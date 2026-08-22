# memorystate.md

Running project journal: current state, decisions and *why*, and what's still
open. Written so that a person — or an AI agent — picking this repo up cold can
get productive without re-deriving anything.

**Keep this file updated.** When you make a decision that a future reader would
otherwise have to reverse-engineer from a diff, append it to the log.

**Last updated:** 2026-08-05
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
| **Database** | Optional Neon: artist links + the search index. See [DATABASE.md](./DATABASE.md) |
| **Env vars** | None required; `DATABASE_URL` and `DISCOGS_TOKEN` optional |
| **Tests** | ✅ 139 Vitest units + 109 Playwright assertions (`npm run test:all`) |
| **Preferences** | 5 themes (lightest→darkest) · 3 densities · 3 type categories · 6 text sizes |
| **Analytics** | ✅ Vercel Analytics, no cookies |
| **Auth** | None, none planned |

### Stack

React 19 · TypeScript 5.9 · Vite 7 · Tailwind 3.4 · TanStack Query 5 ·
React Router 7 · date-fns 4 · lucide-react · vaul · react-day-picker ·
Vercel Analytics · seven Vercel Node 22 functions. Dev-only: Vitest,
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
| `/api/health` | Function | What is configured, reachable and migrated. No secrets |
| `/api/backfill` | Function | Fills index gaps. Bearer `CRON_SECRET`; daily cron |

The app is a single route. The event, artist and search views are all sheets, not
pages — tapping a DJ opens the artist *over* the event, and dismissing returns to
it. Sets play in a transport bar docked to the bottom, which outlives every sheet.

### Test commands

| Command | What it runs |
| --- | --- |
| `npm test` | 122 Vitest units over the pure functions in `api/_lib` and `src/lib` |
| `npm run test:e2e` | 33 Playwright assertions for the transport bar |
| `npm run test:search` | 30 Playwright assertions for search and venue maps |
| `npm run test:layout` | 18 Playwright assertions for responsive layout and preferences |
| `npm run test:preview` | 7 Playwright assertions for the party preview |
| `npm run test:offline` | 7 Playwright assertions for the service worker, against `dist/` |
| `npm run test:all` | all six |

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

### 2026-08-03 — What the review caught

A Sonnet review of the change above found nine things. Six were real; all six
are fixed. Two are worth carrying forward.

**Every cache-invalidation migration since 0002 has been a no-op — and worse.**
Migrations 0002, 0003, 0004 and 0005 all end with some version of

```sql
update artist_links set sets = '[]', resolved_at = to_timestamp(0)
 where link_source <> 'manual';
```

and every one of them believed it was scheduling a re-resolve. None was.
`readCached` returns whatever row it finds and **never reads `resolved_at`**;
`getArtistLinks` only bypasses the cache on `refresh: true`, and nothing in the
codebase passes it. So those statements did not invalidate anything — they
permanently emptied the set list of every artist already cached, and the
resolver has been serving those empty rows as *hits* ever since.

That is very likely part of why artists have been showing up with no sets.

Deleting the row is the only invalidation this schema supports: a missing row is
a cache miss, and a cache miss resolves live and writes back. `0006` is a
`delete`, which also repairs everything 0002–0005 emptied.

> **The lesson.** The four earlier migrations each carried a confident comment
> explaining what they invalidated. The comment was wrong in all four, and
> nothing contradicted it, because a cache that returns stale data looks exactly
> like a cache that is working. Writing `resolved_at` is only invalidation if
> something *reads* `resolved_at`.

**Two-letter affixes reopened the hole they were meant to close.** The first
allowlist included `ny`, `la`, `us`, `de`, `it`. Those are not rare geographic
tags; they are how ordinary English words end. Verified: `Harmony` matched an
account called `harmo`, `Cosmo` matched `cosmola` — the same class of wrong
account as `cosmonaut`, arriving through a two-character coincidence instead of
an unbounded suffix. Trailing decorations are now three characters minimum, and
`dj` survives only as a *leading* one, since position is real information. The
accepted cost is `objektuk`.

Splitting leading from trailing also paid for itself twice: it made room to add
the scene cities the first list omitted — the original stopped at `nyc` and
`berlin`, quietly ruling that a Chicago handle was less legitimate than a Berlin
one — and, with a closed set of decorations doing the work, the name floor could
drop from five characters to four, so Or:la and DVS1 can now reach `orlamusic`
instead of matching nothing but themselves.

The rest, briefly:

- **One abort deadline for a now-sequential pipeline.** A single 7s controller
  was correct while all six sources raced it. Once RA became a prerequisite, a
  slow-but-*successful* RA lookup could hand SoundCloud and Mixcloud an already
  aborted signal — the two sources a DJ actually posts to, returning nothing,
  with a successful call as the cause. Each stage now gets its own deadline; RA
  is held to 3s because it blocks.
- **The place sweep dropped `nyc` and `usa`** to a length floor meant for
  accidental tokens from the proper-noun sweep. On an app called ra-nyc.
- **`apple-touch-icon` pointed at an SVG**, which iOS does not rasterise — on
  the one platform that meta block exists for. Now a PNG, generated with
  zlib and struct because the sandbox has no image library.
- **`.shell` was unlayered**, and unlayered author CSS beats every `@layer` rule
  regardless of specificity, so a `max-w-*` utility placed beside it to widen one
  instance would have silently lost. Moved into `@layer utilities` — safe
  because, unlike the runtime-built `theme-${x}` names, `.shell` is written
  literally in the JSX and survives the content scan. Verified in the built CSS.

### 2026-08-05 — The map stops being an OSM iframe

Reported as hating the look of it, and the look was a consequence of the
mechanism. The map was an OpenStreetMap embed iframe — one tag, no key, no SDK,
the right weight for something most sessions never open — but it came with OSM's
standard raster style, a pale grey-and-beige road atlas. In a dark app that had
to be inverted to be bearable, and inverted it read as a photographic negative
of a map rather than a map.

Composing tiles by hand keeps every property that made the iframe the right call
and drops the one that didn't. `src/lib/tiles.ts` is the Web Mercator arithmetic
every tile server shares; the sheet lays out `<img>` tags from it. Still no
mapping library, still nothing in the bundle — but now any tile server will do,
and the one chosen is **CARTO Voyager**: coloured, flat-shaded, parks green and
water blue, the closest keyless tile set to what a phone's own map app looks
like. Free non-commercially to 75k views a month with attribution, which a map
that only opens on a venue tap is a long way from.

What is lost is pan and zoom. The embed barely had them, and *Open in Maps* is
one tap away for anyone who wants to actually navigate.

Alongside it: **Get an Uber** and **Get a Lyft** next to *Open in Maps*, because
getting there is what you do next after finding out where it is. Uber's
universal link carries the venue as the destination and `pickup=my_location`;
Lyft's carries the destination and omits pickup entirely, which is its way of
saying the same thing. Either way the rider's position is the ride app's
problem — which is why this app never asks for a geolocation permission it
would only hand straight back.

> **Empower was here first, for one round, and was replaced on request.** Two
> reasons it was the weaker choice anyway: it publishes no deep-link scheme at
> all — no docs, no parameters — so its button could never carry the
> destination and deliberately carried nothing rather than inventing query
> parameters their app does not read. And NYC's TLC has publicly warned that
> Empower operates in the city unlicensed and that trips booked through it may
> not be insured. Lyft has neither problem and is one documented universal link.

Two bugs caught building it, both invisible in a diff and both found by the eye
and the browser rather than by reasoning:

