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

/** What a queue was started *from*, so the transport can link back to it. */
export interface PlaybackSource {
  /** Shown in the bar — the party's name. */
  label: string;
  /** Where tickets are. Always an ra.co event page. */
  url: string;
}

interface PlayerContextValue {
  queue: ArtistSet[];
  index: number;
  current: ArtistSet | null;
  artistName: string | null;
  /** Set when the queue is a party preview rather than one artist's catalogue. */
  source: PlaybackSource | null;
  /** Seconds of *actual playback* since this source started. */
  listened: number;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number | null;
  seekable: boolean;
  error: string | null;
  hasNext: boolean;
  hasPrevious: boolean;
  /** Loads a queue and starts at `startIndex`. Re-tapping the live set resumes. */
  playSets(
    sets: ArtistSet[],
    startIndex: number,
    artistName: string | null,
    source?: PlaybackSource | null,
  ): void;
  /**
   * Adds to the end of the queue without disturbing what is playing.
   *
   * This is what lets a party preview start on the first DJ who resolves
   * instead of waiting for the whole lineup — the rest arrive behind the music.
   */
  appendSets(sets: ArtistSet[]): void;
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
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const [listened, setListened] = useState(0);
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

  // Builds — or reuses — the player for whatever is current.
  //
  // Keyed on the set id rather than the index, so re-opening an artist whose
  // queue starts with the set already playing leaves it playing.
  //
  // The cleanup deliberately does NOT destroy the handle. React runs the
  // previous cleanup before the next effect, so tearing down here would kill
  // the very iframe the next track wants to reuse — and a rebuilt cross-origin
  // iframe has no user activation, which is exactly why every set after the
  // first needed a second tap on play. Teardown now happens where it belongs:
  // when the provider actually changes, on stop, and on unmount.
  useEffect(() => {
    const host = hostRef.current;
    if (!current || !host) return undefined;

    currentIdRef.current = current.id;
    setLoading(true);
    setError(null);
    setPosition(0);
    setDuration(current.duration);

    const existing = handleRef.current;
    if (existing && existing.provider === current.provider && existing.load) {
      existing.load(current);
      setSeekable(existing.seekable);
      return undefined;
    }

    // Different provider, or nothing playing yet: this one has to be rebuilt.
    existing?.destroy();
    handleRef.current = null;
    setSeekable(true);

    let cancelled = false;
    void (async () => {
      try {
        const create = await playerFor(current.provider);
        if (cancelled) return;

        // No `cancelled` guards inside these: a handle that is no longer ours
        // has been destroyed and its iframe removed, so it cannot still be
        // emitting — whereas a *reused* handle is current and its events must
        // keep landing. Guarding on a per-run flag silently deafened it.
        const handle = await create(host, current, {
          onReady: (reported) => {
            setLoading(false);
            if (reported) setDuration(reported);
          },
          onProgress: (at, length) => {
            setPosition(at);
            if (length) setDuration(length);
          },
          onPlay: () => {
            setLoading(false);
            setPlaying(true);
          },
          onPause: () => setPlaying(false),
          onEnded: () => advanceRef.current(),
          onError: (message) => {
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
    };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The only unconditional teardown: leaving the app entirely.
  useEffect(
    () => () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    },
    [],
  );

  // Lock screen / notification shade. Metadata follows the track; the handlers
  // route the OS buttons back through our own transport so the two can't drift
  // apart. Bound after `current` so the closures see the live queue.
  useEffect(() => {
    publishMetadata(current, artistName);
  }, [current, artistName]);

  useEffect(() => {
    publishPlaybackState(playing);
  }, [playing]);

  /**
   * Time actually spent listening to the current source.
   *
   * A wall clock would count the twenty minutes the phone spent in a pocket
   * paused, which is the opposite of interest. Ticking only while `playing` is
   * what makes this mean "kept listening" — and that is the whole basis for
   * showing a ticket link, so it has to be honest or the link is just an ad.
   */
  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => setListened((seconds) => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    publishPosition(position, duration);
  }, [position, duration]);

  const playSets = useCallback(
    (
      sets: ArtistSet[],
      startIndex: number,
      name: string | null,
      from: PlaybackSource | null = null,
    ) => {
      if (sets.length === 0) return;
      const target = Math.min(Math.max(startIndex, 0), sets.length - 1);
      setQueue(sets);
      setArtistName(name);
      setSource(from);
      setListened(0);
      setIndex(target);
      // Tapping the set that is already loaded should resume it, not tear the
      // player down and rebuild it from zero.
      if (handleRef.current && currentIdRef.current === sets[target]?.id) {
        handleRef.current.play();
      }
    },
    [],
  );

  const appendSets = useCallback((sets: ArtistSet[]) => {
    if (sets.length === 0) return;
    setQueue((existing) => {
      // A late arrival that is already queued must not create a duplicate — the
      // preview resolves artists concurrently and two of them can legitimately
      // return the same b2b recording.
      const seen = new Set(existing.map((set) => set.url || set.id));
      const additions = sets.filter((set) => !seen.has(set.url || set.id));
      return additions.length === 0 ? existing : [...existing, ...additions];
    });
  }, []);

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
    setSource(null);
    setListened(0);
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
      source,
      listened,
      playing,
      loading,
      position,
      duration,
      seekable,
      error,
      hasNext,
      hasPrevious,
      playSets,
      appendSets,
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
      source,
      listened,
      playing,
      loading,
      position,
      duration,
      seekable,
      error,
      hasNext,
      hasPrevious,
      playSets,
      appendSets,
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
