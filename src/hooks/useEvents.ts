import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EventsResponse } from "@/types/event";

export function useEvents(date: string) {
  return useQuery({
    queryKey: ["events", date],
    queryFn: async (): Promise<EventsResponse> => {
      const { data, error } = await supabase.functions.invoke("scrape-events", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        body: null,
      });

      // Since we can't pass query params through invoke, we'll call it differently
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scrape-events?date=${date}`,
        {
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch events");
      }

      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  });
}
