/** Shape returned by `/api/events` — mirrors `api/_lib/ra.ts`. */
export interface Artist {
  id: string;
  name: string;
}

export interface Event {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  url: string;
  imageUrl: string | null;
  venue: { name: string; area: string };
  artists: Artist[];
  attending: number;
  isPick: boolean;
  pickBlurb: string | null;
}

export interface EventsResponse {
  date: string;
  events: Event[];
  count: number;
}
