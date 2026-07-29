/** Shape returned by `/api/events` — mirrors `api/_lib/ra.ts`. */
export interface RAEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  contentUrl: string;
  images: { filename: string }[];
  venue: { name: string; area: { name: string } | null } | null;
  artists: { id: string; name: string }[];
  pick: { blurb: string } | null;
}

export interface EventsResponse {
  date: string;
  count: number;
  events: RAEvent[];
}
