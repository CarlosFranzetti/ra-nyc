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

export function useArtist(id: string | undefined, name: string) {
  return useQuery({
    queryKey: ["artist", id, name],
    queryFn: ({ signal }) => fetchArtist(id!, name, signal),
    enabled: Boolean(id && name),
    // Resolution is stable and cached hard upstream; no need to refetch a
    // DJ's identity during a session.
    staleTime: ARTIST_STALE_TIME,
    gcTime: 24 * 60 * 60 * 1000,
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

  return (id: string, name: string) => {
    if (!id || !name) return;
    void queryClient.prefetchQuery({
      queryKey: ["artist", id, name],
      queryFn: () => fetchArtist(id, name),
      staleTime: ARTIST_STALE_TIME,
    });
  };
}
