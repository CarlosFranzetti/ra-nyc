import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePlayer } from "@/context/PlayerContext";
import { artistQuery } from "@/hooks/useArtist";
import { previewSet } from "@/lib/preview";
import type { ArtistSet } from "@/types/artist";
import type { Artist, Event } from "@/types/event";

/**
 * Adding to the playlist without starting it.
 *
 * The `+` beside every play button ends up here. It shares its machinery with
 * `useEventPreview` — the same `/api/artist` round trip, the same deterministic
 * pick per event and DJ — and differs in the one way that matters: nothing it
 * does interrupts what is already playing.
 *
 * ## Why the whole-night add is not a race
 *
 * The preview deliberately starts on whichever DJ resolves first, because
 * silence between the tap and the music is the thing it exists to avoid. Adding
 * has no such clock: nobody is waiting to hear it, so the sets go in **in
 * lineup order** once they have all resolved. A playlist that lists a bill in
 * the order it was printed is worth a second of waiting; one shuffled by
 * whichever request happened to come back first is not.
 */

/** Matches the preview's ceiling — a festival bill is not a playlist addition. */
const MAX_ARTISTS = 6;

/**
 * How long an add waits on a DJ's lookup.
 *
 * A hung `/api/artist` froze every add behind it, because a tap is dropped while
 * one is pending (L2 #6). Ended as "nothing playable", it surfaces as `failed`
 * and frees the button.
 */
const LOOKUP_TIMEOUT_MS = 8000;

export interface PlaylistAdd {
  /** Adds one DJ's set for this night. */
  addArtist(event: Event, artist: Artist): void;
  /** Adds a set for each DJ on the bill, in lineup order. */
  addNight(event: Event): void;
  /** Which add is in flight — an artist id, or `night` — so a button can spin. */
  pending: string | null;
  /**
   * The last add that resolved to nothing playable, by the same key as
   * `pending`. Cleared when another add starts.
   */
  failed: string | null;
}

export const NIGHT_KEY = "night";

export function usePlaylistAdd(): PlaylistAdd {
  const queryClient = useQueryClient();
  const { enqueue, getEpoch } = usePlayer();
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const resolve = useCallback(
    async (event: Event, artist: Artist): Promise<ArtistSet | null> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // `fetchQuery`, so a DJ already opened this session costs no request.
        // `retry: false`: the default retry re-sends a 429 immediately, and the
        // add has its own answer to a failure — `failed`.
        const lookup = queryClient.fetchQuery({
          ...artistQuery(artist.id, artist.name),
          retry: false,
        });
        const timeout = new Promise<null>((done) => {
          timer = setTimeout(() => done(null), LOOKUP_TIMEOUT_MS);
        });
        const details = await Promise.race([lookup, timeout]);
        return details ? previewSet(event.id, artist.id, details.sets) : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
    [queryClient],
  );

  const addArtist = useCallback(
    (event: Event, artist: Artist) => {
      const key = artist.id || artist.name;
      if (pending) return;
      setPending(key);
      setFailed(null);
      // The player may be closed — or a different queue started — while the
      // lookup is out. `enqueue` is handed live state, so the second can no
      // longer replace anything; the first has to be checked here, or a `+`
      // tapped before Close restarts music the listener shut off.
      const epoch = getEpoch();
      void resolve(event, artist).then((set) => {
        setPending(null);
        if (getEpoch() !== epoch) return;
        if (set) {
          enqueue([
            { set, artistName: artist.name, source: { label: event.title, url: event.url } },
          ]);
        } else setFailed(key);
      });
    },
    [pending, resolve, enqueue, getEpoch],
  );

  const addNight = useCallback(
    (event: Event) => {
      if (pending) return;
      const lineup = event.artists.slice(0, MAX_ARTISTS);
      if (lineup.length === 0) {
        setFailed(NIGHT_KEY);
        return;
      }
      setPending(NIGHT_KEY);
      setFailed(null);
      const epoch = getEpoch();
      const source = { label: event.title, url: event.url };
      void Promise.all(
        lineup.map(async (artist) => ({ artist, set: await resolve(event, artist) })),
      ).then((results) => {
        setPending(null);
        if (getEpoch() !== epoch) return;
        const items = results.flatMap(({ artist, set }) =>
          set ? [{ set, artistName: artist.name, source }] : [],
        );
        if (items.length === 0) setFailed(NIGHT_KEY);
        // `enqueue` dedupes — within the batch too — so a b2b that resolved
        // from both of its DJs goes in once. Each set keeps its own DJ's name.
        else enqueue(items);
      });
    },
    [pending, resolve, enqueue, getEpoch],
  );

  return { addArtist, addNight, pending, failed };
}
