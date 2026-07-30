/** Shape returned by `/api/events` — mirrors `api/_lib/ra.ts`. */
export interface Event {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  url: string;
  imageUrl: string | null;
  venue: { name: string; area: string };
  artists: string[];
  attending: number;
  isPick: boolean;
  pickBlurb: string | null;
}

export interface EventsResponse {
  date: string;
  events: Event[];
  count: number;
}
