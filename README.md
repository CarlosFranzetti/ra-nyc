# 🎛️ RA-NYC

🎶 *The hottest beats in the Big Apple, now at your fingertips.*

A fast, mobile-first listing of tonight's **Resident Advisor** events in New York
City. Pick a day, scroll the lineups, tap through to RA for tickets.

Originally built on [Lovable](https://lovable.dev); now a plain Vite + React app
deployed on [Vercel](https://vercel.com).

---

## 🌟 Features

- ⚡ **Quick and simple** — one screen, no login, no signup.
- 📅 **Day-by-day** — yesterday through the next week, weekends highlighted.
- 🎭 **Curated for NYC** — underground, rooftop, and secret warehouse events.
- 🔥 **RA Picks** flagged, with full lineups and set times.

---

## 🧱 Stack

| Layer    | Choice                                       |
| -------- | -------------------------------------------- |
| UI       | React 19 + TypeScript, Tailwind CSS 3         |
| Data     | TanStack Query                                |
| Build    | Vite 7                                        |
| API      | Vercel serverless function (`api/events.ts`)  |
| Hosting  | Vercel                                        |
| Database | **None.** See [DATABASE.md](./DATABASE.md).   |

---

## 🚀 Quick start

```bash
git clone https://github.com/CarlosFranzetti/ra-nyc
cd ra-nyc
npm install
npm run dev          # http://localhost:8080 — serves the UI *and* /api/events
```

There are **no environment variables to set.** The app talks to Resident
Advisor's public GraphQL endpoint through our own serverless function; nothing
is authenticated.

| Script              | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Vite dev server, with `api/` mounted as routes   |
| `npm run build`     | Production build to `dist/`                      |
| `npm run preview`   | Serve the built `dist/` (static only, no `/api`) |
| `npm run typecheck` | Type-check both the app and the API functions    |

> `npm run dev` runs the real `api/events.ts` handler through a small Vite
> middleware (see `vite.config.ts`), so local behaviour matches production.
> `vercel dev` works too if you have the Vercel CLI installed.

---

## 🔌 How it works

```
Browser  ──GET /api/events?date=YYYY-MM-DD──▶  Vercel function
                                                     │
                                                     ├─ POST https://ra.co/graphql
                                                     │  (browser-like headers)
                                                     │
                                              ◀──────┘ JSON, cached at the edge
                                                        for 5 min (SWR 1 h)
```

The browser never calls `ra.co` directly. That matters:

- **CORS** — `ra.co/graphql` does not send `Access-Control-Allow-Origin`, so a
  direct browser call is blocked by the browser.
- **Forbidden headers** — `User-Agent`, `Referer` and `Origin` cannot be set from
  browser `fetch()`; browsers silently drop them. RA rejects requests that don't
  look like a browser, so those headers have to be set server-side.
- **Caching** — one function response is shared by every visitor via Vercel's
  edge cache, instead of every visitor hammering RA.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.

---

## 📚 Documentation

| File                                 | Contents                                                      |
| ------------------------------------ | ------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | How the pieces fit, request flow, caching, file map            |
| [MIGRATION.md](./MIGRATION.md)       | Lovable → Vercel: what changed and how to finish the deploy    |
| [DATABASE.md](./DATABASE.md)         | Do you need a database? Neon vs. local Postgres, schema, costs |
| [ROADMAP.md](./ROADMAP.md)           | Planned: event search, DJ set playback, artist bios            |
| [memorystate.md](./memorystate.md)   | Running project journal — decisions, state, open questions     |

---

## 🚢 Deploying

Push to `main` and Vercel builds it. First-time setup is in
[MIGRATION.md](./MIGRATION.md#3--connect-the-repo-to-vercel).

---

## 🙏 A note on Resident Advisor

This app is an unofficial client for RA's public GraphQL API and links back to
`ra.co` for every event. It's polite by design: results are cached at the edge,
so RA sees roughly one request per day-view per five minutes, not one per user.
If RA publishes formal API terms or asks that this stop, honour that.
