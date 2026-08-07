import type { PlaybackSource } from "@/context/PlayerContext";

/**
 * When a ticket link is help rather than an advert.
 *
 * The rule is deliberately small and lives on its own so it can be argued with
 * — this is the one piece of the app that promotes something, and the line
 * between "useful" and "in the way" is a judgement worth stating in one place
 * instead of burying in a component.
 */

/**
 * How long someone listens before the link is worth showing.
 *
 * Long enough that it cannot be an accident: a minute is past the intro of the
 * first set, so they have heard the room and kept it on. Short enough that it
 * still arrives while they are interested rather than after they have moved on.
 */
export const TICKET_AFTER_SECONDS = 60;

/**
 * `listened` counts seconds of *actual playback*, never wall clock — a phone
 * paused in a pocket for twenty minutes has not shown interest in anything, and
 * a link that appeared then would be an advert dressed as a suggestion.
 *
 * Requires a `source` too: a queue built from one artist's catalogue is not a
 * party, and there is nothing to buy a ticket to.
 */
export function shouldOfferTickets(
  source: PlaybackSource | null,
  listened: number,
): boolean {
  return source !== null && listened >= TICKET_AFTER_SECONDS;
}
