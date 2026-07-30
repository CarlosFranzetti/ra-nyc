import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Optional Neon connection.
 *
 * The database is a **cache with a memory**, not a dependency. Without
 * `DATABASE_URL` the app resolves artist links live on every request and works
 * exactly as before — slower, and third-party APIs get hit more, but nothing
 * breaks. That property is deliberate: it means the database can be added,
 * removed or fail without taking the site down.
 *
 * `@neondatabase/serverless` queries over HTTP, so there is no connection pool
 * to exhaust across many concurrent function instances — the specific reason
 * Neon suits this and a plain Postgres over TCP does not.
 */

let cached: NeonQueryFunction<false, false> | null | undefined;

export function getSql(): NeonQueryFunction<false, false> | null {
  if (cached !== undefined) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    cached = null;
    return null;
  }

  try {
    cached = neon(url);
  } catch (error) {
    console.error("[db] failed to initialise Neon client", error);
    cached = null;
  }
  return cached;
}

export function isDbEnabled(): boolean {
  return getSql() !== null;
}
