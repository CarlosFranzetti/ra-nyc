import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
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

/**
 * One row of the playlist.
 *
 * The DJ's name and the party travel with the *entry*, not with the queue. They
 * used to be two `useState`s for the whole queue, so every set after the first
 * was labelled with whoever started the queue — the wrong DJ in the bar, on the
 * lock screen, and a Tickets link to the wrong party.
 *
 * `uid` identifies the entry rather than the set: the same set can legitimately
 * be queued twice (`playNext` keeps an earlier copy), and a row key or a
 * "did the current entry change" test needs something position cannot give it.
 */
export interface QueueEntry {
  uid: number;
  set: ArtistSet;
  artistName: string | null;
  source: PlaybackSource | null;
}

/** What a caller hands in; the player mints the uid. */
export interface QueueItem {
  set: ArtistSet;
  artistName?: string | null;
  source?: PlaybackSource | null;
}

interface PlayerContextValue {
  queue: ArtistSet[];
  /** The queue with each row's own DJ, party and stable uid. */
  entries: readonly QueueEntry[];
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
   * Adds to the end of the queue without disturbing what is playing. A no-op on
   * an empty queue: a late arrival after Close must not bring the player back.
   *
   * Nothing in `src` calls this any more — the preview uses `playNext` and
   * `insertAfter` so a taster stays contiguous. Kept as the plain "add to the
   * tail" primitive.
   */
  appendSets(items: QueueItem[]): void;
  /**
   * The `+` next to every play button: put this at the end of the playlist.
   *
   * With something already playing this is purely additive — the music does not
   * change. With nothing playing there is nothing to queue *behind*, so it
   * starts: a transport bar showing a track the listener has to press play on
   * again is a worse answer than the obvious one. If the queue has already run
   * to its end, the new set starts for the same reason.
   *
   * Dedupes by URL, within the batch as well as against the queue — a b2b
   * resolved from both of its DJs is one recording and goes in once.
   */
  enqueue(items: QueueItem[]): void;
  /**
   * The play button, once a playlist exists: play this now and keep the rest.
   *
   * The set goes in immediately after whatever is playing and becomes current,
   * so the queue you built carries on behind it. Returns the uid of the entry
   * now holding the set, so a caller can keep inserting behind it.
   */
  playNext(set: ArtistSet, name?: string | null, source?: PlaybackSource | null): number | null;
  /**
   * Put a set straight after a given entry without starting it. Returns the uid
   * of the entry holding the set (the existing one if it was already queued).
   */
  insertAfter(
    anchorUid: number,
    set: ArtistSet,
    name?: string | null,
    source?: PlaybackSource | null,
  ): number | null;
  /** Jump straight to a position in the playlist. */
  jumpTo(position: number): void;
  /** Take a set out of the playlist. */
  removeAt(position: number): void;
  toggle(): void;
  next(): void;
  previous(): void;
  seek(seconds: number): void;
  stop(): void;
  isCurrent(setId: string): boolean;
  /**
   * Bumps on every Close. An async caller captures it at tap time and drops its
   * result if it changed: a lookup that resolves after Close must not restart
   * music the listener just shut off.
   */
  getEpoch(): number;
}

// ── Queue state ──────────────────────────────────────────────────────────────
//
// A reducer, not two `useState`s. The callbacks it replaced closed over
// `queue` and `index` as they were at *tap* time, and the callers run them in a
// `.then` seconds later — so a slow `+` decided "the queue is empty, start
// playing" against a queue that had since filled, and replaced it. A reducer is
// handed the live state at the moment the action lands.

interface QueueState {
  entries: QueueEntry[];
  index: number;
  /** The last set finished and there was nothing after it. */
  ended: boolean;
  /**
   * Bumped when the current *entry* changes but the current set id does not —
   * the load effect is keyed on the id, so without this a same-id neighbour
   * (a duplicate that got adjacent) never reloads and playback freezes.
   */
  reload: number;
}

