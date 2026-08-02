import type { ArtistSet } from "@/types/artist";

/**
 * A live, controllable player for one set.
 *
 * Every provider gives us an embed, but an embed alone only gets you *their*
 * controls inside *their* iframe — which dies the moment the sheet holding it
 * unmounts. To keep a set playing across navigation and drive it from our own
 * transport bar, each provider needs a real control surface behind a common
 * interface.
 */
export interface PlayerHandle {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  /** Must be safe to call twice, and after the provider has already errored. */
  destroy(): void;
  /** False when the provider gives us no way to scrub, so the bar can say so. */
  seekable: boolean;
}

/**
 * Adapters push state rather than being polled, because only they know when
 * their provider is genuinely ready. Every callback is optional to act on — a
 * provider that never reports duration just leaves the timeline open-ended.
 */
export interface PlayerEvents {
  onReady(duration: number | null): void;
  onProgress(position: number, duration: number | null): void;
  onPlay(): void;
  onPause(): void;
  onEnded(): void;
  onError(message: string): void;
}

/**
 * Builds a player inside `mount` — a hidden, body-level host owned by the
 * player provider, deliberately *not* anything React renders in a sheet.
 */
export type CreatePlayer = (
  mount: HTMLElement,
  set: ArtistSet,
  events: PlayerEvents,
) => Promise<PlayerHandle>;