- **The map rendered no tiles at all** — right size, right pin, no map. The
  measuring hook read `ref.current` inside a `useEffect(..., [])`, and the drawer
  does not mount its children until it opens: on first render the node was null,
  the effect bailed, and an empty dependency array meant it never ran again once
  the node appeared. Callback ref into state fixes it.
- **`h-64 w-64` is not 256px in this app.** The spacing scale is multiplied by
  the density preference, so tiles were drawn at ~266px and positioned on a 256px
  grid — every tile overlapping its neighbour, the whole map stretched four
  percent. Only visible in a screenshot with grid lines in it. Tiles are now
  sized inline, and two assertions check the drawn size matches the placed size
  and that no two tiles overlap.

### 2026-08-05 — Search gets an index instead of a wider window

Asked for a month ahead, two months back, and a cache of recent events. The
first two are constants; the third is the only reason they can mean anything.

**The window was never the limit — the page size was.** RA caps a page at 100
rows and returns a date range in *ascending* order, and NYC generates roughly a
hundred listing rows a day (every day of a multi-day run is its own row). Three
pages forward therefore reached about **three days** ahead, not sixty. Widening
the window without changing anything else would have widened only the label on
it. Behind, the recent past was one request per day for four days and openly
sampled after that.

No amount of paging fixes this inside one request. Remembering does.
`event_cache` (migration `0007`) holds one row per event, filed under the night
it starts, with a `search_key` computed by the same `searchKey` the matcher
uses — so the SQL substring filter and the JS matcher cannot disagree about what
"holo" and **h0l0** have in common.

**It fills itself.** Every day view writes what it fetched; so does every
search. No cron, no backfill job, no separate ingest path to keep correct — the
index is a by-product of the app being used, which is also why it needs no
operational attention.

Search now unions three sources: the index (the only one that can cover ninety
days), the live windows (which keep the nearest days fresh — a party announced
this morning is not indexed yet — and are the entire answer with no database),
and, only when both found nothing, a bounded in-memory scan of the index so a
*typo'd* term still gets the edit-distance pass SQL cannot do.

`coverage: { indexed, window }` is now on the response, and `truncated` means
something narrower: saturated live windows **and** an index that does not cover
the window. A ninety-day search answered from three days of live listings should
not read like a complete answer, and once the index does cover the window there
is nothing left to disclaim.

> **Caught by a test.** `SEARCH_BEHIND_DAYS` went to 60 while `PAST_SAMPLED`
> still stopped at 40, so a cold index would never have reached two months no
> matter what the constant said. The last sampled range is now pinned to
> `SEARCH_BEHIND_DAYS` so the two cannot drift again.

Still a cache, in the sense the rest of this file means it: no `DATABASE_URL`, a
missing table or an unreachable Neon and search is exactly the live-window
search it was before, day views are untouched, and nothing 500s.

### 2026-08-05 — Answering "is the database even on?"

Asked whether a database is needed now. It is, and the answer changed with the
search index: `artist_links` was always a pure cache — delete it and you lose
latency — but without `event_cache` search is *structurally* capped at about
three days ahead, which is a missing capability rather than a slow one. That is
exactly the trigger DATABASE.md predicted.

Then the follow-up question could not be answered: **is `DATABASE_URL` actually
set in production?** Vercel's project API does not expose environment variables,
this sandbox has no route to Neon or to the deployment, and every optional
dependency in this app degrades silently by design. A missing connection string
looks exactly like an empty table, which looks exactly like a city with no
events. That ambiguity has now cost debugging time three separate times: a
SoundCloud key set but never deployed, four migrations that appeared to
invalidate a cache and did not, and this.

`GET /api/health` ends it. It reports whether each dependency is configured,
whether Neon is reachable, and — via `to_regclass` — which migrations have
actually run, judged by the tables they create rather than by a migrations
table nobody maintains. It never reports what anything is set *to*.

`GET /api/backfill` fills the index gaps, nearest days first, because the index
otherwise only learns about days somebody visited. Two design points worth
keeping:

- **It refuses to run without `CRON_SECRET` rather than falling open.** An
  endpoint that causes upstream requests on demand and quietly becomes public
  when an env var is missing is a worse failure than one that stops working.
- **No per-route `maxDuration` override.** An overlapping `functions` glob in
  `vercel.json` is a deploy-time risk, and this is a background job that can
  simply take another pass tomorrow — so it budgets 11s under the shared 15s
  limit and reports `remaining` instead.

A day RA genuinely has no events for stays "missing" and is retried every run.
Cheap at this volume; the alternative is inventing a sentinel event that does
not exist.

### 2026-08-05 — The index earns two more jobs

Asked to use the events index for everything discussed except "follow an
artist". Two features, both of which only became cheap because the index exists.

**RA outages stop being outages.** A day view was all-or-nothing — RA answers or
the page shows an error — and "RA may block Vercel's egress IPs" has sat in §5
as an untested risk since the migration. `/api/events` now falls back to what
the index holds for that day and flags the response `stale: true`; the header
says *Saved listings*. Saying so is not decoration: without it, listings that
are hours old are indistinguishable from current ones and the app would be
confidently wrong about tonight.

The fallback is caught **inside** the inner try, not in the outer handler,
because `date` and `areaId` are only in scope there. The first version put it
outside and had to hardcode NYC — which would have served the wrong city's
listings the day anyone passed `?area=`. Its cache header is deliberately short
and carries no `stale-while-revalidate`: a degraded answer must not keep being
served once RA recovers, and the long SWR on the healthy path is what makes
that safe.

**Offline.** A hand-written service worker rather than Workbox — the whole
policy is three rules and a plugin would add a build step and ~15 kB to save
writing them:

- Navigations: network first, falling back to the cached shell.
- `/assets/*`: cache first. Vite content-hashes them, so revalidating is waste.
- `/api/events`: stale-while-revalidate. **This is the rule that makes the app
  usable underground** — the listings you looked at last are the ones you want
  on the platform.

Everything else is network-only. Search, artist resolution and venue geocoding
answer questions asked *now*, and a stale answer is worse than an honest
failure. Cross-origin requests — tiles, players, fonts — are not touched at all.

`skipWaiting` is deliberately **not** called. A new worker taking over
mid-session leaves the page holding old hashed asset URLs the new cache no
longer has, and lazy chunks start 404ing under someone's fingers. Activating on
the next load is one visit slower and cannot break a live one.

`tests/offline.e2e.mjs` runs against the **built** output over a real static
server, because a worker is not installed for routes the browser never fetched
and is registered only in a production build. The assertion that matters is the
one with the network cut: the app loads and renders listings with no network at
all. 7/7.

> **Known gap.** The RA-outage fallback has no automated test — exercising it
> needs a live database, which no test environment here has. It is verified by
> construction and by typecheck only. The offline path, which could be tested,
> is.

### 2026-08-05 — Party previews, and a ticket link that has to be earned

**Audio starts on the tap now.** Two taps became one: opening a DJ *is* the
request to hear them — there is only one reason to do it — so `ArtistSheet`
starts the newest set on open rather than waiting for a second tap on a row.
Tapping the playing row now pauses it, which is the same gesture doing the
obvious thing.

The other half of "as soon as possible" is the network. Opening a party now
warms every DJ on the bill through `usePrefetchArtist`, so by the time anyone
taps a name the request is usually already answered.

**Preview the night.** One set per DJ, queued in lineup order, so you can hear
what a room sounds like without committing to anyone's hour.

