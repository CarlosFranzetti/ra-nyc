# memorystate.md

Running project journal: current state, decisions and *why*, and what's still
open. Written so that a person — or an AI agent — picking this repo up cold can
get productive without re-deriving anything.

**Keep this file updated.** When you make a decision that a future reader would
otherwise have to reverse-engineer from a diff, append it to the log.

**Last updated:** 2026-07-29
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
| **Database** | None. Deliberately. See [DATABASE.md](./DATABASE.md) |
| **Env vars** | None required |
| **Tests** | ❌ None yet |
| **Auth** | None, none planned |

### Stack

React 19 · TypeScript 5.9 · Vite 7 · Tailwind 3.4 · TanStack Query 5 ·
React Router 7 · date-fns 4 · one Vercel Node 22 function.

### Routes

| Route | Kind | Purpose |
| --- | --- | --- |
| `/` | SPA | The only page. Date strip + event list |
| `/api/events?date=YYYY-MM-DD[&area=8]` | Function | Cached proxy to RA GraphQL |

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
