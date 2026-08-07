import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ArtistDetails } from "@/types/artist";

async function fetchArtist(
  id: string,
  name: string,
  signal?: AbortSignal,
): Promise<ArtistDetails> {
  const res = await fetch(
    `/api/artist?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`,
    { signal },
  );

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to load artist");
  }

  return (await res.json()) as ArtistDetails;
}

const ARTIST_STALE_TIME = 60 * 60 * 1000;

/**
 * One definition of "how to fetch an artist", shared by the three places that
 * need it: the sheet that displays one, the prefetch that warms one before the
 * tap lands, and the party preview that resolves a whole lineup.
 *
 * They must agree on the **query key** above all else. Three hand-written keys
 * that drift apart do not error — they just quietly stop sharing a cache, and
 * every prefetch becomes a wasted request that warms nothing.
 */
export function artistQuery(id: string, name: string) {
  return {
    queryKey: ["artist", id, name] as const,
    queryFn: ({ signal }: { signal?: AbortSignal }) => fetchArtist(id, name, signal),
    // Resolution is stable and cached hard upstream; no need to refetch a
    // DJ's identity during a session.
    staleTime: ARTIST_STALE_TIME,
    gcTime: 24 * 60 * 60 * 1000,
  };
}

export function useArtist(id: string | undefined, name: string) {
  return useQuery({
    ...artistQuery(id ?? "", name),
    enabled: Boolean(id && name),
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Warm an artist before the tap lands.
 *
 * `touchstart` fires well before `click`, so by the time the route mounts the
 * request is usually already in flight — the same trick the date strip uses.
 */
export function usePrefetchArtist() {
  const queryClient = useQueryClient();

  // Memoised, and that matters beyond tidiness: this is used as an effect
  // dependency, and an unmemoised callback is a new identity every render — so
  // the effect that warms a lineup would re-run on every single render rather
  // than once when the sheet opens.
  return useCallback(
    (id: string, name: string) => {
      if (!id || !name) return;
      void queryClient.prefetchQuery(artistQuery(id, name));
    },
    [queryClient],
  );
}
