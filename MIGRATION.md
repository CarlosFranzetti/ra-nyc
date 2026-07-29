# Lovable → Vercel migration

Status: **code migration complete.** What's left is clicking through the Vercel
setup once (§3) and disconnecting Lovable (§5).

---

## 1 · What was wrong before

The repo as exported from Lovable did not build. Running `npm run build` on a
clean checkout failed:

```
[vite:css] [postcss] It looks like you're trying to use `tailwindcss` directly
as a PostCSS plugin. The PostCSS plugin has moved to a separate package…
```

`package.json` pinned `tailwindcss@^4`, but every other file in the repo was
written for Tailwind v3 (`@tailwind base;` directives, a `tailwind.config.ts`
with a `theme.extend` object, the `tailwindcss-animate` plugin). Lovable's
preview sandbox papered over this; Vercel's build would not have.

Four other things would have bitten after deploy:

| Problem | Consequence on Vercel |
| --- | --- |
| Browser called `ra.co/graphql` directly | Blocked by CORS — the app shows "Failed to load events" for everyone |
| `User-Agent` / `Referer` set on a browser `fetch()` | Silently dropped; RA sees an unbrowser-like request and 403s |
| Supabase client imported `VITE_SUPABASE_*` env vars | `createClient(undefined, undefined)` throws at module load if anything ever imported it |
| No SPA fallback config | Any route other than `/` 404s on refresh |

---

## 2 · What changed

### Build fixed

- **Pinned Tailwind to `^3.4`** to match the config and CSS that already exist.
  (Upgrading *forward* to v4 was the alternative — it means rewriting
  `index.css` to `@import "tailwindcss"`, moving the theme into `@theme`, and
  replacing `tailwindcss-animate`. Not worth it during a hosting migration;
  logged in [ROADMAP.md](./ROADMAP.md).)
- Added `"type": "module"` — silences Node's ESM warning on `postcss.config.js`.
- Split `dependencies` / `devDependencies` properly. Lovable had put Vite,
  TypeScript, Tailwind and all `@types/*` in `dependencies`.
- `tailwind.config.ts` now uses `import animate from "tailwindcss-animate"`
  instead of `require()`, which is invalid in an ESM package.
- Added `npm run typecheck`. There was no type-checking step at all.
- Added a `.gitignore`. The repo had none — `node_modules/` was one careless
  `git add .` away from being committed.

### RA fetching moved server-side

New `api/events.ts` + `api/_lib/ra.ts`. The browser now calls
`GET /api/events?date=YYYY-MM-DD`; the function calls RA with real
browser-like headers and returns JSON with edge-cache headers. Rationale in
[ARCHITECTURE.md](./ARCHITECTURE.md#step-2-in-detail--why-a-function-at-all).

`src/hooks/useRAEvents.ts` shrank to a `fetch("/api/events?date=…")`. It also
now forwards TanStack Query's `AbortSignal`, so flipping quickly through the
date strip cancels in-flight requests instead of racing them.

The function additionally:

- validates `date` against `^\d{4}-\d{2}-\d{2}$` before it reaches RA;
- accepts an optional `?area=<id>` (defaults to `8`, RA's id for NYC) — this is
  what makes a future city switcher a one-line change;
- times out upstream after 10 s rather than holding the function open;
- maps failures to real status codes (400 / 405 / 500 / 502 / 504) instead of a
  generic throw.

### Supabase removed

Deleted `src/integrations/supabase/`, `supabase/config.toml`, and the
`@supabase/supabase-js` dependency. It was Lovable scaffolding: the generated
types file declared **zero tables**, and `client.ts` was never imported by any
component. Also dropped `class-variance-authority`, likewise unused.

Nothing about the app's behaviour changed — see [DATABASE.md](./DATABASE.md)
for the longer answer about whether you want a database back.

### Vercel config added

`vercel.json` sets the framework, the Node 22 function runtime with a 15 s cap,
the SPA rewrite (`/(?!api/).*` → `/index.html`, so deep links and refreshes
work), and immutable caching for content-hashed assets.

### Local dev keeps working

`vite dev` doesn't know about Vercel's `api/` convention, so `vite.config.ts`
now includes a small plugin that loads the same handler modules and adapts
Node's req/res to the Web `Request`/`Response` the handlers are written
against. One implementation, both environments — no `vercel dev` required
(though it still works).

Also changed `server.host` from Lovable's `"::"` to `true`. `"::"` crashes with
`EAFNOSUPPORT` on hosts without IPv6.

---

## 3 · Connect the repo to Vercel

One-time, in the Vercel dashboard:

1. **Add New… → Project → Import Git Repository →** `CarlosFranzetti/ra-nyc`.
2. Vercel reads `vercel.json`, so the framework preset, build command
   (`npm run build`), output directory (`dist/`) and install command
   (`npm ci`) are already correct. **Don't override them.**
3. **Environment Variables: leave empty.** The app needs none. If you see
   leftover `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` entries,
   delete them.
4. **Deploy.**
5. Set the production branch to `main` under *Settings → Git* (Vercel defaults
   to the repo's default branch, which is already `main`).

CLI equivalent, if you prefer:

```bash
npm i -g vercel
vercel link
vercel --prod
```

### Verifying the deploy

```bash
# should return {"date":"…","count":N,"events":[…]}
curl "https://<your-deployment>.vercel.app/api/events?date=$(date +%F)"

# should return the SPA, not a 404
curl -I "https://<your-deployment>.vercel.app/some/deep/link"

# should be a 400, not a 500
curl -i "https://<your-deployment>.vercel.app/api/events?date=banana"
```

If `/api/events` returns **502 "Resident Advisor responded with 403"**, RA is
blocking Vercel's egress IPs. Options, in order of preference: raise `s-maxage`
so you hit RA far less often; add a scheduled job that warms the cache; or fall
back to a stored snapshot — which *is* a reason to want a database, and is
covered in [DATABASE.md](./DATABASE.md#when-a-database-does-start-earning-its-keep).

### Custom domain

*Settings → Domains → Add.* Point the apex `A` record at `76.76.21.21` or use
Vercel's nameservers; add `www` as a redirect. Vercel provisions the
certificate automatically.

---

## 4 · Verify locally first

```bash
rm -rf node_modules package-lock.json
npm install
npm run typecheck     # must pass
npm run build         # must pass — this is what Vercel runs
npm run dev           # open http://localhost:8080, click through the dates
```

All four are green as of this migration.

---

## 5 · Decommission Lovable

Do this **after** the Vercel deploy is verified, and in this order:

1. Confirm the Vercel URL renders events for several days.
2. In Lovable, disconnect the GitHub integration for this project so it stops
   pushing commits to `main` behind your back.
3. Remove any Lovable-managed custom domain, then re-add it in Vercel.
4. The Supabase project Lovable provisioned (`sjskkjsluxivtovzkajb`) is empty —
   no tables. Delete it, or leave it paused. It costs nothing either way, but
   an abandoned project with live keys is a liability worth closing out.
5. Keep the Lovable project itself around read-only for a week or two as a
   rollback reference, then archive it.

**Rollback plan:** everything in this migration is in git. `git revert` the
migration commit and Lovable's version of the code is back. The pre-migration
tree is also tagged in the branch history.

---

## 6 · Known gaps after migration

Carried over from the Lovable build, not introduced here — see
[memorystate.md](./memorystate.md#open-questions--known-issues):

- Dates come from the visitor's local clock, not New York time. Someone in
  London opening it at 01:00 sees "today" as NYC's tomorrow.
- The event list is capped at RA's first 50 results per day, with no pagination.
- No tests.
- No error boundary; a render crash blanks the page.