- **It starts on the first DJ back, not the last.** A six-name bill is six
  `/api/artist` round trips; waiting for all of them would put seconds of
  silence between the tap and the music. Whoever resolves first starts playing
  and the rest are appended behind the music. Measured in the browser: 120ms
  with the slowest artist stubbed at 1.5s.
- **The pick is seeded, not random.** `Math.random()` re-rolls on every reopen,
  so the party you sampled two minutes ago becomes a different party. FNV-1a
  over `eventId:artistId` keeps one night sounding like itself while giving
  different nights, and different DJs, different picks.
- **It is a button, not automatic on opening the event.** The brief said to
  play on clicking a party; the instruction that outranked it was "least
  obstructive". People open a party to read a time and a bill, and sound nobody
  asked for is the rudest thing an app does on a phone. One obvious button is
  the same idea without the ambush — and it keeps playback tied to a real
  gesture, which browsers require anyway. Asserted: opening a party plays
  nothing.

**The ticket link is earned.** `listened` counts seconds of *actual playback* —
a phone paused in a pocket never accumulates any — and at sixty seconds a small
Tickets link appears in the transport. That threshold is the whole ethic: at a
minute in, "where do I get tickets" is a question the listener now has, and
answering it is help. Shown at the start it is an advert, and an app that has to
be ignored to be used. The rule lives in `src/lib/tickets.ts` on its own so it
can be argued with rather than buried in a component.

`VenueSheet` also gained one above the ride buttons — someone working out how to
*get* there has already decided they want to go, which is the one screen where a
ticket link is the answer rather than an interruption.

**Three bugs of mine, all caught by tests rather than by reading:**

- **A hook after an early return.** The lineup-warming `useEffect` landed below
  `if (!event) return null`, so React saw a different number of hooks the moment
  an event arrived: *"Rendered more hooks than during the previous render."* The
  sheet did not render at all.
- **An effect depending on `data?.sets ?? []`.** That fallback is a fresh array
  every render, so the auto-play effect re-ran constantly. Depends on
  `data?.sets` now, which React Query keeps stable.
- **`usePrefetchArtist` returned a new function every render**, which made it
  useless as an effect dependency — the warm effect would have re-run on every
  render. Memoised.

**Reuse.** `artistQuery(id, name)` in `useArtist.ts` is now the single
definition of how to fetch an artist, shared by the sheet, the prefetch and the
preview. They have to agree on the query key above all else: three hand-written
keys that drift do not error, they just quietly stop sharing a cache and every
prefetch warms nothing.

> **Two honest gaps.** The 60-second reveal is unit-tested, not exercised in a
> browser — Playwright's fake clock must be installed before navigation, and
> advancing it a minute blanks the app by firing every startup timer at once.
> What the browser suite does assert is the guarantee that matters: nothing is
> promoted to someone who has only just arrived. And the Sonnet review of this
> change never ran — the agent died on an API session limit.

### 2026-08-05 — Play arrows, a legible third font, and a theme that stops repeating

**Green play triangles on the lineup chips.** A name on its own does not look
like a control, and the "tap to hear a set" caption above them was not being
read. The same triangle as the preview button says it in one glyph.

The green is `--play`, declared once on `:root` and inherited by every theme
rather than defined per theme. It is not decoration — it is the signal that a
thing makes sound, and a signal that changes colour with the wallpaper stops
being learnable. Green because a green triangle already means play everywhere
else on a phone.

**The preview section is tighter.** Heading and chips down a size, chips to
`py-0.5`, and the preview button fixed at `h-[2.3rem]` — the 2.5rem it was, less
eight percent. Fixed height rather than padding so the spinner and the triangle
cannot change it between states.

**Third typeface, fourth attempt — and a different kind of answer.** Bebas Neue
was distinctive and unreadable. Space Grotesk was readable and looked like
system-ui. Bricolage Grotesque was more characterful and *still* a grotesque, so
the complaint repeated. Atkinson Hyperlegible stops trying to be a better
grotesque: the Braille Institute commissioned it so that low-vision readers
cannot confuse one letter for another — the tailed l, the slabbed i, an
unmistakable G, a true double-storey a. Those same decisions are what make it
look nothing like Helvetica at a glance, which is the other half of the ask.
Renamed "Legible" in preferences, because that is what it is for.

**"It always gives me green."** The roll was uniform over four themes, which
repeats a quarter of the time — two or three Matrixes in a row is what
randomness actually looks like, and it reads as a bug. `randomColorTheme` now
excludes the previous pick, which is what people mean by random.

> **The bug that hid inside that fix.** `readSettings` built a `defaults` object
> eagerly — rolling once — and then rolled *again* on the branch that actually
> ran. So the "previous" theme being excluded was a throwaway from milliseconds
> earlier, and the no-repeat guarantee did nothing at all. Rolled exactly once
> per load now.

**Preferences fit one screen.** Everything down a step and the gaps tightened:
measured at 664px of content in a 664px viewport. A preferences panel you have
to scroll hides the options nobody thought to look for.

**A way to say thanks.** One line at the bottom of the last panel — no
illustration, no modal, no interstitial. This app is free, has no ads and sells
nothing, so a donate link belongs somewhere findable and nowhere else; anything
larger would be the first thing in the app asking for something rather than
offering it. The handles live in `src/lib/donate.ts` and ship **blank**: a
guessed payment URL either 404s or sends money to whoever owns that tag, and
empty strings hide the row entirely so a fork collects nothing for anyone.

**`readthis.md`** collects everything still needing a human. The useful finding
in it: **all of it can be done from a phone** — Neon's SQL Editor, Vercel's env
vars, GitHub's web editor and branch deletion are all ordinary web apps. Only
the backfill trigger wants a header, and iOS Shortcuts can send one.

Two test expectations needed updating rather than the code: the player suite
counted only `Play Set …` labels, and the row that is playing now says `Pause`;
and the layout suite asserted the old typeface by name.

### 3.x · The night ends at 3:30am

RA files an event under the calendar date it **starts**, so at 1am the app had
already discarded tonight and was showing tomorrow — with tonight still
running. The person on their phone at 2am is the one most likely to want the
next room on the same night out, and the calendar had just abandoned them.

`src/lib/night.ts` moves the boundary to **3:30am**: late enough for the second
and third stop of a normal night, early enough that someone awake at 8am gets
the day they expect. Past about 4am it starts stealing the following evening
from early risers, which is the same bug pointing the other way.

Only what the app *calls* today moved. The query is untouched — a night running
past midnight still lives under its own start date in the payload, which is
exactly why the boundary had to move on the client.

Two things that are easy to get wrong and are asserted:

- The chip says **"Tonight"**, not "Today". At 2am it sits on yesterday's date,
  and "Today" there reads as a bug rather than as the point.
- `currentNight()` anchors at **local noon**. A midnight-anchored date minus 24h
  lands at 23:00 the previous day in a spring-forward zone, which silently
  reads as the day before that.

### 3.x · One palette structure, five hues

All five themes share one ladder: background 5%, cards 9%, secondary 13%, muted
15%, input 17%, borders 18%, muted-foreground 58%, glow 0.38. Switching theme
changes hue and nothing else.

What read as incoherent between themes was never the colours. Matrix sat at 3%
lightness while Sunset sat at 5%, with borders and muted text drifting by up to
eight points, so changing theme changed *how heavy the app felt*. Chosen over a
single neutral charcoal (cost Matrix its terminal) and a two-hue duotone (least
uniform). **A sixth theme copies the ladder and changes only the hues.**

### 3.x · Three type categories, not three text faces

