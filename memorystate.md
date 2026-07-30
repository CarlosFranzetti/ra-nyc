# memorystate.md

Running project journal: current state, decisions and *why*, and what's still
open. Written so that a person — or an AI agent — picking this repo up cold can
get productive without re-deriving anything.

**Keep this file updated.** When you make a decision that a future reader would
otherwise have to reverse-engineer from a diff, append it to the log.

**Last updated:** 2026-07-30
**Branch:** `claude/lovable-vercel-migration-hyp0a1`

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
| **Hosting** | Vercel (migrated from Lovable) |
| **Build** | ✅ `npm run build` passes |
| **Types** | ✅ `npm run typecheck` passes (app + api) |
| **Dev server** | ✅ `npm run dev` on :8080, serves UI + `/api` |
| **Database** | Optional Neon, caches artist links only. See [DATABASE.md](./DATABASE.md) |
| **Env vars** | None required; `DATABASE_URL` and `DISCOGS_TOKEN` optional |
| **Tests** | ❌ None committed (UI verified ad hoc in headless Chromium) |
| **Analytics** | ✅ Vercel Analytics, no cookies |
| **Auth** | None, none planned |

### Stack

React 19 · TypeScript 5.9 · Vite 7 · Tailwind 3.4 · TanStack Query 5 ·
React Router 7 · date-fns 4 · lucide-react · vaul · react-day-picker ·
Vercel Analytics · two Vercel Node 22 functions.

### Routes

| Route | Kind | Purpose |
| --- | --- | --- |
| `/` | SPA | The only page. Date strip + event list |
| `/api/events?date=YYYY-MM-DD[&area=8]` | Function | Cached proxy to RA GraphQL |
| `/api/image?u=<https url>` | Function | Flyer proxy fallback, host-allowlisted |
| `/api/artist?id=<ra id>&name=<name>` | Function | Resolves a DJ to sets + profile links |
| `/artist/:id?name=<name>` | SPA | Artist page: set player, sets list, profiles |

---

## 3 · Decision log

### 2026-07-29 — Migrated Lovable → Vercel

Full detail in [MIGRATION.md](./MIGRATION.md). The decisions worth remembering:

**The repo did not build.** `package.json` had `tailwindcss@^4` while every
config and stylesheet was written for v3. `npm run build` failed outright on a
clean checkout. Lovable's sandbox hid it.
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
app. Pure Lovable scaffolding. Also dropped `class-variance-authority` (unused).
→ This is also the direct answer to "do I even need a database?": **you already
had one, and the app never touched it.**

**Wrote a Vite dev plugin** (`vite.config.ts`) that mounts `api/*.ts` as routes,
running the exact handler Vercel runs — Node's `(req, res)` is both what Vercel
invokes and what connect middleware provides, so no adapter is needed.
→ Chosen over requiring `vercel dev` so that `npm run dev` alone gives a
faithful local environment. `vercel dev` still works if preferred.

