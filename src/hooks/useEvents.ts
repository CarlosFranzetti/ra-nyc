import { useEffect } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
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
