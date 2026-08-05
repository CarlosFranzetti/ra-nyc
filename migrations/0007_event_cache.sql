-- A durable index of listings, so search stops being a live sampling problem.
--
-- Search has always worked by pulling a window of listings from RA and matching
-- them here, because RA exposes no text predicate this client can rely on. That
-- makes coverage a direct trade against upstream load, and the trade was being
-- lost in both directions: RA returns a date range in ascending order and caps a
-- page at 100 rows, while NYC generates roughly a hundred listing *rows* a day
-- (every day of a multi-day run is its own row). Three pages forward therefore
-- reached about three days ahead, not sixty, and the past beyond the nearest few
-- days was explicit sampling.
--
-- No amount of paging fixes that inside one request. Remembering does. Every
-- listing this app fetches — for a day view or for a search — is written here,
-- so coverage accumulates as the app is used and search reads from an index
-- instead of re-deriving one per query.
--
-- Deliberately still a cache: everything degrades to the previous live-window
-- behaviour when `DATABASE_URL` is unset or this table is missing.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0007_event_cache.sql

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
  -- Title, venue and lineup, run through the same `searchKey` the matcher uses:
  -- lowercased, accents stripped, punctuation removed, leet digits folded to the
  -- letters they ape. Computed in the app rather than in SQL precisely so the two
  -- cannot drift — one function decides what "holo" and "h0l0" have in common.
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

-- Nothing prunes this yet; at NYC's volume a year is on the order of 15k rows.
-- When it matters:  delete from event_cache where event_date < now() - interval '1 year';
