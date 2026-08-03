# memorystate.md

Running project journal: current state, decisions and *why*, and what's still
open. Written so that a person — or an AI agent — picking this repo up cold can
get productive without re-deriving anything.

**Keep this file updated.** When you make a decision that a future reader would
otherwise have to reverse-engineer from a diff, append it to the log.

**Last updated:** 2026-08-03
**Branch:** `claude/lovable-vercel-migration-hyp0a1` (name set by the session
harness; see §5)

---

## 1 · What this project is

A one-screen, mobile-first web app listing Resident Advisor's New York City
events by day. Pick a date from an 8-day strip, scroll the cards, tap through to
`ra.co` for tickets. No accounts, no login, no ads, no data of its own.

**Design intent: the workflow stays as it is.** Open it, see tonight, tap out.
Every feature below has to survive the question "does this still work in ten
seconds on a phone on the subway?"

---

## 2 · Current state

| | |
| --- | --- |
| **Hosting** | Vercel (migrated from a hosted app builder) |
| **Build** | ✅ `npm run build` passes |
| **Types** | ✅ `npm run typecheck` passes (app + api) |
| **Dev server** | ✅ `npm run dev` on :8080, serves UI + `/api` |
| **Database** | Optional Neon, caches artist links only. See [DATABASE.md](./DATABASE.md) |
| **Env vars** | None required; `DATABASE_URL` and `DISCOGS_TOKEN` optional |
| **Tests** | ✅ 81 Vitest units + 71 Playwright assertions (`npm run test:all`) |
| **Analytics** | ✅ Vercel Analytics, no cookies |
| **Auth** | None, none planned |

### Stack

React 19 · TypeScript 5.9 · Vite 7 · Tailwind 3.4 · TanStack Query 5 ·
React Router 7 · date-fns 4 · lucide-react · vaul · react-day-picker ·
Vercel Analytics · five Vercel Node 22 functions. Dev-only: Vitest,
playwright-core.

### Routes

| Route | Kind | Purpose |
| --- | --- | --- |
| `/` | SPA | The only page. Date strip + event list |
| `/api/events?date=YYYY-MM-DD[&area=8]` | Function | Cached proxy to RA GraphQL |
| `/api/image?u=<https url>` | Function | Flyer proxy fallback, host-allowlisted |
| `/api/artist?id=<ra id>&name=<name>` | Function | Resolves a DJ to sets + profile links |
| `/api/search?q=<term>` | Function | Windowed listing search — upcoming, then past |
| `/api/venue?name=<venue>` | Function | Geocodes a venue for the map sheet |

The app is a single route. The event, artist and search views are all sheets, not
pages — tapping a DJ opens the artist *over* the event, and dismissing returns to
it. Sets play in a transport bar docked to the bottom, which outlives every sheet.

### Test commands

| Command | What it runs |
| --- | --- |
| `npm test` | 81 Vitest units over the pure functions in `api/_lib` and `src/lib` |
| `npm run test:e2e` | 32 Playwright assertions for the transport bar |
| `npm run test:search` | 21 Playwright assertions for search and venue maps |
| `npm run test:layout` | 18 Playwright assertions for responsive layout and preferences |
| `npm run test:all` | all four |

---

## 3 · Decision log

### 2026-07-29 — Migrated to Vercel

The migration doc it was written up in has since been retired; the operational
parts live in [INSTALL.md](./INSTALL.md). The decisions worth remembering:

**The repo did not build.** `package.json` had `tailwindcss@^4` while every
config and stylesheet was written for v3. `npm run build` failed outright on a
clean checkout. The builder's preview sandbox hid it.
→ **Pinned Tailwind to `^3.4`** rather than upgrading forward. A hosting
migration and a framework upgrade in one commit means a failure has two possible
causes. v4 is logged in [ROADMAP.md](./ROADMAP.md) as its own task.

**Moved the RA fetch out of the browser** into `api/events.ts`. Three
independent reasons, any one sufficient:
1. `ra.co/graphql` sends no CORS headers → a direct browser call is blocked.
2. The old code set `User-Agent` and `Referer` on a browser `fetch()`. Both are
   forbidden headers; browsers drop them silently. The request RA actually
   received was **not** the request the code appeared to send — and RA 403s
   traffic that doesn't look like a browser.
3. Caching. Seven days browsed × every visitor was that many requests to RA.
   Now one edge-cached response serves everyone for 5 minutes.

**Deleted Supabase.** Zero tables in the generated types, zero imports in the
app. Pure generator scaffolding. Also dropped `class-variance-authority` (unused).
→ This is also the direct answer to "do I even need a database?": **you already
had one, and the app never touched it.**

**Wrote a Vite dev plugin** (`vite.config.ts`) that mounts `api/*.ts` as routes,
running the exact handler Vercel runs — Node's `(req, res)` is both what Vercel
invokes and what connect middleware provides, so no adapter is needed.
→ Chosen over requiring `vercel dev` so that `npm run dev` alone gives a
faithful local environment. `vercel dev` still works if preferred.

**Changed `server.host` from `"::"` to `true`.** The IPv6-literal bind
crashes with `EAFNOSUPPORT` on hosts without IPv6 — including the container this
migration was done in.

**Added a `.gitignore`.** The repo had none, so `node_modules/` was one
`git add .` away from being committed.

**Kept the day-at-a-time UX exactly as it was.** No visual changes in the
migration commit. Deliberate: any post-deploy bug is then unambiguously a
plumbing bug.

### 2026-07-29 — First Vercel import failed on `vercel.json`

`Function Runtimes must have a valid version, for example 'now-php@1.0.0'`.

`vercel.json` had `functions["api/*.ts"].runtime = "nodejs22.x"`. That field is
**only for community/custom runtimes** and expects an npm spec
(`vercel-php@0.5.2`), so Vercel tried to parse `nodejs22.x` as `package@version`
and found no version. `nodejs22.x` is valid syntax — but for Next.js
route-segment config, not `vercel.json`.

