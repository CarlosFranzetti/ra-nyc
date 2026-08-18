/** Shape returned by `/api/artist` — mirrors `api/_lib/artistLinks.ts`. */
export type SetProvider = "soundcloud" | "mixcloud" | "archive";

export interface ArtistSet {
  provider: SetProvider;
  id: string;
  title: string;
  url: string;
  /** Iframe src for in-app playback. */
  embedUrl: string;
  /** Seconds. */
  duration: number | null;
  plays: number | null;
  createdAt: string | null;
  /** Cover art, for the OS lock screen via the Media Session API. */
  artwork: string | null;
}

export interface ArtistBio {
  text: string;
  source: "Resident Advisor" | "SoundCloud" | "Mixcloud";
  url: string | null;
}

export interface ArtistLink {
  label: string;
  url: string;
  detail: string;
  /** True when we matched an actual profile rather than building a search URL. */
  resolved: boolean;
}

export interface ArtistDetails {
  id: string;
  name: string;
  mixcloudUser: string | null;
  mixcloudUrl: string | null;
  soundcloudUser: string | null;
  soundcloudUrl: string | null;
  raUrl: string | null;
  bio: ArtistBio | null;
  sets: ArtistSet[];
  links: ArtistLink[];
  linkSource: "auto" | "manual" | "none";
  cached: boolean;
  persisted: boolean;
}

export const PROVIDER_LABELS: Record<SetProvider, string> = {
  soundcloud: "SoundCloud",
  mixcloud: "Mixcloud",
  archive: "Internet Archive",
};
