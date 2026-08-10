import { addDays, isSameDay } from "date-fns";

/**
 * When one night becomes the next, for a listings app.
 *
 * Not midnight. RA files an event under the calendar date it starts, so at 1am
 * "today" is already the next day and the app you opened at 11pm to find a
 * party has, an hour later, thrown that party away and is showing you tomorrow
 * — with tonight's still running. The person looking at their phone at 2am is
 * the person most likely to want the *next* room on the same night out, and
 * they are exactly the person the calendar has just abandoned.
 *
 * 3:30am is late enough to cover the second and third stop of a normal night
 * out, and early enough that someone waking at 8am gets the day they expect.
 * Anything past about 4am starts stealing the following evening from early
 * risers, which is the opposite failure and a quieter one.
 *
 * This shifts only what the app *calls* today. It does not touch what RA is
 * asked for: a night that runs past midnight still lives under its own start
 * date in the payload, which is precisely why the boundary has to move here
 * rather than in the query.
 */
const ROLLOVER_HOUR = 3;
const ROLLOVER_MINUTE = 30;

/**
 * The night `at` belongs to, as a Date at local noon.
 *
 * Noon rather than midnight so that adding and subtracting days across a
 * daylight-saving boundary cannot land an hour short and silently roll the
 * date back a day.
 */
export function currentNight(at: Date = new Date()): Date {
  const noon = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 12, 0, 0, 0);
  const minutesIn = at.getHours() * 60 + at.getMinutes();
  const rollover = ROLLOVER_HOUR * 60 + ROLLOVER_MINUTE;
  return minutesIn < rollover ? addDays(noon, -1) : noon;
}

/** Replaces date-fns `isToday`, which still believes in midnight. */
export function isTonight(date: Date, at: Date = new Date()): boolean {
  return isSameDay(date, currentNight(at));
}

/** Replaces date-fns `isTomorrow`, for the same reason. */
export function isNextNight(date: Date, at: Date = new Date()): boolean {
  return isSameDay(date, addDays(currentNight(at), 1));
}
