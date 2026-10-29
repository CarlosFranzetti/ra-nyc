# Agent transcript — flyer speed, five-year history, feature research, local versions

**Session:** 2026-10-28 · repo `ra-nyc` at `c80f79f` (main, landing 56)
**Orchestrator:** Fable 5.1 (this session) — briefs, relays, rulings, assignment, ship
**Owner's ask (verbatim):** "I noticed the flyers aren't loading as snappy as they used to. I thought we were caching them 6 months into the past and up to 3 months future as long as there is an event. I'd actually like to cache the past five years but do not preload them like the 6mo cache was being handled (as per my understanding). Only access those if a user does a search or if someone is starting to browse history. Split this amongst various haiku and sonnet agents and fable will orchestrate. I want 2 opus agents doing research about any features I might be overlooking. I also want a lower agent looking into how hard it would be to have local versions. (Berlin, London, Ibiza, Detroit, etc.)"

## 00 · Orchestrator — what is actually true today, before anyone is briefed

- The **search index** (`event_cache`, Neon) spans 120 days back and 45 ahead (`SEARCH_BEHIND_DAYS` / `SEARCH_AHEAD_DAYS` in `api/_lib/ra.ts`). The nightly cron hits `/api/backfill` and fills missing days, nearest first, 60 days a run. `/api/health` reports 163 of 166 days indexed.
- **Flyers are not cached by date anywhere.** Three layers: the browser tries `images.ra.co` directly with no referrer; on error it retries through `/api/image` (allowlisted, 8 MB cap, `public, max-age=86400, s-maxage=2592000, immutable`); the service worker (`public/sw.js`) keeps at most 300 flyers, evicting the longest-unopened. The `/api/events` responses are kept by the service worker for roughly 5 months back / 1 month ahead (200 entries). So "six months of flyers" was never the design — it is the data cache's shape, and the owner's model of it is one of the things to answer.
- Since 2026-10-26 the list warms a selected night's flyers five at a time off-screen (`useWarmDayImages`), the cards use `content-visibility`, and the page scales under an open sheet. Any of these could be the "less snappy".

| Lane | Agent | Model | Remit |
|---|---|---|---|
| FLYERS | F1 | sonnet | Why flyers feel slower; measure; propose the fix |
| HISTORY | C1 | sonnet | Audit every cache layer; design five-year on-demand history (no preload) |
| HISTORY | C2 | haiku | Search over a five-year index: queries, indexes, coverage copy |
| RESEARCH | R1 | opus | Product features the owner may be overlooking (listener-facing) |
| RESEARCH | R2 | opus | Platform/data features the owner may be overlooking (index, PWA, RA data) |
| LOCAL | L1 | haiku | How hard are local versions (Berlin, London, Ibiza, Detroit) |

Rules for every agent: investigation only — no edits under `src/` or `api/`, no commits; probes only under the scratchpad; one private `E2E_PORT` each if a Vite server is needed; evidence as file:line plus what was run; a proposed change with its blast radius; a "ruled out" list. Subagents cannot message each other, so every cross-lane point goes through the orchestrator and is logged here.

## 01 · Orchestrator → all six — briefs sent (23:0x UTC, 2026-10-28)

All six launched in parallel, in the background. Briefs in short:

