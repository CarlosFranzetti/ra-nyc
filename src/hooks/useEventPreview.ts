import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePlayer } from "@/context/PlayerContext";
import { artistQuery } from "@/hooks/useArtist";
import { previewSet } from "@/lib/preview";
import type { Event } from "@/types/event";

/**
 * Plays a taster of a whole night: one set from each DJ on the bill.
 *
 * ## Why it starts before it is finished
 *
 * Resolving a DJ means an `/api/artist` round trip, and a six-name lineup would
 * be six of them. Waiting for all six before making a sound would put several
 * seconds of silence between the tap and the music — and on a cold cache, far
 * more than several.
 *
 * So the first artist to come back starts playing, and the rest are appended to
 * the queue behind the music as they arrive. The bill is short enough that they
 * all land long before the first set ends.
 *
 * Resolution runs in lineup order but resolves concurrently, so "first back" is
 * usually the first name — and when it is not, it is because that DJ was
 * already cached, which is exactly the one you want to hear first anyway.
 */

/**
 * A whole festival bill would be twenty round trips for a taster nobody listens
 * to the end of. The top of the bill is the party's character.
 */
const MAX_ARTISTS = 6;

export interface EventPreview {
  /** Kick off the preview. Safe to call repeatedly; the second call is a no-op. */
  start(event: Event): void;
  /** True from the tap until the first set is queued. */
  preparing: boolean;
  /** Set when the whole lineup resolved to nothing playable. */
  empty: boolean;
}

export function useEventPreview(): EventPreview {
  const queryClient = useQueryClient();
  const { playNext, insertAfter, getEpoch } = usePlayer();
  const [preparing, setPreparing] = useState(false);
  const [empty, setEmpty] = useState(false);

  // Guards against a double tap starting two overlapping previews, each
  // appending into the other's queue.
  const runningFor = useRef<string | null>(null);
  // Which preview is the latest. `runningFor` alone is an event id, so a slow
  // run for night A kept resolving into night B's queue after the listener
  // moved on, and its `finally` cleared B's guard while B was still in flight.
  const runRef = useRef(0);

  const start = useCallback(
    (event: Event) => {
      if (runningFor.current === event.id) return;
      runningFor.current = event.id;
      setPreparing(true);
      setEmpty(false);

      const lineup = event.artists.slice(0, MAX_ARTISTS);
      if (lineup.length === 0) {
        setPreparing(false);
        setEmpty(true);
        runningFor.current = null;
        return;
      }

      const run = ++runRef.current;
      const epoch = getEpoch();
      // Stale if a newer preview started, or the player was closed meanwhile.
      const live = () => run === runRef.current && getEpoch() === epoch;

      let started = false;
      // The entry the taster has reached so far, so each later DJ is inserted
      // behind it and the taster stays contiguous.
      let anchor: number | null = null;
      const source = { label: event.title, url: event.url };

      const resolutions = lineup.map(async (artist) => {
        try {
          // `fetchQuery` rather than a bare fetch: an artist already opened this
          // session is served from cache with no request at all, which is what
          // makes a second preview of the same night instant.
          const details = await queryClient.fetchQuery({
            ...artistQuery(artist.id, artist.name),
            retry: false,
          });
          if (!live()) return;
          const chosen = previewSet(event.id, artist.id, details.sets);
          if (!chosen) return;

          // The race is the point: whoever is back first starts the music.
          // `playNext`, not `playSets`: with a playlist already built the taster
          // slots in after the live set and the listener's queue resumes behind
          // it, instead of being replaced. With an empty queue it simply starts.
          if (!started) {
            started = true;
            setPreparing(false);
            anchor = playNext(chosen, artist.name, source);
          } else if (anchor !== null) {
            anchor = insertAfter(anchor, chosen, artist.name, source) ?? anchor;
          }
        } catch {
          // One unresolvable DJ must not silence the rest of the bill.
        }
      });

      void Promise.all(resolutions).then(() => {
        if (run !== runRef.current) return;
        runningFor.current = null;
        // A closed player is not "nothing playable".
        if (!started && live()) {
          setPreparing(false);
          setEmpty(true);
        }
      });
    },
    [queryClient, playNext, insertAfter, getEpoch],
  );

  return { start, preparing, empty };
}
