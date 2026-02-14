import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

interface RAEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  contentUrl: string;
  images: { filename: string }[];
  venue: { name: string; area: { name: string } } | null;
  artists: { name: string }[];
  pick: { blurb: string } | null;
}

const QUERY = `
  query GET_DEFAULT_EVENTS_LISTING(
    $filters: FilterInputDtoInput
    $pageSize: Int
  ) {
    eventListings(filters: $filters, pageSize: $pageSize, page: 1) {
      data {
        event {
          id
          title
          date
          startTime
          endTime
          contentUrl
          images {
            filename
          }
          venue {
            name
            area {
              name
            }
          }
          artists {
            name
          }
          pick {
            blurb
          }
        }
      }
    }
  }
`;

export function useRAEvents(selectedDate: Date) {
  const dateStr = format(selectedDate, "yyyy-MM-dd");

  return useQuery<RAEvent[]>({
    queryKey: ["ra-events", dateStr],
    queryFn: async () => {
      const res = await fetch("https://ra.co/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0",
          Referer: "https://ra.co/events/us/newyorkcity",
        },
        body: JSON.stringify({
          query: QUERY,
          variables: {
            filters: {
              areas: { eq: 8 },
              listingDate: { gte: dateStr, lte: dateStr },
            },
            pageSize: 50,
          },
        }),
      });

      if (!res.ok) throw new Error("Failed to fetch events");

      const json = await res.json();
      const listings = json?.data?.eventListings?.data ?? [];
      return listings.map((l: { event: RAEvent }) => l.event);
    },
    staleTime: 5 * 60 * 1000,
  });
}
