# Roadmap

Planned features, in build order.

The themes, densities, navigation modes, swipe, details sheet and skeletons
listed as done in §3 were rebuilt on 2026-07-29 from the feature manifest of
the lost original — see
[memorystate.md](./memorystate.md#2026-07-29--recovering-the-original-lovable-app).
Everything else below is still unbuilt.

Legend: **P1** = next up · **P2** = after that · **P3** = nice to have.

---

## 0 · Testing (prerequisite) — P1

There are no tests. Before adding features that touch a third-party API and a
database, get a floor under the project:

- **Vitest** for `api/_lib/ra.ts` (response parsing, error mapping, date
  validation) with `fetch` stubbed. No network in tests.
- **Testing Library** for `EventCard` and the search filter.
- One Playwright smoke test: load `/`, click a date, assert cards render.

Small, but it's what makes everything below safe to change.

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

## 2 · DJ sets + artist bios — P2

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

**Done** (rebuilt 2026-07-29 from the lost original's feature manifest):
themes, densities, navigation modes, swipe, details sheet, skeletons,
adjacent-day prefetch.

**P2**

- **NYC-time dates.** `HomePage` seeds state from `new Date()` — the visitor's
  local clock. Anchor to `America/New_York` so "today" means today *in NYC*.
  Also decide when the night rolls over: a 2 a.m. set belongs to the previous
  evening, and the date strip should agree with how people actually talk about
  it.
- **Pagination / infinite scroll.** Capped at RA's first 50 results per day.
- **Error boundary.** A render crash currently blanks the page. (The retry
  button and `prefers-reduced-motion` handling are done.)

**P3**

- **Filter chips** — genre, RA Pick only, free, before-midnight.
- **City switcher.** `api/events.ts` already accepts `?area=`; the UI just
  doesn't expose it. RA area ids are stable (8 = NYC).
- **PWA / installable.** This is a phone app people open on the way out.
  Offline-cache the current week.
- **Open Graph images** per day so shared links look like something.
- **Tailwind v4 upgrade.** Pinned to v3 during the migration; see
  [MIGRATION.md](./MIGRATION.md#build-fixed). Do it as its own PR, never
  alongside a feature.
- **Analytics** — Vercel Analytics is one line and no cookie banner. Worth it
  only to answer "is anyone tapping DJ names?"

---

## Explicitly not planned

- User accounts, or anything requiring a login.
- Ticket sales — always hand off to RA.
- Cities beyond NYC as a default. The name is the scope.
