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
  // Seed from the resolver's metadata so the timeline has a length before the
  // widget reports one.
  let duration = set.duration;

  widget.bind(SC.Widget.Events.READY, () => {
    widget.getDuration((ms) => {
      if (ms > 0) duration = ms / 1000;
      events.onReady(duration);
    });
    widget.play();
  });
  widget.bind(SC.Widget.Events.PLAY, () => events.onPlay());
  widget.bind(SC.Widget.Events.PAUSE, () => events.onPause());
  widget.bind(SC.Widget.Events.FINISH, () => events.onEnded());
  widget.bind(SC.Widget.Events.ERROR, () =>
    events.onError("SoundCloud couldn't play this set."),
  );
  widget.bind(SC.Widget.Events.PLAY_PROGRESS, (payload) => {
    if (payload?.currentPosition != null) {
      events.onProgress(payload.currentPosition / 1000, duration);
    }
  });

  return {
    seekable: true,
    play: () => widget.play(),
    pause: () => widget.pause(),
    seek: (seconds) => widget.seekTo(seconds * 1000),
    destroy: () => {
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