> **Superseded.** Slab (Zilla) came out a round later; the set is now
> System · Legible · Condensed — see *"Six faces, three slots"* further down.
> What is still live here is *why* Anton failed, which is exactly why Oswald is
> pinned at one weight.


Every previous attempt at the third font slot failed identically. Bebas Neue was
distinctive and unreadable; Space Grotesk readable and indistinguishable from
system-ui; Bricolage Grotesque more characterful and still a grotesque; Atkinson
Hyperlegible genuinely different in its letterforms but the same *colour* on the
page. Four rounds of "the third one still looks like the first", because they
were four moderate text faces.

The set is now three **categories** that cannot be confused at any size:

- **System** — the native sans.
- **Slab** — Zilla Slab. The obvious pick for "typewriter" is Courier and it is
  wrong: monospace gives an `i` the width of an `m`, so listings run about a
  third longer and two-line titles become three. Zilla keeps the blunt
  rectangular serifs and drops the fixed pitch, so it is *narrower* than the
  system sans rather than wider.
- **Legible** — Atkinson Hyperlegible.

**Anton lasted one round in the third slot.** It is a genuine poster face and
that is exactly the problem on a phone at 2am — and it could not be toned down,
because it ships **one weight**, so "a bit less bold" was not a thing that
typeface could do. Atkinson went back in: commissioned by the Braille Institute
so letters cannot be mistaken for each other, which also makes it look nothing
like Helvetica at a glance. It is the version of "obviously not system-ui" that
survives being read.

Headings under both display faces are **600, not 700**. At full bold a column of
titles reads as a stack of bars rather than as text. Order in the picker runs
least-to-most departure from system: System · Slab · Legible.

Each option's label in the picker renders in the face it selects. A font picker
that names three fonts in a fourth font is asking you to take its word for it.

### 3.x · Six text sizes, all upward

The old smaller/default/larger topped out at **+10%** and spent a third of its
range going below a size nobody had complained about. It is now six geometric
steps of ~6%, with **step 0 = the old default**, reaching +34%.

It was a stepper (− bar +) rather than six buttons, on the reasoning that the
axis is ordered so "one more" is the actual thought. Half right: "one more" is
*a* thought, and "that one" is the other, and a stepper only serves the first.
Getting from the smallest to the largest was five taps, and there was no way to
point at a rung.

It is now a native `input[type=range]` with the six rungs drawn as ticks under
it. Drag, tap-anywhere-on-the-track, arrow keys, Home/End and the VoiceOver
rotor all come with the element; a row of buttons gets none of them without
being reimplemented badly. The ± buttons went with the stepper rather than
sitting alongside it — 80px of a 320px drawer doing what a drag already does,
and the room they returned is what makes the six rungs far enough apart to hit.

Three things about it are load-bearing and none are obvious from the markup:

- **`data-vaul-no-drag` on the wrapper.** The settings panel is a right-hand
  vaul drawer, and vaul reads a left-to-right pointer drag as *dismiss me* —
  the same gesture as raising the text size. Without the opt-out, turning the
  type up closes the panel you turned it up from.
- **The fill and ticks are inset 10px at each end.** A range thumb's centre
  travels from half-a-thumb to width-minus-half-a-thumb, never to the edges, so
  ticks spread across the full width drift out of line with it — worst at the
  two ends, which are the two positions anyone actually checks.
- **Every length in the control is px, not rem.** It is the one thing on screen
  that must not resize with the setting it controls; a slider that grows under
  your thumb moves the target mid-drag.

All three are asserted in a new `tests/settings.e2e.mjs`. The vaul one was
checked by deleting the attribute and confirming the suite went red — which
caught a second bug in the test itself: vaul keeps the panel mounted through
its exit transition, so an immediate `count()` reported a drawer that was
already on its way out as still open. The drag assertion failed correctly while
the dismissal assertion passed, describing a drawer that was gone two checks
later. It now waits out the animation and reads visibility.

The class prefix moved from `text-` to `text-size-`; `.text-larger` was one
rename away from colliding with a Tailwind `text-*` utility. Both renamed unions
(`TEXT_SIZES`, `TYPOGRAPHIES`) needed no migration because `oneOf()` already
falls back on any unrecognised stored value.

### 3.x · Equal air above and below the thumbnail

`EventCard`'s row is `items-center`. The text column is almost never exactly
96px tall — a one-line title with no head count is short, a two-line title with
a full lineup is tall — and top-aligned, every pixel of that difference
collected underneath the image as one lopsided gap.

Centring is the fix rather than a padding value, and that distinction is the
point: alignment holds at **every density and text size** automatically, where a
padding value would have to be re-tuned for each of the eighteen combinations.
Measured equal to 0.1px at tight/default/airy across the size range.

Separately, all three densities came down **5%** — 0.87/1.04/1.25 →
0.827/0.988/1.188. The ratios between them are untouched, so "Airy" is still
exactly as much airier than "Default" as it was; the ladder moved as a unit,
which is what keeps the three options meaningful relative to each other. Borders
stayed at 1px: sub-pixel borders render as a hairline on retina and get dropped
or rounded up at 1x, so "thinner" would mean "inconsistent".

### 3.x · Filters that filter something

The first three chips shipped **RA Pick**, **Free** and **Before 12**, and two
of them were dead weight in opposite directions.

**Free** was a text match over the title, because RA's listing payload carries
no price at all — no `cost`, no tier. It read `0` on most nights, and on the
nights it read anything it could not be trusted. **Before 12** was the mirror
image: almost every listing starts before midnight, so it matched everything
and filtered nothing — a chip reading `21` beside a count of `21`.

Replaced with crowd-size tiers over `attending`, which is real data already in
the payload: **Busy** is the top third of the night, **Low-key** the bottom
third, and the middle third belongs to neither. The question people actually
arrive with is *is this the big one tonight, or the one nobody has found yet*.

**Relative to the night, never absolute.** A Tuesday's biggest room draws fewer
people than a Saturday's quietest, so any fixed head count makes one chip
useless on half the days of the week — the same failure as the two it replaced.
Tiers are computed over the whole day's listings rather than over whatever is
currently filtered, so turning Busy on and off cannot redefine what busy means.

Genre chips were considered and rejected: RA's payload has no genre field, so
they would need either a second request per event or a keyword guess over
titles — the Free chip's mistake again. Venue and promoter are long tails, not
three-chip axes.

### 3.x · The date rail

Eight fixed chips became a scrollable rail of sixty, running 14 days back and
45 forward.

The old strip shifted its own window when the calendar jumped outside it, which
meant the strip you scrolled back to was never the strip you left. A long rail
has no window to shift, so position is just position, and the past is reachable
by dragging rather than by knowing the calendar exists. The selected chip is
auto-centred on change, or picking a date three weeks out silently highlights
something nobody can see.

**"Tonight" and "Tmrw" are gone** — dates only. The relative labels made two
chips read differently from the other six, and on a rail you drag, a label that
means "wherever you are now" is worse than a date. `night.ts` still governs
*which* day is current, it just no longer says so in words.

**Swipe-to-change-day is gone too.** It competed with scrolling the listings
and with dragging the rail, and losing a day under your thumb mid-scroll is a
worse failure than an extra tap. `useSwipe` was deleted with it.

### 3.x · Four months back

`SEARCH_BEHIND_DAYS` 60 → 120, ahead unchanged at 30. Widening the past is
cheap in a way widening the future is not: the past does not change, so once
the index holds a day it never needs that day again — four months back costs a
one-time backfill rather than ongoing requests. `PAST_SAMPLED` gains a fourth
range so the cold-index fallback still reaches the new edge instead of quietly
stopping at 80 days.

