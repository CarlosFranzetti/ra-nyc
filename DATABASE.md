# Do you need a database?

**Short answer: no. Not today. Don't add one yet.**

You asked whether the database is even needed, and whether a locally-hosted
Postgres would do. Here's the full reasoning, plus what changes when the
[roadmap features](./ROADMAP.md) land.

---

## Why there's no database today

Your instinct was right — and the code agrees with you. The Supabase project
Lovable wired up (`sjskkjsluxivtovzkajb`) had:

- **zero tables** — the generated `types.ts` literally declared
  `Tables: { [_ in never]: never }`;
- **zero call sites** — `src/integrations/supabase/client.ts` was never imported
  by a single component.

It was scaffolding. Lovable adds Supabase to new projects by default because
most apps eventually want auth and storage; this one never did. It has been
removed.

**Was Supabase used for anything other than a database?** Yes — and this
corrects an earlier answer here that was based only on this repo's git history.

An earlier version of the app, since lost (see
[memorystate.md](./memorystate.md#2026-07-29--recovering-the-original-lovable-app)),
used a **Supabase Edge Function as a GraphQL proxy in front of ra.co, with rate
limiting**. That is a compute feature, not a database one — it used Deno on
Supabase's edge, and still no tables.

It is worth dwelling on, because it independently validates this migration:
that version proxied RA server-side for exactly the reasons `api/events.ts`
does now. The version that reached GitHub had regressed to fetching ra.co
straight from the browser, which is why it could never have worked in
production. **The Vercel function is not a new architecture — it is the
original one, rehosted.**

Within the code that this repository has ever contained, though, the answer is
no: searching every commit for `supabase.auth`, `supabase.storage`,
`supabase.from`, `supabase.channel`, `supabase.functions` and `supabase.rpc`
returns nothing. The only Supabase artefacts in this repo were:

| File | What it was |
| --- | --- |
| `src/integrations/supabase/client.ts` | Generated `createClient()` call, never imported |
| `src/integrations/supabase/types.ts` | Generated types declaring zero tables |
| `supabase/config.toml` | One line: the project id |
| `.env` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` — deleted in commit `e1b1afd`, before the migration |

So removing it dropped no functionality from *this* codebase, and the edge
function's job is now done by `api/events.ts`. Nothing is lost by not going
back to Supabase; a Vercel function sits next to the app it serves, with one
platform to operate instead of two.

That's not an accident of how the app was built — it's what the app *is*.
RA-NYC has **no data of its own**:

| Thing | Where it lives |
| --- | --- |
| Events, venues, lineups, images | Resident Advisor's API |
| Which day you're looking at | React state, `useState` |
| Fetched results | TanStack Query in memory + Vercel's edge cache |
| User accounts, favourites, settings | Don't exist |

Every byte on screen is derived from an upstream API on demand. A database in
that picture would be a cache with extra steps — and you already have two
caches (the CDN and the query client) that cost nothing and need no
maintenance.

**Adding Postgres now would buy you:** nothing.
**It would cost you:** a connection string to manage, a schema to migrate, a
sync job to keep fresh, a new failure mode when it drifts from RA, and a
monthly bill.

---

## When a database *does* start earning its keep

Three triggers. The first two come straight from the features you asked for.

### Trigger 1 — Search across more than the current day

A search box that filters the ~50 events **already on screen** needs no
database. That's `Array.prototype.filter`, and it's how [ROADMAP.md
§1](./ROADMAP.md#1--event-search) specifies phase 1.

A search box that answers *"when is Move D playing in NYC next?"* is a
different question. It has to look across every upcoming event, which means
something has to have already fetched and indexed them. Two ways:

- **No-DB version:** fan out to RA for a 30-day window on demand. ~30 upstream
  requests per search, 3–8 s latency, and it will get you rate-limited.
- **DB version:** a nightly job pulls the next 60 days into Postgres; search is
  one indexed query, ~20 ms.

The second is obviously right *if you want cross-day search*. It's also
obviously unnecessary if you don't.

### Trigger 2 — DJ sets and bios

[ROADMAP.md §2](./ROADMAP.md#2--dj-sets--artist-bios) is the real forcing
function. RA gives you an artist's *name*. To play their sets you need their
SoundCloud or Mixcloud identity, and RA doesn't provide it. So for each artist
you must resolve `"Move D"` → `soundcloud.com/move-d`, which means:

- hitting a third-party API (SoundCloud's is invite-only now; Mixcloud's is
  open but rate-limited),
- doing fuzzy matching, because DJ names are ambiguous — "Jane", "Move D",
  "DJ Python" all collide with unrelated accounts,
- and occasionally correcting the match **by hand**.

That last point is decisive. A hand-corrected mapping is *your* data. It cannot
be re-derived from RA, so it cannot live in a cache — a cache is by definition
something you can afford to lose. The moment you correct one artist link, you
need a database.

### Trigger 3 — Anything per-user

Favourites, "going" lists, saved searches, notifications. None of it is on the
roadmap, but it's the usual third trigger.

**Summary:**

| Feature | Needs a DB? |
| --- | --- |
| Current app | No |
| Search within the loaded day | No |
| Search across all upcoming events | Yes |
| Play a DJ's sets (best-effort, uncorrected) | No — resolve live and cache at the edge |
| Play a DJ's sets (curated, hand-corrected) | **Yes** |
| Artist bio links | Yes, same reason |
| Favourites / accounts | Yes |

---

## Neon vs. a locally-hosted Postgres

You floated running Postgres locally. Here's the honest comparison — and the
answer is **both**, for different jobs.

### The blocker for local-only

Vercel functions are stateless, ephemeral, and run in AWS regions. A Postgres
on your laptop or a box at home is **not reachable from them**. To connect
you'd have to either expose Postgres to the public internet (please don't —
`postgres` on `:5432` with a password is one of the most-scanned targets there
is), or run a tunnel (Tailscale, ngrok, Cloudflare Tunnel) that becomes a
permanent piece of production infrastructure you now maintain. Your site would
also go down whenever your laptop sleeps.

There's a second, subtler problem: **connection exhaustion.** Serverless scales
to many concurrent instances, each wanting a Postgres connection, against a
default `max_connections` of 100. Traditional Postgres hates this. It's the
specific problem Neon's HTTP driver and pooled endpoints exist to solve.

### Where local Postgres genuinely wins

For **development**. It's free, fast, offline, and you can drop and reseed it
without a care. And because Neon *is* Postgres — real Postgres, not a
compatible clone — the same schema, the same SQL, the same migrations, and the
same `pg` client work against both. Nothing about developing on a local
container locks you out of Neon in production.

### Recommendation

| | Development | Production |
| --- | --- | --- |
| **Use** | Local Postgres in Docker | Neon |
| **Why** | Free, offline, disposable | Reachable from Vercel, scales to zero, HTTP driver survives serverless |

```bash
# Local dev database, when the day comes
docker run --name ra-nyc-pg -e POSTGRES_PASSWORD=dev \
  -p 5432:5432 -d postgres:17

# .env.local
DATABASE_URL="postgres://postgres:dev@localhost:5432/postgres"
```

Production sets `DATABASE_URL` to the Neon pooled connection string in Vercel's
environment variables. Same code path.

### Why Neon specifically

- **Scales to zero.** This app's traffic is spiky — Thursday night, not Tuesday
  morning. Neon suspends an idle database and you stop paying for it. A
  RDS/Supabase/Railway instance bills you for 24 h of idle every day.
- **Free tier is enough.** ~0.5 GB storage; 60 days of NYC events with lineups
  is a few MB. You will not outgrow it.
- **Serverless driver.** `@neondatabase/serverless` queries over HTTP, so no
  connection pool to exhaust and no cold-start TCP handshake.
- **Database branching.** `neonctl branches create` gives a Vercel preview
  deployment its own copy-on-write database. Genuinely useful when you're
  changing a schema.
- **It's plain Postgres.** Full-text search, `pg_trgm` for fuzzy DJ-name
  matching, JSONB for raw RA payloads. No proprietary query language to learn,
  and no lock-in — `pg_dump` and go.

**Alternatives, briefly:** Vercel Postgres is Neon under the hood, so you may as
well go direct and keep the option to move. Supabase is a fine product but it's
Postgres *plus* auth, storage, realtime and edge functions — you'd be adopting a
platform to get a table. If all you ever need is a key/value cache, Upstash
Redis is a smaller tool that fits better than any SQL database.

---

## If/when you add it: the schema

Don't build this yet. It's here so the decision is already made when the
roadmap features start.

```sql
-- Cached mirror of RA listings. Disposable; re-derivable from RA.
create table events (
  id            text primary key,          -- RA's event id
  area_id       int  not null default 8,   -- 8 = NYC
  title         text not null,
  event_date    date not null,
  start_time    timestamptz,
  end_time      timestamptz,
  content_url   text not null,             -- path on ra.co
  image_url     text,
  venue_name    text,
  venue_area    text,
  is_pick       boolean not null default false,
  raw           jsonb  not null,           -- full RA payload, for schema drift
  fetched_at    timestamptz not null default now()
);

create index events_date_idx   on events (area_id, event_date);
create index events_search_idx on events
  using gin (to_tsvector('english', title || ' ' || coalesce(venue_name, '')));

-- Artists. NOT disposable: soundcloud_url/mixcloud_url/bio_url may be
-- hand-corrected, and that correction cannot be re-derived from RA.
create table artists (
  id             text primary key,         -- RA's artist id
  name           text not null,
  slug           text unique,
  soundcloud_url text,
  mixcloud_url   text,
  bio_url        text,
  bio_excerpt    text,
  -- how the links were obtained, so an automated backfill never clobbers
  -- a human correction
  link_source    text check (link_source in ('auto','manual','none')) default 'none',
  resolved_at    timestamptz
);

create index artists_name_trgm_idx on artists using gin (name gin_trgm_ops);

create table event_artists (
  event_id  text references events (id) on delete cascade,
  artist_id text references artists (id) on delete cascade,
  primary key (event_id, artist_id)
);
```

Two notes worth keeping:

- `raw jsonb` means an unannounced change to RA's schema degrades a column
  instead of losing the record.
- `link_source` is the whole reason this is a database and not a cache. A
  nightly re-resolve must skip every row where `link_source = 'manual'`.

### Wiring it up

```bash
npm i @neondatabase/serverless
```

```ts
// api/_lib/db.ts
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

export const sql = neon(url);
```

Keep it in `api/_lib/`. **The browser must never hold a database URL** — that's
the one hard rule. The Lovable/Supabase model of querying from the client is
what makes `VITE_`-prefixed credentials feel normal; they aren't, and anything
prefixed `VITE_` is compiled into a public JavaScript bundle.

Refresh via a Vercel Cron job (`api/cron/sync.ts`, `"schedule": "0 5 * * *"`),
protected with a `CRON_SECRET` check.

### Migrations

Plain SQL files in `migrations/` applied with a script is enough at this size.
If you want a tool, Drizzle fits this stack best (TypeScript-native, generates
SQL you can read, no runtime). Skip a heavy ORM — the queries here are small.

---

## The rule to keep

> Add the database when you have data that **cannot be re-fetched from RA**.
> Until then, every persistence problem this app has is solved by a
> `Cache-Control` header.

Right now that condition is false. The first feature that makes it true is a
hand-corrected DJ link.