- **F1 (sonnet):** rank the causes of slower flyers with evidence — the direct-then-proxied double hop in `EventThumb`, whether `useWarmDayImages` contends with on-screen `<img>` loads and whether its fetch options even match the img so the warm is reused, `content-visibility` and lazy-load, the 300-flyer cap and whether `trim` is really LRU; a cheap Playwright probe with a 150 ms stub CDN; and the owner's "six months of flyers" belief answered in three sentences.
- **C1 (sonnet):** audit every cache layer with file:line; trace a tap on a date 200 days or two years ago end to end; design five-year on-demand history (retention, fill-on-browse, fill-on-search with three options costed in RA requests, what the cron keeps doing, coverage semantics, the service worker's data cache, Neon size, `search_key` at write time); an ordered implementation plan flagging anything near the backfill bearer check.
- **C2 (haiku):** the index's queries at 180k rows — which scan, which need an index (exact `CREATE INDEX`), whether matching is SQL or JS; coverage fields and the exact UI sentence; result ordering over five years; the Vitest cases to pin it.
- **R1 (opus):** up to twelve listener-facing features the owner may be overlooking, each with fit, S/M/L cost and conflicts with ROADMAP's "not planned" and the security rules; a considered-and-rejected list. Grounded in the owner's taste as shown this session.
- **R2 (opus):** up to twelve platform/data features — RA fields unread, what a five-year index makes possible, PWA capabilities on iOS 17+, free-tier limits — plus a bonus "things that look wrong today" list.
- **L1 (haiku):** every place NYC is baked in (table, file:line, how to parameterise); what is known about RA area ids; three architectures costed in days and ongoing RA/Neon/cron cost; a recommendation with the first three steps.

## 02 · R1 (Opus, product research) → Orchestrator — report

> I've ranked nine features below, covering the listener-facing side only. I checked each one against the code, and none is already listed in ROADMAP except where I say "twist". Most competitors build on accounts. RA Guide and DICE both centre on following artists and venues, alerts and saving events, and DICE adds Spotify or Apple Music taste-matching and waiting lists. Songkick imports your music library and syncs gigs to your calendar. The review complaints I found were thin: alerts that fail or fire for the wrong city, refunds, and RA's search. So the useful gap is the version of each feature that needs no account.
>
> ### Ranked
>
> **1. Links that open a specific night or event, plus a Share button**
> - **What it is:** `?date=YYYY-MM-DD&event=<id>` in the address bar, and `navigator.share` in the event sheet so a friend lands on the same night with that event's sheet open.
> - **Why it fits:** Right now every URL opens tonight. `App.tsx` sends `*` to `HomePage`, and the selected date and open sheets are only in-memory state. The only link you can send is the ra.co one. ROADMAP's P3 "Open Graph images … so shared links look like something" assumes shareable links exist, and they don't. **Twist on a roadmap item:** this has to come before the OG images.
> - **Cost:** S–M. `HomePage.tsx` state moves to `useSearchParams`, plus one button in `EventDetailsSheet.tsx`. No new data. Per-event OG images need server rendering and belong to R2.
> - **Risk:** Keep the search term out of the URL. The original Phase 1a plan put `?q=` there, but Vercel Analytics records page URLs, so that would quietly turn into analytics on search terms. Use only the date and event id.
>
> **2. Starred nights, kept on the device**
> - **What it is:** A star in the event sheet. Starred events get a small mark on their date-rail chip and on the card, and double-tapping the logo lands on the starred one when tonight has one.
> - **Why it fits:** Every competitor has save or follow, and every one of them needs a login. ROADMAP rules out accounts, and `recentSearches.ts` already shows the pattern of a pure function plus a thin `localStorage` wrapper. It answers "where was I going tonight" at 1am without scrolling 50 cards.
> - **Cost:** M. A new `lib/starred.ts`, plus `EventDetailsSheet`, `DatePicker` and `EventCard`. No new data.
> - **Risk:** Safari erases script-written storage for sites that haven't been used for 7 days unless they're installed to the home screen, so stars can disappear for browser-only users. Say so in the copy rather than promise permanence. Item 1's share link doubles as the export.
>
> **3. After midnight, show what's still going**
> - **What it is:** Once the clock passes midnight within the night `night.ts` defines, ended events dim and sink, and running ones read "until 6am" instead of their start time.
> - **Why it fits:** `night.ts` exists for "the person looking at their phone at 2am … wants the next room", but the list still shows 10pm parties that ended at 2am at full weight. `endTime` is already fetched (`api/_lib/ra.ts:79`) and the UI never uses it; `EventCard` shows only `startTime`. It changes automatically, with no new chip, so it doesn't advertise itself.
> - **Cost:** S. `EventCard.tsx`, a sort tweak in `HomePage`, and one helper in `night.ts`.
> - **Risk:** RA's `endTime` is often a promoter's nominal guess, so dim ended events rather than hide them. It depends on the P1 New York timezone fix, or anyone abroad gets the wrong "now".
>
> **4. "Also in NYC" on the artist and venue sheets**
> - **What it is:** The next two or three indexed dates for this DJ in `ArtistSheet`, and the next few nights at this room in `VenueSheet`. Tapping one jumps the listings there, the way a search result does.
> - **Why it fits:** ROADMAP §1b says "when is this DJ playing in NYC next?" is the genuinely useful search, but it only answers that if you think to type the name. The moment you're listening to someone in the artist sheet is when you want to know. This is RA and DICE's follow-the-artist value with no follow button.
> - **Cost:** S–M. The index already stores artist and venue ids in each event. The clean version adds `?artist=<id>` and `?venue=<id>` to `api/search.ts` rather than spending the 20-per-minute search budget on a name query every time a sheet opens.
> - **Risk:** Changing `/api/search` brushes the rate-limit headers, which CLAUDE.md lists as a must-review area.
>
> **5. The playlist survives the app being closed**
> - **What it is:** Save the queue, the current set and its position on the device. On reopen, the transport comes back paused at 47:12 and plays on one tap.
> - **Why it fits:** iOS routinely kills a backgrounded PWA, and `PlayerContext.tsx` saves nothing to the device today, so "a player that keeps your playlist" only lasts as long as the tab does. The players already support `seek` (`players/types.ts:15`), and restoring paused respects "no sound without a gesture".
> - **Cost:** M. Saving and restoring in `PlayerContext`, plus seek-on-load in the SoundCloud and Mixcloud adapters.
> - **Risk:** It must never autoplay on restore. A saved set URL that has since been deleted needs a quiet fallback; it overlaps the deferred "Skip an unplayable set" item.
>
> **6. DJs you've listened to, remembered without a button**
> - **What it is:** Any DJ you've listened to for more than a minute is remembered on the device. Their name in other lineups gets a quiet mark, and optionally the night gets one too.
> - **Why it fits:** `PlayerContext` already counts seconds listened for the ticket rule in `tickets.ts`, which is the same "earned, not advertised" signal. It is RA, DICE and Songkick's follow and taste-matching, learned from what you actually played, with no OAuth and no follow button.
> - **Cost:** M. A new `lib/heard.ts`, a hook in `PlayerContext`, lineup styling in `EventCard` and `EventDetailsSheet`, and a "Forget listening history" row in Settings.
> - **Risk:** This is listening history kept on the device. It must stay out of `analytics.ts`, and the code should say so as plainly as `analytics.ts` says what it doesn't send.
>
> **7. Subway directions next to Uber and Lyft**
> - **What it is:** A transit hand-off in the venue sheet: Apple Maps with `dirflg=r`, Google Maps with `travelmode=transit`, or Citymapper.
> - **Why it fits:** The README says "most of the walk to a venue is underground", yet `rideLinks.ts` only builds car hand-offs. It uses the same universal-link, no-geolocation design as the existing ride links.
> - **Cost:** S. `rideLinks.ts` and `VenueSheet.tsx`, using coordinates `/api/venue` already returns.
> - **Risk:** If it's Citymapper, draw a plain wordmark the way `RideMarks.tsx` does. Count it as an outbound tap in `analytics.ts` with the same honest wording.
>
> **8. Add to calendar**
> - **What it is:** Build an `.ics` file on the device from the event and the venue address.
> - **Why it fits:** Songkick's calendar sync is one of its most-cited features, and it's the no-account version of "remind me". This works with no server.
> - **Cost:** S. A new `lib/ics.ts` and one row in `EventDetailsSheet`.
> - **Risk:** RA's times have no timezone, so the file must say `TZID=America/New_York` or it repeats the P1 timezone bug inside someone's calendar. Downloading an `.ics` from a home-screen PWA on iOS is unreliable, so test that on a real phone first.
>
> **9. Sleep timer**
> - **What it is:** "End of this set" or 30 or 60 minutes, then a fade and pause.
> - **Why it fits:** People play sets on the ride home or in bed, and the app is built so sets keep playing while you browse. To stay out of the 44px transport row, put it behind a long-press on pause; the owner already likes hold gestures (`useLongPress`).
> - **Cost:** S. `PlayerContext` and `PlayerBar`.
> - **Risk:** iOS slows down timers in a backgrounded page, which is exactly the locked-phone case. Check that on a real device before promising it works. "End of this set" is the most reliable option, because it fires on the provider's own end-of-track event rather than on a timer.
>
> ### Considered and rejected
> - **Push alerts for DJs you follow:** needs a push subscription stored on the server per person, which is an account in all but name, and iOS only allows it for installed apps.
> - **Spotify or Apple Music import:** needs a login with those services, and DJ-set artists are thinly represented there.
> - **"Friends going" or anything social:** needs accounts.
> - **Price, sold-out, waitlist, resale:** ticket sales are "not planned", and price isn't in RA's listing data (the Free chip's lesson in `filters.ts`).
> - **Set times or timetable:** not in RA's listing data. The flyer is the source, and the hold-to-view flyer already covers it.
> - **Genre chips:** already rejected in memorystate's "Filters that filter something".
> - **A map of every venue tonight:** needs geocoding every venue each night, which runs into Nominatim's usage limits. That's a data problem for R2.
> - **Tracklists or track IDs for sets:** a SoundCloud data-access question, so it belongs to R2 under the client_id rule.
> - **MTA service alerts and weather:** clutter, plus a keyed server feed.
> - **Ratings or reviews of nights:** needs accounts and moderation.
> - **Desktop keyboard shortcuts:** small value for a phone-first app.
> - **City switcher:** NYC-only is the scope.
>
> Sources: RA Guide on the App Store (apps.apple.com/app/id981952703); RA Guide on AlternativeTo; RA Guide reviews (justuseapp.com); DICE on Google Play and Wikipedia; Bandsintown alerts outage (status.bandsintown.com); Digital Music News on Songkick (2014); a Songkick review (docket.com.br).

*(Orchestrator: 122,977 tokens, 21 tool uses, 2m 26s.)*

## 03 · R2 (Opus, platform research) → Orchestrator — report

> I read the repo only and made no edits or commits. RA publishes no GraphQL schema, so every RA field name below comes from third-party scrapers' output, not from RA. Treat each one as a guess to try before building on it. The test is the same pattern `api/_lib/artistLinks.ts:1083` uses: send the field in a separate query and log the failure, so a wrong name can't break the listings query (`api/_lib/ra.ts:67-104`).
>
> ### Ranked features
>
> **1. Ticket state on the card (sold out, ticketed, price text)** — RA fields `isTicketed`, a `cost`/price-text field and a tickets-available or sold-out flag; the app reads none (`ra.ts:67-104`). Add to `RAEvent` in both places (`ra.ts:32`, `src/types/event.ts`) and one `jsonb` column. Display only; hands off to RA, so "no ticket sales" holds. **Cost S–M.** Risk: unverified names; sold-out changes hourly but the edge holds a day 5 min and the index refreshes ~every 3 nights, so it needs a "last seen" time.
>
> **2. A DJ's NYC history: "23 NYC dates since 2021", last and first gig, NYC debut or "back after 3 years"** (needs the five-year index) — `event_cache.artists` is `jsonb` (`eventCache.ts:63`, migration 0007) with no index; add a GIN `jsonb_path_ops` index and query `artists @> '[{"id":"…"}]'`. Return from `/api/artist` (edge-cached a week, `api/artist.ts:103`). Also answers year-in-review (most-booked DJs, busiest venues). **Cost M.** Risk: a false "debut" when history has gaps (on-demand fill, or the 50-row cap below); only flag when the index covers the DJ's range.
>
> **3. A venue's calendar and history** (five-year index) — the index drops the venue id (`eventCache.ts:118-122` sets `venue: { id: null }`). Add `venue_id` and an `(area_id, venue_id, event_date)` index; old rows get it when re-fetched. Behind `api/venue.ts` (cached 30 days). **Cost M.** Risk: rows without an id until re-fetched; name matching breaks on shared names.
>
> **4. Health reporting for the index and for RA schema changes** — a `backfill_runs` row per run (today the result only reaches the cron's response, `backfill.ts:234`); `/api/health` reports last run, age, RA errors per field; a check that RA's `totalResults` (queried at `ra.ts:101`, never read) matches rows stored; pair with a scheduled `web_fetch_vercel_url` read. **Cost S.** Risk none; RA renaming a field or blocking Vercel is the biggest risk to the app and today shows only as quietly stale data.
>
> **5. Genres and promoters as structured data** — RA fields `genres { id name }`, `promoters { id name }` (RA has launched genre tags). Store as `jsonb`, include in `search_key`; gives the roadmap's genre chip (`ROADMAP.md:166`) real data, real data under `vocab.ts`'s vibe words, promoter search by id. **Cost M.** Risk: unverified; promoters self-enter genres, thin coverage.
>
> **6. Trigram index for search (needed before searching five years)** — `create extension pg_trgm` + GIN `gin_trgm_ops` on `search_key`; the b-tree on `(area_id, search_key)` cannot serve `like '%term%'` (migration 0007's comment admits it). `word_similarity` handles typos in SQL and could replace the 5,000-row in-memory scan (`eventCache.ts:51`, ~±50 days). **Cost S.** Risk: +50–100% of the column's size on Neon's 0.5 GB.
>
> **7. Calendar files and subscribable feeds (`.ics`/`webcal`) per event, DJ or venue** — `api/ics.ts` reading `event_cache`; RA times have no zone, so `TZID=America/New_York`. A DJ or venue feed is "tell me when X plays" with no login, no push, no install, on iOS today. **Cost S (event) / M (feeds).** Risk: calendar servers poll, so edge-cache for hours; never log the feed URL with the IP.
>
> **8. A party's lineage: "new this season", "5th edition", "one year ago tonight"** (five-year index) — needs a series key: RA may have one (unverified), else promoter id + title stem + venue. **Cost M–L.** Risk: wrongly merging two parties; far better once promoter ids exist.
>
> **9. Attendance over time: "heating up", real busy tiers** — each upsert overwrites `attending` (`eventCache.ts:207`). A `(ra_event_id, day, attending)` table written nightly for future events, pruned to 60 days keeping finals. **Cost S–M.** Risk: unpruned it is ~1M rows a year.
>
> **10. Manifest upgrades** — `id`, `shortcuts` (Tonight, Tomorrow, Search), `share_target`, `launch_handler: navigate-existing`, `screenshots`, 192/512 PNGs (today SVG only). **Cost S.** Risk: Chromium-only; iOS supports none of `share_target`, `launch_handler`, `shortcuts`; iOS does support `navigator.share`.
>
> **11. Link previews per event (`/e/:id`)** — the SPA rewrite gives every link the same bare page. A small function returning HTML with `og:` tags from `event_cache`, flyer via `/api/image`, then loading the app. Covers the roadmap's OG item (`ROADMAP.md:172`) without rendering images. **Cost M.** Risk: skip `@vercel/og` (Hobby's 4 CPU-hours).
>
> **12. Web push for followed DJs/venues, plus a home-screen badge** — subscriptions table, VAPID keys as server env (never `VITE_`), lineup diff at backfill time (today the upsert erases the old lineup); `setAppBadge`. **Cost L.** Risk: iOS 16.4+ installed apps only, permission on a tap only; Hobby cron is daily so alerts are a digest; push endpoints are personal data; feature 7 gets ~80% for ~10% of the cost.
>
> ### Free-tier sums
> - Neon Free: 0.5 GB storage, 100 CU-hours/month per project. Five years at ~60 events a night ≈ 110k rows; at ~1 KB a row plus indexes ≈ 150 MB, ≈ 200 MB with trigram. Fits. Stops fitting with unpruned attendance history or other cities written into the index.
> - Could not measure the real table size: the Neon connector shows three projects (crates, DustBox, comic), none is ra-nyc.
> - Vercel Hobby: 4 CPU-hours/month, 1M invocations.
> - RA's terms page showed no automated-access clause I could read; `memorystate.md` §5.7's open question stands.
>
> ### Considered and rejected
> Periodic Background Sync (Chromium-only); caching sets offline (third-party iframes, `sw.js:39-49`); reading RA counts from page HTML (scraping); scraping SoundCloud's `client_id` (forbidden); accounts; hourly cron (Hobby is daily); shared rate limiter (costs money; `rateLimit.ts:9` is a documented choice); flyers in Blob/Neon; `tsvector` (DJ names aren't dictionary words); price-drop alerts; more cities ("the name is the scope"); "near me" (R1's).
>
> ### Things that look wrong today
> 1. **Flyer cache throws flyers away on hits** (`public/sw.js:301`). The "touch" code clones `cached` after an `await cache.delete(...)`, by which time the page is already reading that response — the "body already used" class documented at `sw.js:200-208`. If so, the delete succeeds and the put throws, so each cache hit evicts the flyer and it only stays cached every other view. The promise also runs outside `waitUntil`. Fix: clone before returning.
> 2. **Search puts tonight's parties under "Past" from about 8pm ET.** Server-side "today" is the UTC date (`ra.ts:419-422`; also `backfill.ts:113`, `eventCache.ts:409`, SQL `current_date`). No server code uses `America/New_York`. The roadmap's "one function" fix (`ROADMAP.md:44`) covers only the client.
> 3. **The index never sees the tail of busy nights.** Backfill calls `fetchRAEvents` with the default page size of 50 (`ra.ts:244`, `backfill.ts:209`), and multi-day runs use up rows. `totalResults` is fetched but never read (`ra.ts:101`). A five-year index carries this gap forward.
> 4. **Cancelled events are never removed from the index.** `cacheEvents` only inserts or updates (`eventCache.ts:192-214`). Removed listings stay in search and in the RA-down fallback. Can't be cleared by diffing against a fresh fetch until #3's cap is fixed.
> 5. **Anyone can grow the database with other cities.** `/api/events?area=<any int>` writes into `event_cache` (`events.ts:98,120`), 30 requests a minute per instance across every date within ±1 year. Allowlist the area or skip the index write when the area isn't NYC.
> 6. **Heads-up for C1/C2:** `isValidDate` rejects dates more than a year from today (`ra.ts:316-326`), so a five-year on-demand fill through `/api/events` will get a 400.

*(Orchestrator: 160,382 tokens, 24 tool uses, 2m 55s. Relays: #1 → F1; #3, #5, #6 → C1. Logged below.)*

## 04 · Orchestrator → F1, C1 — relays from R2

- **→ F1:** R2's claim that `public/sw.js:301` clones the cached flyer response *after* `await cache.delete(...)`, so each cache hit evicts the flyer and it only stays cached every other view, with the promise outside `waitUntil`. Asked for confirm/refute with evidence, a Playwright proof if feasible (second view of a night should make zero image requests), as a new section 5.
- **→ C1:** four items to fold in and verify — `isValidDate`'s one-year bound (a five-year browse would 400); `/api/events?area=` writing any area into the index (a storage-growth hole that a five-year window widens); backfill's 50-row page size and the unread `totalResults` (busy nights' tails never indexed); cancelled events never removed. Plus a check of R2's Neon arithmetic (five years ≈ 110k rows ≈ 150 MB of 0.5 GB).

## 05 · L1 (Haiku, local versions) → Orchestrator — report

> Short answer: one deployment with a city switcher is the cheapest path, about 8–12 developer-days. Nothing is in the repo that would stop it, but the RA area ids for Berlin, London, Ibiza and Detroit are not verified, so the first step is a live check. Full notes at `scratchpad/agents2/l1/notes.txt`. Read-only; nothing was edited or committed. Effort figures are estimates from reading the code, not measured.
>
> ### 1. Where NYC is baked in
>
> | file:line | NYC-specific | Parameterise as |
> |---|---|---|
> | `api/_lib/ra.ts:23-24` | `NYC_AREA_ID = 8`, the default area | per-city config |
> | `api/_lib/ra.ts:169` | `venue.area: "New York"` hardcoded; also lands in `event_cache.venue_area` | per-city name |
> | `api/_lib/ra.ts:207`, `api/venue.ts:122` | Referer `ra.co/events/us/newyork` | per-city |
> | `api/_lib/ra.ts:215` | `filters.areas.eq` takes the passed id, so the query is already area-aware | no change |
> | `api/_lib/ra.ts:419-422` | `shiftDate` uses `toISOString()`, so "today" is the UTC date | city TZ |
> | `api/events.ts:98` | reads `?area=`, defaults to NYC | already ready |
> | `api/search.ts:85` | `areaId: NYC_AREA_ID`, no `?area=` param at all | request param |
> | `api/backfill.ts:155,180,211,214`, `:113-115` | `NYC_AREA_ID` and UTC `shift()`; one 60-day budget per run | loop over cities |
> | `api/health.ts:59` | `NYC_AREA_ID` | per city |
> | `api/venue.ts:47` | `CITY_SUFFIX = "New York, NY, USA"` (geocode query and maps label) | per city |
> | `api/venue.ts:50`, `:170` | `NYC_VIEWBOX` Nominatim bias; `bounded=0`; no `countrycodes` | per city |
> | `api/_lib/artistContext.ts:128-190` | `PLACES` and `REGIONS.ny` aliases used for origin scoring | per-city extras |
> | `api/_lib/vocab.ts:23-77` | English vocabulary; comment says "NYC institutions" | per-language file |
> | `migrations/0007_event_cache.sql` | `area_id` column; every query filters on it (`eventCache.ts:278` and onward) | ready, no change |
> | `src/lib/night.ts:23-24`, `:33-38` | 03:30 rollover on the visitor's clock | per-city TZ and rollover hour |
> | `src/hooks/useEvents.ts:16` | fetches `/api/events?date=` with no area | add `&area=` |
> | `src/hooks/useEvents.ts:36,44,164,187`, `src/pages/HomePage.tsx:66` | query key `["events", date]`, no city | add city to key |
> | `src/hooks/useSearch.ts:22,53` | `/api/search?q=`, key `["search", term]`, no city | add city |
> | `src/main.tsx:37` | query cache persisted to localStorage as `ra-nyc:query-cache` | a city switch shows the old city unless keyed |
> | `src/components/VenueSheet.tsx:208-215` | Lyft link shown for every venue, no region check | per-city flag (Lyft is US/Canada) |
> | `src/hooks/useDistance.ts:105-106` | `mi` hardcoded | per-city units |
> | `src/lib/formatEventDay.ts:13` | locale `en-US` | per city |
> | `src/lib/formatTime.ts:20-24` | 12-hour am/pm only | per city |
> | `src/components/Header.tsx:188` | logo word "NYC" | per city |
> | `src/components/SearchSheet.tsx:380` | "search NYC listings" | per city |
> | `index.html:44,97-112` | title, meta, og and twitter all "RA NYC" | per deploy (build time) |
> | `public/manifest.webmanifest:2-4` | name, short_name, description | per deploy (one manifest per origin) |
> | `vercel.json` crons | one cron on `/api/backfill`, `0 9 * * *` | per deploy or per-city loop |
>
> Fine as they are: `src/lib/tiles.ts` (generic CARTO tiles), `src/hooks/useDistance.ts:85-91` (haversine), `src/lib/tickets.ts` (hand-off to RA; no price or currency rendering), `api/image.ts` (RA host allowlist), the per-IP rate limits. No map-centre coordinates in `src/`; the only NYC coordinates are in test fixtures and `NYC_VIEWBOX`.
>
> Timezone findings: event times display correctly for any city (RA times are naive wall-clock strings and `formatTime` keeps the digits). "Which night is it now" follows the visitor's clock (`night.ts`) — the open P1 in ROADMAP. The server's "today" is the UTC date (`ra.ts:419-422`, `backfill.ts:113-115`, `eventCache.ts:410`), wrong for NYC from 20:00 to 24:00 EDT; the same fix covers it.
>
> ### 2. RA area ids
> - In the repo: NYC is 8 (`ra.ts:23-24`, `DATABASE.md:230`, ROADMAP, `memorystate.md:55`). Nothing records how 8 was verified; the query was ported from an earlier Supabase edge function not in this repo.
> - `fetchListings` (`ra.ts:215`) sends `GET_EVENT_LISTINGS` with `filters.areas.eq` and a `listingDate` range; RA caps a page at 100 rows.
> - WebSearch (two standard queries; third-party scraper listings, not RA docs): London 13 (one source, medium-low); Berlin 34 (several listings, medium; may copy each other); Amsterdam 20 in most, 23 in one (shows the sources are unreliable); New York 8 corroborated (medium-high); Ibiza and Detroit not found. Could not confirm the `areas.eq` shape; cannot reach ra.co from the sandbox.
> - To verify: probe `/api/events?date=…&area=34` on the deployed app (production can reach RA), or the network tab on `ra.co/events/de/berlin`. The probe writes area-keyed rows into `event_cache`, so it is not side-effect free.
>
> ### 3. Three architectures
> **(a) One deployment, city switcher in Settings.** Reuses `event_cache.area_id`, `/api/events?area=`, one Neon database and one cron. Thread the city through client fetches and query keys, add an area param to search, make the transform take the city, a per-city config table (TZ, rollover, viewbox, suffix, locale, units, 12/24-hour, Lyft flag, vocab), loop the backfill over cities with a per-city budget, health per area, Settings UI and copy. **About 8–12 dev-days.**
> **(b) One codebase, one deployment per city.** Env config (`RA_AREA_ID`, `CITY_NAME`, `TZ`, centre); build-time manifest and `index.html`; one Vercel project and one Neon database per city (or one partitioned). **About 4–6 days for the first city, 0.5–1 day per extra**, plus ongoing ops: N projects, N crons, a redeploy per env change. Each city gets its own install name and icon — the main advantage.
> **(c) Path-based `/berlin`.** Routing is cheap, but one manifest per origin (an installed `/berlin` is still "RA NYC"), static titles and meta, area in every API call, service-worker scope. **About 8–10 days**, worst install story.
>
> RA and storage per city: a day view is 1 RA request; a cold search is 20 (3 ahead, 10 exact past days, 7 sampled: `ra.ts:351,376,405`); backfill does 60 days a run, 6 concurrent, 8 s timeout, 50 s budget, daily — a 166-day window cold-fills in ~3 nights for one city, ~8–9 nights each for three sharing the budget. Neon ≈ 100 rows a day for NYC, ~15k a year, nothing prunes; each extra city about the same.
>
> ### Recommendation
> Architecture (a), with one cities table. The data layer is already keyed by area, so a single deployment costs code, not infrastructure. (1) Fix NYC's timezone first, in `night.ts` and the server's UTC dates, via a one-entry cities table — closes ROADMAP P1, about half a day. (2) Verify Berlin and London area ids with one probe each on the deployed app; add `?area=` to search and the client query keys; make the transform take the city. (3) Add Berlin as the second city: timezone, rollover (owner's call; 03:30 is tuned for NYC), viewbox, suffix, 24-hour, km, no Lyft, German vocabulary; per-city backfill budget.
>
> ### Ruled out / unknowns
> Ruled out: currency, map centre, image proxy, rate limit, time display, distance maths. Unknowns: the four area ids (none high-confidence; Ibiza and Detroit unknown); the `areas.eq` filter shape live; listing volume elsewhere; the Vercel plan's cron limit; Neon sizing for several cities; RA's terms for multi-city use; the owner's scope decision (ROADMAP: "Cities beyond NYC as a default. The name is the scope.").

*(Orchestrator: 152,835 tokens, 38 tool uses, 2m 50s.)*

## 06 · C2 (Haiku, search at scale) → Orchestrator — report

> ### 1. Query shape at scale
> I read the code and did not run EXPLAIN, so the planner expectations are inferred, not measured.
> - **`searchCachedEvents`** (`eventCache.ts:250-295`) selects 13 columns where `area_id = $1`, `event_date between`, and an OR of `search_key like '%' || key || '%'` (269-271); orders by `abs(event_date - current_date)` (285); `limit $4` (286) — the caller passes `SEARCH_LIMIT * 2` = 120 (`ra.ts:655`). Also runs `coverage()` (290), a second aggregate over the window on every search. The date range can use `event_cache_window_idx (area_id, event_date desc)` (migration 0007:50). The `like` has no index. Area 8 will be nearly the whole table at five years: expect a Seq Scan, then a top-N sort over every match.
> - **`recentCachedEvents`** (334-362): no term predicate; `order by abs(...) limit 5000` (`FUZZY_SCAN_LIMIT`, line 51). The distance function cannot use an index, so every row in the window is read and sorted on every search. Today the window already exceeds 5,000 rows, so it always returns exactly 5,000.
> - **`cachedEventsForDay`** (310-331): equality on the window index. Fine at any size.
> - **`indexStatus`** (412-419) and **`coverage`** (524-528): `count(distinct event_date)`/min/max over the window; `coverage` runs on every search.
> - **`staleDays`** (464-474): groups the whole window; backfill only. **`missingDays`** (492-500): `generate_series` with `NOT EXISTS`, ~1,871 index lookups; cheap, but its meaning breaks at five years.
> - **The 120 cap** (`ra.ts:655` → `eventCache.ts:286`): at 180k rows it decides which matches exist at all — the 120 nearest today, both directions interleaved. Fails when more than 60 upcoming matches are closer than the 60th most recent past match. Applied before JS removes false positives, so it can evict true matches.
> - **Fuzzy reach:** 5,000 rows at ~96 a day ≈ ±25 days; the comment at 46-49 claims ±50.
> - **Indexes:** `event_cache_search_idx (area_id, search_key)` cannot serve `%term%` (the comment at 53-55 claims a bitmap fallback; it does not). `search_key` is lowercase a-z0-9 (`normalize.ts:40`), so `like` is exact. New: `create extension if not exists pg_trgm; create index if not exists event_cache_search_trgm_idx on event_cache using gin (search_key gin_trgm_ops);` Drop `event_cache_search_idx`. Draft DDL at `scratchpad/agents2/c2/proposed-index.sql`.
> - **Preloading risk.** The daily backfill (`vercel.json` cron `0 9 * * *`, `backfill.ts:154-162`, `DEFAULT_DAYS` 60) would, once the window is five years, fill 1,871 gaps at 60 a night. That breaks "never preloaded". Its `from` must stay at the recent band, or the gap pass must go.
> - Migration 0007:59 says a year is ~15k rows; at ~100 a day it is ~36k.
>
> ### 2. The matcher
> - **Both SQL and JS.** SQL pre-filters with substring on `search_key`; JS runs the full `matchesTerm` (`ra.ts:449-544`) on up to ~2,000 live rows (3 ahead pages, 10 exact days, 7 sampled, 100 each), up to 120 SQL rows, and exactly 5,000 scanned rows (`ra.ts:686, 695-699`) — ~7,100 calls per search. Constants, so they do not grow; the reach and the cap placement are the real problems.
> - **Correctness at scale.** SQL is looser than JS: expansions are substring in SQL but whole-word in JS (`ra.ts:473-478`). From `vocab.ts`: `live`→`av` matches Dave and Travis; `after`→`late` matches chocolate; `queer`→`trans`; `bass`→`uk`. Cross-field matches come through because the haystack joins fields and strips spaces (`eventCache.ts:131-135`, `normalize.ts:40`). The 120 cap applies before JS removes these, so false positives fill the slots and real matches are evicted. At 180k a vocabulary word will hit it.
> - **Proposal, in order:** (1) move the whole-word rule into SQL: `search_words text[]` with the split from `ra.ts:457`, filter expansions with `search_words && $expansions::text[]` on a GIN index. (2) Replace the shared `abs()` query with two index-ordered walks, NYC "today" passed in from JS: upcoming `event_date >= $today order by event_date asc limit 61`; past `event_date < $today and event_date >= $from order by event_date desc limit 61`. (3) Bound the fuzzy pass in SQL: candidates `search_key % <word or adjacent pair>` (pg_trgm), limit 300, nearest first; JS runs `withinEditDistance` only on those; keep pairs (the typo tests at `ra.test.ts:250-272` depend on them). (4) Recent first: query `[-120, +45]`, widen to the older band only when the past list has fewer than 61. (5) Hard cap with a flag: `limit 61` per list; if 61 come back, show 60 and set `truncated`. Stop writing sampled ranges to the index (`ra.ts:664`).
>
> ### 3. Coverage copy
> - **`truncated` is effectively always true for NYC.** `ahead.full` is true whenever the 45-day window has ≥100 rows (`ra.ts:577`); `cached.daysCovered < windowDays` holds while the index has fewer than 166 days (`ra.ts:722-723`). So the footer at `SearchSheet.tsx:417-420` shows on every answered search today.
> - **`coverage.indexed` counts days with any row** (`eventCache.ts:516-530`). Sampled ranges write a few rows for many days (`ra.ts:664`), so those days count as indexed, and `missingDays` never refills them (`eventCache.ts:495-497`). A defect today.
> - **Exact days are partial too.** Single-day fetches take one page of 100 (`ra.ts:633-636, 555-557`); the day view one page of 50 (`ra.ts:244`, `api/events.ts:109-120`). `collect` computes `full` (`ra.ts:577`) and nothing stores it. `backfill.ts:231-233` counts a day RA had nothing for as missing forever. `thin` (`SearchSheet.tsx:228-230`) becomes permanently true at five years.
> - **Proposed response** (`api/search.ts:10-18`, `ra.ts:410-417`): `truncated: boolean; coverage: { recent: { indexed, window }; older: { indexed, window } | null }` — recent = last 120 + next 45 (166); older = 121 to 1,825 back (1,705); null with no database. `indexed` must count complete fetched days (`event_cache_day.complete`), not days with rows. Only `SearchSheet.tsx:403-404` reads the flat shape, via `useSearch.ts:10`.
> - **Sheet copy:** empty state: `Nothing matching “{q}” in the nights we have searched.` Coverage line: `Searched {r} of {R} recent days and {o} older days people have opened.` (`all {R}` when r = R); with no older days: `Searched {r} of {R} recent days. Older nights fill in as people open their days.` Singulars handled. Truncated footer, only when `truncated`: `Showing up to 60 upcoming and 60 past nights.` Remove `thin` and the "may not be searchable yet" line; omit the coverage line with `older: null`.
>
> ### 4. Ordering and dates
> - Direction is right: upcoming ascending (`ra.ts:703-706`), past descending (710-715).
> - Two date sources: live rows classify by RA's `event.date` (`ra.ts:701`); the index files by `startTime` falling back to `date` (`eventCache.ts:137-141`) and returns that as `date`. For an overnight event these can disagree; fixtures hide it (`ra.test.ts:33-35`). Confirm with one real 22:00–04:00 sample. Live rows win de-duplication.
> - **Timezone bug, verified.** `today` is `shiftDate(0)` (`ra.ts:607`) = UTC date (419-422). Ran with `TZ=America/New_York`: at 21:00 EDT on 28 October the UTC date is 29 October, so tonight's listings file as past (711) and drop from upcoming (704). Window edges (608-609), SQL `current_date` (`eventCache.ts:285, 353`), backfill (113-115) and index status (409-410) are all UTC. Three definitions of tonight: client local date with 3:30 rollover; search UTC date; index start date. Fix: compute today in `America/New_York` in JS and pass it into SQL; never `current_date`. The `day()` test helper (`ra.test.ts:14-15`) uses the same UTC arithmetic, so the suite cannot see it.
> - **Browse limit.** `isValidDate` (`ra.ts:316-326`, gate at `api/events.ts:94`) rejects dates more than 365 days away.
> - `isoDay` and `formatEventDay` are correct under UTC.
>
> ### 5. Unit tests to add
> Existing that flip: `ra.test.ts:113-116` (400 days rejected), `:359-368`, `:370-378`; `daysCovered: 151` in `searchIndex.test.ts`.
> New in `ra.test.ts`: (1) `isValidDate` accepts `day(-1825)`, rejects `day(-1826)`. (2) tonight counted in New York not UTC — `vi.setSystemTime("2026-10-29T01:00:00Z")`, listing dated 2026-10-28 is upcoming. (3) `truncated` false when no list was cut. (4) search never asks RA for anything older than 120 days — pins on-demand. (5) `fetchRAEvents` returns every listing for a 120-row day.
> New `indexCompleteness.test.ts`: (6) a sampled range records no complete days; (7) a capped page is incomplete; (8) an RA day with zero events is fetched and complete.
> In `searchIndex.test.ts` (mock applies `limit` after distance ordering): (9) a vocabulary word does not evict true matches from the cap; (10) `after` does not match "chocolate"; (11) past stays newest-first over 1,800 days, length ≤ 60; (12) `truncated` true and `past` 60 long on 121 rows; (13) coverage bands 166 / 1,705 / null; (14) a fetched-empty day counts as indexed.
> Other: (15) `eventDay` files an overnight event under its start night; (16) `backfill.test.ts`: with 1,800 gaps every fetched day lies in `[-120, +45]` and the run stops at 60 — pins no-preload; (17) EXPLAIN script against a Neon branch, out of `test:all`.
> Baseline 274/274.
>
> ### Ruled out
> Storage (180k rows is small; the problem is query shape); `cachedEventsForDay` and `missingDays` as queries; de-duplication by id; key drift (both sides use `searchKey`); the 120 cap alone for an ordinary artist; `isoDay`/`formatEventDay`; the stale "six pages" comment at `api/search.ts:20` (the code makes 20 upstream requests: 3 + 10 + 7).

*(Orchestrator: 201,757 tokens, 25 tool uses, 5m 59s. Relayed to C1: the backfill preload trap, coverage counting days-with-any-row, partial "exact" days, the UTC today, and the recent-then-widen proposal.)*

## 07 · F1 (Sonnet, flyers) → Orchestrator — report

> ### 1. Cause(s), ranked
>
> **A. The flyer cache deletes each flyer when it serves it. Confidence: high, reproduced.**
> - **Location:** `public/sw.js:301`: `void cache.delete(request).then(() => cache.put(request, cached.clone()));` followed by `return cached;`. `cached.clone()` runs after the `await`ed delete, when the page is already reading the body. It throws `Response body is already used`, the same bug class documented at `sw.js:200-208`. The delete has already happened, so the entry is gone.
> - **Evidence:** built HEAD, served it locally with `images.ra.co` mapped to a local https server (150 ms delay, 40-event night, 390px viewport). Loaded once, then reloaded three times. `ra-img` held 40 entries after the cold visit, then 0, 40, 0 after reloads 1, 2, 3. Reloads 1 and 3 made 0 image requests (the cache was still full when they started); reload 2 made 40 direct requests (reload 1 had emptied it). The worker logged unhandled rejections: `TypeError: Failed to execute 'clone' on 'Response': Response body is already used`. So every flyer is cached only on alternate views, which confirms R2's claim.
> - **R2's other claims:** the promise is also outside `waitUntil` (true by reading). `trim` (`sw.js:126-131`) is fine: oldest-first by `cache.keys()` order; it would make the cache LRU if the touch worked.
> - **Origin:** born with the image cache in 5027de2 (2026-08-12). The offline suite only checks a first hit, so it never saw this.
> - **Effect:** in the hotlink-block scenario, HEAD's repeat visit made 38 direct requests for 40 flyers instead of 0.
> - **Real cost in production:** the worker's `fetch()` still goes through the browser HTTP cache, so some re-fetches are cheap. For the proxied path that is `immutable` and one day. Whether `images.ra.co` direct is cacheable depends on RA's headers, which I could not see.
>
> **B. The first screen is only partly warmed, and the direct-then-proxy double hop may be the dominant cost. Confidence: low to medium, not proven.**
> - `memorystate.md:587` says "Still unconfirmed: whether hotlink protection was actually the cause." Nothing in the code history proves the direct load succeeds or fails.
> - If RA rejects: each flyer pays one failed direct round trip before the proxy. The worker caches that failure too: `sw.js:310` caches any opaque response, including a 403.
> - Measured in reject mode: a cold visit made 42 direct and 30 proxy requests in the first 2 s; the cache holds ~49 entries for 40 flyers (~2 per flyer), halving the effective 300 cap; after 2 s, 20 of 40 flyers were painted — the pre-162cadf build also painted 20.
>
> **C. The warm adds duplicate requests on a cold first visit but did not slow painting. Confidence: low.**
> - With 40 events, the cold visit made 60 server hits for 40 URLs — ~20 duplicates, probably `<img>` loads racing the warm `new Image()` before the worker takes control.
> - First flyer painted at 513 ms with the warm and 512 ms without. Flyers painted by 2 s: 40 versus 20. Warm helps; not a regression.
>
> ### 2. Proposed fix
> - **A (`public/sw.js:301`, one function):** clone before returning: `const keep = cached.clone(); void cache.delete(request).then(() => cache.put(request, keep)); return cached;` Better, wrap the touch in `event.waitUntil` or drop delete-then-put for a single `cache.put`. Patched a scratch copy of the built `sw.js` this way: the cache stayed at 40 entries across three reloads, 0 image requests, 0 rejections. Blast radius: the image branch only. Test: in `tests/offline.e2e.mjs`, load, reload three times, assert `ra-img` count unchanged and the third load makes no image request. Fails on HEAD.
> - **B (decision for the owner):** open devtools Network and see whether `images.ra.co` requests return 403 or succeed. If they fail, make the proxy the first attempt and skip the direct hop (`EventThumb.tsx`, `warmImage` in `useEvents.ts`). Separately, do not cache opaque responses that may be 403s, since one failed flyer would otherwise be pinned until the delete bug evicts it.
> - **C:** nothing needed.
>
> ### 3. Ruled out
> Warm contention with first-screen images (512 ms with and without; the warm uses `new Image()` not `fetch()`, same URL and `referrerPolicy`, so the worker cache key matches). `flyerUrls` identity (memoized on `allEvents`, `HomePage.tsx:156-159`). `content-visibility` (added 2026-09-25 in 12ad278, not 162cadf; a build without it behaved the same, 512 vs 572 ms; card 20 painted instantly after scrolling in both — the pre-162cadf build with no warm took 182 ms and 9 requests). `trim`. `decoding="async"`, `fetchPriority`, the `key={stage}` remount, the 10 s timeout, the `saveData` guard. Production: `/api/health` OK; `/api/events?date=2026-10-28` returned 18 events (16 with flyers), `cache-control: public, max-age=60`, `x-vercel-cache: MISS`.
>
> ### 4. The owner's model
> - **Data cache:** the service worker holds `/api/events` responses for any date you opened, up to 200 entries, oldest-fetched evicted. There is no 6-months-back or 3-months-ahead rule. The query cache persists to localStorage. Vercel's edge holds the listings for a fresh 5 minutes (`s-maxage=300`) and serves them stale for up to a day.
> - **Image cache:** flyers are never stored in the database, only URLs. The browser caches the `/api/image` bytes for 1 day and Vercel's edge for 30 days. The worker's `ra-img` cache is meant to hold 300 flyers, but today it throws each one away when it serves it.
> - **DB:** the search index holds about 4 months back and 1.5 months ahead (`/api/health`: 2026-06-30 to 2026-12-12). Nothing ties flyer availability to "as long as there is an event".
>
> ### 5. R2's service-worker claim
> **Confirmed**, with the reproduction under cause A. Proof the fix works: in a scratch copy with clone-before-return, the cache count stayed at 40, 0 rejections, 0 image requests on reloads 1 to 3. Probes under `scratchpad/agents2/f1/` (`probe.mjs`, `probe2.mjs`). Nothing edited in the repo; no servers left running.

*(Orchestrator: 148,077 tokens, 29 tool uses, 19m 24s.)*

## 08 · C1 (Sonnet, history design) → Orchestrator — report

> Investigation only. I edited nothing and committed nothing. The scratchpad notes file was refused by the tool, so this reply is the whole report.
>
> **What I could and couldn't check:** `/api/health` via the Vercel MCP server returned `indexed 165 / window 166, oldest 2026-06-30, newest 2026-12-12`. I could not reach ra.co (CONNECT 403), so RA's schema and whether it serves 5-year-old days are **unverified**. I did not query Neon (the account's three projects are `crates`, `DustBox`, `comic`; none is ra-nyc). Vercel runtime logs: Hobby keeps one hour.
>
> **The owner's model vs the code:** the index is 120 back and 45 ahead (`ra.ts:347-348`), not 6 months / 3. The service worker keeps 200 days (`sw.js:79`). "As long as there is an event": a zero-event day stays "missing" and is retried every cron run (`backfill.ts:231-233`).
>
> ### 1. Audit
>
> | Layer | Holds | Key | TTL | Evicted by | Cite |
> |---|---|---|---|---|---|
> | Neon `event_cache` | One row per event, filed under its start night, with `search_key` and `seen_at` | `ra_event_id` PK; indexes `(area_id, event_date desc)` and `(area_id, search_key)` | Forever | Nothing — no `delete from` anywhere in `api/` or `src/` | `migrations/0007:22-57`; `eventCache.ts:151-228` |
> | Edge `/api/events` | Day JSON | Full URL, so `?area=` varies the key | 200: max-age 60, s-maxage 300, SWR 86400. RA-outage fallback: 30/60, no SWR. 429: no-store | Vercel | `events.ts:132, 168, 68` |
> | Edge `/api/search` | Search JSON | URL | 120 / 900 / SWR 86400 | Vercel | `search.ts:96` |
> | Edge, other | artist 3600/604800/SWR 30d (degraded 60/300); venue 86400/2592000/SWR 30d; image 86400/2592000 immutable; health and backfill no-store; `/assets` 1y immutable; `sw.js` max-age 0 | | | | `artist.ts:102-103`; `venue.ts:319-320`; `image.ts:126`; `vercel.json` |
> | SW `ra-data-v1` | `/api/events` responses | one per `date=` URL | until trimmed | `trim` to 200; `cache.put` re-appends, so LRU by last revalidation | `sw.js:63, 79, 126, 196-283` |
> | SW `ra-img-v1` | Flyers, including opaque | URL | until trimmed | LRU (delete and put on hit), cap 300 | `sw.js:91, 297-325` |
> | TanStack `["events", date]` | Day JSON | date | staleTime 5 min; gcTime 30 min observed, 1 day prefetched | gc; persisted to localStorage `ra-nyc:query-cache`, maxAge 1 day, throttle 2 s, buster `v2-artists` | `useEvents.ts:8-9, 46-47`; `main.tsx:11-21, 35-39, 65-68` |
> | TanStack, other | search staleTime 10 min; artist gcTime 1 day; venue staleTime Infinity | | | | `useSearch.ts:19, 56`; `useArtist.ts:40-41`; `VenueSheet.tsx` ~109 |
> | `warmedImages` | flyer URLs warmed this page life | URL | page life | reload | `useEvents.ts:200, 227-229, 326`; `HomePage.tsx:160` |
>
> **A user taps an old date.** Ways in: the calendar has no bounds (`CalendarPopover.tsx:69-78`); the rail spans -14/+45 (`DatePicker.tsx:21-22`); a search result jumps anywhere (`HomePage.tsx:326-329`). **200 days ago:** `isValidDate` passes; `/api/events` fetches live, one page of 50, `startsOn` filter, attending sort (`ra.ts:241-263`); `cacheEvents` upserts (`events.ts:120`) — nothing declines to write outside the window and nothing deletes. The row is then invisible to everything window-bound (`missingDays`, `staleDays`, `indexStatus`, the search SQL and fuzzy scan); its only reader is the RA-outage fallback `cachedEventsForDay`. The client also prefetches +1, +2, -1 (`useEvents.ts:31-41`): one tap = 4 RA calls, 4 index writes, 4 SW entries, 4 persisted queries. **2 years ago:** `isValidDate` false → 400 "Query param `date` must be YYYY-MM-DD" (wrong message for out-of-range); the client shows it and retries once. **Health is clamped:** `indexStatus` takes min/max inside the window, so `oldest 2026-06-30` cannot show whether older rows exist — they may, since nothing deletes. **Search UI breaks if `coverage.window` is simply widened:** `SearchSheet.tsx:226-230` warns "thin" when `indexed < window*0.9`, and `:417-421` hard-codes "last four months".
>
> ### 2. Design
> **(a) Retention.** Keep `[today-1825, today+365]`, enforced at the write door. `isValidDate` becomes a date-string compare against the New York day with `HISTORY_BEHIND_DAYS = 1825`; its only caller is `events.ts:94`. With the area locked to NYC, storage is capped at ~2,190 days. No pruner; a yearly manual delete is the owner's call.
> **(b) Fill on browse.** Already true to 365 days. Widen the bound; calendar `startMonth`/`endMonth` so the 400 is unreachable; out-of-range its own error text; fix the 50-row cap; skip neighbour prefetch and flyer warming outside the live window. A history browse then costs 1 RA request (2 if over 100 rows) and one upsert.
> **(c) Fill on search.** (i) now, (ii) only after a schema probe, (iii) rejected. **(i)** widen the SQL pass only, C2's two-step: recent band as today, a second query over `[-1825, -121]` only when the recent past has fewer than 10 hits; 0 extra RA. `recentCachedEvents` stays on the recent band (it reads full rows before its top-N sort: ~110k rows instead of ~8k otherwise). **(ii)** dig by artist needs RA to filter by artist or text and nothing in the repo shows it can (`ARCHITECTURE.md:355`, `memorystate.md:836`); if a probe finds a field: resolve ids from the index's `artists` jsonb, ≤3 ids × 2 pages, marker table; precondition: `transformListing` hardcodes `venue.area` "New York" (`ra.ts:168`). **(iii)** a walk is preloading by another route.
> **(d) The cron.** Leave `SEARCH_BEHIND_DAYS`/`SEARCH_AHEAD_DAYS` untouched; add `HISTORY_BEHIND_DAYS = 1825` used only by `isValidDate`, search widening and health. `backfill.ts` reads only the `SEARCH_` constants (`:156, 161, 181, 182`): zero edits, cannot walk five years. Guard test: mock eventCache, call with the `CRON_SECRET` header, assert `missingDays.from >= today-120`.
> **(e) Coverage and health.** Keep `coverage {indexed, window}` meaning the recent band. Add `older: { days, oldest } | null` with no `window` — a ratio like "12 of 1,705" is tiny by design and must never trigger "thin". Footer: "Also searched N older nights you have browsed, back to Mon YYYY." Health gains `history: { days, oldest, rows }` from an unclamped query. **On C2's `event_cache_day` table: not in the first PRs.** The partial-day defect is real but self-heals in the recent band (`staleDays` re-fetches any day with rows; sampled writes set `seen_at = now()` so they queue last and get a full re-fetch within ~3 nights). The table earns its keep when dig ships. Don't stop sampled writes; they carry a cold index.
> **(f) Service worker and client caches.** Five-year browsing thrashes them: each history browse adds 4 SW entries and 4 persisted queries (~30-35 KB each, estimated); ~50 browsed days push out the live set; localStorage (~5 MB) fills in ~40-60 days and then persistence fails silently; `useWarmDayImages` warms ~50 flyers a day into the 300 LRU, so ~6 history days evict the priority window. Fixes: (1) no neighbour prefetch or warming outside the live window; (2) the SW routes dates older than ~30 days to `ra-history-v1` (cap ~400, cache-first, no revalidation; add to `keep` at `sw.js:114`); (3) do not cache bodies with `stale:true` — the comment at `sw.js:222-225` says degraded answers are never cached but the check is only `response.ok` and the degraded answer is HTTP 200 (`events.ts:156-169`); (4) exclude history day queries from localStorage with `shouldDehydrateQuery`, gcTime 10 min; (5) for days older than ~7, edge header `max-age=3600, s-maxage=604800, stale-while-revalidate=2592000` like `artist.ts:102-103`, deployed after the paging fix.
> **(g) Neon size.** ~0.85-1.0 KB per row with indexes; 91k rows ≈ 80-90 MB, 110k ≈ 95-110 MB, 180k ≈ 170 MB; today's index ≈ 7 MB. `list_projects` shows a 1 GiB logical size limit on the account's projects; the free-tier figure I know is 0.5 GB. Fits either way. Run `explain (analyze, buffers)` before adding trigram.
> **(h) `search_key`.** Computed at write time; history rows sit outside every refresh path, so a change to `searchKey`/`normalize`/`vocab` leaves them stale. They can be rekeyed without RA from stored `title`, `venue_name`, `artists`.
>
> ### 3. Implementation plan
> | Step | Work | Files | Test | Blast radius |
> |---|---|---|---|---|
> | 0 | NY "today" helper replaces UTC `shiftDate`/`today`; pass it to SQL instead of `current_date`. Leave `backfill.ts:113-115` alone (09:00 UTC, dates agree) | `ra.ts:419-422, 607`; `eventCache.ts:285, 353, 409-410` | clock 2026-10-28T01:00Z puts an event dated 10-27 in `upcoming` | search bucketing |
> | 1 | `fetchListings` returns `{rows, total}`; `fetchRAEvents` pageSize 100, follows `totalResults` up to 3 pages; search's exact days reuse it | `ra.ts` | 100 rows with total 140 → 2 requests, 140 rows | every day view, search exact days, backfill's call: more requests per busy day |
> | 2 | Area allowlist NYC only, 400 otherwise; `cacheEvents` skips others | `events.ts:98-103` | `?area=9` → 400, no write | none in-repo |
> | 3 | `HISTORY_BEHIND_DAYS`, `isValidDate` rewrite, split error text, calendar bounds, update `ra.test.ts:112-116` | `ra.ts`, `events.ts`, `CalendarPopover.tsx` | -400 valid; -2000 and +400 invalid | visitors can store any of ~2,190 dates |
> | 4 | Search reads history: second query, older coverage, `older` in the response, `SearchSheet` copy, health `history` | `eventCache.ts`, `ra.ts`, `search.ts`, `useSearch.ts`, `SearchSheet.tsx`, `health.ts` | recent past ≥10 → one query; <10 → second with `from = today-1825`; fuzzy keeps recent bounds | SQL only |
> | 5 | Client and SW housekeeping from (f) | `useEvents.ts`, `HomePage.tsx`, `main.tsx`, `sw.js`, `events.ts:132` | offline e2e: browse 10 old days, near-term entries survive, a `stale:true` body is not stored | offline behaviour; bump cache name |
> | 6 (gated on probe) | Migration 0008 `event_cache_day`, read-through, artist dig | new | | owner applies by hand |
> | 7 (optional) | Diff-on-refetch for cancellations, future days only, via `replaceDay` from `backfill.ts` | | | touches `backfill.ts`: review on the spot |
>
> **Bearer check:** no step edits `authorised()` or the 401/503 gates. **Production data:** steps 1, 3, 6 change what gets written.
>
> ### R2 relays (verified)
> 1. Date bound confirmed; new bound NY-day compare, 1825 back / 365 ahead, error split. 2. Area writes confirmed; also an edge-cache bypass (`area` is in the key); allowlist NYC. 3. Page cap confirmed (`ra.ts:244-254`; continuing multi-day rows filtered after the page, `:258`; `totalResults` never read); on-demand fills have the same cap. 4. Cancelled events confirmed (only upserts); the day view reads live so only search shows them; diff-on-refetch unsafe while the cap exists and on history days. 5. R2's 110k ≈ 150 MB is the high end of my 95-110 MB; fits.
>
> ### C2 relays (verified)
> 1. Bands kept apart by not editing the constants backfill reads. 2. Completeness table deferred to dig; `older {days, oldest}` instead of `{indexed, window}`. 3. Partial exact days confirmed; step 1 fixes the cap. 4. UTC today confirmed; from 20:00 EDT tonight is "past"; the client's 03:30 rollover means NY midnight alone leaves 00:00-03:30 wrong; step 0, backfill untouched. 5. First PR: recent-first two-step search; wait on trigram GIN (hand-run extension; only if a search exceeds ~300 ms) and on `search_words text[]` (a separate bug).
>
> ### Ruled out
> Widening `SEARCH_BEHIND_DAYS` to 1825 (preloads 1,871 gaps, thin warning forever, fuzzy cost ×13); a walk; raising the sampled windows; paging a wide backward range (RA returns oldest first); a separate history table; a cron pruner; read-through in the first PR; trigram now.
>
> ### Open questions for the owner
> 1. Does RA serve NYC listings five years back? 2. Auto-widen when recent past has fewer than 10 hits, or an explicit "search older" button? 3. Manual yearly prune, or the cron? 4. Which Neon project is the app's, and is its limit 0.5 GB or 1 GiB? 5. OK to hand-apply migration 0008 when dig ships? 6. OK to serve old days from the edge and service worker for up to a week without revalidation?

*(Orchestrator: 204,393 tokens, 38 tool uses, 20m 1s.)*

## 09 · Orchestrator — consolidation and rulings

All six in. Total investigation: ~990k subagent tokens across six agents, against ~1.3M for ten in the first hunt, with no agent dying on a limit.

**Rulings, binding on the repair lanes.**
1. **Flyers.** F1's cause A is the fix and it is already in: `dc541e5`, clone-before-return plus `waitUntil`, offline 14/14 with two new checks. F1's cause B (proxy-first if RA rejects direct loads) stays open: it needs one look at a phone's Network tab, which only the owner can do; recorded in `readthis.md`. No code for B now.
2. **History: C1's steps 0–5 ship in this PR; 6 and 7 are deferred** (6 waits on an RA schema probe the sandbox cannot run; 7 touches `backfill.ts` and wants the page cap fixed first). The two bands stay apart by construction: the cron reads only the `SEARCH_` constants and is not edited; `HISTORY_BEHIND_DAYS = 1825` is a new constant used by the write door, the search widening and health.
3. **Search widens automatically** when the recent past has fewer than 10 hits. No "search older" button — a control that advertises an internal band is clutter, and the owner's words were "only access those if a user does a search".
4. **Coverage copy:** C1's amendment over C2's shape. `older: { days, oldest } | null` with no `window`; the footer "Also searched N older nights you have browsed, back to Mon YYYY." Recent-band coverage and the thin rule are untouched.
5. **Retention and prune:** keep `[today-1825, today+365]` at the write door; no pruner; a yearly manual delete, recorded for the owner.
6. **Settled days** (more than 7 days past) may be served from the edge for a week with stale-while-revalidate, and from a cache-first `ra-history-v1` in the service worker. A past day does not change.
7. **Area allowlist** as a `Set` containing 8, so L1's future (a city switcher) is one line away, and `cacheEvents` is skipped for anything else.
8. **Timezone step 0 is in scope** — it is half of ROADMAP's P1 and C2 reproduced it — but only the server's "today" (`ra.ts`, `eventCache.ts`); the client's `night.ts` and `backfill.ts` stay as they are.
9. **R1, R2, L1 are not built now.** The owner asked for research; the digests go to the owner with the transcript and into ROADMAP as candidates, with R2's "things that look wrong" numbered 2, 3, 5 and 6 absorbed into this PR (steps 0, 1, 2, 3) and 4 deferred (step 7).

**Lanes.** Two Sonnet repairers on disjoint files, with the response contract fixed here so they cannot drift:
- `/api/search` gains `older: { days: number; oldest: string | null } | null` (null with no database); `coverage` and `truncated` unchanged.
- `/api/health` gains `history: { days: number; oldest: string | null; rows: number } | null`.
- `/api/events` out-of-range 400 text: "Query param `date` is outside the range this app keeps (five years back, one year ahead)". Days more than 7 days past get `public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000`.
- `HISTORY_BEHIND_DAYS = 1825` and `HISTORY_AHEAD_DAYS = 365` exported from `api/_lib/ra.ts`; the client duplicates 1825 in `CalendarPopover` as a literal with a comment, as the suites do for the rollover.

| Lane | Steps | Files |
|---|---|---|
| **H1 (server)** | 0, 1, 2, 3 (server half), 4 (server half), the edge header from 5 | `api/_lib/ra.ts`, `api/_lib/eventCache.ts`, `api/events.ts`, `api/search.ts`, `api/health.ts`, `tests/unit/*` |
| **H2 (client + worker)** | 3 (calendar bounds), 4 (`useSearch`, `SearchSheet` copy), 5 (prefetch/warm guards, `shouldDehydrateQuery`, `ra-history-v1`, no `stale:true` bodies) | `src/components/CalendarPopover.tsx`, `src/components/SearchSheet.tsx`, `src/hooks/useSearch.ts`, `src/hooks/useEvents.ts`, `src/pages/HomePage.tsx`, `src/main.tsx`, `public/sw.js` (data branch only), `tests/search.e2e.mjs`, `tests/offline.e2e.mjs`, `tests/layout.e2e.mjs` |

Docs, ROADMAP, readthis and the ship stay with the orchestrator.

## 10 · H1 repairer (Sonnet, server) → Orchestrator — final report

> Each step is in, and `npm run typecheck` and `npm run test` are both green: 306 units across 17 files, up from 274 across 16. Nothing is committed and I ran no e2e suites.
>
> **(1) Per step**
> - **Step 0:** done. New `newYorkDay()` and `shiftDay()` in `ra.ts` use `Intl` with `America/New_York`. `today` and every window edge in search come from one NY day per request. The SQL `current_date` uses in `searchCachedEvents` and `recentCachedEvents` are now a `$N::date` parameter, and `indexStatus` takes `today`. `coverage` never used `current_date`, so it is unchanged. The test helper `day()` is NY-aware via `Intl` directly, so it doesn't check the server helper against itself.
> - **Step 1:** done. `fetchListings` returns `{ rows, total }`, and `fetchRAEvents` uses pageSize 100 and follows `totalResults` up to 3 pages. Search's ten exact-day fetches now go through the same code. A missing `totalResults` is read as "this page is all there is".
> - **Step 2:** done. `AREAS` is a Set containing only `NYC_AREA_ID`, and any other integer area gets 400 before RA is asked or `cacheEvents` is called. Kept the existing "positive integer" message for non-integers and added "Query param `area` is not an area this app serves". Tested the handler directly in a new `tests/unit/events.test.ts`.
> - **Step 3:** done. `HISTORY_BEHIND_DAYS` (1825) and `HISTORY_AHEAD_DAYS` (365) are exported, and the bounds are a string compare against the NY day. The old `isValidDate` is replaced by `isCalendarDate` (the format check, now also rejecting 2026-02-30) and `isWithinHistory` (the range check); `isValidDate` stays as the two combined. The `ra.test.ts` range tests are updated as specified.
> - **Step 4:** done, with one deviation. New functions `searchOlderCachedEvents`, `olderCoverage` and `historyStatus` in `eventCache.ts`. The older query is limit 61, ordered by `event_date desc, ra_event_id`, run only when the recent past has fewer than 10 hits. `truncated` is also true when that query returns more than 60 rows or the merged past exceeds 60. Deviation: `olderCoverage` and `historyStatus` take `{ areaId, from, to }` instead of `(areaId, today)` — `(areaId, today)` would have made `eventCache.ts` import the constants from `ra.ts` and create an import cycle.
> - **Step 4b:** done. `history` is added to the health response; the `search` block is unchanged apart from the NY day.
> - **Step 5:** done, header rule below.
>
> **(2) Final response shapes**
> - `/api/search` 200: `{ q, upcoming, past, truncated, coverage: { indexed, window }, older }`, `older` = `{ days: number, oldest: string | null } | null` — null with no database and when its query fails. `coverage` and `truncated` describe the recent band; `truncated` also goes true if the older merge was cut.
> - `/api/health` 200: `{ ok, database, search: { indexed, window, oldest, newest }, history, soundcloud }`; `history` = `{ days, oldest, rows } | null`, covering `[today-1825, today-121]`, the band behind `search`, so the two never count the same row.
> - `/api/events` 400s: malformed date "Query param `date` must be YYYY-MM-DD"; out of range "Query param `date` is outside the range this app keeps (five years back, one year ahead)"; non-integer area "Query param `area` must be a positive integer"; area not served "Query param `area` is not an area this app serves".
> - `/api/events` headers: `date < shiftDay(NY today, -7)` gets `public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000`; exactly 7 back, today and future keep `public, max-age=60, s-maxage=300, stale-while-revalidate=86400`; the stale fallback stays `public, max-age=30, s-maxage=60`; 429 stays `no-store`.
>
> **(3) Files touched:** `api/_lib/ra.ts`, `api/_lib/eventCache.ts`, `api/events.ts`, `api/search.ts`, `api/health.ts`, `tests/unit/ra.test.ts`, `tests/unit/searchIndex.test.ts`, `tests/unit/events.test.ts` (new).
>
> **(4) Results:** `npm run typecheck` clean (one mid-work failure on `src/main.tsx(79)` was H2's in-progress work and cleared). `npm run test`: 306 passed.
>
> **(5) Outside my files:** `api/backfill.ts` still uses UTC `shift()` for its window edges, so it is off by a day for the same evening hours; it also now makes up to 3 requests per busy day because `fetchRAEvents` paginates. `src/types` and the client need to read `older` from the search response and `history` from health.

*(Orchestrator: 174,458 tokens, 38 tool uses, 8m 33s.)*

## 11 · H2 repairer (Sonnet, client and worker) → Orchestrator — final report

> Steps A–D are all done, and `npm run typecheck`, the search, layout and offline suites all pass. I cleaned up the Vite servers I started. Nothing is committed.
>
> **(1) Per step**
> - **A, done.** `CalendarPopover.tsx` sets `startMonth`/`endMonth` (react-day-picker 10.0.1) to 1825 days back and 365 ahead of `currentNight()`. 1825 is a named literal with the mirror comment pointing at `HISTORY_BEHIND_DAYS`. Deviation: also added `disabled={{ before, after }}` and a `disabled` class — the month bounds alone leave days in the first and last month tappable, and those days would hit the server's 400. The layout e2e check clicks the arrows to each end and asserts the month shown (Oct 2021 and Oct 2027 today); at a bound the library sets `aria-disabled` and drops the arrow's label, so the check looks for that.
> - **B, done.** `older` is typed in `useSearch.ts`. The thin rule still reads `coverage` only, with a comment saying why. Deviation: the footer used to render only when `truncated`; it now renders when `truncated || older.days > 0`, so the older sentence is visible on a non-truncated answer. The "last four months" sentence still needs `truncated`. Where `older.days` is 0, `older` is null or the field is absent, nothing is added. `Mar 2023` is built in UTC the way `formatEventDay` does it (`en-US`, `month: "short"`).
> - **C, done.** `useEvents.ts` has `LIVE_BEHIND_DAYS = 120` and `LIVE_AHEAD_DAYS = 45` with the mirror comment, plus an exported `isLiveDay(date)`. The neighbour prefetch is skipped for a history day, and any neighbour outside the live window is skipped too. History days get a `gcTime` of 10 minutes. `HomePage.tsx` passes an empty flyer list for a history day. `main.tsx` has `shouldDehydrateQuery`, so history `["events", date]` queries are not written to localStorage. The offline suite browses 200 days back through the calendar, then asserts `ra-nyc:query-cache` contains tonight but not that date, and that its neighbours were never requested.
> - **D, done.** The data branch reads the body and skips storing and announcing when `stale` is true; a non-JSON 200 body is not stored either. Dates more than 30 days back go to `ra-history-v1`: cache-first, no revalidation, capped at 400 with `trim`, added to the `keep` set. Pulled the offline empty-day answer into a helper, `emptyDay`, used by both branches. Deviation: when the network fails for a history day with no `ra-history` copy, it tries the old `ra-data` entry before the empty answer, so nights browsed before this change are not lost. `ra-data-v1`, `MAX_DATA_ENTRIES`, the live revalidation path, `handleImage` and `hold` are untouched. To confirm the new checks bite, disabled the `stale` guard and the persist filter: exactly the two matching checks failed.
>
> **(2) Strings added to the sheet:** `Also searched {N} older nights you have browsed, back to {Mon YYYY}.` / `Also searched 1 older night you have browsed, back to {Mon YYYY}.` If `oldest` is null or unparseable, the `, back to …` part is dropped. With both facts true it follows the existing sentence after a single space: `Searching the next six weeks and the last four months. Also searched 12 older nights you have browsed, back to Mar 2023.`
>
> **(3) Files touched:** `src/components/CalendarPopover.tsx`, `src/components/SearchSheet.tsx`, `src/hooks/useSearch.ts`, `src/hooks/useEvents.ts`, `src/pages/HomePage.tsx`, `src/main.tsx`, `public/sw.js`, `tests/search.e2e.mjs`, `tests/offline.e2e.mjs`, `tests/layout.e2e.mjs`.
>
> **(4) Suite results:** typecheck clean. `test:search` 49/49 (44 + 5: the 12-night footer, `older: null`, singular "1 older night", `days: 0`, and the "last four months" sentence surviving next to the new one). `test:layout` 49/49 (47 + 2: back bound and forward bound). `test:offline` 23/23 (14 + 9: three for the `stale` body, three for `ra-history`, three for the persisted cache and neighbours). Ports 5913 and 5914 were in use, so offline ran on 5915.
>
> **(5) Needed from H1:** none; the client works whether or not `older` is present. The 1825/365 bounds and `LIVE_BEHIND_DAYS`/`LIVE_AHEAD_DAYS` are mirrored by hand and must stay in step with `api/_lib/ra.ts`.

*(Orchestrator: 167,283 tokens, 39 tool uses, 8m 44s.)*

## 12 · Orchestrator — verification and ship

Both lanes verified independently. H1: `api/backfill.ts` untouched (confirmed by `git diff --name-only`), the events-endpoint diff read line by line — the area allowlist refuses before RA is asked and before `cacheEvents`, the 429 path is unchanged, the settled-day header applies only to dates more than seven days before the New York day. H2: the worker diff read line by line; one refinement by the orchestrator — `handleHistory` awaited the cache write and the key walk before returning, so a cold history day paid for storage before the page had its body and the `waitUntil` hold did nothing; the save now runs behind the response, clone taken first, `close` on every exit. Offline re-run on the final worker: 23/23.

Full suite: typecheck clean; units 306; player 41; search 49; layout 49; preview 12; donate 9; settings 31; offline 23; playlist 55. The combined `test:all` run exited 1 only because the offline suite's static server found port 5871 still held by the suite before it (`EADDRINUSE`, the documented case); offline and playlist were re-run alone and passed.

Cadence: `main` is at 57 landings; this merge is 58, not a multiple of seven. The diff changes no rate-limit header, no bearer check, nothing under donate or the image allowlist. No review.

Commits on the branch over `c80f79f`: `dc541e5` (worker flyer fix), the docs checkpoint, the server lane, the client lane with docs. One PR, normal merge.

## 13 · Orchestrator — production

PR #87 merged as `2cf94dc`; deployment `dpl_2p7B6ip96u1zvTXe8CQuiUZRYkBM` READY on `ra-nyc.vercel.app`. Checks via `web_fetch_vercel_url`:

- `/api/health` → 200. `search` unchanged (165 of 166, 2026-06-30 → 2026-12-12). New `history: { days: 105, oldest: "2026-03-17", rows: 3333 }` — the older band already held 105 days from before the window moved, which C1 predicted ("rows that slide past 120 days are kept, because nothing deletes") and which the clamped health could not show until now.
- `/api/search?q=sergio` → 200, four past hits newest first including the Crashbeat night that started the search work, `coverage { 164, 166 }`, and `older: { days: 106, oldest: "2026-03-17" }`.
- `/api/events?date=2024-10-26` → 200, 111 events, not stale, `cache-control: public, max-age=3600` (the settled-day header; the edge-side `s-maxage` is stripped from the client view). **RA serves NYC listings two years back**, so the owner's open question in readthis §0 is answered for that depth; five years remains a one-tap check. That request also wrote the day into the index through the new write door — the first history day filled by browsing.

Round 2 closed: six investigators ≈ 990k subagent tokens, two repairers ≈ 340k, one Sonnet review not due (landing 58).
