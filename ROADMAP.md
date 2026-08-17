# Roadmap

Legend: **P1** = next up · **P2** = after that · **P3** = nice to have.

---

## What's next

Ordered by what actually costs a user something today.

### Anchor dates to New York time — P1

**Half done.** The rollover question is answered: `src/lib/night.ts` puts the
boundary at 3:30am, so a 2am set belongs to the night it started on and the
strip and the listings agree about it.

The timezone half is still open and is the part that is actually *wrong* rather
than merely arguable. `currentNight()` reads the visitor's clock, so someone in
London opening the app at 01:00 gets NYC's tomorrow — and at 08:00 London,
which is 03:00 in New York, they get the wrong night entirely. The app is
silently incorrect for anyone outside the eastern US and gives no hint of it.

The fix is to evaluate the rollover in `America/New_York` rather than in local
time — `Intl.DateTimeFormat` with a `timeZone` option, not a fixed offset,
because the offset changes twice a year and hardcoding −5 breaks for eight
months. Everything downstream already routes through `currentNight()`, so this
is one function.

Worth deciding at the same time: whether a visitor abroad should be *told*
they are seeing New York time, or whether that is noise for a listings app
whose name says NYC.

### Error boundary — P1

A render crash currently blanks the page. Small change, and it converts the
worst failure mode into a retry button.

### Pagination past RA's first 50 — P2

Busy Saturdays are being truncated with no indication. Either page on scroll or
say "showing the first 50 of N".

### Score sets independently of the profile — P2

Matching a SoundCloud profile sets `ownUploads`, which switches off per-track
filtering entirely. Right when the match is right, total when it is wrong. The
matcher and the RA-bio context narrow how often that happens but don't bound the
consequence. Scoring each track on its own would.

### A manual-correction route — P2

`link_source = 'manual'` already exists and every automated write already
refuses to clobber it — the column has been waiting for this since the schema
was written. What's missing is any way to *set* it. The trigger to build it is
the first wrong artist match worth fixing by hand.

### Make cache invalidation possible at all — P2

`readCached` never reads `resolved_at`, and nothing passes `refresh: true`, so
the only way to invalidate an artist row is to delete it. Four migrations were
written believing otherwise. Either honour `resolved_at` as a TTL in
`readCached`, or drop the column so nobody writes another migration against it.

### Listings beyond Resident Advisor — P3, maybe

RA is one promoter's view of the city and misses whole scenes — anything
ticketed elsewhere, and most of what never gets listed at all. Candidates, in
rough order of how tractable each looks:

| Source | Shape | Notes |
| --- | --- | --- |
| **Dice** | Has a public API surface behind the web app | Closest to RA's model; strong NYC electronic coverage |
| **Shotgun** | Web app with a JSON backend | Good on the underground end |
| **Posh** | Web app with a JSON backend | Heavy on the party/loft end RA ignores |
| **Eventbrite** | Documented public API | Widest net, lowest signal-to-noise — needs hard category filters |
| **Instagram** | No usable API for this | Realistically out of reach; login-walled and hostile to scraping, and the data is in flyer JPEGs rather than in text |

All of these are *maybes*, and the reason to be cautious is not technical. Two
sources means two ids for the same party, and a de-duplicated listing needs a
match on venue + night + lineup that is at least as careful as the DJ matcher —
which took four rounds to get right on names alone. The failure mode is the
same night appearing twice with different head counts, which is worse than not
having the second source.

Sequence if it happens: one source at a time, behind the existing
`event_cache` shape, with de-duplication proved on a week of real data before
the second one is added.

### Full-size flyer on a second tap — P2, needs a decision

Double-tapping a card's thumbnail would open the flyer full-screen. The flyer is
the one piece of a listing that is genuinely worth looking at large — it carries
the lineup, the times and the door price that RA's own fields often do not — and
`/api/image` already proxies and caches the full-resolution file, so nothing new
has to be fetched.

