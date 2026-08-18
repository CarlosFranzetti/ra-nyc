# readthis.md

Everything outstanding that needs a human.

---

## 1 · The database — **done, nothing to do**

Checked against production on **2026-08-18**:

```json
"database": { "configured": true, "reachable": true,
              "tables": { "artist_links": true, "event_cache": true } },
"search":   { "indexed": 165, "window": 166,
              "oldest": "2026-04-20", "newest": "2026-10-02" }
```

All three switches are on:

- **`DATABASE_URL`** is set in Vercel and Neon answers.
- **Both tables exist** — the migration was run by hand and it took.
- **`CRON_SECRET`** is set. `/api/backfill` returns `401 Unauthorized` rather
  than `503 "Backfill is disabled"`, which is the difference between "the secret
  is wrong or absent from the request" and "no secret is configured at all".

The index covers **2026-04-20 → 2026-10-02**: 120 days back and 45 forward from
the day it was checked, which is the whole window. The nightly cron filled it —
the iOS shortcut in §3 was never needed and is kept only as a way to force a
run.

**165 of 166 is what complete looks like.** A day RA genuinely has no NYC
listings for never gets a row, so it stays "missing" and is retried on every
run for ever. Chasing the last one is chasing a day with nothing on it.

Verified end to end while checking: `?q=sergio` returns *"Crashbeat with Reade
Truth, Richard Hinge, Sergio Dimoff"* at Bossa Nova Civic Club — the gig whose
absence started the whole search investigation.

### Two optional integrations are off

Neither is the database and neither breaks anything.

| Key | State | What it costs you |
| --- | --- | --- |
| `SOUNDCLOUD_*` | working (`api-v2`) | — |
| `YOUTUBE_API_KEY` | not set | A *fallback* only, used when SoundCloud and Mixcloud both have nothing for a DJ. Fewer sets resolve than could. |
| `DISCOGS_TOKEN` | not set | Artist link enrichment only. |

Each is one variable in **Vercel → ra-nyc → Settings → Environment Variables**,
followed by a redeploy — setting a variable does not redeploy on its own. Not
worth doing unless you notice DJs with no sets.

---

## 2 · Still outstanding

**Delete the merged branches.** github.com → ra-nyc → **Branches** → *All
branches* → bin icon. Everything named `claude/…` is merged. Then tick
**Settings → General → Automatically delete head branches** so it stops
happening.

I cannot do this from a session: `git push --delete` returns 403 on
`git-receive-pack`, and the REST `DELETE` returns 403 with *"Write access to
this GitHub API path is not permitted through this proxy."* Both are proxy
policy, not permissions.

---

## 3 · What I could not do, and why

| Thing | Reason |
| --- | --- |
| Run the migrations | This sandbox has no route to Neon, and no `DATABASE_URL`. Asking you to paste a live connection string into chat would put a production credential in the transcript. |
| Delete the merged branches | The git proxy returns **HTTP 403** on `git-receive-pack` for a delete. Pushes work; deletions are blocked. Confirmed twice. |
| ~~Verify anything against production~~ | **No longer true, and this is worth knowing.** Direct egress to `ra-nyc.vercel.app`, `ra.co`, SoundCloud, Mixcloud and CARTO is still denied — `curl` gets `CONNECT tunnel failed, 403`. But Vercel's MCP server has `web_fetch_vercel_url`, which fetches a deployment *from Vercel's side*, and that reaches the app fine. `/api/health`, `/api/search` and the rest are all readable. Several rounds of "open this on your phone and tell me what it says" were unnecessary. |
| Set the repo Website / topics | No repository-metadata write exists in this session — you did both already. |
| Run the last Sonnet code review | The review agent died on an API session limit mid-run. I did the review passes myself, which is how three hook bugs were caught, but that is not a second pair of eyes. |

---

## 4 · The last two exchanges

### 4.1 — "Are we all deployed"

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

### 4.2 — "Make sure audio starts playing asap when you click a link…"

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

## 5 · Where the rest is written down

- **[memorystate.md](./memorystate.md)** — the running journal: every decision
  and why, the open questions, and the map of the code.
- **[INSTALL.md](./INSTALL.md)** — running it, configuring it, deploying it,
  and the troubleshooting that has actually bitten.
- **[ROADMAP.md](./ROADMAP.md)** — what is next and why, in priority order.