### 3.x · Themes as a ladder, not a palette

Every theme's background dropped, by a different amount each, so the set now
runs lightest to darkest and the picker lists it in that order:

| | Background | Was |
| --- | --- | --- |
| Vapor | 4.5% | 5% |
| Neon | 4.25% | 5% |
| Matrix | 3.75% | 5% |
| Sunset | 3.5% | 5% |
| Mono | 2% | 5% |

Everything **above** the background stayed uniform and came down a flat 2%:
card 8.8%, secondary 12.7%, muted 14.7%, input 16.7%, border 17.6%. That split
is the point — the background is now the one structural variable, so the themes
read as a range of darkness rather than as five unrelated greys, while a switch
still cannot change how heavy the chrome feels.

Matrix also lost its amber. At 48° the venue accent sat far enough from the
142° primary to read as a *second theme* rather than a second voice; 84° lime is
still unmistakably not the primary and still in the family. Its green came down
to `142 69% 46%`, about nine percent off both saturation and lightness.

Glow went from `0.38` to `0.3`, with the blur radii cut with it (10/20 → 7/14,
15/30 → 11/22). Thinner, not dimmer — the complaint was thickness.

### 3.x · Density, third attempt

`tight 0.7 · default 0.86 · airy 0.974`.

Airy was the complaint and 0.974 is eighteen percent below the 1.188 it was.
That number **alone** would have put Airy level with the old Default and
collapsed a three-option axis into two, so Default and Tight came down with it —
the whole ladder shifted rather than one rung sliding into another. Tight moved
furthest in relative terms because its own complaint was the gap between a
card's edge and its contents.

### 3.x · Cards the same height whatever the title does

`EventCard`'s title is `min-h-[2.5em]` **and** `line-clamp-2`. Clamping alone
caps a long title but lets a short one collapse to one line, so a list mixing
the two had cards of two heights and the gaps between them looked arbitrary.

2.5em is exactly two lines at `leading-tight` (1.25 × 2). The first attempt used
2.25em and left a 4px difference — close enough to read as a bug rather than as
a choice, and only visible by measuring six cards in a row. **em, not rem**, or
it stops matching the text the moment the text-size preference moves.

The lineup and head-count lines dropped to `0.6875rem` and moved up under the
venue, so the bottom of a card reads as one block rather than three competing
rows.

### 3.x · Six faces, three slots, and what finally stuck

`System · Legible · Condensed`.

The pattern behind every failed attempt: Bebas Neue, Space Grotesk, Bricolage
Grotesque, JetBrains Mono and Zilla Slab are all *text* faces of similar colour
on the page, so beside system-ui the picker kept offering three shades of one
idea. Anton broke that and broke readability with it — one weight, and that
weight is a poster.

Oswald was the answer to Anton — the same idea in a family that has weights,
pinned at 500 regardless of text size — and it lasted one round before the same
request came back in the same words: *like Impact, but not as bold.*

That repeat is the useful part. Anton missed on **weight**, so the obvious fix
was a face with a weight axis, and Oswald has one. But Oswald missed on
**shape**, and no setting of a weight axis fixes a shape. Oswald is drawn from
Alternate Gothic: narrower than Impact, higher stroke contrast, smaller
x-height, altogether more refined. Turning it up would have made it heavy
without making it Impact. A whole round went into a dial that was never
connected to the complaint.

**Fjalla One** is now in the slot: a grotesque rather than a gothic, flat
terminals, the big x-height and short extenders that give Impact its density,
at a medium weight instead of a black one.

It ships exactly one weight — the thing that sank Anton — and that is fine
here, because the single weight *is* the target rather than something to walk
back from. `font-weight: 400` is stated rather than inherited for that reason:
the headline rules elsewhere ask for 600, and asking a family with no bold for
one gets a synthesised smear rather than a graceful fallback. The layout suite
now asserts the 400 specifically, so a reappearance of 600 fails loudly instead
of shipping as a slightly blurry heading.

Impact itself sits in the fallback chain, which it did not before. If the
webfont never arrives, the nearest thing on Windows or macOS is the face this
slot was always imitating — better than Arial Narrow, which is condensed
without being a display face at all.

Headings only; body stays system-ui.

One thing not verified: **Google Fonts is unreachable from the sandbox**, so
`document.fonts` is empty there and no automated check in this repo proves the
glyphs render — `getComputedStyle().fontFamily` reports the *declared* stack
whether or not the file loaded. That was equally true of Oswald and of Plex; it
is worth knowing that the font assertions are about the CSS, not the pixels.

### 3.x · The search bug where a typo beat the correct spelling

Reported as "my friend played last week, `sergio` finds nothing, `aergio` finds
him". That is not a wrong-fuzziness problem — it is the exact-spelling path
being **strictly weaker** than the typo path, and the cause was one line:

```ts
if (hits.length === 0) { /* widen */ }
```

The two paths search different corpora. SQL `like` sees the whole table but
returns a capped, date-ordered slice and cannot do edit distance. The in-memory
scan sees a bounded slice but applies all three passes. A typo produced zero
hits and therefore *earned* the wider pass; a correct spelling that found one
irrelevant event cleared the gate and never widened at all.

The widened scan now runs on every search. It costs one bounded query.

**Second cause, same symptom:** `search_key` is a snapshot computed when a row
is written. RA announces parties before lineups, so an event indexed early
carries a key with no DJ names in it while its `artists` column is correct. SQL
misses it; the in-memory pass, which reads the live fields, does not. Another
reason the widened pass cannot be conditional.

**Third cause, unrelated to the gate:** `PAST_SAMPLED`'s nearest range `[14, 4]`
was a ten-day span fetched as *one* 100-row page, and NYC produces ~100 rows a
day — a ten-percent sample of exactly the days people ask about. `PAST_DAYS_EXACT`
is now 10 (a day per request), and the sampled ranges are weighted 3/2/1/1 pages
nearest-first.

**Fuzzy is now word-by-word on both sides.** It always split the haystack; it
never split the query, so "reade truthh" folded to one eleven-character key
within one edit of nothing. A typo in a two-word DJ name — the common shape in
this scene — could not be found at all.

**Testing this needed a stubbed database.** The first regression test was
written against the normal harness, passed against the *unfixed* code, and
proved nothing: with no `DATABASE_URL` both index functions return empty, so the
gate was unreachable. `tests/unit/searchIndex.test.ts` mocks `eventCache` and
was verified to fail against the old gate before being kept.

### 3.x · A vocabulary for vibe words

RA exposes **no genre field** — the searchable text is title, venue and lineup.
`api/_lib/vocab.ts` expands a query into what promoters actually call those
nights: `after` → afterhours/sunrise/morning, `queer` → the words parties use
instead, `techno` → tekno/industrial/hardgroove.

Query side only, never the haystack, so adding a word can widen results but can
never change what an existing exact search returns. It is a vocabulary, not a
classifier — wrong sometimes in both directions, which is fine for a search box
you are scanning and would not be fine for a filter chip claiming a fact.

**Not a curated list of parties.** The moment it starts naming who counts as
queer techno it is an editorial position maintained by hand and wrong within a
season.

### 3.x · Flyers, and what offline can honestly promise

Four caches now: `ra-shell-v1`, `ra-assets-v1`, `ra-data-v1`, `ra-img-v1`.

