-- Resolved artist links.
--
-- This is the project's first real table, and it exists for one reason: a
-- corrected DJ → SoundCloud/Mixcloud mapping cannot be re-derived from RA, so
-- it cannot live in a cache. See DATABASE.md.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0001_artist_links.sql

create table if not exists artist_links (
  -- RA's artist id. The primary key, because RA reuses artist *names*.
  ra_artist_id    text primary key,
  name            text not null,

  mixcloud_user   text,          -- username, e.g. "moved"
  mixcloud_url    text,
  soundcloud_url  text,
  discogs_url     text,
  ra_url          text,

  -- Playable sets, cached as JSON so the shape can evolve without a migration.
  -- Disposable: re-derivable from Mixcloud.
  sets            jsonb not null default '[]'::jsonb,

  -- 'auto'   — resolved by the matcher, safe to re-resolve
  -- 'manual' — corrected by a human, MUST NOT be overwritten
  -- 'none'   — resolution ran and found nothing; stops us retrying forever
  link_source     text not null default 'none'
                  check (link_source in ('auto', 'manual', 'none')),

  resolved_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Name lookups for a future search feature, and for resolving when we have a
-- name but no id.
create index if not exists artist_links_name_idx on artist_links (lower(name));

-- Lets a refresh job find the stalest rows first.
create index if not exists artist_links_resolved_at_idx on artist_links (resolved_at);