Raised by the owner and explicitly deferred: *"maybe this is for roadmap and you
should ask me later"*. **Ask before building it.** The open question is the
gesture rather than the viewer. A double-tap on a card whose single tap already
opens the event sheet means every single tap now waits ~250ms to find out
whether a second one is coming, which makes the whole list feel laggy to
everyone who never double-taps. The alternatives are a long-press, a tap on the
flyer *inside* the event sheet (where nothing else competes for it), or a small
expand affordance on the thumbnail.

### Search over dates — P3

`matchesTerm` covers titles, venues and lineups. A date query (`aug 15`,
`friday`) finds nothing unless the word happens to be in a title.

Left undone deliberately: a weekday matches a seventh of a 166-day window, which
is worse than no answer, and "what is on the 15th" is what the date rail and the
calendar are already for. Only worth doing for unambiguous forms — ISO dates and
month-plus-day — and only if anyone actually types them.

### Smaller things — P3

- **Filter chips** — genre, RA Pick only, free, before-midnight.
- **City switcher.** `api/events.ts` already accepts `?area=`; the UI just
  doesn't expose it. RA area ids are stable (8 = NYC).
- **Offline.** The manifest is in place and the query cache already persists to
  `localStorage`; a service worker would make the current week readable on the
  subway with no signal. This is the one that best fits how the app is used.
- **Open Graph images** per day, so shared links look like something.
- **Tailwind v4 upgrade.** Pinned to v3 during the hosting migration. Its own
  PR, never alongside a feature.

---

## Shipped

Kept below as a record of the original plan, which differs from how these
actually landed — see ARCHITECTURE.md and memorystate.md for what was built.

Testing, listed here as a prerequisite and long unbuilt, now stands at 86 Vitest
units and 71 Playwright assertions across four suites.

---

## 1 · Event search — P1

> *"Search bar to search for events."*

### Phase 1a — filter the loaded day (no database)

A search input pinned under the header that filters the events already fetched
for the selected date. Matches against **event title, venue name, and artist
names** — searching "Nowadays" or "Move D" should both work.

```
src/components/SearchBar.tsx      controlled input, clear button, ⌘K focus
src/hooks/useEventSearch.ts       useMemo filter over the current day's events
src/lib/search.ts                 normalise() + matches() — shared with 1b
```

Details that matter:

- **Normalise before comparing.** Lowercase, strip diacritics
  (`"Bjørn"` → `"bjorn"`), collapse whitespace. DJ names are full of accents,
  and nobody types them.
- **Debounce ~150 ms.** Even filtering in memory, re-rendering 50 cards on every
  keystroke is visibly janky on a phone.
- **Highlight the match** in the card so it's obvious *why* a result matched —
  especially when the hit was an artist name buried in a long lineup.
- **Empty state** must distinguish "no events this day" from "no events match
  your search", with a one-tap way to clear the query.
- **Put the query in the URL** (`/?q=move+d&date=2026-08-01`) so a search is
  shareable and survives refresh. `App.tsx` already has React Router; this is
  `useSearchParams`.
- **Preserve the query when the date changes** — the natural next move after
  "no results today" is checking tomorrow.

Roughly a day's work. No backend changes at all.

### Phase 1b — search across all upcoming events (needs a database)