**Images.** Cache-first, capped at 300 entries — sized off the priority window
(three weeks back, one week ahead, ~10 flyers a night). Eviction is genuinely
LRU: a hit is deleted and re-put so it moves to the back of insertion order,
which keeps the priority window resident *by virtue of being what people
reopen* rather than by per-entry date bookkeeping in the worker.

`images.ra.co` is the one deliberate exception to "leave other origins alone",
cached as an opaque response; `/api/image` is checked for a real 2xx.

**Perceived speed** is three separate things, and only one of them is the
worker. First-viewport thumbs upgrade themselves from `lazy` to `eager` +
`fetchpriority=high` in a synchronous layout effect, before the browser's own
lazy-load scheduler acts. `usePrefetchEventImage` warms a flyer on
hover/touchstart, mirroring what `usePrefetchEvents` already does for data —
touchstart fires well before the click, so the image is usually in flight
before the sheet opens. Text is never blocked on any of it.

**Data.** `MAX_DATA_ENTRIES` 60 → 200, covering the 150-back/30-ahead window. A
cache miss while offline now returns a well-formed `{ events: [], count: 0,
stale: true }` rather than a 503, so it lands in the empty state and the
"Saved listings" banner the app already has instead of the red error screen.

**What offline cannot do, stated rather than faked:** keep a playing SoundCloud
set alive. Playback runs inside the provider's own cross-origin iframe — a
separate browsing context this worker has no scope over. There is no way to make
that traffic replayable without either heroics or a false claim, so the file
says so.

### 3.x · The backfill was the bottleneck, not the window

Widening search to five months back is arithmetic; making those days *actually
searchable* is the cron. It ran 14 days a night against a 181-day window, so a
cold index took **thirteen nights** to become useful — and for all thirteen,
search answers "nothing found" for anything older than a week, which is
indistinguishable from a broken search.

Now 60 days a run, `CONCURRENCY` 6, `TIME_BUDGET_MS` 50s under a `maxDuration`
raised to 60s for this route alone. Three nights.

The earlier comment argued against raising `maxDuration` because a background job
can simply take another pass tomorrow. That is true and it was still the wrong
call: "tomorrow" times thirteen is the entire problem, and this endpoint is
bearer-gated and runs once a day, so a longer ceiling costs nothing anyone else
shares.

Its window also only ran backwards, `-150 … 0`. Future days do get indexed by
anyone browsing them, but "somebody browsed it" is not coverage — a quiet
Wednesday three weeks out is precisely the day nobody opens and search then
cannot answer for.

### 3.x · The green build that was a 500

That widening shipped broken and nobody noticed for a week. `api/backfill.ts`
used `SEARCH_AHEAD_DAYS` and never imported it, so every call threw a
`ReferenceError` before it reached a single day.

Nothing caught it, and the reason is worth writing down: **Vercel builds the
API with esbuild, which strips types without checking them.** A type error is
therefore not a build failure — the deploy goes green and the endpoint 500s.
Meanwhile `npm run test:all` ran eight suites over the *front end* and passed,
because none of them call this route.

`test:all` now begins with `npm run typecheck`. It is the only check in the
project that reads the API at all, and it was sitting one script away from the
one command anyone runs.

The narrower lesson: a passing test suite is evidence about the code the suite
executes. For serverless routes nothing executes locally, so `tsc` is not a
style gate there — it is the entire test suite.

### 3.x · The SoundCloud timeline was echoing a guess

Two bugs, both visible on a phone, both invisible to a green suite.

`set.duration` is the resolver's metadata — a seed, so the bar has *a* length
before the widget will give one. The adapter asked `getDuration` once, at READY,
and then handed whatever it got to every progress tick for the rest of the
track. READY only means the widget will accept commands, not that it has parsed
anything, so it frequently answers **0** — and when it did, the seed survived
and every later tick re-asserted it. A two-hour set on a forty-minute guess pins
the playhead at the far right after forty minutes and stays there.

Every other adapter in `lib/players/` re-reads its duration as it plays. This
one was the outlier, and it is the priority provider.

It now asks again on **PLAY**, which is the first moment the track is definitely
parsed, and derives the length on every tick from `relativePosition`, which
`PLAY_PROGRESS` has carried all along (`currentPosition / relativePosition`).
The arithmetic is the backstop rather than the primary: it needs 1% of the track
to have played, which on an hour-long mix is the first thirty-six seconds.

The second half: the handle is deliberately reused across tracks — that is what
makes the second set start on one tap — but reuse means *one* progress binding
serves every track, and the outgoing one keeps emitting after `load()` is
called. Those late ticks landed as the new track's position, so skipping into a
set opened its timeline wherever the previous one had reached. Progress is now
dropped while a swap is in flight, and `start()` emits an explicit zero rather
than waiting for the first real tick.

**Why the suite could not have caught either**, which is the transferable part:
the fake widget answered `getDuration` correctly on the first call, and the
metadata fixture happened to equal the widget's length *exactly*. So a timeline
that ignored the widget entirely and echoed the seed back still measured
correct. A stub that is more cooperative than the real thing is not a stub, it
is a second implementation that agrees with you. It now answers 0 until parsed,
carries `relativePosition`, and fires the stale in-flight tick; the fixture
disagrees with the widget on purpose.

### 3.x · Names whose words are all too short to typo

An audit of the matcher turned up two misses with one cause. A word must be five
characters before a single edit is allowed to match it — below that an edit
matches half the city — and that filter ran on the **haystack** as well as the
query. "Bossa Nova Civic Club" therefore contributed only `bossa` and `civic`,
and "DJ Koze" contributed *nothing at all*, which made it unreachable by any
typo whatsoever. `bosa nova` and `dj kose` both returned empty.

Adjacent word **pairs** now join single words in the pool: `bossanova` is one
edit from `bosanova`, `djkoze` one from `djkose`. Pairs only — a full title's
key is far too long to be within one edit of anything anyone types, and the cost
stays linear in a field's words rather than quadratic.

Widening a fuzzy pool is exactly how a search becomes a sieve, so the negatives
are asserted alongside: two edits away stays two edits away, an unrelated name
returns nothing. Probed the rest of the surface while in there — accents, leet
venues (`h0l0`), vibe words, promoters in titles, multi-word typos — and it
holds.

**Dates are still not searchable.** A weekday query would match a seventh of a
166-day window, and "what is on the 15th" is what the date rail and the calendar
already answer.

### 3.x · Venues that never had an address

The address sat below the map and appeared only when Nominatim produced a label,
so the venues that most need one — the warehouse, the loft, the boat, none of
which a street-address geocoder can place — showed nothing at all.

RA has them, because a promoter typed them in. `/api/venue` now takes an RA
venue id (newly carried on the events payload) and asks. Two decisions worth
keeping:

- **A second request, not a field on the listings query.** Nothing else in the
  app touches this part of RA's schema; a mismatch in the listings query would
  take down every event in the app rather than one line of one sheet. Every
  failure in it is caught and means "no address".
- **RA's address is handed *back* to the geocoder** when the venue's name got
  nowhere. A street address is precisely what Nominatim is good at, so an
  unplaceable venue becomes a pin, a distance, and a ride with a real drop-off.

That refactor introduced a cache bug on the way through, which is the part worth
remembering: with both upstream calls swallowing their own failures, a timeout
returned a perfectly valid body with no coordinates — and this response is
cached for **a month**. A five-second Nominatim blip would have pinned a venue
as unmappable until September. Geocode results now report whether the geocoder
answered *at all*, separately from whether it had anything, and a degraded
answer takes a five-minute cache.

