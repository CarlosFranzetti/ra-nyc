# Architecture

## One-paragraph summary

RA-NYC is a static single-page React app plus three serverless functions. The SPA
is built by Vite into `dist/` and served from Vercel's CDN. `api/events.ts` is a
thin, cached, validating proxy in front of Resident Advisor's public GraphQL
endpoint; `api/image.ts` is a fallback proxy for flyer images the RA CDN won't
serve to a browser directly. `api/artist.ts` resolves a DJ to playable Mixcloud sets and profile links.

There is no auth. The only persistent state is one optional Postgres table
caching resolved artist links — absent a `DATABASE_URL` the app resolves live and
behaves identically. User preferences live in `localStorage` and never leave the
device.

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
  image.ts          GET /api/image?u=<absolute https url>
                    Flyer proxy for when the RA CDN refuses a direct browser
                    request. Host-allowlisted, image/* only, 8 MB cap.
                    Fallback path only — see "Images" below.
  _lib/rateLimit.ts Per-IP request budgets. Best-effort by design — see
                    "Rate limiting" below.
  _lib/db.ts        Optional Neon client. Returns null without DATABASE_URL,
                    and every caller falls through to live resolution.
  _lib/artistLinks  Resolves a DJ to sets, a bio and profile links across four
                    providers, with strict match guarding, provider ordering,
                    and read-through DB caching. See "DJ sets" below.
  artist.ts         GET /api/artist?id=<ra id>&name=<name>

src/
  main.tsx          React root + QueryClientProvider + ThemeProvider.
  App.tsx           Router + Vercel Analytics. One route today: "/".
  pages/HomePage.tsx    Date state, loading/error/empty states, event list,
                        swipe handling, drawer orchestration, density classes.
  pages/ArtistPage.tsx  Set player, switchable set list, profile links. Lazy
                        route — most visits never open it.
  components/
    Header.tsx          Sticky blurred bar: title, calendar, settings.
    DatePicker.tsx      8-day strip. Prefetches a day on touchstart/hover, so
                        the fetch is in flight before the tap lands.
    CalendarPopover     Jump to any date beyond the strip (react-day-picker).
    BottomNav.tsx       Bottom bar for the "tabs" navigation style.
    EventCard.tsx       Compact row: 96px thumb, title, venue, time, lineup,
                        "N going", PICK badge. Opens the details drawer.
    EventThumb.tsx      Flyer <img>: CDN-direct → /api/image → venue initial.
    EventDetailsSheet   Full detail in a drawer; lineup as chips (the future
                        attachment point for DJ set playback).
    SettingsSheet.tsx   Theme / density / typography / navigation preferences.
    EventSkeleton.tsx   Shimmer placeholder matching EventCard's geometry.
    EmptyState.tsx      No events for this date.
    ErrorState.tsx      Failure + the API's real message + retry.
    SplashScreen.tsx    Covers first paint until the first day lands.
    SetPlayer.tsx       Mixcloud iframe, mounted only after an explicit tap.
    ui/drawer.tsx       Thin vaul wrapper — the one headless-UI dependency.
  context/
    ThemeContext.tsx    Preferences state, localStorage persistence, and the
                        theme-/density-/type- class writes on <html>.
  hooks/useEvents.ts    TanStack Query over GET /api/events, with +1/+2/-1 day
                        prefetch, and usePrefetchEvents for hover/touch.
  hooks/useSwipe.ts     Touch-based horizontal swipe; ignores mostly-vertical
                        gestures so scrolling never changes the day.
  hooks/useArtist.ts    TanStack Query over GET /api/artist.
  types/event.ts        Event / EventsResponse — the contract between api/ and
                        src/. Keep in sync with api/_lib/ra.ts.
  types/preferences.ts  Theme / density / typography / nav unions + labels.
  lib/utils.ts          cn() — clsx + tailwind-merge.
  lib/images.ts         Builds the /api/image proxy URL.
  lib/formatTime.ts     RA sends ISO or bare HH:mm; renders both as "11pm".
  index.css             The 4 themes, 3 densities, 3 typography variants, glow
                        system, stagger + shimmer animations, touch base rules.
  assets/ra-logo.svg    Splash mark.

vite.config.ts      Vite config + a dev-only plugin that mounts api/*.ts as
                    routes so `npm run dev` behaves like production.
vercel.json         Framework, maxDuration, SPA rewrite, asset headers.
public/             ra-favicon.svg, robots.txt.
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

## DJ sets

`/api/artist` resolves a name to at most **3** sets, preferring providers in this
order:

| Provider | Search | Embed | Key |
| --- | --- | --- | --- |
| **SoundCloud** | `api-v2` | widget | **required** — `SOUNDCLOUD_CLIENT_ID` |
| **Mixcloud** | public API | widget | none |
| **Internet Archive** | `advancedsearch` | `/embed/` | none |
| **YouTube** | Data API v3 | `/embed/` | optional — `YOUTUBE_API_KEY` |

SoundCloud is first because it holds the most DJ sets — but its API registration
has been closed to new apps for years. The tempting workaround is to scrape a
`client_id` out of their web bundle; this deliberately does not, because that
circumvents an access control on purpose and breaks whenever they rebuild.
SoundCloud search is therefore opt-in via a key you already have, and without one
it degrades to a search link while Mixcloud and the Internet Archive still fill
the list. Embedding an already-resolved SoundCloud URL needs no key, so playback
is identical either way.

Every provider yields a plain iframe URL, so playback needs no SDK — only a
per-provider height, since a SoundCloud widget and a YouTube player disagree
about how tall they should be.

**Matching is strict on purpose.** `isPlausibleMatch` requires a normalised exact
match or a clean prefix on names of five or more characters, with RA's
disambiguating suffixes stripped (`"Cosmo (NY)"` → `cosmo`). Free-text titles
(Archive, YouTube) additionally have to mention the artist. A confidently wrong
player — someone else's set under a DJ's name — is worse than an empty list, so a
near miss shows an empty state pointing at search links.

**Links** under the bio are capped at 5 and ranked resolved-profile-first, so a
real Discogs page outranks a Beatport search. RA is excluded from the list because
it *is* the bio — its URL is the bio's attribution. Bandcamp and Beatport have no
keyless artist search, so they are labelled as searches rather than presented as
profiles.

**Bio** is the first available of: RA's `biography`, the artist's Mixcloud
`biog`, their SoundCloud description, or Discogs prose — attributed in the UI to
whichever it came from. RA's field is an educated guess at their schema, so that
query asks for it and retries without it on error; one unknown field fails an
entire GraphQL query.

## Caching and perceived speed

Four layers, cheapest first:

1. **Persisted query cache.** The TanStack cache is written to `localStorage`
   (`ra-nyc:query-cache`, 1-day `maxAge`) and rehydrated on boot, so a returning
   visitor's last day paints on the first frame with no network at all.
   Serialisation is synchronous, hence `throttleTime: 2000` to keep it off the
   main thread mid-scroll. **Bump `buster` whenever an API response shape
   changes**, or restored data will be the wrong shape.
2. **Prefetch before the tap.** Date chips and lineup chips both prefetch on
   `touchstart`/`mouseenter`, which fires well before `click` — the request is
   usually in flight by the time the view mounts. Adjacent days (+1, +2, −1) are
   warmed too.
3. **Edge cache.** Events: 5 min fresh, 1 day `stale-while-revalidate`. Artist:
   1 week fresh, 30 days SWR, since a DJ's platform identity effectively never
   changes. Generous SWR means a cold region or an upstream outage degrades to
   slightly-old data rather than an error.
4. **Optional Neon.** Removes third-party lookups entirely after the first
   resolve. See [DATABASE.md](./DATABASE.md).

### One animation gotcha worth remembering

The ported stylesheet transitioned **`box-shadow` on `*`**. box-shadow cannot be
composited, so every frame of a drawer drag repainted everything on screen. It is
now off the global rule, and only elements that want an animated glow opt in.
`.transition-smooth` uses iOS's sheet curve, `cubic-bezier(0.32, 0.72, 0, 1)`,
which decelerates late so a released drag settles rather than stops; the drawer
also carries `will-change-transform` for its own layer.

## Rate limiting

Both functions apply a per-IP budget before doing any work: **30/minute** for
`/api/events`, **200/minute** for `/api/image` (one screen of listings can ask
for ~50 flyers, and if the CDN blocks direct loads every one arrives at the
proxy). Over budget returns `429` with `Retry-After` and `X-RateLimit-*`.

Ported from the Supabase edge function this API replaced. Three things about it
are deliberate:

- **It is best-effort, not a security control.** Counters live in module memory,
  so they are per *instance*: Vercel runs many concurrent instances and recycles
  them, so a caller spread across instances exceeds the limit and a cold start
  resets the window. A distributed limiter needs a shared store (Upstash /
  Vercel KV) — credentials and a service to operate, which this app deliberately
  doesn't have. If real abuse appears, use Vercel's Firewall rate limiting
  (edge-level, no code, actually global) rather than building one here.
- **It still works, because of where it sits.** The edge cache absorbs nearly
  all normal traffic, so only cache misses reach the function — exactly the
  requests that would otherwise hit ra.co. A visitor clicking through a week
  costs 8. Anything near these limits is not a person browsing.
- **The 429 is `no-store`.** A cached 429 at the edge would be served to every
  visitor, turning one abusive caller into an outage. For the same reason the
  `X-RateLimit-*` headers appear only on the 429, never on the cacheable 200 —
  otherwise the edge would cache one caller's remaining count and hand it to
  everyone.

Malformed requests count against the budget too: the check runs before input
validation, so spraying invalid dates isn't a free bypass.

## Images

RA's `images[].filename` is inconsistent — sometimes an absolute URL, sometimes
a bare path — so `src/lib/raImage.ts` normalises it. Loading the result can
still fail, because `images.ra.co` applies hotlink protection based on
`Referer`/`Origin`, and a browser cannot set either (both are forbidden
headers, the same constraint that forced `api/events.ts` server-side).

`EventImage` therefore degrades in three stages:

1. **Direct from the CDN**, with `referrerPolicy="no-referrer"` — fast, and
   costs us no bandwidth. Sending no referrer at all is often enough, since
   many CDNs reject a foreign referrer but allow an absent one.
2. **Through `/api/image`** on error, which can send the `Referer` the CDN
   wants. Responses are cached `immutable` for a month at the edge; RA flyer
   URLs are content-addressed, so the bytes never change.
3. **Removed** if both fail. Plenty of listings have no usable flyer, and an
   empty slot beats a broken-image icon.

`/api/image` is **host-allowlisted** (`images.ra.co`, `ra.co`, `www.ra.co`),
https-only, and refuses any response whose `Content-Type` isn't `image/*`.
Without those it would be an open proxy and a general-purpose content relay.

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

Colours are HSL triples in `src/index.css`, consumed through
`tailwind.config.ts` (`bg-card`, `text-muted-foreground`, …). Never hard-code a
hex value in a component; add a token instead.

**Themes** are four complete token sets selected by `data-theme` on `<html>`:
Noir, Midnight, Ember, Neon. All four are dark — a light theme has never
existed here, and `darkMode: ["class"]` remains configured but unused. `:root`
carries Noir so the page is styled before React mounts.

**Density** is `data-density` on `<html>`, also written by
`PreferencesContext`. `--density-scale` sets the root font size, so every
rem-based dimension scales together from one variable; `--card-gap`,
`--card-pad` and `--card-image-h` cover what shouldn't scale linearly.
Components consume those directly (`p-[var(--card-pad)]`).

Both are attribute writes on a single element rather than React state threaded
through the tree — changing a theme re-renders nothing.

Layout is deliberately phone-shaped: `max-w-md mx-auto` on the page container.

---

## What is *not* here

- No database, ORM, or migrations. See [DATABASE.md](./DATABASE.md).
- No authentication or user accounts.
- No analytics or tracking.
- No tests yet. See [ROADMAP.md](./ROADMAP.md#0--testing-prerequisite).
- No error-reporting service; function errors go to Vercel's logs via
  `console.error`.
