import { useEffect } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import type { EventsResponse, RAEvent } from "@/types/event";

const STALE_TIME = 5 * 60 * 1000;

/**
 * Reads a day's listings from our own `/api/events` function rather than
 * hitting ra.co from the browser — see `api/_lib/ra.ts` for why.
 */
async function fetchEvents(
  dateStr: string,
  signal?: AbortSignal,
): Promise<RAEvent[]> {
  const res = await fetch(`/api/events?date=${dateStr}`, { signal });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to fetch events");
  }

  const json = (await res.json()) as EventsResponse;
  return json.events;
}

export function useRAEvents(selectedDate: Date) {
  const queryClient = useQueryClient();
  const dateStr = format(selectedDate, "yyyy-MM-dd");

  const query = useQuery<RAEvent[]>({
    queryKey: ["ra-events", dateStr],
    queryFn: ({ signal }) => fetchEvents(dateStr, signal),
    staleTime: STALE_TIME,
    // Keep the previous day on screen while the next one loads. Without this
    // every date tap blanks the list to a spinner, which reads as slow even
    // when the response is quick.
    placeholderData: keepPreviousData,
    // Default is 3 retries with backoff. Combined with the function's 10s
    // upstream timeout that can spin for ~45s before the user is told
    // anything. One retry covers a blip; past that, show the error.
    retry: 1,
  });

  // Warm the neighbouring days so stepping through the strip is instant.
  // These are cheap: the edge cache serves most of them.
  useEffect(() => {
    for (const offset of [1, -1]) {
      const neighbour = format(addDays(selectedDate, offset), "yyyy-MM-dd");
      void queryClient.prefetchQuery({
        queryKey: ["ra-events", neighbour],
        queryFn: () => fetchEvents(neighbour),
        staleTime: STALE_TIME,
      });
    }
    // selectedDate is a Date instance and changes identity every render in
    // some callers; key the effect on the formatted string instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr, queryClient]);

  return query;
}
