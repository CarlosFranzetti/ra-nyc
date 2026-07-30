-- Multi-source sets and bios.
--
-- 0001 assumed Mixcloud was the only provider. Sets now come from SoundCloud,
-- Mixcloud, Internet Archive and optionally YouTube, and each carries its own
-- embed URL — all inside the existing `sets` jsonb, so no change needed there.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0002_artist_bio_and_soundcloud.sql

alter table artist_links
  add column if not exists soundcloud_user text,
  -- Bio prose plus its attribution: {text, source, url}
  add column if not exists bio jsonb;

-- Rows written by 0001 have Mixcloud-only sets without a `provider` field.
-- Clearing them forces one clean re-resolve; they are disposable by definition.
update artist_links
   set sets = '[]'::jsonb,
       resolved_at = to_timestamp(0)
 where link_source <> 'manual'
   and sets <> '[]'::jsonb
   and not (sets @> '[{"provider": "mixcloud"}]'::jsonb);
