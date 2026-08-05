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
  /**
   * True when ra.co could not be reached and these came from the saved index.
   * Absent on a normal response — see `api/events.ts`.
   */
  stale?: boolean;
}
