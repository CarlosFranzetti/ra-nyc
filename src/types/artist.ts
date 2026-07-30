/** Shape returned by `/api/artist` — mirrors `api/_lib/artistLinks.ts`. */
export interface ArtistSet {
  /** Mixcloud key, e.g. "/username/some-set/" — also the embed feed id. */
  key: string;
  title: string;
  url: string;
  /** Seconds. */
  duration: number | null;
  plays: number | null;
  createdAt: string | null;
}

export interface ArtistDetails {
  id: string;
  name: string;
  mixcloudUser: string | null;
  mixcloudUrl: string | null;
  soundcloudUrl: string | null;
  discogsUrl: string | null;
  raUrl: string | null;
  sets: ArtistSet[];
  linkSource: "auto" | "manual" | "none";
  cached: boolean;
  persisted: boolean;
}
