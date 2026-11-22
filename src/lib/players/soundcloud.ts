import type { CreatePlayer } from "./types";
import { createHiddenIframe, loadScript, withParams } from "./util";

const API = "https://w.soundcloud.com/player/api.js";

/**
 * What the widget hands every event, not only progress: which sound it is
 * talking about, and where that sound is.
 */
interface ScProgress {
  /** SoundCloud's own track id. Present on every event the live widget sends. */
  soundId?: number;
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

  // A real size, clipped by the 1×1 host. At 1×1 the widget's own waveform
  // code throws on every play, pause, seek and swap ("createPattern … a canvas
  // element with a width or height of 0") — an uncaught exception inside their
  // frame, in the middle of the handlers this adapter depends on.
  const iframe = createHiddenIframe(
    withParams(set.embedUrl, { auto_play: "true" }),
    set.title,
    { width: 320, height: 166 },
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
   * What the listener last asked for. `load()` and the first READY used to
   * call `play()` unconditionally, so a Pause tapped while a skipped-into track
   * was still swapping was undone about 2.5 s later when the swap callback
   * fired (P3 and P1 both reproduced it). Every deferred `play()` below checks
   * this first.
   */
  let wantPlay = true;

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

  /**
   * Whose event this is.
   *
   * Measured against the live widget, 2026-11-22: `load()` is answered within
   * ten milliseconds by a PLAY *for the outgoing track*, and only then, most
   * of a second later, by the callback and the new track's own events. This
   * adapter used to take that first PLAY as the new set starting. It ended the
   * swap early — so the outgoing track's position landed on the new title for
   * a second — and it told the player the new set had made sound before a
   * byte of it had arrived, which switched the watchdog off for every set
   * reached by a skip.
   *
   * Every event carries `soundId`, so the question has an exact answer: while
   * a swap is in flight, anything about the outgoing sound is dropped, and the
   * first event about a different sound is the swap having happened. A widget
   * that sends no id (the suites' fake, or a future widget) falls back to what
   * was true before: nothing counts until `load()` calls back.
   */
  let lastSound: number | undefined;
  let outgoing: number | undefined;
  const accept = (payload?: ScProgress): boolean => {
    const id = payload?.soundId;
    if (swapping) {
      if (id === undefined || id === outgoing) return false;
      swapping = false;
    }
    if (id !== undefined) lastSound = id;
    return true;
  };

  /**
   * A PAUSE before the first PLAY is not the listener's.
   *
   * With `auto_play` in the URL and a `play()` on READY — both are needed, see
   * above — the live widget sends PAUSE and then PLAY in the same millisecond
   * on every ordinary start. Forwarded as it came, that PAUSE told the player
   * the listener had paused, which stood the watchdog down before the set had
   * begun. So it is held: if PLAY follows, it was nothing; if nothing follows,
   * the browser refused to start without a tap, and *then* it is a pause.
   */
  let held: number | undefined;
  const PAUSE_GRACE_MS = 2_000;
  const dropHeld = () => {
    if (held !== undefined) window.clearTimeout(held);
    held = undefined;
  };

  /**
   * Where the listener just seeked to, and until when ticks from before it may
   * still be in flight. postMessage means a progress tick sent from the old
   * position can land after `seekTo`, and it would drag the playhead back for a
   * moment — the same race as the one `swapping` closes for `load()`.
   */
  let seekedTo: { seconds: number; until: number } | null = null;
  const SEEK_SETTLE_MS = 500;
  const SEEK_NEAR_S = 2;

  widget.bind(SC.Widget.Events.READY, () => {
    widget.getDuration((ms) => {
      useDuration(ms / 1000);
      events.onReady(duration);
    });
    if (wantPlay) {
      widget.play();
      retry = window.setTimeout(() => {
        if (!started && wantPlay) widget.play();
      }, 700);
    }
  });
  widget.bind(SC.Widget.Events.PLAY, (payload) => {
    if (!accept(payload)) return;
    started = true;
    dropHeld();
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
  widget.bind(SC.Widget.Events.PAUSE, (payload) => {
    if (!accept(payload)) return;
    if (wantPlay && !started) {
      dropHeld();
      held = window.setTimeout(() => {
        held = undefined;
        if (wantPlay && !started) events.onPause();
      }, PAUSE_GRACE_MS);
      return;
    }
    events.onPause();
  });
  widget.bind(SC.Widget.Events.FINISH, (payload) => {
    // The outgoing track can FINISH after load() has already been called; that
    // would advance the queue past the set the listener just chose.
    if (!accept(payload)) return;
    events.onEnded();
  });
  widget.bind(SC.Widget.Events.ERROR, () =>
    events.onError("SoundCloud couldn't play this set."),
  );
  widget.bind(SC.Widget.Events.PLAY_PROGRESS, (payload) => {
    if (!payload || payload.currentPosition == null || !accept(payload)) return;
    if (seekedTo) {
      if (performance.now() > seekedTo.until) {
        seekedTo = null;
      } else if (Math.abs(payload.currentPosition / 1000 - seekedTo.seconds) > SEEK_NEAR_S) {
        return;
      }
    }

    // Keep correcting rather than trusting the first answer: `getDuration` can
    // report 0 at READY and a real length a second later, and `confirmed` only
    // means "not the seed" — it does not mean the widget cannot refine it.
    const derived = durationFrom(payload);
    if (derived && (!confirmed || duration == null || Math.abs(derived - duration) > 1)) {
      useDuration(derived);
    }

    events.onProgress(payload.currentPosition / 1000, duration);
  });

  /** `load()` has called back: the swapped-in track is there to be played. */
  const start = () => {
    // Its own first events can beat this callback. If they have, it is already
    // playing and already past zero; only the length is still worth asking for.
    const already = !swapping && started;
    swapping = false;
    if (retry !== undefined) window.clearTimeout(retry);
    widget.getDuration((ms) => {
      useDuration(ms / 1000);
      events.onReady(duration);
    });
    if (already) return;
    // The swapped-in track begins at zero, and nothing else says so: the first
    // PLAY_PROGRESS can be hundreds of milliseconds away, and until it lands
    // the bar would still be showing the outgoing track's position.
    events.onProgress(0, duration);
    if (!wantPlay) {
      // `load()` was called with auto_play, so the widget is already playing the
      // new track; a pause tapped during the swap has to be re-asserted here and
      // must not arm the retry.
      widget.pause();
      events.onPause();
      return;
    }
    widget.play();
    retry = window.setTimeout(() => {
      if (!started && wantPlay) widget.play();
    }, 700);
  };

  return {
    seekable: true,
    provider: "soundcloud",
    load: (next) => {
      seekedTo = null;
      duration = next.duration;
      confirmed = false;
      swapping = true;
      started = false;
      outgoing = lastSound;
      dropHeld();
      // A skip is a request to play, whatever was asked before it.
      wantPlay = true;
      // The permalink, not the embed URL — load() takes the track's own page.
      //
      // `auto_play: true` stays. The cleaner fix for the pause-during-swap bug is
      // `auto_play: false` plus a `play()` in the callback, but whether a
      // `play()` from inside that callback keeps the iframe's user activation on
      // iOS is unproven. Test it on a real iPhone before switching.
      widget.load(next.url, { auto_play: true, callback: start });
    },
    play: () => {
      wantPlay = true;
      widget.play();
    },
    pause: () => {
      wantPlay = false;
      dropHeld();
      // Cancel the pending start-retry. Without this a pause within 700ms of
      // loading a track gets undone by the retry firing underneath it, and the
      // set resumes on its own.
      if (retry !== undefined) window.clearTimeout(retry);
      widget.pause();
    },
    seek: (seconds) => {
      seekedTo = { seconds, until: performance.now() + SEEK_SETTLE_MS };
      widget.seekTo(seconds * 1000);
    },
    destroy: () => {
      if (retry !== undefined) window.clearTimeout(retry);
      dropHeld();
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
