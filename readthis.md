# readthis.md

Everything outstanding that needs a human.

**All of it is doable from a phone**, including the backfill trigger. §1 is the
whole thing as a numbered checklist; start at the top and stop when `/api/health`
says you are done.

---

## 1 · The whole thing, from a phone, in order

Six months of listings that work offline — five back, one ahead — needs three
things switched on. All three are ordinary web pages. **Nothing here needs a
laptop.** Total hands-on time is about ten minutes; the rest is the index
filling itself overnight.

---

### Step 1 · Find out what is already done — 10 seconds

Open **`ra-nyc.vercel.app/api/health`**.

Look at the `database` block and find your row:

| What it says | What to do |
| --- | --- |
| `"configured": false` | No database at all. **Start at Step 2.** |
| `"configured": true`, `"event_cache": false` | Database exists, tables don't. **Skip to Step 3.** |
| both `true` | Schema is done. **Skip to Step 4.** |

Send me the JSON if you'd rather not read it — it never contains a
connection string or a key, only whether things are set.

---

### Step 2 · Create the database — only if Step 1 said `configured: false`

1. **vercel.com** → sign in → project **ra-nyc**
2. **Storage** tab → **Create Database** → **Neon** (Serverless Postgres)
3. Free plan → **Connect**

Vercel sets `DATABASE_URL` and redeploys by itself. Do *not* sign up at Neon
separately — you would end up typing a connection string on a phone keyboard.

---

### Step 3 · Create the tables — one paste

**vercel.com → ra-nyc → Storage → your database → Query**

Make sure the **Read-only** toggle is off. Then paste
[`migrations/0000_bootstrap.sql`](./migrations/0000_bootstrap.sql) and hit
**Run**. Phone-friendly link to copy from:

```
raw.githubusercontent.com/CarlosFranzetti/ra-nyc/main/migrations/0000_bootstrap.sql
```

Use the **Raw** view if you go via github.com — the normal file view is a table
with line numbers and copying it drags the numbers into your SQL.

**If it says `cannot insert multiple commands into a prepared statement`,** that
box runs one statement per Run. Wrap the whole file in a `DO $$ begin … end $$;`
block, or paste the statements one at a time. Every one of them is safe to
re-run except the single `delete`, which is meant to remove rows.

Reload `/api/health` — both tables should now read `true`.

---

### Step 4 · Set `CRON_SECRET` — this is the one that fills the index

Without it the nightly job **503s every morning** and the index never grows
beyond the days you personally browsed. This is the step that makes the six
months real.

1. **vercel.com → ra-nyc → Settings → Environment Variables**
2. **Key** `CRON_SECRET` · **Value** any long random string — ask your password
   manager for 32 characters. Nobody ever types this again.
3. Leave all three environments ticked → **Save**
4. **Deployments → newest → ⋯ → Redeploy.** ← *Do not skip.* Changing an
   environment variable does not redeploy on its own. This exact trap already
   cost a round with `SOUNDCLOUD_CLIENT_ID`.

---

### Step 5 · Wait three mornings, then check

The job runs at **09:00 UTC** (about 4–5am New York) and now covers **60 days
per run**, so a 181-day window fills in **three nights**. It used to be 14 days
a night — thirteen nights — which is why this was worth changing.

Nothing visible happens when it works. The two ways to confirm:

- **vercel.com → ra-nyc → Cron Jobs** — `/api/backfill` returns `200`, not `503`.
- **`/api/health`** — `search.indexed` climbs toward `search.window` (181).

Once `indexed` is near 181, search answers for the whole six months, and the
service worker keeps that text readable with no signal at all.

---

### Step 6 · Optional — don't want to wait three nights?

The job takes an `Authorization` header, which a browser address bar cannot
send. From a phone, **iOS Shortcuts**:

*New Shortcut → Get Contents of URL → Method `GET` → Headers: add
`Authorization` = `Bearer <your CRON_SECRET>` → URL:*

```
https://ra-nyc.vercel.app/api/backfill?days=90
```

Run it three or four times, a minute apart. Watch the `remaining` field in the
response come down to `0`.

---

### Also outstanding, unrelated to the index

**Delete the merged branches.** github.com → ra-nyc → **Branches** → *All
branches* → bin icon. Everything named `claude/…` is merged. Then tick
**Settings → General → Automatically delete head branches** so it stops
happening.

I cannot do this from a session: `git push --delete` returns 403 on
`git-receive-pack`, and the REST `DELETE` returns 403 with *"Write access to
this GitHub API path is not permitted through this proxy."* Both are proxy
policy, not permissions.

---

## 2 · What I could not do, and why

