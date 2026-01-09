import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EventsResponse } from "@/types/event";

export function useEvents(date: string) {
  return useQuery({
    queryKey: ["events", date],
    queryFn: async (): Promise<EventsResponse> => {
      const { data, error } = await supabase.functions.invoke<EventsResponse>("scrape-events", {
        body: { date },
      });

      if (error) throw error;
      if (!data) throw new Error("No data returned");
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  });
}