type QueueAction =
  | { type: "PLAY_SETS"; items: QueueEntry[]; start: number }
  | { type: "APPEND"; items: QueueEntry[] }
  | { type: "ENQUEUE"; items: QueueEntry[] }
  | { type: "PLAY_NEXT"; item: QueueEntry }
  | { type: "INSERT_AFTER"; anchorUid: number; item: QueueEntry }
  | { type: "JUMP"; position: number }
  | { type: "NEXT" }
  | { type: "PREV" }
  | { type: "REMOVE"; position: number }
  | { type: "ADVANCE" }
  | { type: "RESUMED" }
  | { type: "RETRY" }
  | { type: "STOP" };

const INITIAL: QueueState = { entries: [], index: 0, ended: false, reload: 0 };

/**
 * Minted outside the reducer so it stays pure — React runs reducers twice in
 * StrictMode, and a counter bumped inside would hand the two runs different
 * uids.
 */
let nextUid = 1;
const mint = (item: QueueItem): QueueEntry => ({
  uid: nextUid++,
  set: item.set,
  artistName: item.artistName ?? null,
  source: item.source ?? null,
});

/**
 * How two sets are told apart across the queue.
 *
 * By URL where there is one, because the same recording legitimately arrives
 * twice — a b2b resolved from each of its two DJs is one upload with two
 * artist ids, and queueing it twice would play it twice in a row.
 */
const keyOf = (set: ArtistSet) => set.url || set.id;