→ Removed `runtime`; the built-in Node runtime is the default for `api/*.ts` and
needs no declaration. Node major version moved to `engines.node` in
`package.json`, which also overrides the dashboard setting — so it lives in git
instead of in project state. Full writeup in
[INSTALL.md](./INSTALL.md#troubleshooting).

### 2026-07-29 — First deploy crashed: wrong function signature

`500 FUNCTION_INVOCATION_FAILED` on every `/api/events` request. The UI showed
an endless spinner.

`api/events.ts` used `export default async function handler(request: Request)`.
Vercel invokes a **default** export in `api/` with Node's `(req, res)`; the web
`Request`/`Response` form is only for **named** method exports
(`export function GET(request: Request)`). Vercel therefore passed an
`IncomingMessage`, `request.url` was the relative path `/api/events?date=…`,
and `new URL()` on a relative string threw `TypeError: Invalid URL` — outside
the try/catch, so the invocation crashed.

→ Handlers now take `IncomingMessage`/`ServerResponse`, parse the URL with an
explicit base, and wrap the whole body in try/catch. Bonus: those are the same
types connect passes, so the Vite dev plugin stopped adapting and now runs the
production handler verbatim — this class of bug can't recur silently, because
local dev exercises the real signature.

Two secondary bugs fixed in the same round, both of which made this harder to
diagnose than it should have been:
- TanStack Query's default 3 retries × the function's 10s upstream timeout meant
  a failing request spun for ~45s with no feedback. Now `retry: 1`.
- The UI swallowed the API's error message behind "try again later". It now
  shows the real message plus a retry button, so a failure is self-diagnosing.

### 2026-07-30 — Rate limiting restored

The Supabase edge function had per-IP rate limiting (30/min) and the Vercel port
never carried it over. Added back in `api/_lib/rateLimit.ts`, used by both
functions: 30/min for `/api/events`, 200/min for `/api/image` (a screen of
listings can request ~50 flyers, all of which hit the proxy if the CDN is
blocking direct loads).

Known and accepted limitation: the counters are in module memory, so they are
per *instance*. Vercel scales horizontally and recycles instances, so this is
best-effort — a caller spread across instances gets more than the limit, and a
cold start resets the window. Made that trade knowingly rather than adding
Upstash/Vercel KV, which means credentials and another service to operate. If
abuse ever materialises, Vercel's Firewall rate limiting is the right next step
(edge-level, global, no code) — not a distributed limiter in here.

It's still worth having because of *where* it sits: the edge cache absorbs
normal traffic, so only cache misses reach the function, which is exactly the
traffic that would otherwise reach ra.co.

Two details that matter more than the limit itself:
- The 429 is `Cache-Control: no-store`. A cached 429 at the edge would be served
  to every visitor — one abusive caller becoming an outage for all.
- `X-RateLimit-*` go only on the 429, never on the cacheable 200, or the edge
  would cache one caller's remaining count and serve it to everyone.
- The check runs *before* input validation, so spraying malformed dates isn't a
  free bypass.

Verified: 30 requests pass, the 31st onward returns 429 with `Retry-After: 59`
and the budget headers; the image proxy keeps a separate bucket.

### 2026-07-30 — The original was recovered, and merged in

The user supplied `LOVES.zip`: a full export of the original project,
including the Supabase edge function and the shadcn tree. This is the code that
`27c90a2`'s commit message described and that neither git remote still had.

**It settled the image bug outright.** The original queried RA's dedicated
`flyerFront` field and only fell back to `images[0].filename`. Our query never
asked for `flyerFront` — that alone explains most missing flyers. Its
normaliser also handles a case ours got wrong: a value already containing
`images.ra.co/` but with no scheme, which our resolver turned into
`https://images.ra.co/images.ra.co/…`. Both ported into `api/_lib/ra.ts`.

**Ported from the original** (the look and feel, verbatim where sensible):
- The four real themes — **Neon** (electric cyan), **Vapor** (magenta),
  **Matrix** (terminal green), **Sunset** (orange) — with `--glow-color` /
  `--glow-intensity` and the `glow-primary*` / `text-glow` utilities. The earlier
  reconstruction's palettes were guesses and are gone.
- A **typography** axis nobody had mentioned: System / Mono (JetBrains Mono) /
  Display (Outfit + Bebas Neue headings).
- Densities renamed to the originals: **tight / default / airy**.
- `stagger-animation` (50 ms cascade, re-keyed per date so a new day animates
  in), `skeleton-glow` shimmer, the global 0.3s colour transition, the 4px
  primary-tinted scrollbar, the splash screen, the sticky `backdrop-blur`
  header, and the event-count line.
- **The card layout**, which was the biggest miss: a compact horizontal row —
  96px thumbnail, then title / venue / time / lineup / "N going" — not the
  full-width flyer cards we had. Dense and scannable is the whole point.
- `attending` surfaced, and **events sorted by it descending**. With a 50-event
  cap and no pagination, popularity beats RA's own ordering.
- Prefetch of +1/+2/−1 days, plus prefetch on `touchstart`/hover of a date chip,
  so the fetch is usually in flight before the tap lands.
- The random colour theme on every load. Kept deliberately — it's most of the
  charm. One line in `ThemeContext` to make it sticky.
- iOS metas: `user-scalable=no`, `theme-color`, apple web-app metas, RA favicon,
  and an inline background so opening never flashes white.

**Deliberately not ported:** the Supabase client and edge function (that job is
`api/events.ts` now), and the ~50-file shadcn `ui/` tree with its 28 Radix
packages. Kept only what the feel actually depends on: `lucide-react` for icons,
`vaul` for the drag-to-dismiss drawer, and `@radix-ui/react-popover` +
`react-day-picker` for the jump-to-date calendar. The Favorites tab was dropped
rather than shipped dead — favourites need persistence, which is the first thing
that would genuinely need a database.

**A bug found while porting, present in the original too:** Tailwind tree-shakes
custom CSS inside `@layer base` when its selectors aren't in the content globs.
These class names are built at runtime (`theme-${x}`), so `.theme-vapor`,
`.theme-matrix` and `.theme-sunset` were purged from the bundle — only
`:root,.theme-neon` survived, because `:root` anchored it. Every theme silently
resolved to Neon. Fixed by lifting the theme/typography/density blocks out of
`@layer base`; plain CSS is never purged. Typography classes also renamed
`font-*` → `type-*`, because `.font-mono` collides with Tailwind's own utility,
which wins over a base-layer rule and would have replaced JetBrains Mono with
Tailwind's mono stack.

Verified in mobile-emulated Chromium (390×844, touch): all four themes produce
distinct computed `--glow-color`/`--background`/`--primary`; all three
typography settings change the resolved body font; density, nav style and
persistence across reload; settings drawer, details drawer, calendar popover,
bottom nav, minimal-mode swipe hint; no uncaught page errors. Screenshotted each
theme against stubbed listings.

### 2026-07-30 — Artist becomes a stacked sheet, not a page

**The artist view is no longer a route.** Tapping a DJ opened `/artist/:id`,
which unmounted the listings and read as leaving the app. It's now an
`ArtistSheet` stacked *over* the still-open event sheet, so dismissing returns
straight to the event with its scroll position intact. `ArtistPage.tsx` and the
route are gone; `App.tsx` has one route again.

Stacking needed `drawer.tsx` to take a `layer` prop — both a portal's overlay
*and* its content have to sit above the sheet beneath, so a single z-index on
the content isn't enough.

Everything renders in-app: the RA bio is fetched server-side and rendered in the
app's own styling rather than linked out, and sets swap in place without
leaving. The only outbound links left are the explicit "Elsewhere" rows, which
were requested.

**The event sheet closes on any tap that isn't a control** — same treatment the
preferences sheet got. It's mostly text, so most of it wasn't interactive and
tapping the flyer or the venue line did nothing.

**Slide timing, 5% slower.** vaul ships
`transition: transform .5s cubic-bezier(.32,.72,0,1)` plus a matching
`animation-duration: .5s` on `[data-vaul-drawer]`. Both are now 0.525s. Two
details make that safe:
- **Specificity, not `!important`.** `[data-vaul-drawer][data-vaul-drawer-direction]`
  beats vaul's single-attribute rule regardless of stylesheet order, while still
  losing to the inline styles vaul writes *during a drag* — so the sheet keeps
  tracking the finger exactly instead of easing behind it. `!important` would
  have broken dragging.
- **The overlay is retimed to match.** Otherwise the backdrop finishes before the
  sheet and the two read as separate movements.

The easing is left as vaul's, which is iOS's own sheet curve — it decelerates
late, and giving that tail 5% more room is most of what "smoother" means here.
In-app transitions moved in step: `.transition-smooth` 0.18s → 0.19s, the glow
group 0.2s → 0.21s, and the stagger 0.3s → 0.315s, all on the same curve.

**A testing note worth keeping.** The first e2e run failed on a "pointer events
intercepted" error that looked like a z-index bug. It wasn't: `EventCard` is
itself a `<button>` whose text contains the lineup, so Playwright's
`button:has-text("Move D")` matched the *card behind the drawer* before the chip
inside it. `document.elementFromPoint` at the chip's centre returned the chip,
which is what proved the app was fine. In-sheet selectors are now scoped with
`[role="dialog"]`.

Verified 15/15 in mobile Chromium: sheet stacks without a URL change, sets
selectable in place, bio in-app, Back returns to the still-open event sheet,
tapping event text dismisses it, and the computed transition duration is
0.525s at runtime.

### 2026-07-30 — Subdued artist page, 3 sets, 5 links, and a real speed pass

**Subdued.** The listings screen is the loud one — glows, stagger, neon accents —
and that's right for it. The artist page is a *read*, so it now stays quiet: flat
card surfaces, plain borders, muted labels, and the accent colour reserved for the
one genuinely interactive control (play). The player lost its glow ring and sits
on `bg-card`.

**Sets capped at 3** (`MAX_SETS`), down from 4. Page order is now sets → bio →
links, which matches how you actually read it.

**5 links under the bio** (`MAX_LINKS`), in a new `links` array built server-side
by `buildLinkList`. Providers: Discogs, SoundCloud, Mixcloud, **Bandcamp**. RA is
excluded because it *is* the bio — its link is the bio's attribution. Resolved
profiles sort ahead of search URLs, so a real Discogs page outranks a name
search. Bandcamp has no keyless artist search API, so it is honestly labelled
"Search releases" rather than dressed up as a profile.

> **Beatport was here and was removed** (Aug 2026, at the user's request). Worth
> recording *why* it never earned its slot: it's a store, not somewhere a DJ
> posts, and with no keyless search every entry was a search URL. It padded a
> list whose whole point was being a short read.

**Speed and caching — the substantive part.**

1. **Query cache persisted to localStorage** (`PersistQueryClientProvider` +
   `createSyncStoragePersister`). This is the biggest perceived-speed win
   available: a returning visitor sees their last day, and any artist they
   opened, painted from disk on the first frame instead of after a round trip.
   Verified — a card renders at 400 ms after reload with the network still in
   flight. `throttleTime: 2000` keeps cache serialisation (synchronous) off the
   main thread mid-scroll, and `buster: "v2-artists"` must be bumped whenever an
   API response shape changes or restored data will be the wrong shape.
2. **Artist prefetch on chip touch/hover**, mirroring the date strip.
   `touchstart` fires well before `click`, so the request is usually already in
   flight when the route mounts. Verified firing on hover before navigation.
3. **Wider edge windows.** Events: `s-maxage=300` fresh but SWR raised
   3600 → 86400, so a cold region or an RA outage degrades to slightly-old
   listings rather than an error. Artist: `s-maxage` 1 day → 1 week, SWR 1 week →
   30 days, since a DJ's Mixcloud/SoundCloud identity effectively never changes.
4. **Preconnect `images.ra.co`** (hit on essentially every screen) plus
   dns-prefetch for the three player hosts.

**The animation-jank fix is the interesting one.** The ported CSS had
`*, *::before, *::after { transition: … box-shadow 0.3s }` — a **box-shadow
transition on every element in the document**. box-shadow can't be composited, so
every frame of a drawer drag was forcing a full repaint of everything on screen.
Removed box-shadow from the global rule and let the elements that actually want an
animated glow opt in. Also swapped `.transition-smooth`'s easing to iOS's sheet
curve `cubic-bezier(0.32, 0.72, 0, 1)`, which decelerates late so a drag release
settles instead of stopping, and added `will-change-transform` to the drawer so it
gets its own compositor layer.

Migration `0003_artist_link_list.sql` adds the `links` jsonb column and forces one
re-resolve of non-manual rows (they predate both the link list and the 3-set cap).

Verified at the time: 14/14 in mobile Chromium — 3 sets, exactly 5 links,
resolved-first ordering, bio attributed and clamped, subdued player styling,
prefetch-on-hover, and cache restore before the network settles. Plus 5/5 cap and
ordering assertions against the compiled module. (The 3-set cap and the Beatport
link have both since been superseded — see below.)

### 2026-07-30 — Multi-source sets: SoundCloud first, 4 per DJ, plus bios

Requested: sets from SoundCloud then Mixcloud then others, 4 total per DJ, plus a
bio, plus Discogs if available.

**The SoundCloud constraint, stated plainly.** SoundCloud has the most DJ sets
and is now first in preference order — but their API registration has been closed
to new apps for years. The common workaround is to scrape a `client_id` out of
their web bundle; **deliberately not done here.** It circumvents an access
control they put up on purpose and breaks every time they rebuild. So SoundCloud
search is opt-in via credentials you already hold. Without them, SoundCloud
degrades to a search link. Embedding an *already-resolved* SoundCloud URL needs
no key, so playback is identical either way — only discovery is gated.

**The two credential shapes — the thing that will bite you.** SoundCloud issues
two kinds of credential and they are not interchangeable:

- **Developer portal** → a client id **and** a secret. These only work against
  `api.soundcloud.com`, and only after exchanging them for a bearer token via
  `client_credentials`. A bare client id is rejected there (has been since 2021).
- **Web-player style** → a lone client id, used against `api-v2.soundcloud.com`.

`soundcloudMode()` branches on which variables are set: both → `official`, id
alone → `api-v2`, neither → `off`. **Setting only `SOUNDCLOUD_CLIENT_ID` when you
actually hold a portal id/secret pair is the likely mistake, and it fails
silently** — every request 401s, SoundCloud contributes no sets, and that reads
exactly like the DJ having nothing there. This cost real debugging time once
already: a key was added, sets stayed empty, and nothing anywhere said why.

So `/api/artist` now reports the live mode in a `soundcloud` field — the mode
name only, never a value. **If SoundCloud sets are missing, check that field
first.** `off` means the env var never reached the running deployment; `api-v2`
with a portal pair means the secret is missing. Note also that Vercel does *not*
redeploy when you add an environment variable — the running deployment keeps the
old (empty) env until something triggers a new build. That is what actually kept
sets empty the first time: the key was set, but the deployment predated it.

**Production currently runs in `api-v2` mode** — a lone client id — and it works:
Nina Kraviz returns three real SoundCloud sets with plays and durations, and
SoundCloud supplies her bio. The `official` path is built and correct but is not
the one in use, so it is the less-exercised of the two.

**A matched profile with no uploads is not the same as no sets.** Marcel Dettmann
resolved to `soundcloud.com/marceldettmann` and still returned zero SoundCloud
sets, because plenty of DJs post through labels, radio shows or playlists rather
than uploading to their own account, and `/users/{id}/tracks` only sees their own
uploads. When the matched user's uploads come back empty we now fall back to the
scoped track search — with strict filtering, since those are search hits.

**Providers now, in preference order:**

| Provider | Search | Embed | Key |
| --- | --- | --- | --- |
| SoundCloud | official API or `api-v2` | widget | required (see below) |
| Mixcloud | public API | widget | none |
| Internet Archive | `advancedsearch` | `/embed/` | none |
| YouTube | Data API v3 | `/embed/` | optional (`YOUTUBE_API_KEY`) |

**Internet Archive was added so "and others" is real, not aspirational** — it's
fully keyless and holds a lot of radio-show and festival archival. That means
even with zero keys configured the feature works: Mixcloud + Archive fill the
list.

`orderSets` sorts by provider rank then by play count within a provider (a decent
proxy for "the good one"), then caps at `MAX_SETS = 4`. Verified: a YouTube set
with 9,999 plays is correctly dropped in favour of lower-played SoundCloud ones,
because provider rank dominates.

Every provider yields a plain iframe URL, so `SetPlayer` needs no SDK — just a
per-provider height, since a SoundCloud widget and a YouTube player disagree
about how tall they should be.

**Bio**, first available of: RA `biography` → Mixcloud `biog` → SoundCloud
description → Discogs profile, attributed in the UI to whichever it came from.
RA's field is an educated guess at their schema, so the query asks for it and
retries without it on error — one unknown field fails an entire GraphQL query.
Discogs prose is stripped of its `[a=Artist]` / `[l=Label]` markup.

**A real bug found by testing the matcher.** `normalizeName` relied on NFD to
strip accents, which works for `é` (letter + combining acute) but silently fails
for `ø`, `æ`, `ß`, `ł` — those are *distinct letters*, not letter-plus-accent, so
NFD leaves them alone and "Bjørn" never matched "bjorn". Added an explicit
transliteration table ahead of the NFD pass. The original combining-mark regex
was also written with literal marks rather than `\u0300-\u036f`, which is
fragile; now escaped. 9/9 normalisation cases pass, including `Straße` →
`strasse` and `Æther` → `aether`.

Migration `0002_artist_bio_and_soundcloud.sql` adds `soundcloud_user` and `bio`,
and clears 0001-era Mixcloud-only `sets` rows (which lack a `provider` field) so
they re-resolve once — disposable by definition, and `link_source <> 'manual'` is
respected.

Verified: 15/15 in mobile Chromium — SoundCloud plays first, provider badges and
per-provider labels correct, switching to the Archive set swaps the embed host,
bio renders with attribution and clamps, profile rows show handles rather than
search text when resolved. Plus the live endpoint's no-keys path, which returns
`linkSource: "none"` with search fallbacks.

### 2026-07-30 — DJ set player, artist page, and the first database

Three things landed together, plus the answer to a question that had been open
since the migration started.

**The drawer now handles events that don't fit.** Long titles, long RA Pick
blurbs and big lineups overflowed the 90vh sheet with no way to know. Fixed
properly rather than cosmetically:
- The *scroller* owns overflow, not the drawer. `min-h-0 flex-1 overflow-y-auto`
  — without `min-h-0` a flex child refuses to shrink and pushes the drawer past
  its max height, which is why inner scrolling looked broken before.
- A **More** pill appears only when content actually continues past the fold,
  measured with a `ResizeObserver` plus scroll listener. It pages down ~80% of a
  viewport rather than jumping to the end.
- A second control **expands the sheet to full height**, trading the flyer down
  to a 24px strip — you expand to read the rest, not to see a bigger picture.
- Blurbs clamp to 3 lines with **Show more** past 180 chars; lineups clamp to 8
  chips with **+N more**.
- All toggles reset per event, or the next event opens mid-scroll with the last
  one's state.

**Lineup names are now links.** `artists` changed from `string[]` to
`{id, name}[]` — using `id` and `name` fields the GraphQL query *already*
requested, so no new upstream risk. RA reuses artist names, so the id is what
the lookup keys on.

**`/api/artist` resolves a DJ to playable sets.** Sources and why:
- **Mixcloud** — public API, no key, long DJ sets are its native content, and
  it's embeddable. The only source we can both search *and* play, so it is the
  player.
- **SoundCloud** — better content, but API registration has been closed to new
  apps for years. Cannot search; we emit a pre-filled search link and say so in
  the UI rather than pretending.
- **Discogs** — exact artist page when `DISCOGS_TOKEN` is set (their search
  endpoint requires auth), otherwise a search link.
- **RA** — tries a `artist(id:)` GraphQL query for a real profile URL, falls
  back to RA search. Deliberately wrapped in its own try/catch: a schema change
  there can cost us one link and must never touch the listings query.

Matching is **strict on purpose** (`isPlausibleMatch`): normalised exact match,
or a clean prefix on names ≥5 chars. Names are normalised for accents and RA's
disambiguating suffixes (`"Cosmo (NY)"` → `cosmo`). A confidently wrong
player — someone else's sets under a DJ's name — is worse than no player, so
"not sure" shows an honest empty state pointing at search links.

**`/artist/:id` page** in the existing look: Mixcloud iframe (mounted only after
an explicit tap — mobile Safari blocks autoplay anyway, so a pre-mounted
third-party iframe buys nothing), a switchable list of sets with durations and
play counts, and the profile links.

**The database, finally.** The user proposed Neon for caching links, and that is
exactly the trigger this file and DATABASE.md predicted: a resolved — and
especially a *hand-corrected* — DJ link cannot be re-derived from RA, so it
cannot live in a cache.

Designed as an **optional layer**, which is the important part:
- No `DATABASE_URL` → resolve live, cache at the edge, app works identically.
- `DATABASE_URL` set → `artist_links` serves lookups instantly and third-party
  APIs get hit once per artist ever.
- A missing table or unreachable database logs and falls through to live
  resolution. The database can be added, removed, or fail without downtime.
- `link_source` is `auto | manual | none`, and the upsert carries
  `where artist_links.link_source <> 'manual'` — an automated re-resolve can
  never clobber a human correction. That clause is the whole reason this is a
  database and not a cache.
- `none` is recorded too, so a fruitless resolve isn't retried forever.

Schema in `migrations/0001_artist_links.sql`. **Not yet applied** — needs a Neon
project and the env var; see DATABASE.md.

**Bundle work, forced by the new page.** The build crossed 500 KB, so the artist
page and the calendar are now lazy routes. The calendar's split initially did
nothing because `HomePage` still imported it statically — Vite says so plainly
in the build output, worth reading. Main chunk went **158 KB → 131 KB gzipped**.

Verified in mobile-emulated Chromium with both APIs stubbed: 23/23 — chips
clamp and expand, More appears only on overflow and scrolls, navigation carries
the name, sets list and switch, the Mixcloud iframe mounts with a URL-encoded
feed, profile links resolve, back returns to the listings, no page errors. The
endpoint's own validation was checked live (400s, 405, and the graceful
`linkSource: "none"` path, since Mixcloud is blocked from the build sandbox).

**`ra-nyc-xi.vercel.app` is not ours.** The project has exactly three domains —
`ra-nyc.vercel.app`, `ra-nyc-carlosfranzettis-projects.vercel.app`,
`ra-nyc-git-main-…` — and `-xi` is not among them, nor is there a second Vercel
project. It looks like Vercel's auto-suffix from an earlier import that has
since been released. **Canonical URL is `ra-nyc.vercel.app`.** Re-attaching
`-xi` is a dashboard action (Settings → Domains) and the name may now be taken
globally; no code change can fix it.

### 2026-07-29 — Images, take two: proxy fallback + analytics

Images still weren't loading after the URL-shape fix, and the `onError` handler
added with it meant failures now hide the element — so a blocked flyer presents
as "no images" rather than a broken icon.

Couldn't observe the cause: Vercel's `web_fetch_vercel_url` can't fetch this
deployment, and `get_runtime_logs` showed no invocations at all — expected,
since edge-cache hits never reach the function. So rather than guess a third
time, `EventImage` now covers every remaining cause:

1. Direct from the CDN with `referrerPolicy="no-referrer"`. Many CDNs reject a
   foreign `Referer` but allow none — this alone may be the whole fix.
2. On failure, retry through the new `/api/image` function, which *can* send the
   `Referer` RA wants. Cached `immutable` for a month at the edge; RA flyer URLs
   are content-addressed so the bytes never change.
3. Only then remove the element.

The direct path stays the default, so no bandwidth flows through the function in
the normal case. `/api/image` is host-allowlisted (`images.ra.co`, `ra.co`,
`www.ra.co`), https-only, `image/*`-only, 8 MB capped — without those it's an
open proxy and a content relay. All six guards verified locally.

**Still unconfirmed:** whether hotlink protection was actually the cause. If
images remain missing, the next suspect is the `images` array arriving empty
from RA, which needs one look at `/api/events?date=…` in a browser.

Also installed **Vercel Analytics** (`<Analytics />` in `App.tsx`, inside
`BrowserRouter` so future routes count as page views). No cookies, so no consent
banner. Worth having now: ROADMAP §2's database phase hinges on whether anyone
actually taps DJ names.

### 2026-07-29 — Recovering the original app

The user reported missing "themes and preferences". They were right, and the
earlier conclusion here — that no such feature ever existed — was wrong. It was
drawn from this repo's git history, which turned out not to be the whole story.

The builder's project edit log (`list_edits`) still records commit `27c90a2`
(2026-01-29), whose message describes the real original:

> shadcn/ui components with Tailwind CSS · **Dynamic theming system (4 colour
> themes, 3 layout densities)** · TanStack Query with aggressive prefetching ·
> **Supabase Edge Function as GraphQL API proxy with rate limiting** · **Three
> navigation modes: standard, tabs, minimal (swipe-only)** · event cards,
> details sheets, and skeletons

**That code is gone.** Verified three ways:
- The builder's `read_file`/`get_diff` at those SHAs → `404 commit_not_found`; the
  objects were dropped when `531b20e "Recreated project scaffold"` ran.
- `git fetch origin 27c90a2` → `upload-pack: not our ref`.
- `refs/pull/*` on GitHub holds only PRs 1–3, all from this migration. The old
  log shows *different* PRs also numbered 1 and 2, so the GitHub repo was
  deleted and recreated — which is what wiped both lineages.
- The builder's published build returns 403, so the bundle can't
  be scraped either.

→ Rebuilt the feature set from that manifest rather than resurrecting the code.
It is a reconstruction, not the literal original: theme names and exact palettes
are new, since nothing recorded them.

Two things this reframed:
- **Supabase did do something beyond a database** — it hosted the RA proxy.
  Corrected in DATABASE.md.
- **The migration's architecture was right all along.** The original proxied RA
  server-side too; the version that reached GitHub had regressed to a direct
  browser fetch, which is why it could never have worked in production. The
  Vercel function is the original design, rehosted.

### 2026-07-29 — Rebuilt themes, preferences, navigation modes

- **4 colour themes** (Noir, Midnight, Ember, Neon) as `data-theme` on `<html>`,
  driving the existing HSL custom properties. All dark — RA listings get looked
  at in the dark, and no light theme ever existed.
- **3 densities** (Compact/Comfortable/Spacious) as `data-density`, with
  `--density-scale` setting the root font size so every rem-based size moves
  together, plus explicit flyer-height and padding tokens for what shouldn't
  scale linearly.
- **3 navigation modes**: Standard (scrolling strip), Tabs (all 8 days as fixed
  columns, no scrolling), Minimal (no date UI, swipe only — the header shows the
  date instead).
- **Swipe between days in every mode**, hand-rolled on touch events. Gestures
  that are more vertical than horizontal are ignored, so scrolling the list
  never changes the day by accident.
- **Event details sheet** replacing the straight-to-ra.co link; the lineup
  renders as chips, which is where DJ set playback (ROADMAP §2) will attach.
- **Skeleton cards** matching real card geometry, so nothing shifts on load.
- Preferences persist to `localStorage` under `ra-nyc:preferences`, validated on
  read — an unrecognised value falls back to the default rather than leaving the
  app unstyled. Private-mode Safari throws on `localStorage`, so every access is
  wrapped.

Verified in a mobile-emulated Chromium (390×844, touch): defaults applied,
theme/density/nav switching, persistence across reload, sheet open/close, tabs
rendering 8 columns, minimal hiding the strip. 14/14 passed. The rig was
temporary — Playwright is not a dependency, because its postinstall downloads
browsers during Vercel builds. Committing a real suite is ROADMAP §0.

### 2026-07-29 — Touch, navigation and perceived speed

Reported as "touch response is quite different than the original".
Investigated; the component code is byte-identical to the original, so
the difference was never the components. Real causes found and fixed:

- **The date strip was clipped, not scrollable.** `DateSelector` had
  `overflow-hidden`, so on a narrow phone the last dates rendered but could not
  be reached at all. Now `overflow-x-auto` with scroll snapping and a hidden
  scrollbar.
- **No `active:` states.** Every interactive element styled only `hover:`,
  which does not exist on touch — so a tap gave zero feedback until data
  arrived. Added `active:` states to date buttons and event cards.
- **Tap latency and grey flash.** Added `touch-action: manipulation` and
  `-webkit-tap-highlight-color: transparent`.
- **Light browser chrome.** No `color-scheme: dark`, no `theme-color`. The
  status bar and the iOS rubber-band overscroll area rendered light against a
  black app — the single most "not native" tell. Fixed in `index.html` +
  `index.css`, with `viewport-fit=cover` and safe-area insets.
- **Every date tap blanked to a spinner.** Now `placeholderData:
  keepPreviousData` keeps the previous day visible, dimmed, while the next
  loads; adjacent days are prefetched so stepping through the strip is
  usually instant.

Also added a `prefers-reduced-motion` block, which the new transitions made
overdue.

**Still open:** the user also reports "missing themes and preferences". No
theme switcher or preferences UI exists in *any* commit in this repo's history
— checked all 15. If the builder's sandbox has unsynced work, it needs to be
exported; its MCP connector requires an approval this session could not
grant.

### 2026-07-29 — Event images never loaded

Once events rendered, the flyers didn't. `EventCard` built the URL as
`` `https://images.ra.co/${filename}` ``, but RA's `images[].filename` is
usually **already an absolute URL** — so this produced
`https://images.ra.co/https://images.ra.co/…`, which 404s. Carried over from
the original build; it had never worked.

→ `src/lib/raImage.ts` resolves both shapes (absolute, protocol-relative, bare
path, leading slash, blank). A failed load now removes the `<img>` instead of
leaving a broken-image icon, since plenty of RA listings have no usable flyer.

Not verified against live RA data — `ra.co` is unreachable from the build
environment — but the resolver is correct for either shape, so it holds
whichever RA returns.

### 2026-07-29 — Database decision: not yet, then Neon

Full reasoning in [DATABASE.md](./DATABASE.md). Compressed:

- The app holds **no data of its own**. Everything on screen comes from RA on
  demand. A database would be a cache with extra steps, next to two caches
  (Vercel edge + TanStack Query) that already work and cost nothing.
- **The rule:** *add the database when there is data that cannot be re-fetched
  from RA.* Currently false.
- **The first thing that makes it true** is a hand-corrected DJ → SoundCloud
  link. It can't be re-derived, so it can't live in a cache.
- **Locally-hosted Postgres can't be production**: Vercel functions are
  stateless and run in AWS; they can't reach a box at your house without either
  exposing `:5432` to the internet or maintaining a tunnel — and the site would
  go down when the laptop sleeps. Serverless also exhausts a normal Postgres
  connection pool.
- **But local Postgres is right for development.** Neon *is* Postgres, so the
  same schema, SQL, migrations, and client work against both. Docker locally,
  Neon in prod, one `DATABASE_URL`.
- **Neon over the alternatives** because it scales to zero (this app's traffic
  is Thursday-night spiky), has an HTTP driver built for serverless, does
  database branching for preview deploys, and is portable — `pg_dump` and go.
- Proposed schema is already written in DATABASE.md. Don't create it yet.

### 2026-07-29 — Feature requests recorded

Two features requested for **future** revisions, specified in
[ROADMAP.md](./ROADMAP.md), not implemented in the migration commit:

1. **Search bar for events** — phase 1a filters the loaded day in memory (no
   backend, ~a day's work); phase 1b searches all upcoming events and is the
   thing that needs the database.
2. **Tap a DJ → play their SoundCloud / Mixcloud sets, plus a bio link** —
   bottom sheet with an iframe embed. The hard part is resolving a name to an
   account: RA gives a name and nothing else, SoundCloud's API is effectively
   closed, and fuzzy DJ-name matching *will* be wrong sometimes. Start with
   Mixcloud (open API), show nothing rather than a wrong match, and add manual
   correction later.

---

### Playback survives navigation — the transport bar

Sets used to play in an embed inside the artist sheet, which meant dismissing the
sheet killed the audio. **An iframe unmounts with the component that renders
it**, so no amount of state juggling fixes this from inside a sheet. The player
had to move out of React's tree: `PlayerProvider` (above the router) owns a 1×1
host appended to `document.body`, and `PlayerBar` is pure UI reading context.

That also required real control APIs, since an embed only gives you the
provider's own controls inside their iframe. Each provider now sits behind one
`PlayerHandle` (`play`/`pause`/`seek`/`destroy` + `seekable`): SoundCloud and
Mixcloud via their widget APIs, YouTube via the IFrame API (polled — it has no
progress event), and **Internet Archive natively**, because their `/embed/` has
no API but they serve the audio file directly, so `<audio>` beats the embed
outright. Adapters load on demand; no SDK is in the initial bundle.

**Three traps, all of which presented as something else:**

1. **The host must stay in the viewport.** `display:none` or off-screen and the
   browser may treat the player as backgrounded and suspend it.
2. **Painting above a sheet ≠ being tappable over one.** An open drawer is a
   modal and Radix sets `pointer-events:none` on `<body>`. The bar rendered above
   the overlay, looked completely fine, and silently ate every tap. Caught only
   by hit-testing the actual pixel — `isVisible()` passed. Fixed with
   `pointer-events-auto`, plus stopping pointer-down propagation, or tapping
   *next* also counts as a click outside the dialog and dismisses the sheet.
3. **Route stubs in the Playwright harness match last-registered-first**, so a
   catch-all silently swallowed the specific `api.js` stub and playback appeared
   broken when it wasn't. Not product code, but it cost a debugging round.

Layout is driven by one variable: the bar publishes its measured height as
`--player-h`, sheets cap themselves with `calc(... - var(--player-h))`, and the
header sticks at `top: var(--player-h)` and gives up its safe-area inset while
the bar is there. `--player-h` is `0px` when nothing is playing, so all of it
stays correct with no conditionals.

Verified 26/26 in mobile Chromium with the providers stubbed, including the
thing that matters: the timeline keeps advancing across dismissing the artist
sheet *and* the event sheet under it.

### The queue is the catalogue, and Beatport is gone

Two follow-ups once the transport existed.

**`next` now walks everything.** `MAX_SETS` went 3 → 50, and the per-provider
fetch split in two: `CATALOGUE_LIMIT` (50) for SoundCloud and Mixcloud, where a
DJ actually posts, and `FALLBACK_LIMIT` (4) for Archive and YouTube, whose
matching is the loosest of the four — fifty guesses there would bury a real
catalogue under near-misses. The 3-cap made sense when a set was a taster
embedded in the sheet; with a persistent transport, `next` is expected to keep
going.

**Ordering is now by date, newest first**, replacing provider-then-plays — which
had been putting a decade-old SoundCloud favourite ahead of last weekend's set.
Nice property: it sorts the providers out for free. SoundCloud and Mixcloud both
report a real date and Archive items usually don't, so undated sets fall to the
back and the fallbacks land after the catalogue *without a rule saying so*.
Provider rank and plays survive only as tie-breaks among undated sets.

**The list and the queue are now different things.** The sheet shows six with a
*Show all N* expander; the queue is always the full catalogue. Showing fifty rows
would have buried the bio and links under a wall of set titles, and the whole
point of the earlier subduing pass was that the artist page is a read.

Beatport removed from the link list — see the note in the 2026-07-30 entry for
why it never earned its slot.

**The Playwright suite is checked in** at `tests/player.e2e.mjs`, `npm run
test:e2e`. It boots its own dev server, stubs `/api/*` and the SoundCloud widget
API, and runs mobile-emulated. The dependency is **`playwright-core`, not
`playwright`** — deliberately: `playwright`'s postinstall pulls a ~150 MB browser
down, which Vercel would pay for on every deploy since it installs devDeps.
Point it at a Chromium with `PLAYWRIGHT_CHROMIUM_PATH` or run
`npx playwright install chromium`.

Verified 26/26 e2e (including that the queue holds all 9 fixture sets while the
list shows 6, and that `next` walks past the collapsed list) plus 7/7 ordering
assertions against the compiled resolver.

### Event search

`GET /api/search?q=` returns `{ upcoming, past, truncated }` in one response, so
the sheet renders both sections without a second round trip.

**RA has no text filter this client can rely on**, so search means pulling a
window of listings and matching them here. That makes the window a direct trade
against upstream load: **60 days either side of today**, three pages of 100 per
direction, six upstream requests per uncached search. It covers the question
people actually ask — "is X playing soon, and when were they last on?" — without
paging a year of listings for every keystroke. `truncated` is returned so the UI
can admit the window rather than implying the result is exhaustive.

**Matching is loose on purpose, and that is an inversion of the artist rule.**
`isPlausibleMatch` (artist resolution) is strict because a wrong auto-resolved
set is presented as fact. A search hit is something the user is actively
scanning and can dismiss at a glance, so search uses plain substring matching
over title, venue and lineup — which between them cover DJs, parties, promoters
(nearly always in the title) and venues. Both run through the same
`normalizeName`, so "bjork" finds "Björk" and "bossa nova" finds "Bossa Nova
Civic Club".

`normalizeName` moved to `api/_lib/normalize.ts` so `ra.ts` can use it without
importing `artistLinks` and dragging the Neon client into the events and search
functions.

**Picking a result jumps the listings to that night and opens the event**, rather
than opening a third stacked sheet. You land back in the normal flow with the
day around it for context, and it avoids inventing a fourth z-layer.

Verified 13/13 in the browser (debounce collapses a burst of keystrokes to one
request, sections ordered upcoming-then-past, results carry a date the day
listings don't, empty state reads as empty rather than broken, picking a result
jumps and opens) plus 10/10 matching and ordering assertions against the
compiled resolver.

### Lock screen

`navigator.mediaSession` is set from the top-level page, which owns the session
even though the audio comes from a cross-origin iframe. Before this a locked
phone showed **"SoundCloud widget"** — the OS was falling back to what the embed
declares about itself.

The action handlers matter as much as the metadata: without them the OS buttons
drive the iframe directly and the transport bar never hears about it, so the two
desynchronise the first time you hit pause on the lock screen. Everything routes
back through the same code the on-screen controls use.

This is why sets carry `artwork` — added to all four providers from fields
already in their responses. `album` is the provider name rather than a
fabricated release.

### 2026-08-03 — Search fuzziness, the 45-minute floor, and one-tap play

**The blank block in search.** A screenshot showed a single result followed by a
large black area, with dimmed listings visible below it. The dimmed content was
the *listings page seen through the drawer overlay* — the sheet was simply only
as tall as its one result, because `DrawerContent` had a `max-height` and hugged
its content. Reproduced by replaying the exact production response for the query
in the screenshot; card heights came back a normal 118–138px, which ruled out the
obvious "one card is enormous" theory and pointed at the sheet.

The search sheet now has a **fixed** height (`88dvh`), not a max. Two reasons:
the bug, and that a content-hugging search sheet would resize on every keystroke
as results came and went. `dvh` rather than `vh` so it sits above the keyboard
instead of extending behind it.

**Every set after the first needed a second tap on play.** Structural, not a
timing fluke: each track change destroyed the iframe and built a new one, and a
*freshly created* cross-origin iframe carries no user activation, so its autoplay
is refused. An iframe that has already played keeps its activation.

`PlayerHandle` now carries its `provider` and an optional `load(set)`. Same
provider ⇒ load in place; different provider ⇒ rebuild. The subtle part is that
the effect's cleanup can no longer destroy the handle — React runs the previous
cleanup before the next effect, so it would kill the very iframe the next track
wants. Teardown moved to provider change, stop, and unmount. The event callbacks
also lost their per-run `cancelled` guards, which would have deafened a *reused*
handle; staleness is handled by destroyed handles having no iframe left to emit
from.

Caught while doing it: the 700ms "did it start?" retry could resurrect playback
after a deliberate pause. Pause now cancels it.

**SoundCloud sets must be ≥ 45 minutes.** SoundCloud is a track host as much as a
mix host; a four-minute single is not what "play a set" means. Unknown duration
counts as too short — far more often a single than an unlabelled two-hour set.
SoundCloud only: Mixcloud is mixes by construction.

**Fuzzy search.** Three passes: substring, leet-folded substring, then edit
distance ≤ 1 per word for terms of five characters or more. `searchKey` (leet
folding) is deliberately separate from `normalizeName` — that one also backs
artist resolution, where folding digits would corrupt `320`, `8ULENTINA` and
`Tommy Four Seven`. The requested case, `holo` → **h0l0**, is a real Ridgewood
venue nobody types with zeroes.

**Unit tests are in** (`npm test`, 64 assertions) over `normalize`, `ra`,
`artistLinks`, the formatters and the rate limiter. Vitest, dev-only. Writing
them surfaced one finding worth knowing rather than fixing silently:
`isPlausibleMatch`'s prefix rule is **unbounded on the right**, so any name
starting with the artist's matches — `Cosmo` accepts `Cosmonaut`, and `Lakuti`
accepts a fan account. Asserted as current behaviour with a comment, so a
deliberate tightening shows up as a change rather than a surprise.

> Worth repeating from the search work: unit tests would not have caught the
> search bugs. Those were wrong *assumptions about RA* — that `pageSize: 200`
> works, that NYC runs ~25 listings a day. The simulation encoded the wrong
> assumption and passed. Only probing production found them. Tests lock in a
> fix; they don't discover that your model of the world is wrong.

### 2026-08-03 — Venue maps

Tapping a venue name opens a map sheet over the event. The reason this needed a
new endpoint rather than a component: **RA gives us a venue name and nothing
else** — no address, no coordinates — so a map means geocoding.

Nominatim is keyless and free if you identify yourself and don't hammer it. Both
push it server-side: a browser cannot set a meaningful `User-Agent`, and a
per-visitor call is precisely the hammering their policy warns about. Cached a
month; venues don't move.

The map is an **OSM embed iframe**, not a mapping library — no key, no SDK,
nothing in the bundle, for something most sessions never open. OSM only serves
light tiles, so `.map-dark` inverts and hue-rotates them; a CSS filter doing what
a paid dark tile server would charge for.

A failed geocode is deliberately not an error: the panel explains itself (usually
a one-off or TBA location) and *Open in Maps* still works from the name alone.
`maps.apple.com` rather than `geo:` because it degrades to a web map everywhere
that isn't iOS.

### 2026-08-03 — Matching gets a second signal, and the desktop gets a layout

**The prefix rule was a hole, and it was wider than it looked.**
`isPlausibleMatch` accepted any candidate that started with the artist's
normalised name once that name reached five characters. So `Cosmo` matched
`cosmonaut`, `Lakuti` matched `lakutifanpage`. Not near misses — different
accounts.

The damage was not one bad set. Matching a *profile* sets `ownUploads`, and that
switches off the per-track filter entirely (`artistLinks.ts`, the
`ownUploads || titleMentions(…)` filter). One wrong profile adopts a whole
catalogue and presents it as the artist's.

A length cap does not fix it. `cosmonaut` is four characters longer than
`cosmo` — *shorter* than the legitimate `music` in `avalonemersonmusic`. So the
test is on **what** the extra characters are: a small allowlist of decorations
real accounts add (`music`, `official`, `dj`, `uk`, `nyc`, …), up to two
stacked. Anything carrying meaning of its own — `naut`, `fanpage`, `edits` —
fails. Made symmetric while there, so `djstingray` works the same as
`objektsound`; the old rule accepted a *shorter* candidate too, which meant
`Marcel Dettmann` would take an account called `marcel`.

**Names alone cannot go further than that.** Two DJs called Cosmo produce
identical strings; no tightening separates them. What separates them is
context, and RA already publishes it in the biography we fetch for the artist
sheet and then use for nothing else. New `api/_lib/artistContext.ts`:

- **Handles.** `soundcloud.com/objekt` in a bio is not corroboration, it is the
  answer — it skips the name search entirely via `/resolve`.
- **Terms.** Places, labels, collectives, radio shows. These only ever *rank*
  candidates that already passed the name test. Rescuing a name-failing
  candidate on keyword overlap would trade a rare wrong answer for a common one.

The parenthetical is the part worth remembering: RA disambiguates same-named
artists as `Cosmo (NY)`, and `normalizeName` strips it before matching ever sees
it. It costs nothing, needs no bio, and it is the single most useful fact RA
will hand over about which Cosmo this is.

Ordering changed for it: RA now resolves *before* SoundCloud and Mixcloud, with
Archive/YouTube/Discogs started first and awaited after, so the dependency costs
an ordering rather than a round trip.

> **Honest limit.** RA's `biography` field is a guess at their schema and often
> comes back empty. With no bio the context is empty and matching behaves
> exactly as it did before — minus the tightened prefix rule. The parenthetical
> is the only signal that always survives.

Migration `0006` clears `sets`, `soundcloud_user` and `mixcloud_user` on every
non-manual row. Clearing the *user* columns is the point: a bad
`soundcloud_user` is what produced the bad sets, and leaving it would have the
next resolve trust the same account again.

**Spacing and text size were decoupled, and that was the wrong fix.** Spacing is
px so that scaling type doesn't scale padding one-for-one — an early version did
and "Larger" blew the layout apart. But *fully* independent meant that at
"Larger" the type grew 12% inside padding that hadn't moved, so cards read
cramped, and at "Smaller" the same padding read empty. `--space` is now
`--density × (1 + (--text-scale − 1) × 0.6)`: coupled at 60% strength. Measured
across all nine combinations, padding-to-type spread fell from 0.10 to 0.04.
Steps are geometric now too, so a step down is the same size of change as a step
up.

**The desktop had no layout, only a stretched phone.** Each card ran the full
window width, so a two-line title sat in a metre of space and the eye travelled
the whole way back for the next row. `.shell` caps and centres every band —
header, date strip, count, listings, transport — at the same widths; the
listings became a grid that goes 1 → 2 → 3 columns; base type steps 16px → 17.5px
at `lg`, multiplying whatever text size was chosen rather than replacing it. The
date strip stops growing separately, because eight chips filling a laptop are
eight 160px slabs around a two-digit number.

**Third typeface, third attempt.** Bebas Neue was distinctive and unreadable at
2am. Space Grotesk fixed legibility and lost the distinctiveness — next to
system-ui at a glance it read as the same font. Bricolage Grotesque is visibly
irregular in a single word but was drawn for text as well as display.

**Stagger entrance.** Same effect, better motion. It used the iOS *sheet* curve,
which starts at a slope of 0.32 and leaps from a standstill — that curve exists
to catch a finger already in motion, and nothing here is being dragged. Ease-out
quint over 0.44s and 10px starts from rest and spends its time decelerating.
Delays now cover fourteen cards at 34ms instead of clumping everything past the
eighth at 400ms.

**Installability.** A manifest with `display: standalone` plus
`window-controls-overlay` in `display_override`, and a maskable icon so Android
doesn't crop the mark. Nothing changes in a normal tab; it's opt-in at install.

Docs: `MIGRATION.md` deleted, its still-useful operational content moved to
`INSTALL.md`. Every "Lovable" reference is gone from the tree — the branch name
is the one exception and it is not ours to change (§5).

## 4 · Map of the code

```
api/_lib/ra.ts           RA GraphQL client + event search. Query, browser-like
                         headers, error mapping, date validation. Server-only.
api/_lib/artistLinks.ts  DJ → sets/bio/links across four providers, and the
                         name matcher. Owns the Neon cache read/write.
api/_lib/artistContext.ts  RA biography → handles + corroborating terms. The
                         only thing that can separate two same-named artists.
api/_lib/normalize.ts    normalizeName / searchKey / withinEditDistance. Kept
                         apart from artistLinks so ra.ts can use it without
                         dragging in the database client.
api/events.ts            Day listings. Validates, calls, caches, maps errors.
api/artist.ts            /api/artist. api/search.ts, api/venue.ts, api/image.ts.

src/pages/HomePage.tsx   Selected date + which sheets are open. Everything else
                         is a sheet over it.
src/context/PlayerContext.tsx  The queue and the provider handle. Reuses the
                         handle across tracks — a fresh cross-origin iframe has
                         no user activation and refuses to autoplay.
src/lib/players/         One module per provider behind a common interface.
src/lib/mediaSession.ts  Lock-screen metadata and transport handlers.
src/index.css            Themes, typography, density/text-scale, .shell, the
                         transport bar, sheet timing. Mostly OUTSIDE @layer —
                         see the gotcha below.

vite.config.ts           Build config + the dev-only api/ route mounter.
vercel.json              Runtime, SPA rewrite, asset cache headers.
```

### Gotchas a newcomer will hit

- **`RAEvent` is declared twice** — `api/_lib/ra.ts` and `src/types/event.ts` —
  because the function bundle and the browser bundle compile under different
  tsconfigs. **Add a GraphQL field → update both.**
- **Files in `api/` starting with `_` are not routes.** That's how `_lib/`
  stays private.
- **`npm run preview` does not serve `/api`.** It's static-only. Use
  `npm run dev` or `vercel dev`.
- **Never put a secret behind a `VITE_` prefix.** Vite inlines those into the
  public browser bundle. Server-only values belong in `api/` and unprefixed env
  vars.

---

## 5 · Open questions & known issues

1. **Timezone.** `HomePage` seeds from `new Date()` — the *visitor's* clock, not
   New York's. Someone in London at 01:00 sees NYC's tomorrow as "today".
   Related: when does the night roll over? A 2 a.m. set belongs to the previous
   evening in how people talk, but not in how the date strip counts.
2. **Hard 50-event cap.** RA's first page only; no pagination. Busy Saturdays
   are being silently truncated.
3. **Search coverage past four days is sampling, not coverage.** The last four
   days get one request each; beyond that the windows widen and thin out. The
   `truncated` flag exists to admit this rather than imply the result is
   exhaustive. NYC produces roughly a hundred listing *rows* a day — every day
   of a multi-day run is its own row — which is the number every mis-sizing of
   this window came from.
4. **No error boundary.** A render crash blanks the page.
5. **`ownUploads` still disables per-track filtering.** Once a profile matches,
   its whole catalogue is trusted. That is correct when the match is right and
   total when it is wrong; the two matching fixes narrow how often it is wrong
   but do not bound the blast radius. Scoring tracks independently of the
   profile would.
6. **The branch name still says `lovable`.**
   `claude/lovable-vercel-migration-hyp0a1` is assigned by the session harness,
   not chosen here, and renaming it mid-session breaks the harness's binding.
   Every reference *inside* the tree is gone. To retire the name: merge, delete
   the remote branch, and let a future session pick a new one.
7. **RA has no published API terms.** This is an unofficial client that links
   back to `ra.co` for every event and caches aggressively to stay light. If RA
   objects, stop.
8. **Is anyone actually tapping DJ names?** Vercel Analytics is wired up and can
   answer it. Worth checking before building anything else on the artist path.

---

## 6 · Next actions

1. **Apply migration `0006`** against production — nothing else in this change
   takes effect for an artist already in the cache.
2. **Set the repo's Website field** to `https://ra-nyc.vercel.app`. The README
   link is already right; the GitHub sidebar field is dashboard state and no
   tool in these sessions can write it.
3. Anchor dates to `America/New_York` (issue #1). It is the oldest open bug and
   the one that silently shows the wrong day.
4. Add an error boundary (issue #4). Small, and it converts a blank page into a
   retry.
5. Pagination past RA's first 50 (issue #2).
6. Score SoundCloud tracks independently of the profile match (issue #5).
