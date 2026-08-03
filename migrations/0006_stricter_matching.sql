-- Re-resolve every artist against the tightened matcher.
--
-- No schema change. Two things changed in how an account is matched to a name,
-- and both can only take effect on a re-resolve:
--
--   * `isPlausibleMatch` no longer accepts an unbounded suffix, so rows that
--     latched onto a namesake or a fan account are wrong and will stay wrong —
--     the resolver does not revisit a row it considers fresh.
--   * Resolution now reads the RA biography for handles and corroborating
--     context, which no existing row was resolved with.
--
-- Clearing the profile columns as well as `sets` is the point: a bad
-- soundcloud_user is what produced the bad sets, and leaving it in place would
-- have the next resolve trust the same account again.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0006_stricter_matching.sql

update artist_links
   set sets            = '[]'::jsonb,
       soundcloud_user = null,
       mixcloud_user   = null,
       resolved_at     = to_timestamp(0)
 where link_source <> 'manual';
