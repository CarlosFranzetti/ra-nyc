import type { ArtistSet } from "@/types/artist";

/**
 * Lock-screen and notification-shade metadata.
 *
 * Without this the OS falls back to whatever the audio source declares, which
 * for an embedded widget is the widget's own idea of itself — a locked phone
 * showed "SoundCloud widget" and a generic icon rather than the set you queued.
 *
 * The top-level page owns the media session even when the sound is coming from
 * a cross-origin iframe, so setting it here overrides the widget. The action
 * handlers matter just as much as the text: without them the OS controls drive
 * the iframe directly and our transport bar has no idea what happened, so the
 * two fall out of sync the first time you hit pause on the lock screen.
 */

interface Handlers {
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  seek(seconds: number): void;
}

function supported(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

export function publishMetadata(set: ArtistSet | null, artistName: string | null): void {
  if (!supported()) return;
  if (!set) {
    navigator.mediaSession.metadata = null;
    return;
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: set.title,
    artist: artistName ?? "",
    // The provider, not a fake album — being honest about where a set came from
    // is more useful on a lock screen than inventing a release it isn't on.
    album: PROVIDER_ALBUM[set.provider],
    artwork: set.artwork
      ? [{ src: set.artwork, sizes: "500x500", type: "image/jpeg" }]
      : [],
  });
}

const PROVIDER_ALBUM: Record<ArtistSet["provider"], string> = {
  soundcloud: "SoundCloud",
  mixcloud: "Mixcloud",
  archive: "Internet Archive",
};

export function publishPlaybackState(playing: boolean): void {
  if (!supported()) return;
  navigator.mediaSession.playbackState = playing ? "playing" : "paused";
}

/**
 * Position, so the lock screen's scrubber tracks the set rather than sitting at
 * zero. Guarded because the spec rejects a position past the duration, and our
 * providers occasionally report one a fraction over.
 */
export function publishPosition(position: number, duration: number | null): void {
  if (!supported() || !navigator.mediaSession.setPositionState) return;
  if (!duration || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(Math.max(position, 0), duration),
      playbackRate: 1,
    });
  } catch {
    // Not worth breaking playback over a rejected position.
  }
}

export function bindHandlers(handlers: Handlers | null): void {
  if (!supported()) return;
  const set = (action: MediaSessionAction, fn: (() => void) | null) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch {
      // Not every browser implements every action; an unsupported one throws.
    }
  };

  if (!handlers) {
    for (const action of [
      "play",
      "pause",
      "nexttrack",
      "previoustrack",
      "seekto",
      "stop",
    ] as MediaSessionAction[]) {
      set(action, null);
    }
    return;
  }

  set("play", handlers.play);
  set("pause", handlers.pause);
  set("nexttrack", handlers.next);
  set("previoustrack", handlers.previous);
  set("stop", handlers.pause);
  try {
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") handlers.seek(details.seekTime);
    });
  } catch {
    // Same: seekto is not universally supported.
  }
}
