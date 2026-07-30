-- Ranked outbound link list shown under the bio.
--
-- Stored as jsonb rather than columns because the provider set is still moving
-- (Bandcamp and Beatport arrived after 0002) and the shape is display-only.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0003_artist_link_list.sql

alter table artist_links
  add column if not exists links jsonb not null default '[]'::jsonb;

-- Existing rows have no link list and a 4-set cap; a single re-resolve fixes
-- both. Disposable data, and hand corrections are left alone.
update artist_links
   set links = '[]'::jsonb,
       sets = '[]'::jsonb,
       resolved_at = to_timestamp(0)
 where link_source <> 'manual';
