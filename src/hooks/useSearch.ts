import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Event } from "@/types/event";

export interface SearchResponse {
  q: string;
  upcoming: Event[];
  past: Event[];
  truncated: boolean;
}

/** Below this a search matches half the city and costs a round trip to say so. */
export const MIN_QUERY = 2;

/** Long enough that a normal typing pause doesn't fire, short enough to feel live. */
const DEBOUNCE_MS = 350;

const STALE_TIME = 10 * 60 * 1000;

async function fetchSearch(q: string, signal?: AbortSignal): Promise<SearchResponse> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Search failed");
  }
  return (await res.json()) as SearchResponse;
}

/** Holds back a fast-changing value until it settles. */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * Searches events by term.
 *
 * Debounced rather than fired per keystroke: each search costs several upstream
 * requests, so typing "bossa nova" un-debounced would be ten searches to answer
 * one question. `keepPreviousData` holds the last results on screen while the
 * next lands, so refining a query doesn't flash an empty list.
 */
export function useSearch(query: string) {
  const term = useDebounced(query.trim(), DEBOUNCE_MS);
  const enabled = term.length >= MIN_QUERY;

  const result = useQuery({
    queryKey: ["search", term],
    queryFn: ({ signal }) => fetchSearch(term, signal),
    enabled,
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    retry: 1,
  });

  return {
    ...result,
    /** True while the user has typed something the debounce hasn't sent yet. */
    pending: enabled && term !== query.trim(),
    enabled,
  };
}
