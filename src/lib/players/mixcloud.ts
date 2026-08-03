import type { CreatePlayer } from "./types";
import { createHiddenIframe, loadScript } from "./util";

const API = "https://widget.mixcloud.com/media/js/widgetApi.js";

interface MixcloudEvent<T extends unknown[]> {
  on(callback: (...args: T) => void): void;
}

interface MixcloudWidget {
  ready: Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<boolean>;
  getDuration(): Promise<number>;
  events: {
    play: MixcloudEvent<[]>;
    pause: MixcloudEvent<[]>;
    ended: MixcloudEvent<[]>;
    error: MixcloudEvent<[]>;
    progress: MixcloudEvent<[number, number]>;
  };
}

interface MixcloudNamespace {
  PlayerWidget(iframe: HTMLIFrameElement): MixcloudWidget;
}

declare global {
  interface Window {
    Mixcloud?: MixcloudNamespace;
  }
}

/**
 * Mixcloud, via their widget API.
 *
 * Unlike SoundCloud's callback-on-ready, Mixcloud hands back a `ready` promise
 * that must settle before any control call is accepted — so binding and the
 * initial play both wait on it.
 */
export const createMixcloudPlayer: CreatePlayer = async (mount, set, events) => {
  await loadScript(API);
  const Mixcloud = window.Mixcloud;
  if (!Mixcloud) throw new Error("Mixcloud player unavailable");

  const iframe = createHiddenIframe(set.embedUrl, set.title);
  mount.appendChild(iframe);

  const widget = Mixcloud.PlayerWidget(iframe);
  await widget.ready;

  let duration = set.duration;
  try {
    const reported = await widget.getDuration();
    if (reported > 0) duration = reported;
  } catch {
    // Keep the resolver's figure.
  }
  events.onReady(duration);

  widget.events.play.on(() => events.onPlay());
  widget.events.pause.on(() => events.onPause());
  widget.events.ended.on(() => events.onEnded());
  widget.events.error.on(() => events.onError("Mixcloud couldn't play this set."));
  widget.events.progress.on((position, reportedDuration) => {
    if (reportedDuration > 0) duration = reportedDuration;
    events.onProgress(position, duration);
  });

  void widget.play();

  return {
    seekable: true,
    provider: "mixcloud",
    play: () => void widget.play(),
    pause: () => void widget.pause(),
    seek: (seconds) => void widget.seek(seconds),
    destroy: () => {
      void widget.pause().catch(() => undefined);
      iframe.remove();
    },
  };
};
