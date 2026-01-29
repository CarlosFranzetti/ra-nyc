import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { format, addDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { EventsResponse } from "@/types/event";

async function fetchEvents(date: string): Promise<EventsResponse> {
  const { data, error } = await supabase.functions.invoke<EventsResponse>("scrape-events", {
    body: { date },
  });

  if (error) throw error;
  if (!data) throw new Error("No data returned");
  return data;
}

export function useEvents(date: string) {
  const queryClient = useQueryClient();

  // Prefetch next 2 days and previous day
  useEffect(() => {
    const currentDate = new Date(date);
    const datesToPrefetch = [
      format(addDays(currentDate, 1), "yyyy-MM-dd"),
      format(addDays(currentDate, 2), "yyyy-MM-dd"),
      format(addDays(currentDate, -1), "yyyy-MM-dd"),
    ];

    datesToPrefetch.forEach((prefetchDate) => {
      queryClient.prefetchQuery({
        queryKey: ["events", prefetchDate],
        queryFn: () => fetchEvents(prefetchDate),
        staleTime: 5 * 60 * 1000,
      });
    });
  }, [date, queryClient]);

  return useQuery({
    queryKey: ["events", date],
    queryFn: () => fetchEvents(date),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000, // Keep cached data for 30 min
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
    retry: 1,
  });
}

// Hook to prefetch a specific date (for hover/touch)
export function usePrefetchEvents() {
  const queryClient = useQueryClient();

  return (date: string) => {
    queryClient.prefetchQuery({
      queryKey: ["events", date],
      queryFn: () => fetchEvents(date),
      staleTime: 5 * 60 * 1000,
    });
  };
}
