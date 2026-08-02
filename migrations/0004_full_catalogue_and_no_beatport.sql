-- Full set catalogues, newest first, and Beatport dropped from the link list.
--
-- Nothing about the schema changes here — both `sets` and `links` are jsonb, so
-- this is purely a cache invalidation. Rows written before this point hold at
-- most 3 sets ordered by provider-then-plays, and a link list that still
-- includes Beatport. Neither is wrong enough to break anything, but a stale row
-- would keep `next` stopping after three tracks indefinitely, because the
-- resolver only re-reads a row it considers fresh.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0004_full_catalogue_and_no_beatport.sql

update artist_links
   set sets = '[]'::jsonb,
       links = '[]'::jsonb,
       resolved_at = to_timestamp(0)
 where link_source <> 'manual';
