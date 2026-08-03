# RA-NYC

A fast, mobile-first listing of **Resident Advisor**'s New York events. Pick a
day, scan the lineups, tap a DJ to hear them, tap through to RA for tickets.

**Live: [ra-nyc.vercel.app](https://ra-nyc.vercel.app)**

---

## What it does

Every screen is built around one question — *what's on tonight, and is it worth
going?* — so the whole app is a single scrolling list with no login, no signup
and no navigation to learn.

**Listings.** One day at a time, yesterday through the next week, sorted busiest
first with RA Picks flagged. Swipe left or right to change day, or jump to any
date with the calendar. Tap an event for the full flyer, blurb and lineup.

**DJ sets.** Tap any name in a lineup and it resolves that artist to their
SoundCloud and Mixcloud catalogue, newest first, plus a bio and up to five
profile links. Sets play in a transport bar docked at the top — play/pause,
next/previous, scrubbable timeline — and **keep playing while you browse**, so
finding out what someone sounds like doesn't cost you your place in the listings.

**Looks.** Four themes (Neon, Vapor, Matrix, Sunset), three typefaces, three
densities and three text sizes. Venue names carry their own hue per theme, so
where a night is reads apart from when it is. The theme is picked at random each
time you open it. Preferences persist locally; there is no account and nothing is
sent anywhere.

**Search.** The magnifier next to the calendar searches NYC listings by DJ,
party, promoter or venue — upcoming first, then past. Matching is accent- and
leet-insensitive and tolerates a typo, so `bjork` finds Björk and `holo` finds
h0l0. Picking a result jumps the listings to that night and opens it.

**Where it is.** Tapping a venue name opens a map, with a link out to your phone's
map app. Venue names carry their own colour per theme so they're easy to scan for.

**Speed.** The query cache is persisted to disk, so returning to the app paints
your last day before the network answers. Adjacent days are prefetched, and every
API response is shared across visitors by Vercel's edge cache.

---

## Stack

| Layer     | Choice |
| --------- | ------ |
| UI        | React 19 + TypeScript, Tailwind CSS 3 |
| Data      | TanStack Query, persisted to `localStorage` |
| Build     | Vite 7 |
| API       | Vercel serverless functions (`api/`) |
| Hosting   | Vercel |
| Analytics | Vercel Analytics (no cookies, no consent banner) |
| Database  | Optional Neon — artist links only, degrades to live lookups without it |
| Tests     | Vitest for pure functions; Playwright (`playwright-core`) for behaviour |

Sets come from SoundCloud, Mixcloud, the Internet Archive and YouTube, each
behind a common player interface. Only SoundCloud needs credentials; the rest are
keyless.

---

## How it works

```
Browser  ──GET /api/events?date=YYYY-MM-DD──▶  Vercel function
                                                     │
                                                     ├─ POST https://ra.co/graphql
                                                     │  (browser-like headers)
                                                     │
                                              ◀──────┘ JSON, cached at the edge
```

The browser never calls `ra.co` directly, for three reasons:

- **CORS** — `ra.co/graphql` sends no `Access-Control-Allow-Origin`, so a direct
  browser call is blocked.
- **Forbidden headers** — `User-Agent`, `Referer` and `Origin` cannot be set from
  browser `fetch()`; browsers drop them silently. RA rejects requests that don't
  look like a browser, so those have to be set server-side.
- **Caching** — one function response is shared by every visitor at the edge,
  instead of every visitor hitting RA.

---

## Documentation

| File | Contents |
| ---- | -------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | How the pieces fit: request flow, playback, caching, file map |
| [DATABASE.md](./DATABASE.md) | Whether a database is needed at all, and what it would hold |
| [ROADMAP.md](./ROADMAP.md) | What's planned next |
| [memorystate.md](./memorystate.md) | Running project journal — decisions, state, open questions |

---

## A note on Resident Advisor

This is an unofficial client for RA's public GraphQL API, and it links back to
`ra.co` for every event. It's polite by design: results are cached at the edge,
so RA sees roughly one request per day-view per five minutes rather than one per
visitor. If RA publishes formal API terms or asks that this stop, honour that.
