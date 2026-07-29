import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { EventsResponse, RAEvent } from "@/types/event";

/**
 * Reads the day's listings from our own `/api/events` function rather than
 * hitting ra.co from the browser — see `api/_lib/ra.ts` for why.
 */
export function useRAEvents(selectedDate: Date) {
  const dateStr = format(selectedDate, "yyyy-MM-dd");

  return useQuery<RAEvent[]>({
    queryKey: ["ra-events", dateStr],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/events?date=${dateStr}`, { signal });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to fetch events");
      }

      const json = (await res.json()) as EventsResponse;
      return json.events;
    },
    staleTime: 5 * 60 * 1000,
    // Default is 3 retries with backoff. Combined with the function's 10s
    // upstream timeout that can spin for ~45s before the user is told
    // anything. One retry covers a blip; past that, show the error.
    retry: 1,
  });
}
