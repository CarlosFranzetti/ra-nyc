import { useCallback, useEffect } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { proxiedImageUrl } from "@/lib/images";
import { currentNight } from "@/lib/night";
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

/**
 * How many nights ahead the opening scan covers, tonight included.
 *
 * A week, because that is the unit people plan a night out in — "what's on this
 * week" is the question, and answering it should not require tapping seven
 * chips and waiting at each one.
 */
export const SCAN_DAYS = 7;

/**
 * Refreshes the coming week once, on load.
 *
 * `useEvents` already warms the two days either side of wherever you are, which
 * makes stepping along the rail instant but only ever covers where you have
 * already been. This covers where you are going.
 *
 * The more important half is that it *refreshes*. Days are served
 * stale-while-revalidate by the service worker and the query cache is persisted
 * to localStorage, so a day you looked at last week comes back from disk,
 * through a worker that hands you its saved copy — two layers of stale, neither
 * of which had anything that showed you the fresh answer when it arrived. A
 * party announced since was simply missing, while search — which reads the
 * database — could find it. That is exactly the report this fixes, alongside
 * `announceUpdate` in the service worker.
 *
 * `refetchQueries`, not `prefetchQuery`: prefetch respects `staleTime` and does
 * nothing for a day the cache thinks is fresh, which on a cold load restored
 * from disk is most of them. The point here is to go and ask.
 *
 * Fired once per mount rather than on every date change — stepping through the
 * rail should not re-scan the week each time.
 */
export function useWeekScan(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const today = currentNight();
    for (let offset = 0; offset < SCAN_DAYS; offset += 1) {
      const day = format(addDays(today, offset), "yyyy-MM-dd");
      void queryClient.refetchQueries({ queryKey: ["events", day], exact: true });
      // A day nobody has ever loaded has no query to refetch, so seed it.
      void queryClient.prefetchQuery({
        queryKey: ["events", day],
        queryFn: () => fetchEvents(day),
        staleTime: STALE_TIME,
      });
    }
  }, [queryClient]);
}

/**
 * Shows the refreshed copy when the service worker says one arrived.
 *
 * The worker posts `events-updated` only when a revalidation actually changed
 * the day's listings, so this invalidates one query rather than polling. React
 * Query then refetches — and gets the copy the worker has just cached — so the
 * list corrects itself in place instead of on your next visit.
 */
export function useEventCacheUpdates(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; date?: string } | null;
      if (data?.type !== "events-updated" || !data.date) return;
      void queryClient.invalidateQueries({
        queryKey: ["events", data.date],
        exact: true,
      });
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    // Required, and easy to miss: a ServiceWorkerContainer only starts
    // delivering queued messages automatically when something assigns to
    // `onmessage`. With `addEventListener` alone the queue is never started and
    // nothing is ever delivered — the listener is attached, correct, and mute.
    // This cost a test run to find, which is the only reason it was found.
    navigator.serviceWorker.startMessages();

    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [queryClient]);
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
