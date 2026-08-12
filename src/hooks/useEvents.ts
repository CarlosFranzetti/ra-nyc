import { useCallback, useEffect } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { proxiedImageUrl } from "@/lib/images";
import type { EventsResponse } from "@/types/event";

const STALE_TIME = 5 * 60 * 1000;
const GC_TIME = 30 * 60 * 1000;

/**
 * Reads a day's listings from our own `/api/events` function rather than
 * hitting ra.co from the browser — see `api/_lib/ra.ts` for why.
 */
async function fetchEvents(date: string, signal?: AbortSignal): Promise<EventsResponse> {
  const res = await fetch(`/api/events?date=${date}`, { signal });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to fetch events");
  }

  return (await res.json()) as EventsResponse;
}

export function useEvents(date: string) {
  const queryClient = useQueryClient();

  // Warm the next two days and the previous one. Most are edge-cache hits, so
  // this is cheap, and it's what makes stepping through the strip feel instant.
  useEffect(() => {
    const current = new Date(`${date}T00:00:00`);
    for (const offset of [1, 2, -1]) {
      const neighbour = format(addDays(current, offset), "yyyy-MM-dd");
      void queryClient.prefetchQuery({
        queryKey: ["events", neighbour],
        queryFn: () => fetchEvents(neighbour),
        staleTime: STALE_TIME,
      });
    }
  }, [date, queryClient]);

  return useQuery({
    queryKey: ["events", date],
    queryFn: ({ signal }) => fetchEvents(date, signal),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchOnWindowFocus: false,
    // Hold the previous day on screen while the next loads, instead of blanking
    // to a skeleton on every tap.
    placeholderData: keepPreviousData,
    // Default is 3 retries with backoff; combined with the function's 10s
    // upstream timeout that spins for ~45s before the user is told anything.
    retry: 1,
  });
}

/** Prefetch on hover / touchstart, before the tap actually lands. */
export function usePrefetchEvents() {
  const queryClient = useQueryClient();

  return (date: string) => {
    void queryClient.prefetchQuery({
      queryKey: ["events", date],
      queryFn: () => fetchEvents(date),
      staleTime: STALE_TIME,
    });
  };
}

/**
 * Warmed once per session per URL — a card can fire `onMouseEnter` and
 * `onTouchStart` for the same event, and a slow drag across the list can
 * re-enter it more than once. Module-level, not per-hook-instance: the point
 * is one request per flyer regardless of how many cards or renders ask for it.
 */
const warmedImages = new Set<string>();

/**
 * Warm a flyer on hover / touchstart, same trigger as `usePrefetchEvents`
 * above and `usePrefetchArtist` — by the time the tap that opens the detail
 * sheet lands, the image it's about to show eagerly has nothing left to wait
 * for.
 *
 * Plain `Image()` loads rather than `fetch()`: they're the exact requests
 * `EventThumb` itself makes (same URLs, same `referrerPolicy`), so the service
 * worker's `ra-img-v1` cache — or failing that, the browser's own HTTP cache —
 * has already done the work by the time the real `<img>` mounts. Mirrors
 * `EventThumb`'s own direct-then-proxied order: hotlink protection that blocks
 * the direct load blocks it here too, so warming only the direct URL would
 * warm the one request that was never going to succeed and leave the fallback
 * — the one the sheet will actually end up showing — to happen live instead.
 */
export function usePrefetchEventImage() {
  return useCallback((imageUrl: string | null | undefined) => {
    if (!imageUrl || warmedImages.has(imageUrl)) return;
    warmedImages.add(imageUrl);
    const direct = new Image();
    direct.referrerPolicy = "no-referrer";
    direct.onerror = () => {
      const proxied = new Image();
      proxied.referrerPolicy = "no-referrer";
      proxied.src = proxiedImageUrl(imageUrl);
    };
    direct.src = imageUrl;
  }, []);
}
