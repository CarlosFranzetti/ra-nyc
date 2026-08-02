import type { CreatePlayer } from "./types";
import { loadScript } from "./util";

const API = "https://www.youtube.com/iframe_api";
const POLL_MS = 500;

interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}

interface YtNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: () => void;
      };
    },
  ) => YtPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ready: Promise<void> | null = null;

/**
 * The script's `load` event fires before the API is usable — YouTube signals
 * readiness by calling a global instead. Chaining onto any existing handler
 * keeps this safe if something else on the page ever wants the same hook.
 */
function ensureApi(): Promise<void> {
  if (ready) return ready;
  ready = new Promise<void>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    loadScript(API).catch((error: unknown) => {
      ready = null;
      reject(error instanceof Error ? error : new Error("YouTube API failed"));
    });
  });
  return ready;
}

/**
 * YouTube, via the IFrame API.
 *
 * Only reachable when `YOUTUBE_API_KEY` is set server-side, so in practice this
 * is the least-exercised adapter. It also polls rather than subscribing: the
 * IFrame API reports state transitions but has no progress event, so the
 * timeline has to ask.
 */
export const createYoutubePlayer: CreatePlayer = async (mount, set, events) => {
  await ensureApi();
  const YT = window.YT;
  if (!YT) throw new Error("YouTube player unavailable");

  const videoId = new URL(set.embedUrl).pathname.split("/").filter(Boolean).pop();
  if (!videoId) throw new Error("Unrecognised YouTube video");

  // YT replaces this node with its iframe, so it needs to be a throwaway.
  const host = document.createElement("div");
  host.style.cssText = "width:1px;height:1px;opacity:0;pointer-events:none;";
  mount.appendChild(host);

  let timer: number | undefined;
  const stopPolling = () => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  };

  const player: YtPlayer = new YT.Player(host, {
    videoId,
    host: "https://www.youtube-nocookie.com",
    playerVars: { autoplay: 1, playsinline: 1, controls: 0 },
    events: {
      onReady: () => {
        const reported = player.getDuration();
        events.onReady(reported > 0 ? reported : set.duration);
        player.playVideo();
      },
      onStateChange: ({ data }) => {
        if (data === YT.PlayerState.PLAYING) {
          events.onPlay();
          stopPolling();
          timer = window.setInterval(() => {
            const length = player.getDuration();
            events.onProgress(
              player.getCurrentTime(),
              length > 0 ? length : set.duration,
            );
          }, POLL_MS);
        } else if (data === YT.PlayerState.PAUSED) {
          stopPolling();
          events.onPause();
        } else if (data === YT.PlayerState.ENDED) {
          stopPolling();
          events.onEnded();
        }
      },
      onError: () => events.onError("YouTube couldn't play this set."),
    },
  });

  return {
    seekable: true,
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    seek: (seconds) => player.seekTo(seconds, true),
    destroy: () => {
      stopPolling();
      try {
        player.destroy();
      } catch {
        /* already torn down */
      }
    },
  };
};