The genuinely useful version: *"when is this DJ playing in NYC next?"* Requires
an index of the next N days, which requires
[the database](./DATABASE.md#trigger-1--search-across-more-than-the-current-day).

- Nightly Vercel Cron job populating `events` / `artists` / `event_artists`.
- `GET /api/search?q=…` backed by Postgres full-text over title + venue, plus
  `pg_trgm` similarity on artist names so `"movid"` still finds `"Move D"`.
- Results grouped by date, not a flat list.
- Rank by date ascending (soonest first) — recency beats relevance for
  listings, and a perfect match three months out is less useful than a decent
  match on Friday.

Ship 1a first and see whether 1b is actually wanted. It may not be.

---

## 2 · DJ sets + artist bios — **steps 1–2 shipped 2026-07-30**

**Built:** `/api/artist` (Mixcloud search + cloudcasts, RA artist lookup, Discogs
with optional token, SoundCloud search link), the `/artist/:id` page with a
Mixcloud player and switchable set list, tappable lineup chips in the details
drawer, and the `artist_links` table with `link_source` so hand corrections
survive a re-resolve.

**Still to do from this section:** the manual-correction admin route (step 4),
confidence scoring beyond the current strict name match, and SoundCloud playback
if their API ever reopens. The original plan follows.

> *"Clicking a dj will play SoundCloud or Mixcloud or other available dj sets
> and if available a link to their bio is also available."*

The most valuable feature on this list — hear the artist before you buy a
ticket — and the most involved, because RA gives you a name and nothing else.

### UX

Artist names in `EventCard` become tappable. Tapping opens a **bottom sheet**
(not a new page — you should not lose your place in the listings) containing:

1. Artist name + RA profile link.
2. An embedded player, if a set was found.
3. A **bio link**, if one exists — RA's artist page first; Discogs, Bandcamp, or
   the artist's own site as fallbacks.
4. An honest empty state when nothing resolves: *"No sets found — search
   SoundCloud"* with a pre-filled query link. Better than a spinner that never
   resolves.

Keep playback in the sheet and let it continue while the sheet is dismissed, so
you can keep browsing with a set running. That's the whole point.

### The hard part: name → account

RA exposes an artist `id` and `name`. It does not expose social links. So:

| Source | Notes |
| --- | --- |
| **Mixcloud** | Public API, no key, `GET /search/?q=…&type=user`. Long DJ sets are its native content. **Start here.** |
| **SoundCloud** | Best content, worst access — API registration has been effectively closed for years. The `oEmbed` endpoint works without a key if you already know the URL, so it's usable *once resolved*, but not for search. |
| **Bandcamp / YouTube** | Fallbacks. YouTube's Data API has a quota but is easy to get. |
| **RA artist page** | Scrape-of-last-resort for the bio link. Fragile; prefer linking out. |

Fuzzy matching is unavoidable and will be wrong sometimes. Guardrails:

- Require a similarity threshold before auto-linking; below it, show nothing
  rather than the wrong artist. A confidently wrong link is worse than none.
- Prefer accounts with a plausible follower count and recent uploads.
- Store `link_source = 'auto' | 'manual'` so a nightly re-resolve **never
  overwrites a hand correction** — see
  [DATABASE.md](./DATABASE.md#ifwhen-you-add-it-the-schema).
- Add a tiny admin route to correct a mapping by hand. This is the point at
  which the project genuinely acquires its own data.

### Player embeds

Both platforms provide iframe embeds — no SDK, no bundle cost:

- Mixcloud: `https://player-widget.mixcloud.com/widget/iframe/?feed=<url>`
- SoundCloud: `https://w.soundcloud.com/player/?url=<url>&color=%23ffffff`

Load the iframe **only after the sheet opens** (a third-party player per card
would wreck scroll performance), set `loading="lazy"`, and add a
`sandbox`/`referrerpolicy` attribute. Both platforms set their own CSP; check
they render inside the sheet on iOS Safari specifically, which is where
autoplay policy is strictest — assume the user must tap play once.

### Build order

1. `GET /api/artists/:id/sets` — Mixcloud only, no DB, cache hard at the edge.
2. Bottom sheet + embed in the UI. Ship it; see if it's used.
3. Add the database, backfill job, and confidence scoring.
4. SoundCloud, then the manual-correction admin route.

Steps 1–2 are a weekend and answer the only question that matters: does anyone
tap the DJ names?

---

## 3 · Smaller items

Everything still open from this section has moved up to **What's next** at the
top of the file, where it is ordered against the rest of the work rather than
sitting in a bucket.

**Done** (rebuilt 2026-07-29 from the lost original's feature manifest):
themes, densities, navigation modes, swipe, details sheet, skeletons,
adjacent-day prefetch. **Analytics** — Vercel Analytics is wired up in
`App.tsx`. **Installable** — the manifest landed 2026-08-03; the offline half is
still open and listed above.

---

## Explicitly not planned

- User accounts, or anything requiring a login.
- Ticket sales — always hand off to RA.
- Cities beyond NYC as a default. The name is the scope.
