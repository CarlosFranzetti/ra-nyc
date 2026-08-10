-- Everything, in one paste. Safe to run on an empty database or a live one.
--
-- The numbered migrations exist as a history of how the schema got here, which
-- is worth keeping. They are a bad way to *set up* a database from a phone:
-- seven files, opened one at a time on github.com, each needing the raw view
-- and a careful select-all. This file is the same end state in one block.
--
-- Every statement is idempotent. `create table if not exists`, `add column if
-- not exists` and `create index if not exists` all no-op when the object is
-- already there, so running this twice does nothing the second time and running
-- it against a database that is already migrated changes nothing at all.
--
-- The one statement that is not a no-op is the delete near the bottom. That is
-- migration 0006 and it is deliberate — read its comment before running.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0000_bootstrap.sql
-- Or paste the whole file into Vercel → Storage → Query, or Neon's SQL Editor.

-- ── 0001: resolved artist links ─────────────────────────────────────────────
-- The project's first real table. It exists because a corrected DJ →
-- SoundCloud/Mixcloud mapping cannot be re-derived from RA, so it cannot live
-- in a cache.

create table if not exists artist_links (
  -- RA's artist id. The primary key, because RA reuses artist *names*.
  ra_artist_id    text primary key,
  name            text not null,

  mixcloud_user   text,
  mixcloud_url    text,
  soundcloud_url  text,
  discogs_url     text,
  ra_url          text,

  -- Playable sets, cached as JSON so the shape can evolve without a migration.
  -- Disposable: re-derivable from the providers.
  sets            jsonb not null default '[]'::jsonb,

  -- 'auto'   — resolved by the matcher, safe to re-resolve
  -- 'manual' — corrected by a human, MUST NOT be overwritten
  -- 'none'   — resolution ran and found nothing; stops us retrying forever
  link_source     text not null default 'none'
                  check (link_source in ('auto', 'manual', 'none')),

  resolved_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists artist_links_name_idx on artist_links (lower(name));
create index if not exists artist_links_resolved_at_idx on artist_links (resolved_at);

-- ── 0002 + 0003: columns added as the resolver grew ─────────────────────────
-- Sets stopped being Mixcloud-only, bios arrived with their attribution, and
-- the ranked outbound link list under the bio came after that.

alter table artist_links
  add column if not exists soundcloud_user text,
  -- Bio prose plus its attribution: {text, source, url}
  add column if not exists bio jsonb,
  add column if not exists links jsonb not null default '[]'::jsonb;

-- ── 0006: re-resolve every artist ───────────────────────────────────────────
-- This one deletes rows, and that is the point.
--
-- Migrations 0002 through 0005 each believed they were invalidating the cache
-- and none of them did. They emptied every cached artist's set list and reset
-- `resolved_at`, but nothing in the read path looks at `resolved_at` and
-- nothing passes a refresh flag — so the resolver has been serving those empty
-- rows as cache *hits* ever since. Deleting is the only invalidation this
-- schema actually supports.
--
-- Hand-corrected rows are left alone, which is the whole reason `link_source`
-- exists. On a new database this deletes nothing.

delete from artist_links where link_source <> 'manual';

-- ── 0007: the durable search index ──────────────────────────────────────────
-- Search pulls a window of listings from RA and matches them here, because RA
-- exposes no text predicate this client can rely on. RA returns a date range
-- ascending and caps a page at 100 rows, while NYC generates roughly a hundred
-- listing rows a day — so three pages forward reached about three days, not
-- sixty. No amount of paging fixes that inside one request. Remembering does.
--
-- Still a cache: everything degrades to the old live-window behaviour when
-- DATABASE_URL is unset or this table is missing.

create table if not exists event_cache (
  ra_event_id text primary key,
  area_id     integer not null,
  -- The night it *starts*. RA's listingDate filter is a range overlap, so a
  -- multi-day run comes back on every day it covers; one row per event, filed
  -- under its opening night, is what stops a residency repeating all week.
  event_date  date not null,
  title       text not null,
  venue_name  text not null,
  venue_area  text,
  artists     jsonb not null default '[]'::jsonb,
  url         text,
  image_url   text,
  attending   integer not null default 0,
  is_pick     boolean not null default false,
  pick_blurb  text,
  start_time  text,
  end_time    text,
  -- Title, venue and lineup through the same `searchKey` the matcher uses:
  -- lowercased, accents stripped, punctuation removed, leet digits folded.
  -- Computed in the app rather than in SQL precisely so the two cannot drift.
  search_key  text not null,
  seen_at     timestamptz not null default now()
);

-- Serves the window scan: everything between two dates in one area, newest
-- first, which is the order past results are shown in.
create index if not exists event_cache_window_idx
  on event_cache (area_id, event_date desc);

-- Serves the term filter. A trailing-wildcard b-tree index cannot answer
-- `like '%term%'`, so this exists for the planner to fall back to a bitmap scan
-- over a date-bounded subset rather than the whole table.
create index if not exists event_cache_search_idx
  on event_cache (area_id, search_key);
