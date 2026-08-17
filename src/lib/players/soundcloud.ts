import type { CreatePlayer } from "./types";
import { createHiddenIframe, loadScript, withParams } from "./util";

const API = "https://w.soundcloud.com/player/api.js";

interface ScProgress {
  currentPosition?: number;
  relativePosition?: number;
}

interface ScWidget {
  bind(event: string, callback: (payload?: ScProgress) => void): void;
  play(): void;
  pause(): void;
  seekTo(milliseconds: number): void;
  getDuration(callback: (milliseconds: number) => void): void;
  load(url: string, options: { auto_play?: boolean; callback?: () => void }): void;
}

interface ScNamespace {
  Widget: ((iframe: HTMLIFrameElement) => ScWidget) & {
    Events: {
      READY: string;
      PLAY: string;
      PAUSE: string;
      FINISH: string;
      PLAY_PROGRESS: string;
      ERROR: string;
    };
  };
}

declare global {
  interface Window {
    SC?: ScNamespace;
  }
}

/**
 * SoundCloud, via their Widget API.
 *
 * The widget talks postMessage, so the iframe can be invisible and still be
 * fully driven from our own transport. `auto_play=true` *and* an explicit
 * `play()` on ready: the URL flag is what satisfies mobile autoplay policy
 * (the iframe is created inside the tap that started playback), and the call
 * covers the case where the widget was already loaded before we bound.
 */
export const createSoundcloudPlayer: CreatePlayer = async (mount, set, events) => {
  await loadScript(API);
  const SC = window.SC;
  if (!SC) throw new Error("SoundCloud player unavailable");

  const iframe = createHiddenIframe(
    withParams(set.embedUrl, { auto_play: "true" }),
    set.title,
  );
  mount.appendChild(iframe);

  const widget = SC.Widget(iframe);

  /**
   * The timeline's length, and where it came from.
   *
   * `set.duration` is the resolver's metadata — a seed, so the bar has *a*
   * length before the widget will tell us one. It is frequently wrong: RA and
   * the oEmbed lookup disagree, and for a lot of sets it is simply absent.
   *
   * This adapter used to ask `getDuration` once, at READY, and then hand that
   * number to every progress tick for the rest of the track. When the widget
   * answers 0 at READY — which it often does, because it is ready to take
   * commands before it has parsed the track — the seed was never replaced, and
   * every subsequent tick actively re-asserted it. A two-hour set on a
   * forty-minute guess pins the playhead at the far right after forty minutes
   * and stays there; a guess that is too long never lets it reach the end. That
   * is the "timeline is not accurate" bug, and it was SoundCloud-specific:
   * every other adapter here re-reads its duration as it plays.
   */
  let duration = set.duration;
  let confirmed = false;

  const useDuration = (seconds: number) => {
    if (!(seconds > 0)) return;
    duration = seconds;
    confirmed = true;
  };

  /**
   * The widget's own arithmetic, free on every tick.
   *
   * `PLAY_PROGRESS` carries `relativePosition` (0–1) alongside `currentPosition`
   * (ms), so the true length is one division — no async call, no polling, and
   * it self-corrects if the first answer was wrong. Guarded above 1% because
   * near zero the division amplifies rounding into wild numbers.
   */
  const durationFrom = (payload: ScProgress): number | null => {
    const at = payload.currentPosition;
    const fraction = payload.relativePosition;
    if (at == null || fraction == null || fraction < 0.01) return null;
    return at / 1000 / fraction;
  };

  // If the first play() is swallowed, try once more. The widget occasionally
  // reports ready a beat before it will actually accept a command, and a set
  // that sits silent after you tapped it reads as broken rather than slow.
  let started = false;
  let retry: number | undefined;

  /**
   * True between `load()` and the widget confirming the swap.
   *
   * The handle is deliberately reused across tracks — that is what makes the
   * second set start on one tap — but reuse means the *same* progress binding
   * serves every track, and the outgoing track keeps emitting for a moment
   * after `load()` is called. Those late ticks landed as the new track's
   * position, so a set skipped into from thirty minutes in opened its timeline
   * at thirty minutes and then jumped back. Dropping progress while a swap is
   * in flight is what makes a new track actually start at zero.
   */
  let swapping = false;

  widget.bind(SC.Widget.Events.READY, () => {
    widget.getDuration((ms) => {
      useDuration(ms / 1000);
      events.onReady(duration);
    });
    widget.play();
    retry = window.setTimeout(() => {
      if (!started) widget.play();
    }, 700);
  });
  widget.bind(SC.Widget.Events.PLAY, () => {
    started = true;
    swapping = false;
    // Ask again, now that there is something to ask about. PLAY is the first
    // moment the widget has definitely parsed the track, whereas READY only
    // means it will accept commands — that gap is why asking once was never
    // enough. The relativePosition arithmetic below is the backstop rather than
    // the primary: it cannot answer until 1% of the track has played, which on
    // an hour-long mix is the first thirty-six seconds.
    widget.getDuration((ms) => {
      const before = duration;
      useDuration(ms / 1000);
      if (duration !== before) events.onReady(duration);
    });
    events.onPlay();
  });
  widget.bind(SC.Widget.Events.PAUSE, () => events.onPause());
  widget.bind(SC.Widget.Events.FINISH, () => events.onEnded());
  widget.bind(SC.Widget.Events.ERROR, () =>
    events.onError("SoundCloud couldn't play this set."),
  );
  widget.bind(SC.Widget.Events.PLAY_PROGRESS, (payload) => {
    if (swapping || !payload || payload.currentPosition == null) return;

    // Keep correcting rather than trusting the first answer: `getDuration` can
    // report 0 at READY and a real length a second later, and `confirmed` only
    // means "not the seed" — it does not mean the widget cannot refine it.
    const derived = durationFrom(payload);
    if (derived && (!confirmed || duration == null || Math.abs(derived - duration) > 1)) {
      useDuration(derived);
    }

    events.onProgress(payload.currentPosition / 1000, duration);
  });

  /** Kick playback and re-arm the retry. Shared by first load and every swap. */
  const start = () => {
    started = false;
    swapping = false;
    if (retry !== undefined) window.clearTimeout(retry);
    widget.getDuration((ms) => {
      useDuration(ms / 1000);
      events.onReady(duration);
    });
    // The swapped-in track begins at zero, and nothing else says so: the first
    // PLAY_PROGRESS can be hundreds of milliseconds away, and until it lands
    // the bar would still be showing the outgoing track's position.
    events.onProgress(0, duration);
    widget.play();
    retry = window.setTimeout(() => {
      if (!started) widget.play();
    }, 700);
  };

  return {
    seekable: true,
    provider: "soundcloud",
    load: (next) => {
      duration = next.duration;
      confirmed = false;
      swapping = true;
      // The permalink, not the embed URL — load() takes the track's own page.
      widget.load(next.url, { auto_play: true, callback: start });
    },
    play: () => widget.play(),
    pause: () => {
      // Cancel the pending start-retry. Without this a pause within 700ms of
      // loading a track gets undone by the retry firing underneath it, and the
      // set resumes on its own.
      if (retry !== undefined) window.clearTimeout(retry);
      widget.pause();
    },
    seek: (seconds) => widget.seekTo(seconds * 1000),
    destroy: () => {
      if (retry !== undefined) window.clearTimeout(retry);
      // The iframe may already be detached; pausing a dead widget throws.
      try {
        widget.pause();
      } catch {
        /* nothing to stop */
      }
      iframe.remove();
    },
  };
};