The sheet: address first and always, bold, in `--foreground` rather than
`--venue` (repeating the name's hue read as one wrapped title). Distance in
parentheses, not bold — a qualifier on the address, not a second fact. Then
Uber, Lyft, maps, always all three.

The geolocation permission is new and narrow. The ride links still do not ask —
`pickup=my_location` hands that to Uber and Lyft, who ask anyway. "How far is
it" is different because nothing else can answer it, so it asks once, only from
this sheet, and every refusal resolves to no parenthesis and no explanation.

### 3.x · Preferences: four themes, two sliders

Mono is gone; back to the four this app shipped with. It was the only theme with
no hue, which was the idea and also the problem — every other theme here is a
mood you pick for a night out — and at 2% it broke the ladder whose next-darkest
was 3.5%.

Typography joined Text size as a slider. Three faces ordered by departure from
the system default is the same shape of choice as six sizes: "one further" and
"that one" are both real thoughts, and buttons only serve the second. The names
stay under the ticks, each set in the face it selects.

And the panel stopped closing while you used it. The rule was "anything that is
not a button, link or input closes the sheet" — fine when every setting was a
button, wrong the moment two became sliders, because a slider is *surrounded* by
things that are none of those. A finger leaving the track a few pixels high shut
the panel mid-adjust. The options are one `data-controls` region now; closing
takes a deliberate tap past the end of them.

### 3.x · A hidden screen behind the logo

Open Customize, close it, tap the logo twenty-six times in a row.

The counting is a pure function in `lib/secretTaps.ts` and unit-tested away from
the DOM, because every interesting case is about *time*. "In a row" is a 1.5s
window between taps — without it the counter is a lifetime tally and the screen
eventually opens by accident, which is a trap rather than a secret. A tap while
disarmed *clears* the run rather than merely not counting, so a near-complete
run cannot be banked and finished after reopening the panel.

Counter and armed flag are refs, not state: twenty-five of every twenty-six taps
change nothing visible, and state would re-render the header and every date chip
under it once per tap to display the same thing.

`DividedBoxes` renders through a portal into `document.body`, which is not a
preference — **`backdrop-filter` creates a containing block for fixed-position
descendants**, and the header it is triggered from has one, so rendered in place
a full-screen overlay is trapped inside the header's box.

### 3.x · The green build that was a 500

`api/backfill.ts` used `SEARCH_AHEAD_DAYS` and never imported it, so every call
threw a `ReferenceError` for a week.

**Vercel builds the API with esbuild, which strips types without checking them.**
A type error is not a build failure — the deploy goes green and the endpoint
500s. Meanwhile `test:all` ran eight suites over the front end and passed,
because none of them call that route. `test:all` now begins with `npm run
typecheck`. For serverless routes nothing executes locally, so `tsc` is not a
style gate there — it is the entire test suite.

### 3.x · The date rail slid on load

Reported as the rail opening on the wrong days: three nights of history to the
left of tonight instead of one.

The end state was always correct. The effect that parks the selected chip in the
second slot worked, and if you waited it arrived — it just animated getting
there, on mount as well as on a date change, and for the first few hundred
milliseconds the strip sat on a fortnight of history and slid. What you see on
load *is* the journey.

First placement is now instant, every later one still animated. On load there is
nowhere to animate from; after that, a date change is a move from somewhere to
somewhere and the animation shows which direction you went.

The value is `"instant"`, not `"auto"`, and that is the part that would be
easy to get wrong twice: the rail carries `scroll-smooth`, and `auto` means
*defer to the CSS*. Only `instant` overrides it.

Tonight's chip also now reads **Today** instead of its weekday. Measured against
`currentNight()` rather than the calendar date, like everything else here — at
2am on the 18th it marks the 17th, because that is the night still in progress.
The label survives navigating away, so it stays a landmark to come back to. It
is set a size smaller with the tracking dropped: five characters in a box built
for three, and wrapping would make one chip taller than its neighbours and put a
step in the middle of the rail.

**The first version of this test passed against the bug**, which is the third
time this session. It read the rail once, after a wait long enough for the
smooth scroll to have finished, so it asserted the end state — the half that was
never broken. It now samples every 20ms across the first half-second and fails
if the rail is ever somewhere else; sabotaged back to `"smooth"`, it reports
"still moving at 0ms".

### 3.x · YouTube and Discogs removed

Both were resolvers gated on an API key nobody had set. In practice that meant
YouTube contributed **no sets at all**, and Discogs contributed no profile —
while the Discogs *link* was rendered regardless, because `buildFallbackLinks`
supplied a keyless search URL. "Search releases" is a link that hands the work
back to the reader on a page whose entire premise is that it already did it.

Removed rather than disabled. A dead path behind an unset environment variable
is the kind nobody notices has rotted, and there were four of them: the two
resolvers, a YouTube player adapter, and a provider slot in every union,
icon map and label table in the app.

What went: `resolveYouTube`, `resolveDiscogs`, `lib/players/youtube.ts`, the
`youtube` member of `SetProvider`, the `Discogs` member of the bio-source
union, `discogsUrl` on `ArtistLinks`, the Discogs entry in `buildLinkList`, and
both flags from `/api/health`.

What stayed: **the `discogs_url` column in `artist_links`.** Dropping it needs a
migration run by hand on a phone, and an unused nullable column costs nothing —
so the reads and writes stopped and the column did not. If the feature comes
back it is already there.

Both are written up in ROADMAP.md with the reason each is not simply a matter of
adding the key back:

- **YouTube** is a video host, so a "DJ set" there is as often a fan rip, a
  tracklist slideshow or an hour of festival stream as the artist's own upload,
  and the Data API offers nothing to tell them apart beyond the title — the
  exact signal `titleMentions` was already found too weak to trust alone.
- **Discogs** is worth having for a different job than it had. Its value is not
  a link but the *identity graph*: aliases, group memberships, name variations.
  That is the hard problem in `isPlausibleMatch`, where "Anthony Naples" and
  "AN" are the same person and nothing in the pipeline knows it. Wire it into
  name resolution rather than the link list.

### 3.x · The search field under the keyboard

Tapping search raised the keyboard *over* the field it belongs to.

**A phone has two viewports and they disagree the moment the keyboard opens.**
The *layout* viewport is what `position: fixed` and `100vh` are measured
against, and it does not change. The *visual* viewport is what you can see, and
on iOS the keyboard covers the bottom of the layout viewport without shrinking
it. A sheet pinned to `bottom: 0` and sized in viewport units therefore puts its
lower half behind the keyboard.

**`dvh` does not rescue this, despite reading as though it should.** The
"dynamic" is the browser's own collapsing toolbars, not the software keyboard:
`100dvh` with a keyboard open is still the whole window. The comment that used
to sit on this sheet asserted the opposite — *"the dynamic viewport shrinks when
the keyboard opens"* — and that wrong sentence is why it shipped.

Two systems were also moving the same element. vaul has `repositionInputs`, on
by default, which sets inline `height` and `bottom` in px from `visualViewport`;
our classes set their own from `dvh`. Inline wins, `max-height` from the class
still clamps, and the result is a sheet whose height and offset were computed by
different arithmetic. It is now off for the search sheet — the only one with a
field — and this app does the positioning, because this is the side that can
also see `--player-h`.

`useViewportVars` publishes two numbers at the app root:

- `--vvh` — the visible height.
- `--kb` — how much of the layout viewport's bottom is covered. Zero without a
  keyboard, so every rule using it is inert until it matters.

`--kb` subtracts `visualViewport.offsetTop` as well as its height, because iOS
*also* scrolls the visual viewport within the layout viewport; without that term
a scrolled viewport reports a taller keyboard than exists.

Then: every bottom sheet gets `bottom: max(var(--player-h), var(--kb))` — with a
keyboard up the transport is behind it and unreachable, so reserving room for
both would reserve it twice. The search sheet's height becomes
`min(88dvh - player, var(--vvh))`, which reads as the two cases it is: no
keyboard and it is exactly what it always was; keyboard up and it becomes
precisely the visible area, top flush with the top of the visual viewport.

Both halves are needed and the tests now prove it separately. Sabotaging the
lift alone leaves the field behind the keyboard; sabotaging the shrink alone
overshoots and pushes it to **y = −173**, off the top — and the first version of
that check only guarded the lower bound, so it passed a different broken layout.
It checks both bounds now.

One test artifact worth remembering: measuring right after changing the height
reported the sheet 7px low, then 9px, then 8.65px. A drifting non-integer offset
is an animation, not a bug — vaul re-runs its transform ease on a height change.
The check waits for the transform to settle instead of guessing a duration.

**Not verified on iOS.** Chromium has no software keyboard, so what the suite
drives is the mechanism: it sets `--vvh` and `--kb` by hand, which is exactly
what a keyboard opening does to them. If the sheet does not move for those it
will not move for a real one — but the reverse is not proven from here.

### 3.x · Four months of history came out the wrong end

Reported as two things — "natias should find Matias" and "it isn't searching
back the months in history". They were one bug wearing two hats, plus a second
bug underneath.

**`String(row.event_date).slice(0, 10)`.** A Postgres `date` comes back from the
Neon driver as a **JavaScript Date**, and `String(new Date("2026-05-24"))` is
`"Sun May 24 2026 00:00:00 GMT+0000"`. Slicing ten characters gives
`"Sun May 24"`.

Every date comparison in this app is a string comparison on those ten
characters, and **every letter sorts above every digit** — `"Sun May 24" >
"2026-08-22"` is true. So every event that came from the index was classified
as *upcoming*, whatever month it was in, and search's `past` list could only
ever hold the handful of days fetched live from RA. The history was indexed,
matched correctly, and came out under the wrong heading. Production showed it
plainly: a May event returned in `upcoming`, with `"date":"Sun May 24"` on it.

The old comment said the column "comes back either as a bare day or an ISO
timestamp depending on the driver" — two cases, neither of which was the one
that happens.

**`FUZZY_SCAN_LIMIT = 1200`, ordered `event_date desc`.** SQL does substring and
leet-folding; edit distance cannot happen there without `fuzzystrmatch`, so a
typo'd term needs rows in memory. The window runs 45 days into the *future*, and
descending order spends the whole budget starting there: at NYC's volume the
scan reached from +45 down to roughly +30 and stopped. **The past was never in
memory at all**, so no typo could ever find a gig that had already happened.
`searchCachedEvents` had the same shape, capped at 60 — a DJ with a busy autumn
would hide their own summer.

Both now order by `abs(event_date - current_date)`, growing outwards from
tonight, and the scan limit is 5000 — about ±50 days at fifty events a day. The
old comment claimed "newest first", which is exactly what `desc` does and
exactly not what was wanted.

That second bug is why "natias" appeared to be a fuzzy-matching failure. The
matcher was fine: with the past in memory, `natias` → `Matias Jofre` is one
substitution and it lands. Nothing about edit distance needed changing.

**Testing note, and it is the fourth time this session.** The first version of
the guard for this was three tests in `searchIndex.test.ts` asserting that a
past-dated indexed event is filed as past. They pass against the *unfixed*
`isoDay` — eventCache is mocked in that file, so `toEvent` never runs and the
fixtures hand over well-formed ISO dates. The real guard is
`eventCacheDates.test.ts`, tested against a reverted `isoDay` and confirmed to
fail four ways. The comment in the first file now says what it does and does not
cover, because the obvious reading of it is wrong.

### 3.x · Density moves air, not objects

The ladder came down again — 0.6 / 0.86 / 1.12 → **0.42 / 0.7 / 0.95**. The
spread between the ends is unchanged at 0.53 and the steps stay near-symmetric
around Default, so the axis still means something; the whole thing simply sits
lower. Airy now sits barely above the old Default, which is the intended shape:
what used to be the comfortable middle is the loosest this app goes. Two rounds
have ended in "less space", and the one time it went the other way (1.188) the
verdict was "sprawling".

**The interesting part is what that exposed.** Tailwind shares one scale between
padding and width/height, and this app multiplies that scale by the density
preference. So `w-24` on a flyer and `w-3` on a map pin were being scaled along
with the gaps around them. At 0.6 that was survivable; at 0.42 the flyer came
out **40px** and the pin a five-pixel smudge, on a screen whose entire job is
showing flyers — and "don't shrink the images" had already been said twice.

Density is how much *room* things have, not how big they are. Flyers, icons and
the header row are now literal px and hold at every setting: flyer 80px, header
40px, icons 20/12/11. The card still breathes — 96px at Tight against 109px at
Airy — which is the whole axis doing its job on the air rather than the content.

The header is fixed for a second reason: it was asked for directly, and the
logo's own padding was never the problem. The three icon buttons are taller
than the wordmark, so *they* set the row height; padding the logo without
touching them left Airy's header 48px with the logo floating in the middle. All
four are pinned now. The buttons come in under the 44px tap target and that is
a considered trade — they sit at the top of the screen with nothing to mis-hit,
and a header reserving 44px three times over is most of what this removed.

Also: the flyer in the details sheet closes it explicitly now. The dead-space
handler already did that, but only by accident of an `<img>` not being a
control, and vaul reads a pointer-down on its content as a possible drag —
which is exactly what a tap on a large image looks like. Saying it outright
costs one handler.

### 3.x · The index never looked at a day twice

Found while chasing why `jofre` returned nothing after the date and scan fixes
had both landed and `matias` was reaching back to May.

`missingDays` finds days with **no rows**, and the backfill only ever filled
those. So a day was fetched once and then frozen at the moment it was fetched.
That is fine for everything that does not change and wrong for the one thing
that does: **RA announces a party first and its lineup later**, and `search_key`
is computed at write time. A day indexed on announcement carries a key with no
DJs in it, permanently.

The `artists` column is correct — the in-memory pass reads it — but that pass
only reaches about fifty days out. Beyond that, SQL `like` on the key is the
only path, and a key cannot match a name it never contained. The symptom is a
DJ who played three months ago being unfindable by name while their event sits
correct in the database.

It also meant the job finished in two seconds with a fifty-second budget.

`staleDays` orders indexed days by `max(seen_at)` ascending, and the backfill
now spends whatever is left after gaps on re-fetching the oldest-looked-at.
Gaps keep priority — a missing day is worse than a stale one. At sixty days a
run over a 166-day window, everything is refreshed about every three nights.

`remaining` counts only gaps closed, not days touched, which needed the targets
to carry whether they were a gap; otherwise a run that refreshed forty days
would report forty gaps closed.

**Whether this is why `jofre` is empty is unknown**, and worth being straight
about: it may equally be that Matias Jofre has not played NYC inside the
120-day window. The stale-key gap is real either way and was worth closing on
its own.

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
4. **No error boundary.** A render crash blanks the page. Now the last
   all-or-nothing failure left in the app, since RA outages degrade to saved
   listings and a dead network degrades to the offline cache.
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