/** First occurrence wins; `against` seeds what is already taken. */
function fresh(items: QueueEntry[], against: readonly QueueEntry[] = []): QueueEntry[] {
  const seen = new Set(against.map((entry) => keyOf(entry.set)));
  return items.filter((entry) => {
    const key = keyOf(entry.set);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function step(state: QueueState, action: QueueAction): QueueState {
  const { entries, index } = state;
  switch (action.type) {
    case "PLAY_SETS": {
      if (action.items.length === 0) return state;
      const start = Math.min(Math.max(action.start, 0), action.items.length - 1);
      // The remap matters: the caller's `start` indexes the list it passed, and
      // dedupe can shift everything after a dropped duplicate.
      const targetKey = keyOf(action.items[start]!.set);
      const next = fresh(action.items);
      const at = next.findIndex((entry) => keyOf(entry.set) === targetKey);
      return { ...state, entries: next, index: Math.max(at, 0), ended: false };
    }
    case "APPEND": {
      if (entries.length === 0) return state;
      const additions = fresh(action.items, entries);
      return additions.length === 0
        ? state
        : { ...state, entries: [...entries, ...additions] };
    }
    case "ENQUEUE": {
      if (entries.length === 0) {
        return step(state, { type: "PLAY_SETS", items: action.items, start: 0 });
      }
      const additions = fresh(action.items, entries);
      if (additions.length === 0) return state;
      const merged = [...entries, ...additions];
      return state.ended
        ? { ...state, entries: merged, index: entries.length, ended: false }
        : { ...state, entries: merged };
    }
    case "PLAY_NEXT": {
      if (entries.length === 0) {
        return step(state, { type: "PLAY_SETS", items: [action.item], start: 0 });
      }
      const key = keyOf(action.item.set);
      // Already the live set: the caller resumes it.
      if (entries[index] && keyOf(entries[index]!.set) === key) return state;
      // Straight after the current one, with the tail behind it. A copy already
      // waiting further down is dropped, or skipping forward would reach it a
      // second time.
      const tail = entries.slice(index + 1).filter((e) => keyOf(e.set) !== key);
      return {
        ...state,
        entries: [...entries.slice(0, index + 1), action.item, ...tail],
        index: index + 1,
        ended: false,
      };
    }
    case "INSERT_AFTER": {
      if (entries.length === 0) return state;
      const key = keyOf(action.item.set);
      if (entries.some((e) => keyOf(e.set) === key)) return state;
      const anchor = entries.findIndex((e) => e.uid === action.anchorUid);
      const at = anchor === -1 ? entries.length : anchor + 1;
      const merged = [...entries.slice(0, at), action.item, ...entries.slice(at)];
      return { ...state, entries: merged, index: at <= index ? index + 1 : index };
    }
    case "JUMP":
      if (action.position < 0 || action.position >= entries.length) return state;
      return { ...state, index: action.position, ended: false };
    case "NEXT":
      return index < entries.length - 1
        ? { ...state, index: index + 1, ended: false }
        : state;
    case "PREV":
      return index > 0 ? { ...state, index: index - 1, ended: false } : state;
    case "REMOVE": {
      if (action.position < 0 || action.position >= entries.length) return state;
      const remaining = entries.filter((_, i) => i !== action.position);
      // Removing something earlier shifts everything after it down, so the
      // playhead moves with it or the wrong track becomes current. Removing the
      // live one leaves the index where it is, which now points at what was
      // next — the same thing skipping forward would have done.
      const moved =
        action.position < index
          ? index - 1
          : Math.min(index, Math.max(remaining.length - 1, 0));
      return { ...state, entries: remaining, index: moved };
    }
    case "ADVANCE":
      return index < entries.length - 1
        ? { ...state, index: index + 1 }
        : { ...state, ended: true };
    case "RESUMED":
      return state.ended ? { ...state, ended: false } : state;
    case "RETRY":
      return { ...state, reload: state.reload + 1 };
    case "STOP":
      // `reload` keeps counting: a Close and a play in one batch must still
      // look like a change to the load effect.
      return { ...INITIAL, reload: state.reload + 1 };
  }
}

function reduce(state: QueueState, action: QueueAction): QueueState {
  const next = step(state, action);
  if (next === state || action.type === "PLAY_SETS") return next;
  const before = state.entries[state.index];
  const after = next.entries[next.index];
  // The reload rule, once, for every transition: a different entry holding the
  // same set. Removing a row *above* the live one changes neither uid nor id,
  // so the live set is not restarted from 0:00.
  if (before && after && before.set.id === after.set.id && before.uid !== after.uid) {
    return { ...next, reload: next.reload + 1 };
  }
  return next;
}

const BUILD_FAILED = "Couldn't load the player. Tap play to try again.";

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
  const [state, rawDispatch] = useReducer(reduce, INITIAL);
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
  /** Silences the live handle's events; called just before it is destroyed. */
  const killRef = useRef<() => void>(() => undefined);
  const buildFailedRef = useRef(false);
  const epochRef = useRef(0);

  // The queue as it is *now*, not as of the last render. Every dispatch also
  // runs the (pure) reducer on this copy, so a second call in the same tick —
  // the preview inserting behind the entry it just started — sees the first.
  const stateRef = useRef<QueueState>(INITIAL);
  const dispatch = useCallback((action: QueueAction) => {
    stateRef.current = reduce(stateRef.current, action);
    rawDispatch(action);
  }, []);

  const { entries, index, reload } = state;
  const entry = entries[index] ?? null;
  const current = entry?.set ?? null;
  const artistName = entry?.artistName ?? null;
  const source = entry?.source ?? null;
  const queue = useMemo(() => entries.map((e) => e.set), [entries]);
  const hasNext = index < entries.length - 1;
  const hasPrevious = index > 0;

  const loadingRef = useRef(false);
  loadingRef.current = loading;
  const durationRef = useRef<number | null>(null);
  durationRef.current = duration;

  // `stop` is declared below, and `removeAt` needs it when the last set is taken
  // out of the playlist. A ref keeps the two from having to be declared in
  // dependency order.
  const stopRef = useRef<() => void>(() => undefined);

  // A ref, because the adapter's onEnded closure is created once per track and
  // would otherwise capture the queue as it was when that track started.
  const advanceRef = useRef<() => void>(() => undefined);
  advanceRef.current = () => {
    dispatch({ type: "ADVANCE" });
    if (stateRef.current.ended) setPlaying(false);
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

  /** Deafen, then destroy. Archive emits a `pause` as it is torn down. */
  const destroyHandle = useCallback(() => {
    killRef.current();
    killRef.current = () => undefined;
    handleRef.current?.destroy();
    handleRef.current = null;
  }, []);

  // The reset, before paint. In a `useEffect` it ran *after* the new title had
  // already painted, so every track change showed the new name over the old
  // position and length for two frames (P2 sampled it with rAF).
  useLayoutEffect(() => {
    if (!current) return;
    currentIdRef.current = current.id;
    buildFailedRef.current = false;
    setLoading(true);
    setError(null);
    setPosition(0);
    setDuration(current.duration);
  }, [current?.id, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // Builds — or reuses — the player for whatever is current.
  //
  // Keyed on the set id rather than the index, so re-opening an artist whose
  // queue starts with the set already playing leaves it playing. `reload` is the
  // other half: it changes when a *different entry* holds the same set, or when
  // a failed build is retried.
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

    const existing = handleRef.current;
    if (existing && existing.provider === current.provider && existing.load) {
      existing.load(current);
      setSeekable(existing.seekable);
      return undefined;
    }

    // Different provider, or nothing playing yet: this one has to be rebuilt.
    destroyHandle();
    setSeekable(true);

    let cancelled = false;
    // `dead` silences a build that was superseded before it was adopted. Once
    // adopted the handle is current and its events must keep landing — guarding
    // on `cancelled` instead silently deafened a reused handle — so adoption
    // freezes the flag and only `killRef` can set it afterwards.
    let adopted = false;
    let dead = false;
    const live =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (!dead) fn(...args);
      };

    void (async () => {
      try {
        const create = await playerFor(current.provider);
        if (cancelled) return;

        const handle = await create(host, current, {
          onReady: live((reported) => {
            setLoading(false);
            if (reported) setDuration(reported);
          }),
          onProgress: live((at, length) => {
            setPosition(at);
            if (length) setDuration(length);
            // Progress means audio is moving. `onPlay` is not always the last
            // word — the error text used to outlive the failure that caused it.
            setError(null);
          }),
          onPlay: live(() => {
            setLoading(false);
            setError(null);
            setPlaying(true);
            if (stateRef.current.ended) dispatch({ type: "RESUMED" });
          }),
          onPause: live(() => setPlaying(false)),
          onEnded: live(() => advanceRef.current()),
          onError: live((message) => {
            setError(message);
            setLoading(false);
            setPlaying(false);
          }),
        });

        // The track changed while the SDK was loading; this player is already
        // obsolete and must not be left running in the host.
        if (cancelled) {
          dead = true;
          handle.destroy();
          return;
        }
        adopted = true;
        killRef.current = () => {
          dead = true;
        };
        handleRef.current = handle;
        setSeekable(handle.seekable);
      } catch (cause) {
        if (cancelled) return;
        // Never `cause.message`: for a script that failed to load it is the raw
        // URL, which is what the bar used to print.
        void cause;
        buildFailedRef.current = true;
        setError(BUILD_FAILED);
        setLoading(false);
        setPlaying(false);
      }
    })();

    return () => {
      cancelled = true;
      if (!adopted) dead = true;
    };
  }, [current?.id, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // The only unconditional teardown: leaving the app entirely.
  useEffect(
    () => () => {
      killRef.current();
      handleRef.current?.destroy();
      handleRef.current = null;
    },
    [],
  );

  // Lock screen / notification shade. Metadata follows the track — with this
  // entry's own DJ, not the queue's first; the handlers route the OS buttons
  // back through our own transport so the two can't drift apart.
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

  // Per *source*, not per `playSets` call: resuming the live set used to zero
  // the clock and take the Tickets link away from someone who had earned it,
  // whereas moving to another party's entry starts a new count.
  useEffect(() => {
    setListened(0);
  }, [source?.url]);

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
      dispatch({
        type: "PLAY_SETS",
        items: sets.map((set) => mint({ set, artistName: name, source: from })),
        start: target,
      });
      // Tapping the set that is already loaded should resume it, not tear the
      // player down and rebuild it from zero.
      if (handleRef.current && currentIdRef.current === sets[target]?.id) {
        handleRef.current.play();
      }
    },
    [dispatch],
  );

  const appendSets = useCallback(
    (items: QueueItem[]) => {
      if (items.length === 0) return;
      dispatch({ type: "APPEND", items: items.map(mint) });
    },
    [dispatch],
  );

  const enqueue = useCallback(
    (items: QueueItem[]) => {
      if (items.length === 0) return;
      dispatch({ type: "ENQUEUE", items: items.map(mint) });
    },
    [dispatch],
  );

  const playNext = useCallback(
    (
      set: ArtistSet,
      name: string | null = null,
      from: PlaybackSource | null = null,
    ): number | null => {
      const live = stateRef.current;
      const playingEntry = live.entries[live.index];
      // Already the live set — resume rather than splicing a second copy of it
      // in beside itself.
      if (playingEntry && keyOf(playingEntry.set) === keyOf(set)) {
        handleRef.current?.play();
        return playingEntry.uid;
      }
      const item = mint({ set, artistName: name, source: from });
      dispatch({ type: "PLAY_NEXT", item });
      return item.uid;
    },
    [dispatch],
  );

  const insertAfter = useCallback(
    (
      anchorUid: number,
      set: ArtistSet,
      name: string | null = null,
      from: PlaybackSource | null = null,
    ): number | null => {
      const existing = stateRef.current.entries.find((e) => keyOf(e.set) === keyOf(set));
      if (existing) return existing.uid;
      const item = mint({ set, artistName: name, source: from });
      dispatch({ type: "INSERT_AFTER", anchorUid, item });
      return item.uid;
    },
    [dispatch],
  );

  const jumpTo = useCallback(
    (position: number) => dispatch({ type: "JUMP", position }),
    [dispatch],
  );

  const removeAt = useCallback(
    (position: number) => {
      const { entries: live } = stateRef.current;
      if (position < 0 || position >= live.length) return;
      if (live.length === 1) {
        stopRef.current();
        return;
      }
      dispatch({ type: "REMOVE", position });
    },
    [dispatch],
  );

  const toggle = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) {
      // A build that failed has no handle and nothing that would re-run it, so
      // Play on the bar did nothing. Gated on the failure: a tap during a
      // normal first build must not tear that build down.
      if (buildFailedRef.current) {
        buildFailedRef.current = false;
        dispatch({ type: "RETRY" });
      }
      return;
    }
    if (playing) {
      handle.pause();
      // The adapter confirms a pause with an event, but while a swap is in
      // flight the last `playing` is the *outgoing* track's — show Pause as
      // pressed now rather than leaving a button that says Pause on a paused
      // player.
      if (loadingRef.current) setPlaying(false);
    } else {
      handle.play();
    }
  }, [playing, dispatch]);

  const next = useCallback(() => dispatch({ type: "NEXT" }), [dispatch]);
  const previous = useCallback(() => dispatch({ type: "PREV" }), [dispatch]);

  const seek = useCallback((seconds: number) => {
    // Guarded like `toggle`. Between a track change and the adapter resolving,
    // there is a window where the timeline already has a length (seeded from
    // the set's own metadata) but no player to drive — optional-chaining the
    // call would drop the seek while `setPosition` still moved the playhead,
    // so the bar would show a position playback never went to. The same window
    // applies to the OS: a lock-screen seekto arrives with no clamp at all.
    const handle = handleRef.current;
    if (!handle || loadingRef.current || !Number.isFinite(seconds)) return;
    const length = durationRef.current;
    const clamped = Math.max(0, length && length > 0 ? Math.min(seconds, length) : seconds);
    handle.seek(clamped);
    setPosition(clamped);
  }, []);

  const stop = useCallback(() => {
    // Synchronously, before anything re-renders: a lookup's `.then` can run
    // before the next render, and it must already see that Close happened.
    epochRef.current += 1;
    destroyHandle();
    currentIdRef.current = null;
    buildFailedRef.current = false;
    dispatch({ type: "STOP" });
    setListened(0);
    setPlaying(false);
    setLoading(false);
    setPosition(0);
    setDuration(null);
    setError(null);
  }, [dispatch, destroyHandle]);
  stopRef.current = stop;

  const getEpoch = useCallback(() => epochRef.current, []);

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
      entries,
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
      enqueue,
      playNext,
      insertAfter,
      jumpTo,
      removeAt,
      toggle,
      next,
      previous,
      seek,
      stop,
      isCurrent,
      getEpoch,
    }),
    [
      queue,
      entries,
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
      enqueue,
      playNext,
      insertAfter,
      jumpTo,
      removeAt,
      toggle,
      next,
      previous,
      seek,
      stop,
      isCurrent,
      getEpoch,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used within a PlayerProvider");
  return context;
}