| Thing | Reason |
| --- | --- |
| Run the migrations | This sandbox has no route to Neon, and no `DATABASE_URL`. Asking you to paste a live connection string into chat would put a production credential in the transcript. |
| Delete the merged branches | The git proxy returns **HTTP 403** on `git-receive-pack` for a delete. Pushes work; deletions are blocked. Confirmed twice. |
| Verify anything against production | This session's network policy denies egress to `ra-nyc.vercel.app`, `ra.co`, SoundCloud, Mixcloud and CARTO. Deployment state is verified through Vercel's API instead. |
| Set the repo Website / topics | No repository-metadata write exists in this session — you did both already. |
| Run the last Sonnet code review | The review agent died on an API session limit mid-run. I did the review passes myself, which is how three hook bugs were caught, but that is not a second pair of eyes. |

---

## 3 · The last two exchanges

### 3.1 — "Are we all deployed"

**You asked:** whether everything was deployed.

**I answered:** yes, code-wise. Production was `dpl_7PWsSGPiPri…`, `READY`, on
commit `e51cba9` (the PR #35 merge), with **7 serverless functions** — up from 5,
because `health` and `backfill` had gone live. Working tree clean, zero unpushed
commits, `origin/main` matching.

But I flagged that *deployed* ≠ *working*, and that three things were switched
off: neither migration had run, `CRON_SECRET` was unset so the daily cron would
503 every morning, and we still did not know whether `DATABASE_URL` existed at
all. The honest summary was that the app is deployed and works — map, Lyft,
layout, typography and offline all function without a database — but search
coverage beyond ~3 days, the RA-outage fallback and artist set lists were all
dark, and all three unlock with one `curl` and two `psql` commands.

### 3.2 — "Make sure audio starts playing asap when you click a link…"

**You asked for:** audio starting as soon as possible on a click; clicking a
party queueing a random set from each DJ into a SoundCloud queue that starts
playing, to get a sense of the party; a buy-tickets link appearing at the party
once you have listened a while — small, above Uber and Lyft — while you browse
other events; my judgement on what is least obstructive; plus a Sonnet code
review, dead-code and reusable-function passes, and doc updates.

**I built:**

- **Audio on the tap.** Opening a DJ now starts the newest set — there was only
  ever one reason to open an artist, so the second tap was a tax. Tapping the
  playing row now pauses it.
- **Lineup warming.** Opening a party prefetches every DJ on the bill, so the
  request is usually already answered before you tap a name.
- **Preview the night.** One set per DJ, queued in lineup order. It **starts on
  the first DJ who resolves, not the last** — a six-name bill is six round trips
  and waiting for all of them would put seconds of silence between the tap and
  the music. Measured at **120ms** in the browser with the slowest artist
  stubbed at 1.5s.
- **Seeded, not random, picks.** `Math.random()` re-rolls on every reopen, so
  the party you sampled two minutes ago becomes a different party. FNV-1a over
  `eventId:artistId` keeps one night sounding like itself.
- **The earned ticket link.** `listened` counts seconds of *actual playback* —
  a phone paused in a pocket accumulates none — and at 60 seconds a small
  Tickets link appears in the transport. Plus one above Uber/Lyft in the venue
  sheet.

**Where I overrode you:** you said clicking a party should start the queue. I
made it a button, because you also said *least obstructive* and the two
conflict. People open a party to read a time and a bill, and sound nobody asked
for is the rudest thing an app does on a phone. There is an assertion that
opening a party plays **nothing**. Easy to change if you'd rather have it.

**Three bugs of mine, all caught by tests:** a hook placed after an early return
(React saw a different hook count and the sheet did not render at all); an effect
depending on `data?.sets ?? []`, a fresh array every render; and
`usePrefetchArtist` returning a new function each render, making it useless as an
effect dependency.

**Reuse:** `artistQuery(id, name)` became the single definition of how to fetch
an artist, shared by the sheet, the prefetch and the preview — three
hand-written query keys that drift do not error, they quietly stop sharing a
cache and every prefetch warms nothing.

**Two gaps I stated rather than papered over:** the 60-second reveal is
unit-tested, not browser-tested — Playwright's fake clock must be installed
before navigation and advancing it a minute blanks the app. And the Sonnet
review never ran; the agent died on an API session limit.

---

## 4 · Where the rest is written down

- **[memorystate.md](./memorystate.md)** — the running journal: every decision
  and why, the open questions, and the map of the code.
- **[INSTALL.md](./INSTALL.md)** — running it, configuring it, deploying it,
  and the troubleshooting that has actually bitten.
- **[ROADMAP.md](./ROADMAP.md)** — what is next and why, in priority order.
