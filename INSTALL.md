# Running it yourself

Everything needed to get RA-NYC building, running locally, and deployed.

---

## Requirements

- **Node 22.x** — pinned in `package.json` under `engines`, which is also what
  Vercel reads. Other majors may work; nothing checks.
- npm (the repo ships a `package-lock.json`).

No database, no API keys, no accounts. Every credential in this document is
optional and the app degrades gracefully without it.

---

## Local development

```bash
npm install
npm run dev          # http://localhost:8080
```

`vite dev` knows nothing about Vercel's `api/` convention, so `vite.config.ts`
includes a small plugin that routes `/api/*` to the matching module in `api/`.
The handlers are written against Node's `(req, res)` — both what Vercel invokes
them with and what connect middleware provides — so the plugin only routes, it
never adapts. The function running locally is byte-for-byte the one running in
production, and `vercel dev` is not required.

### The other scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Production build to `dist/`. This is what Vercel runs. |
| `npm run preview` | Serve the built output. |
| `npm run typecheck` | `tsc --noEmit` over the app and the API, separately. |
| `npm test` | Vitest over the pure functions. Fast, no network. |
| `npm run test:e2e` | Playwright transport-bar behaviour. |
| `npm run test:search` | Playwright search behaviour. |
| `npm run test:all` | All three. |

The Playwright suites use `playwright-core` and look for an existing Chromium
rather than downloading one — set `PLAYWRIGHT_CHROMIUM_PATH` if it can't find
yours. This is deliberate: depending on `playwright` proper would pull a ~150 MB
browser into every install, including Vercel's.

---

## Configuration

All optional. Copy `.env.example` to `.env` and fill in what you want; the file
documents each variable in more detail than the table below.

| Variable | Without it |
| --- | --- |
| `DATABASE_URL` | Resolved artist links aren't cached durably; every lookup is live. |
| `SOUNDCLOUD_CLIENT_ID` | SoundCloud degrades to a search link. Mixcloud and the Internet Archive still fill the set list. |
| `SOUNDCLOUD_CLIENT_SECRET` | Sets which SoundCloud API is used — see below. |
| `YOUTUBE_API_KEY` | No YouTube fallback sets. |
| `DISCOGS_TOKEN` | The Discogs link is a search URL rather than the artist's page. |

### The SoundCloud trap

SoundCloud issues two kinds of credential and they are not interchangeable:

1. **Developer portal** — a client id **and** secret. Both must be set. These
   work against `api.soundcloud.com` via an OAuth token, which the app mints and
   caches. A bare client id is rejected there.
2. **A lone client id**, the sort their own web player uses. Set only the id and
   the app talks to `api-v2.soundcloud.com` instead.

Setting the id alone when you actually hold a portal id/secret pair is the easy
mistake: every request 401s and SoundCloud looks like it simply has no sets.
`GET /api/artist` reports which mode is live in its `soundcloud` field.

Note that changing an environment variable in Vercel **does not trigger a
redeploy** — the running deployment keeps the old value until you redeploy.

### Database (optional)

Postgres, tested on Neon. Apply the migrations in order before first use:

```bash
for f in migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

Several of them are cache invalidations rather than schema changes — they clear
rows resolved under older matching rules so the resolver revisits them. They are
all safe to re-run, and none of them touch a row marked `link_source = 'manual'`.

---

## Deploying to Vercel

One-time, in the dashboard:

1. **Add New… → Project → Import Git Repository.**
2. Vercel reads `vercel.json`, so the framework preset, build command, output
   directory and install command are already correct. **Don't override them.**
3. Add any environment variables you want. All are optional.
4. **Deploy.**
5. Set the production branch under *Settings → Git*.

Or from the CLI:

```bash
npm i -g vercel
vercel link
vercel --prod
```

### Verifying a deploy

```bash
# {"date":"…","count":N,"events":[…]}
curl "https://<deployment>.vercel.app/api/events?date=$(date +%F)"

# the SPA, not a 404
curl -I "https://<deployment>.vercel.app/some/deep/link"

# a 400, not a 500
curl -i "https://<deployment>.vercel.app/api/events?date=banana"
```

### Custom domain

*Settings → Domains → Add.* Point the apex `A` record at `76.76.21.21` or use
Vercel's nameservers; add `www` as a redirect. Certificates are automatic.

---

## Troubleshooting

### `/api/events` returns 502 "Resident Advisor responded with 403"

RA is blocking your egress IPs. In order of preference: raise `s-maxage` so you
reach RA far less often; add a scheduled job that warms the cache; or fall back
to a stored snapshot.

### `500: FUNCTION_INVOCATION_FAILED` on every API request

Vercel invokes a **default export** in `api/` with Node's `(req, res)`. The web
standard `Request`/`Response` signature applies only to **named method
exports** — `export function GET(request: Request)` — which is the Next.js App
Router convention, not this one. Get it wrong and Vercel passes an
`IncomingMessage`, `request.url` is a relative path, and `new URL(...)` throws
before any try/catch can see it.

The lesson worth keeping: any throw *before* the try block crashes the
invocation and produces this opaque 500 rather than a JSON error the UI can
show. Keep the whole handler body inside the catch.

### `Function Runtimes must have a valid version…`

`functions.<glob>.runtime` in `vercel.json` is only for community and custom
runtimes and expects an npm package spec. It is not where you select a Node
version — that comes from `engines.node` in `package.json`, which also overrides
*Project Settings → General → Node.js Version*, so the version lives in git
rather than in dashboard state.

### `npm ci` fails with a lockfile mismatch

`package-lock.json` is out of sync with `package.json`. Run `npm install`
locally and commit the updated lockfile. Don't switch the install command to
`npm install` — that lets the deploy silently drift from the lockfile.

### The build succeeds but `/api/events` 404s

Check the SPA rewrite in `vercel.json` still excludes the API prefix. The
negative lookahead in `/((?!api/).*)` is what stops `index.html` swallowing
function routes.
