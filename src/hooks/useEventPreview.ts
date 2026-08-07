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
  const { playSets, appendSets } = usePlayer();
  const [preparing, setPreparing] = useState(false);
  const [empty, setEmpty] = useState(false);

  // Guards against a double tap starting two overlapping previews, each
  // appending into the other's queue.
  const runningFor = useRef<string | null>(null);

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

      let started = false;
      const source = { label: event.title, url: event.url };

      const resolutions = lineup.map(async (artist) => {
        try {
          // `fetchQuery` rather than a bare fetch: an artist already opened this
          // session is served from cache with no request at all, which is what
          // makes a second preview of the same night instant.
          const details = await queryClient.fetchQuery(artistQuery(artist.id, artist.name));
          const chosen = previewSet(event.id, artist.id, details.sets);
          if (!chosen) return;

          // The race is the point: whoever is back first starts the music.
          if (!started) {
            started = true;
            setPreparing(false);
            playSets([chosen], 0, artist.name, source);
          } else {
            appendSets([chosen]);
          }
        } catch {
          // One unresolvable DJ must not silence the rest of the bill.
        }
      });

      void Promise.all(resolutions).then(() => {
        runningFor.current = null;
        if (!started) {
          setPreparing(false);
          setEmpty(true);
        }
      });
    },
    [queryClient, playSets, appendSets],
  );

  return { start, preparing, empty };
}