**Changed `server.host` from `"::"` to `true`.** Lovable's IPv6-literal bind
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
[MIGRATION.md §7](./MIGRATION.md#7--troubleshooting-the-import).

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

The user supplied `LOVES.zip`: a full export of the original Lovable project,
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

### 2026-07-30 — Subdued artist page, 3 sets, 5 links, and a real speed pass

**Subdued.** The listings screen is the loud one — glows, stagger, neon accents —
and that's right for it. The artist page is a *read*, so it now stays quiet: flat
card surfaces, plain borders, muted labels, and the accent colour reserved for the
one genuinely interactive control (play). The player lost its glow ring and sits
on `bg-card`.

**Sets capped at 3** (`MAX_SETS`), down from 4. Page order is now sets → bio →
links, which matches how you actually read it.

**5 links under the bio** (`MAX_LINKS`), in a new `links` array built server-side
by `buildLinkList`. Providers: Discogs, SoundCloud, Mixcloud, **Bandcamp**,
**Beatport**. RA is excluded because it *is* the bio — its link is the bio's
attribution. Resolved profiles sort ahead of search URLs, so a real Discogs page
outranks a Beatport query. Neither Bandcamp nor Beatport has a keyless artist
search API, so those are honestly labelled "Search releases" rather than dressed
up as profiles.

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

Verified: 14/14 in mobile Chromium — 3 sets, exactly 5 links, resolved-first
ordering, Bandcamp and Beatport present, bio attributed and clamped, subdued
player styling, prefetch-on-hover, and cache restore before the network settles.
Plus 5/5 cap and ordering assertions against the compiled module.

### 2026-07-30 — Multi-source sets: SoundCloud first, 4 per DJ, plus bios

Requested: sets from SoundCloud then Mixcloud then others, 4 total per DJ, plus a
bio, plus Discogs if available.

**The SoundCloud constraint, stated plainly.** SoundCloud has the most DJ sets
and is now first in preference order — but their API registration has been closed
to new apps for years. The common workaround is to scrape a `client_id` out of
their web bundle; **deliberately not done here.** It circumvents an access
control they put up on purpose and breaks every time they rebuild. So SoundCloud
search is opt-in via `SOUNDCLOUD_CLIENT_ID` (only useful if you already have one).
Without it, SoundCloud degrades to a search link. Embedding an
*already-resolved* SoundCloud URL needs no key, so playback is identical either
way — only discovery is gated.

**Providers now, in preference order:**

| Provider | Search | Embed | Key |
| --- | --- | --- | --- |
| SoundCloud | `api-v2` | widget | required (`SOUNDCLOUD_CLIENT_ID`) |
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

### 2026-07-29 — Recovering the original Lovable app

The user reported missing "themes and preferences". They were right, and the
earlier conclusion here — that no such feature ever existed — was wrong. It was
drawn from this repo's git history, which turned out not to be the whole story.

Lovable's project edit log (`list_edits`) still records commit `27c90a2`
(2026-01-29), whose message describes the real original:

> shadcn/ui components with Tailwind CSS · **Dynamic theming system (4 colour
> themes, 3 layout densities)** · TanStack Query with aggressive prefetching ·
> **Supabase Edge Function as GraphQL API proxy with rate limiting** · **Three
> navigation modes: standard, tabs, minimal (swipe-only)** · event cards,
> details sheets, and skeletons

**That code is gone.** Verified three ways:
- Lovable `read_file`/`get_diff` at those SHAs → `404 commit_not_found`; the
  objects were dropped when `531b20e "Recreated project scaffold"` ran.
- `git fetch origin 27c90a2` → `upload-pack: not our ref`.
- `refs/pull/*` on GitHub holds only PRs 1–3, all from this migration. The old
  log shows *different* PRs also numbered 1 and 2, so the GitHub repo was
  deleted and recreated — which is what wiped both lineages.
- The published build at `ra-nyc.lovable.app` returns 403, so the bundle can't
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

Reported as "touch response is quite different than the original on Lovable".
Investigated; the component code is byte-identical to the Lovable version, so
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
— checked all 15. If the Lovable sandbox has unsynced work, it needs to be
exported; the Lovable MCP connector requires an approval this session could not
grant.

### 2026-07-29 — Event images never loaded

Once events rendered, the flyers didn't. `EventCard` built the URL as
`` `https://images.ra.co/${filename}` ``, but RA's `images[].filename` is
usually **already an absolute URL** — so this produced
`https://images.ra.co/https://images.ra.co/…`, which 404s. Carried over from
the Lovable build; it had never worked.

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

## 4 · Map of the code

```
api/_lib/ra.ts          RA GraphQL client. The query, the browser-like headers,
                        error mapping, date validation. Server-only.
api/events.ts           The one endpoint. Validates, calls, caches, maps errors.

src/pages/HomePage.tsx  Selected-date state + loading/error/empty states.
src/components/         DateSelector (8-day strip), EventCard.
src/hooks/useRAEvents   TanStack Query over /api/events.
src/types/event.ts      RAEvent — the api ↔ src contract.
src/index.css           Tailwind directives + HSL design tokens.

vite.config.ts          Build config + the dev-only api/ route mounter.
vercel.json             Runtime, SPA rewrite, asset cache headers.
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

Carried over from the Lovable build unless noted.

1. **Timezone.** `HomePage` seeds from `new Date()` — the *visitor's* clock, not
   New York's. Someone in London at 01:00 sees NYC's tomorrow as "today".
   Related: when does the night roll over? A 2 a.m. set belongs to the previous
   evening in how people talk, but not in how the date strip counts.
2. **Hard 50-event cap.** RA's first page only; no pagination. Busy Saturdays
   are being silently truncated.
3. **RA may block Vercel's egress IPs.** Untested from production —
   `ra.co` is unreachable from the sandbox this migration was built in
   (`connect_rejected` at the network policy), so the upstream call is verified
   only by its error path returning a correct 502. **Check `/api/events` on the
   first deploy.** Mitigations, in order: raise `s-maxage`; warm the cache with
   a cron job; fall back to a stored snapshot (→ database).
4. **No tests.** Highest-leverage next task; see ROADMAP §0.
5. **No error boundary.** A render crash blanks the page.
6. **RA has no published API terms.** This is an unofficial client that links
   back to `ra.co` for every event and caches aggressively to stay light. If RA
   objects, stop.
7. **Is anyone actually tapping DJ names?** Unknown, and it decides whether
   ROADMAP §2's database phase is worth building. Ship the no-DB version first
   and find out.

---

## 6 · Next actions

1. Import the repo into Vercel and deploy —
   [MIGRATION.md §3](./MIGRATION.md#3--connect-the-repo-to-vercel).
2. Verify `/api/events` against production (issue #3 above).
3. Disconnect Lovable's GitHub integration; delete the empty Supabase project —
   [MIGRATION.md §5](./MIGRATION.md#5--decommission-lovable).
4. Add Vitest + a smoke test (ROADMAP §0).
5. Build search phase 1a (ROADMAP §1). No backend needed.
6. Build the DJ sheet with Mixcloud only (ROADMAP §2, steps 1–2). Still no
   database.
7. Re-read [DATABASE.md](./DATABASE.md) **only** when step 6 produces its first
   wrong artist match that you want to correct by hand. That's the trigger.
