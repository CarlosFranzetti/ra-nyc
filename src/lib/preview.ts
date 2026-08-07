import type { ArtistSet } from "@/types/artist";

/**
 * Building a taster of a night: one set from each DJ on the bill.
 *
 * The idea is to answer "what does this party actually sound like?" without
 * committing to anyone's hour-long recording — you hear the room's range in the
 * order the lineup is printed, and you can skip.
 */

/**
 * Deterministic pick, not `Math.random()`.
 *
 * "Random" is what this wants to *feel* like, but a genuinely random choice
 * re-rolls every time the sheet is reopened, so the party you previewed two
 * minutes ago is a different party now. Seeding on the event and artist keeps
 * one night sounding like itself while still giving different nights, and
 * different DJs on the same night, different picks.
 *
 * FNV-1a: a few lines, no dependency, and far better distributed over short
 * ASCII ids than the `hash * 31 + c` most people reach for.
 */
export function seededIndex(seed: string, length: number): number {
  if (length <= 1) return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    // >>> 0 keeps it an unsigned 32-bit int; Math.imul does the multiply
    // without losing precision to float64.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % length;
}

/**
 * How deep into a catalogue a preview will reach.
 *
 * Sets are ordered newest-first, so this biases towards recent work — what
 * someone sounds like *now* is the useful signal for a party next Friday, and a
 * decade-old upload is not.
 */
const PREVIEW_DEPTH = 8;

/** The one set that represents this artist at this event. */
export function previewSet(
  eventId: string,
  artistId: string,
  sets: ArtistSet[],
): ArtistSet | null {
  if (sets.length === 0) return null;
  const pool = sets.slice(0, PREVIEW_DEPTH);
  return pool[seededIndex(`${eventId}:${artistId}`, pool.length)] ?? null;
}

/**
 * Drops sets already in the queue.
 *
 * Two DJs playing back to back often have a b2b recording on both their
 * profiles, and hearing it twice in a five-track preview is the kind of thing
 * that reads as broken rather than coincidental.
 */
export function dedupeSets(sets: ArtistSet[]): ArtistSet[] {
  const seen = new Set<string>();
  return sets.filter((set) => {
    // Same recording, different provider ids: the URL is what actually
    // identifies it.
    const key = set.url || set.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
