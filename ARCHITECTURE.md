# Architecture

## One-paragraph summary

RA-NYC is a static single-page React app plus exactly one serverless function.
The SPA is built by Vite into `dist/` and served from Vercel's CDN. The function
(`api/events.ts`) is a thin, cached, validating proxy in front of Resident
Advisor's public GraphQL endpoint. There is no database, no auth, and no
persistent state anywhere in the system.

---

## Request flow

```
┌────────────┐   1. GET /                       ┌──────────────────┐
│  Browser   │ ───────────────────────────────▶ │  Vercel CDN      │
│            │ ◀─────────────────────────────── │  (static dist/)  │
│            │      index.html + JS + CSS       └──────────────────┘
│            │
│            │   2. GET /api/events?date=…      ┌──────────────────┐
│            │ ───────────────────────────────▶ │ Vercel Function  │
│  TanStack  │                                  │  api/events.ts   │
│   Query    │                                  └────────┬─────────┘
│            │                                           │ 3. POST /graphql
│            │                                           ▼
│            │                                  ┌──────────────────┐
│            │ ◀─────────────────────────────── │  ra.co/graphql   │
└────────────┘   4. { date, count, events[] }   └──────────────────┘
                    Cache-Control: s-maxage=300
                    stale-while-revalidate=3600
```

### Step 2 in detail — why a function at all?

The Lovable version called `https://ra.co/graphql` straight from `useRAEvents`.
Three problems, all of which disappear server-side:

1. **CORS.** `ra.co` serves no `Access-Control-Allow-Origin` header. A browser
   `fetch()` to it from another origin is blocked by the browser before the app
   ever sees a response. (It worked inside the Lovable preview only by accident
   of that environment; it is not a property you can rely on in production.)
2. **Forbidden request headers.** The original code set `User-Agent` and
   `Referer`. Both are on the [forbidden header
   list](https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name) —
   browsers drop them silently, so the request RA received did *not* look like
   the request the code appeared to send. RA rate-limits and 403s unbrowser-like
   traffic.
3. **Caching + fan-out.** Every visitor scrolling seven days was seven requests
   to RA *per person*. Now the edge cache collapses that to roughly one origin
   request per (day, 5 minutes) globally.

### Caching policy

`api/events.ts` returns:

```
Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=3600
```

- `max-age=0` — the browser always revalidates; TanStack Query holds its own
  5-minute `staleTime` in memory anyway.
- `s-maxage=300` — Vercel's edge serves a cached copy for 5 minutes.
- `stale-while-revalidate=3600` — for the next hour after expiry the edge serves
  the stale copy *immediately* and refreshes in the background. If RA is down or
  rate-limiting, users still see yesterday's fetch instead of an error.

Static assets under `/assets/*` get `max-age=31536000, immutable` (they're
content-hashed by Vite) via `vercel.json`.

---

## File map

```
api/
  _lib/ra.ts        Server-side RA GraphQL client. Underscore prefix keeps
                    Vercel from exposing it as a route. Owns the query, the
                    browser-like headers, error mapping, date validation.
  events.ts         GET /api/events?date=YYYY-MM-DD[&area=<id>]
                    Validates input, calls _lib/ra.ts, sets cache headers,
                    maps failures to 400/405/500/502/504.
                    Signature is Node's (req, res) — see below.

src/
  main.tsx          React root + QueryClientProvider.
  App.tsx           Router. One route today: "/".
  pages/HomePage.tsx    Date state, loading/error/empty states, event list.
  components/
    DateSelector.tsx    8-day strip: yesterday → +6 days. Weekends tinted.
    EventCard.tsx       Image, title, venue, times, lineup, RA Pick badge.
                        Whole card links to ra.co.
  hooks/useRAEvents.ts  TanStack Query wrapper over GET /api/events.
  types/event.ts        RAEvent / EventsResponse — the contract between
                        api/ and src/. Keep in sync with api/_lib/ra.ts.
  lib/utils.ts          cn() — clsx + tailwind-merge.
  index.css             Tailwind directives + the HSL design tokens.

vite.config.ts      Vite config + a dev-only plugin that mounts api/*.ts as
                    routes so `npm run dev` behaves like production.
vercel.json         Framework, function runtime, SPA rewrite, asset headers.
tailwind.config.ts  Design tokens mapped to the CSS variables in index.css.
tsconfig.app.json   Type-checks src/ (DOM libs, @/* alias).
tsconfig.api.json   Type-checks api/ (Node types).
```

---

## Handler signature

Functions in `api/` export a default handler taking Node's
`IncomingMessage`/`ServerResponse`:

```ts
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>
```

This is not a stylistic choice. Vercel invokes a **default** export in `api/`
with Node's `(req, res)`. The web standard `Request`/`Response` signature is for
**named** method exports (`export function GET(request: Request)`), the Next.js
App Router / Edge convention. Mixing them — `export default` taking a
`Request` — type-checks fine and crashes at runtime, because `req.url` is then
a relative path and `new URL()` rejects it. That cost us a deploy; see
[MIGRATION.md §7](./MIGRATION.md#7--troubleshooting-the-import).

Two rules follow:

1. **Parse the URL with a base:** `new URL(req.url ?? "/", "http://localhost")`.
   The base is discarded; only `searchParams` is read.
2. **Wrap the entire handler body in try/catch.** Anything that escapes becomes
   `FUNCTION_INVOCATION_FAILED` — an opaque 500 with no JSON body, which the UI
   cannot explain to the user.

The happy side effect is that Vite's connect middleware passes these same
types, so `npm run dev` runs the production handler with no adapter in between.

## Type contract

`src/types/event.ts` and `api/_lib/ra.ts` declare the same `RAEvent` shape.
They are deliberately duplicated rather than shared through a path alias,
because the Vercel function bundle and the browser bundle are compiled by
different toolchains with different tsconfigs. **If you add a field to the
GraphQL query, update both files.**

If that duplication ever becomes a real maintenance cost, the fix is a
`shared/` directory included by both tsconfigs — not worth it at this size.

---

## Design system

Dark-only, defined as HSL triples in `src/index.css` under `:root` and consumed
through `tailwind.config.ts` (`bg-card`, `text-muted-foreground`, …). Never
hard-code a hex value in a component; add a token instead. `darkMode: ["class"]`
is configured but unused — there is no light theme yet.

Layout is deliberately phone-shaped: `max-w-md mx-auto` on the page container.

---

## What is *not* here

- No database, ORM, or migrations. See [DATABASE.md](./DATABASE.md).
- No authentication or user accounts.
- No analytics or tracking.
- No tests yet. See [ROADMAP.md](./ROADMAP.md#0--testing-prerequisite).
- No error-reporting service; function errors go to Vercel's logs via
  `console.error`.
