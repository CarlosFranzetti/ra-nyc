/**
 * The last few things you searched for.
 *
 * Pure functions over an array plus a thin localStorage wrapper, so the
 * interesting part — what "recent" means when you search for the same DJ twice,
 * or search for "MATIAS" having already searched "matias" — is testable without
 * a browser or a component.
 */

/** How many to keep. Enough to cover a session's worth of looking. */
export const MAX_RECENT = 6;

const KEY = "ra-recent-searches";

/**
 * Adds a term to the front of the list.
 *
 * Case-insensitive de-duplication, but the *new* spelling wins: searching
 * "Nowadays" after "nowadays" leaves one entry reading "Nowadays", because the
 * way you last typed it is the way you are most likely to recognise it. A term
 * already in the list moves to the front rather than being added twice — a
 * history that lists the same word three times is a history with three fewer
 * slots.
 */
export function remember(list: readonly string[], term: string): string[] {
  const clean = term.trim();
  if (!clean) return [...list];
  const fold = clean.toLowerCase();
  return [clean, ...list.filter((item) => item.trim().toLowerCase() !== fold)].slice(
    0,
    MAX_RECENT,
  );
}

/**
 * Reads the list, tolerating anything.
 *
 * localStorage is shared with the user, other tabs and older versions of this
 * app, so its contents are input, not state: anything that is not an array of
 * non-empty strings is discarded rather than rendered. It also throws outright
 * in Safari's private mode, which is why the whole thing is in a try.
 */
export function loadRecent(storage: Pick<Storage, "getItem"> | null): string[] {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string" && item.trim() !== "")
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Writes the list. A failure here is not worth telling anyone about. */
export function saveRecent(
  storage: Pick<Storage, "setItem"> | null,
  list: readonly string[],
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    /* private mode, quota, or no storage at all */
  }
}
