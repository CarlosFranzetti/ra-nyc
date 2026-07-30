import { useQuery } from "@tanstack/react-query";
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

export function useArtist(id: string | undefined, name: string) {
  return useQuery({
    queryKey: ["artist", id, name],
    queryFn: ({ signal }) => fetchArtist(id!, name, signal),
    enabled: Boolean(id && name),
    // Resolution is stable and cached hard upstream; no need to refetch a
    // DJ's Mixcloud identity during a session.
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
