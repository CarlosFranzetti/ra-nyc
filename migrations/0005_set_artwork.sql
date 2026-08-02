-- Cover art on cached sets, for the OS lock screen.
--
-- No schema change: `sets` is jsonb. This only invalidates rows written before
-- artwork was resolved, which would otherwise keep serving sets with no cover
-- and leave a locked phone showing a placeholder indefinitely — the resolver
-- won't re-read a row it considers fresh.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0005_set_artwork.sql

update artist_links
   set sets = '[]'::jsonb,
       resolved_at = to_timestamp(0)
 where link_source <> 'manual';
