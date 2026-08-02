import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  bindHandlers,
  publishMetadata,
  publishPlaybackState,
  publishPosition,
} from "@/lib/mediaSession";
import { playerFor, type PlayerHandle } from "@/lib/players";
import type { ArtistSet } from "@/types/artist";

interface PlayerContextValue {
  queue: ArtistSet[];
  index: number;
  current: ArtistSet | null;
  artistName: string | null;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number | null;
  seekable: boolean;
  error: string | null;
  hasNext: boolean;
  hasPrevious: boolean;
  /** Loads a queue and starts at `startIndex`. Re-tapping the live set resumes. */
  playSets(sets: ArtistSet[], startIndex: number, artistName: string | null): void;
  toggle(): void;
  next(): void;
  previous(): void;
  seek(seconds: number): void;
  stop(): void;
  isCurrent(setId: string): boolean;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

/**
 * A 1×1 host pinned to the viewport, owned here rather than by any component
 * that renders UI.
 *
 * This is the whole trick behind playback surviving navigation: the provider's
 * iframe lives in `document.body`, outside React's tree, so closing the artist
 * sheet — or the event sheet under it — cannot unmount it. It stays in the
 * viewport at zero size because browsers suspend media they consider
 * offscreen or hidden.
 */
function createHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.setAttribute("data-player-host", "");
  host.style.cssText =
    "position:fixed;left:0;bottom:0;width:1px;height:1px;overflow:hidden;" +
    "opacity:0;pointer-events:none;z-index:-1;";
  return host;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<ArtistSet[]>([]);
  const [index, setIndex] = useState(0);
  const [artistName, setArtistName] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [seekable, setSeekable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<PlayerHandle | null>(null);
  const currentIdRef = useRef<string | null>(null);

  const current = queue[index] ?? null;
  const hasNext = index < queue.length - 1;
  const hasPrevious = index > 0;

  // A ref, because the adapter's onEnded closure is created once per track and
  // would otherwise capture the queue as it was when that track started.
  const advanceRef = useRef<() => void>(() => undefined);
  advanceRef.current = () => {
    if (hasNext) setIndex((i) => i + 1);
    else setPlaying(false);
  };

  if (hostRef.current === null && typeof document !== "undefined") {
    hostRef.current = createHost();
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    document.body.appendChild(host);
    return () => host.remove();
  }, []);

  // Builds the player for whatever is current. Keyed on the set id rather than
  // the index, so re-opening an artist whose queue starts with the set already
  // playing leaves it playing rather than restarting it.
  useEffect(() => {
    const host = hostRef.current;
    if (!current || !host) return undefined;

    let cancelled = false;
    currentIdRef.current = current.id;
    setLoading(true);
    setError(null);
    setPosition(0);
    setDuration(current.duration);
    setSeekable(true);

    void (async () => {
      try {
        const create = await playerFor(current.provider);
        if (cancelled) return;

        const handle = await create(host, current, {
          onReady: (reported) => {
            if (cancelled) return;
            setLoading(false);
            if (reported) setDuration(reported);
          },
          onProgress: (at, length) => {
            if (cancelled) return;
            setPosition(at);
            if (length) setDuration(length);
          },
          onPlay: () => {
            if (cancelled) return;
            setLoading(false);
            setPlaying(true);
          },
          onPause: () => {
            if (!cancelled) setPlaying(false);
          },
          onEnded: () => {
            if (!cancelled) advanceRef.current();
          },
          onError: (message) => {
            if (cancelled) return;
            setError(message);
            setLoading(false);
            setPlaying(false);
          },
        });

        // The track changed while the SDK was loading; this player is already
        // obsolete and must not be left running in the host.
        if (cancelled) {
          handle.destroy();
          return;
        }
        handleRef.current = handle;
        setSeekable(handle.seekable);
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof Error ? cause.message : "This set couldn't be played.",
        );
        setLoading(false);
        setPlaying(false);
      }
    })();

    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
      setPlaying(false);
    };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock screen / notification shade. Metadata follows the track; the handlers
  // route the OS buttons back through our own transport so the two can't drift
  // apart. Bound after `current` so the closures see the live queue.
  useEffect(() => {
    publishMetadata(current, artistName);
  }, [current, artistName]);

  useEffect(() => {
    publishPlaybackState(playing);
  }, [playing]);

  useEffect(() => {
    publishPosition(position, duration);
  }, [position, duration]);

  const playSets = useCallback(
    (sets: ArtistSet[], startIndex: number, name: string | null) => {
      if (sets.length === 0) return;
      const target = Math.min(Math.max(startIndex, 0), sets.length - 1);
      setQueue(sets);
      setArtistName(name);
      setIndex(target);
      // Tapping the set that is already loaded should resume it, not tear the
      // player down and rebuild it from zero.
      if (handleRef.current && currentIdRef.current === sets[target]?.id) {
        handleRef.current.play();
      }
    },
    [],
  );

  const toggle = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    if (playing) handle.pause();
    else handle.play();
  }, [playing]);

  const next = useCallback(() => {
    setIndex((i) => (i < queue.length - 1 ? i + 1 : i));
  }, [queue.length]);

  const previous = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  const seek = useCallback((seconds: number) => {
    // Guarded like `toggle`. Between a track change and the adapter resolving,
    // there is a window where the timeline already has a length (seeded from
    // the set's own metadata) but no player to drive — optional-chaining the
    // call would drop the seek while `setPosition` still moved the playhead,
    // so the bar would show a position playback never went to.
    const handle = handleRef.current;
    if (!handle) return;
    handle.seek(seconds);
    setPosition(seconds);
  }, []);

  const stop = useCallback(() => {
    handleRef.current?.destroy();
    handleRef.current = null;
    currentIdRef.current = null;
    setQueue([]);
    setIndex(0);
    setArtistName(null);
    setPlaying(false);
    setLoading(false);
    setPosition(0);
    setDuration(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!current) {
      bindHandlers(null);
      return undefined;
    }
    bindHandlers({
      play: () => handleRef.current?.play(),
      pause: () => handleRef.current?.pause(),
      next,
      previous,
      seek,
    });
    return () => bindHandlers(null);
  }, [current, next, previous, seek]);

  const isCurrent = useCallback(
    (setId: string) => current?.id === setId,
    [current?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const value = useMemo<PlayerContextValue>(
    () => ({
      queue,
      index,
      current,
      artistName,
      playing,
      loading,
      position,
      duration,
      seekable,
      error,
      hasNext,
      hasPrevious,
      playSets,
      toggle,
      next,
      previous,
      seek,
      stop,
      isCurrent,
    }),
    [
      queue,
      index,
      current,
      artistName,
      playing,
      loading,
      position,
      duration,
      seekable,
      error,
      hasNext,
      hasPrevious,
      playSets,
      toggle,
      next,
      previous,
      seek,
      stop,
      isCurrent,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used within a PlayerProvider");
  return context;
}
