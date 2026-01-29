export interface Event {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  url: string;
  imageUrl: string | null;
  venue: {
    name: string;
    area: string;
  };
  artists: string[];
  attending: number;
  interested: number;
  isPick: boolean;
  pickBlurb: string | null;
}

export interface EventsResponse {
  date: string;
  events: Event[];
  count: number;
}
