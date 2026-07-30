/** Shape returned by `/api/artist` — mirrors `api/_lib/artistLinks.ts`. */
export type SetProvider = "soundcloud" | "mixcloud" | "archive" | "youtube";

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
}

export interface ArtistBio {
  text: string;
  source: "Resident Advisor" | "SoundCloud" | "Mixcloud" | "Discogs";
  url: string | null;
}

export interface ArtistDetails {
  id: string;
  name: string;
  mixcloudUser: string | null;
  mixcloudUrl: string | null;
  soundcloudUser: string | null;
  soundcloudUrl: string | null;
  discogsUrl: string | null;
  raUrl: string | null;
  bio: ArtistBio | null;
  sets: ArtistSet[];
  linkSource: "auto" | "manual" | "none";
  cached: boolean;
  persisted: boolean;
}

export const PROVIDER_LABELS: Record<SetProvider, string> = {
  soundcloud: "SoundCloud",
  mixcloud: "Mixcloud",
  archive: "Internet Archive",
  youtube: "YouTube",
};

/** Providers need different iframe heights to render usably. */
export const PROVIDER_EMBED_HEIGHT: Record<SetProvider, number> = {
  soundcloud: 166,
  mixcloud: 120,
  archive: 170,
  youtube: 220,
};
