# Agent transcript — player, playlist and search investigation

**Session:** 2026-10-26 · repo `ra-nyc` at `84ece05` (main)
**Orchestrator:** Fable 5.1 (this session) — briefs, relays, final decisions, repairs, ship
**Manager:** Opus 5 — consolidates the nine reports, ranks, writes the repair plan
**Investigators:** three per area, one Sonnet lead + two Haiku specialists

| Area | Agent | Model | Remit |
|---|---|---|---|
| PLAYER | P1 | sonnet | PlayerContext state machine, SoundCloud widget adapter, iframe reuse |
| PLAYER | P2 | haiku | Timeline: position/duration/seek, stale ticks, scrub |
| PLAYER | P3 | haiku | Media Session, errors, background/foreground, stop/close |
| PLAYLIST | L1 | sonnet | enqueue / playNext / jumpTo / removeAt / dedupe / index drift |
| PLAYLIST | L2 | haiku | usePlaylistAdd + useEventPreview resolution, pending, races |
| PLAYLIST | L3 | haiku | Playlist panel UI, counts, live marker, expand/collapse |
| SEARCH | S1 | sonnet | Artist resolution: RA → SoundCloud match; use RA origin as a signal |
| SEARCH | S2 | haiku | Fuzzy event search against production; known cases; misses |
| SEARCH | S3 | haiku | Failsafes: empty/wrong SoundCloud, Mixcloud fallback, timeouts |

Rules given to every investigator: investigation only — no edits to `src/` or `api/`; probe scripts allowed under `tests/agent-*.mjs`; each agent has its own `E2E_PORT`; report findings with evidence (file:line, what was run, output), a severity (blocker / bug / papercut / not-a-bug), reproduction steps, a concrete proposed fix, and a cross-area tag where a finding touches another team's remit. Do not invent bugs; say when something could not be reproduced.

Reports and relays below are verbatim. The nine opening briefs are summarised to their remit (the shared rules are in the table above); the full brief text is in the session's tool log.

---

## 00 · Orchestrator → all nine investigators (briefs, in parallel)

**→ P1 (sonnet)** State machine in `PlayerContext.tsx`: desync of `playing` vs widget after `load()`/FINISH/ERROR/`stop()`; index drift across `removeAt` before current, `jumpTo` while loading, `playNext` at the end, `enqueue` of the current set; stale closures handed to `bind()` once; iframe host on StrictMode/unmount/stop (hidden iframe still playing?); whether `listened` ticks while paused. Run the suite once, probe the gaps.

**→ P2 (haiku)** Timeline: late `getDuration`, stale PLAY_PROGRESS from the outgoing track, seek before ready / past duration / to 0, `max={length||1}`, `commitScrub` paths where `scrubbing` is set but never committed, per-tick seeks while dragging, bubble legibility at largest text, `formatClock` edge cases. One probe: no old-position frame after `load()`; h:mm:ss for a 2h set; seek-to-90%-then-next starts at 0:00.

**→ P3 (haiku)** Media Session: `playbackState` on pause/play/stop, metadata cleared on `stop()`, handlers removed on unmount, `seekto`, `setPositionState`. Errors: who sets `error`, does ERROR advance/stall/skip, does it clear on next set, can it stick in the bar. Stop/close: is audio halted before the bar unmounts, is `--player-h` reset, is the queue cleared. Visibility. Commands while `loading`. One probe: ERROR mid-track, then stop → metadata null and `--player-h: 0px`.

**→ L1 (sonnet)** Queue mutators: `removeAt(i<index)` keeps current; `removeAt(index)` what plays and does it autoplay; remove the last/only; `enqueue` of an existing set (dropped/moved/duplicated); `playNext` of current; `enqueue` onto an empty queue (starts or sits?); `setQueue`+`setIndex` tearing; FINISH at end (stop/loop/stuck); `artistName` per-set vs per-queue on a mixed night; any persistence. One probe over a 5-set queue.

**→ L2 (haiku)** `usePlaylistAdd` / `useEventPreview`: `pending` as a single slot clobbered by a second tap; double-tap double-enqueue; date change mid-resolution; artists with no sets (silent/stuck); `fetchQuery` rejects and 429 clear `pending`?; "Preview the night" replacing a built playlist via `playSets`; what `previewSet` picks. One probe with routed `/api/artist` (sets, empty, 1.5s delay).

**→ L3 (haiku)** Panel UI: `${id}-${position}` keys remounting rows on remove; "N of M" after `removeAt` before live; marker on `jumpTo` while loading; live row scrolled into view in `max-h-[38vh]`; panel open when queue shrinks below 2; `--player-h` covers the panel; `aria-current`/labels/badge reading; Tickets link pushing the row.

**→ S1 (sonnet)** Artist resolution: what RA's GraphQL exposes (country/residency?) vs what `resolveRa` requests; design the owner's **RA-origin signal** into `ArtistContext.terms` and/or direct comparison with SoundCloud `city`/`country_code`; three adversarial same-name cases traced through `isPlausibleMatch` + ranking; failsafes (Mixcloud → archive, reject-all returns empty?, sticky wrong/empty DB cache with `s-maxage=604800`, propose a bearer-gated refresh); resolve 3–4 real NYC DJs on production if `web_fetch_vercel_url` is available. Standing rule: never scrape a SoundCloud `client_id`.

**→ S2 (haiku)** Fuzzy search: scoring fields, edit-distance threshold, multi-word, diacritics, punctuation, `MIN_QUERY`; ~20 realistic NYC queries against production (expected / got / rank / ms); precision vs recall failures; is `event.artists[]` indexed; second-word-only queries; client debounce/abort/recent-searches.

**→ S3 (haiku)** Failsafes: upstream timeouts and serial vs parallel resolvers; partial failure poisoning the result; empty results written to DB (sticky); 60/min rate limit vs 6-artist prefetch + whole-night add → 429 handling (retry storm? `Retry-After`?); `soundcloud: "off"` surfaced in UI?; zero-set sheet with a manual "search SoundCloud for X" fallback; empty search state; offline. One probe routing `/api/artist` to `[]`, 429, and a 12s delay.

*(waiting on reports)*

## 01 · P3 (haiku, Media Session / errors / lifecycle) → Orchestrator — REPORT

*Delivered after 22 tool uses, 4m54s. Probe: `tests/agent-p3-lifecycle.mjs`. Did not run the full player suite.*

No `src/` or `api/` files were edited. The only new file is the probe `tests/agent-p3-lifecycle.mjs`, which is untracked. Run it with `E2E_PORT=5503 node tests/agent-p3-lifecycle.mjs 2>&1 | tail -120`. It exits 1 on any failure, and every check is written so PASS is the healthy behaviour. I did not run `tests/player.e2e.mjs`. The first run gave 12/16. I then relabelled one check so its PASS meant healthy and did not re-run, so the current file would show five FAILs: findings 1 to 4, plus 5 is the position check, not an error check.

Findings 1 to 4 are reproduced in the probe. Findings 5 to 8 are code-derived or unverifiable here. No blockers.

### 1. Pause tapped during a track swap is overridden · bug · cross-area: PLAYER adapter
- **Evidence:** Probe Phase 4. Next was tapped, then Pause within the swap window. Right after the tap: `toggle=Play state=paused timers=0`. 2.5s later: `toggle=Pause state=playing timers=1`.
- **Code:** `src/lib/players/soundcloud.ts:193` loads with `auto_play: true` and `callback: start`. `start()` at `:179` calls `widget.play()` unconditionally. Nothing records that the user paused. The bar has no loading guard: `PlayerBar.tsx:310-312` shows a spinner but leaves the button enabled, and `PlayerContext.tsx:393-398` `toggle()` does not check `loading`.
- **Reproduction:** Start a set, tap Next, then tap Pause before the swap completes. On a slow phone the window is seconds long.
- **Proposed fix:** Keep an intent flag in the adapter. `play()` sets it true and `pause()` sets it false. `start()` plays only if the flag is true. Load with `auto_play: false`, because `auto_play: true` starts playback regardless of intent. Verify on iOS Safari that the explicit play in the callback is still allowed. The existing comment at `soundcloud.ts:44-46` says the URL flag is what satisfies the autoplay policy.
- **Caveat:** The real widget was not tested. The override follows from `auto_play: true` plus the unconditional `start()`.

### 2. Error text never clears once playback resumes · bug
- **Evidence:** Probe Phase 1, after Play was tapped on the failed track: `subtitle="SoundCloud couldn't play this set." err=true toggle=Pause state=playing timers=1`. The track is audible and the subtitle is still red.
- **Code:** `PlayerContext.tsx:206-209` `onPlay` sets `loading` and `playing` but not `error`. `error` is cleared only when a new set starts (`:171`). The error also replaces the whole subtitle, hiding the artist name and "1 of 9" (`PlayerBar.tsx:128-130`).
- **Reproduction:** Emit ERROR mid-track (`window.__failLast()` in the probe), then tap Play.
- **Proposed fix:** In `onPlay`, add `setError(null)`.

### 3. A set whose player failed to build cannot be retried from its row · bug · cross-area: ArtistSheet
- **Evidence:** Probe Phase 3, with `api.js` blocked. Subtitle: `Could not load https://w.soundcloud.com/player/api.js`, `toggle=Play`. After the network was restored, the same set's row was tapped: the error stayed and no timers started. The bar's Play was tapped: same result.
- **Code:** The catch at `PlayerContext.tsx:227-234` leaves `handleRef` null. The row calls `toggle()` (`ArtistSheet.tsx:186`), and `toggle()` returns early when there is no handle (`PlayerContext.tsx:393-398`). The load effect is keyed on `current?.id` (`:240`), so re-selecting the same set does not re-run it. Only a change of index (Next/Previous or another row) re-runs it.
- **Reproduction:** Block `w.soundcloud.com/player/api.js`, open a DJ, restore the network, tap the live row.
- **Proposed fix:** Keep a retry counter in state. Bump it in `toggle()` when `current` exists and there is no handle, and add it to the effect's dependencies.
- **Not probed:** Reopening the sheet. By code, `playSets(…, 0)` with the same index also does not re-run the effect.
- **Papercut inside this finding:** The raw URL from `util.ts:22` reaches the user through `PlayerContext.tsx:230`.

### 4. Lock-screen position state is never cleared · papercut
- **Evidence:** Probe Phase 2, after Close: `posLast={"position":3,"duration":3600}`, `posNullCalls=0`. Probe Phase 4, during a swap to a set with no duration: `lock title=Set Number 2`, `posLast={"position":1,"duration":3600}`.
- **Code:** `src/lib/mediaSession.ts:63-65` returns early when duration is unknown, so a previous position state is never replaced. `PlayerContext.tsx:276-278` is the only caller.
- **Proposed fix:** In that early-return branch, and in `stop()`, call `navigator.mediaSession.setPositionState()` with no argument to clear it. Per the Media Session spec this clears the state. I did not verify this in this Chromium.

### 5. Error replaces the queue context and gives no next step · papercut / design question
- **Evidence:** Probe Phase 1. For 2s the title stayed on "Set Number 1" with no auto-advance and no message about skipping. The lock screen stayed on the failed set with `state=paused`.
- **Code:** `PlayerBar.tsx:128-130` replaces the subtitle with `error`.
- **Proposed fix:** Keep the artist and "n of N" line and append the error, or add a "Skip" affordance. Auto-advance is a product decision.

### 6. Mixcloud and Archive have no `load()`, so every track change rebuilds the player · bug (unverified) · cross-area: PLAYER adapters
- **Evidence:** Code only, not probed. `mixcloud.ts:73-83` and `archive.ts:76-92` return handles with no `load`. `PlayerContext.tsx:176` therefore destroys and rebuilds on every track change. `types.ts:23-31` says a rebuilt iframe loses user activation, which is the "second tap" problem the reuse path was built to fix.

### 7. Mixcloud iframe can be left behind when a set is stopped or fails during creation · papercut
- **Evidence:** Code only. `mixcloud.ts:47-51` appends the iframe before `await widget.ready`. `PlayerContext.tsx:221-222` destroys a cancelled handle only after `create` resolves. If `ready` never settles or rejects, nothing removes the iframe.
- **Proposed fix:** Wrap the `ready` await in try/catch that removes the iframe.

### 8. Background playback and lock-screen controls on iOS · unverified
- **Evidence:** No `visibilitychange`, `pagehide` or `pageshow` listeners exist in `src/` (grep returned none). SoundCloud and Mixcloud audio lives in a cross-origin iframe, not in this document. Only Archive's `<audio>` is in-document.
- **Note:** Whether Safari routes lock-screen controls to a cross-origin iframe's audio cannot be tested here. This needs a real iPhone with the screen locked.

### Ruled out
- **Metadata cleared on stop:** Probe shows `metadata null` after Close. The metadata effect runs with `current` null (`PlayerContext.tsx:254-256`), and `stop()` clears the queue (`:424`).
- **`playbackState` on pause, play and stop:** Probe shows `paused` after Close and after Pause (`PlayerContext.tsx:258-260`).
- **Action handlers unbound on stop and unmount:** Probe shows all six actions `cleared`. `bindHandlers(null)` runs in the effect cleanup (`PlayerContext.tsx:437-450`, `mediaSession.ts:87-98`).
- **`--player-h` reset:** Probe shows `0px` after Close. The `PlayerBar.tsx:88-107` cleanup resets it on stop and on unmount.
- **Stop halts audio (SoundCloud):** Probe shows 0 widget timers and 0 host iframes after Close. `soundcloud.ts:204-213` pauses then removes the iframe. Mixcloud (`mixcloud.ts:79-82`) and Archive (`archive.ts:84-91`) also pause and remove, by code only.
- **Stop during creation:** A handle that resolves after stop is destroyed (`PlayerContext.tsx:221-222`). The SoundCloud adapter creates synchronously after `loadScript`, so it has no window.
- **Error does not leave the spinner on:** `setLoading(false)` runs on error (`PlayerContext.tsx:214`).
- **Error clears when the next set starts:** `PlayerContext.tsx:171`, by code. Not probed directly.
- **`seekto` ignores `seekable`:** The handler is bound unconditionally and `seek()` does not check the flag. All three adapters return `seekable: true`, so this does nothing today.
- **Stop action mapped to pause** (`mediaSession.ts:105`): a design choice, not a bug.
- **Stale Archive listeners after destroy:** The old element's `pause` event fires before the next track's `onPlay` could, so there is no clobbering. By reasoning, not probed.
- **Probe `error`:** The `error` in the mediaSession spy was checked for stale state only. No `window.onerror` was involved.

## 02 · Orchestrator → P1 (relay of P3's cross-area findings)

P3 has three findings in your remit that you should fold into your trace of the adapter and the load effect — do not re-derive them, confirm or refute them: (1) `soundcloud.ts:193` loads with `auto_play: true` and `start()` at `:179` calls `widget.play()` unconditionally, so a Pause tapped during a swap is overridden ~2.5s later — P3 reproduced this; (2) when `create` throws, `handleRef` stays null and the load effect is keyed on `current?.id` (`PlayerContext.tsx:240`), so re-tapping the same row never retries; (3) Mixcloud (`mixcloud.ts:73-83`) and Archive (`archive.ts:76-92`) return handles with no `load()`, so `PlayerContext.tsx:176` rebuilds the iframe on every track change for those providers — unverified by P3, code only. Include your verdict on each in your report.

## 03 · S2 (haiku, fuzzy search) → Orchestrator — REPORT

*Delivered after 29 tool uses, 3m55s. Probes: `tests/agent-s2-matcher.mjs`, `agent-s2-probe-matcher.mjs`, `agent-s2-probe-null.mjs`, `agent-s2-probe-typo.mjs`. Did not run `search.e2e.mjs`.*

**Production search is down right now.** Every `/api/search` request I sent returned `500 {"error":"Search failed"}`, including `house`, `villalobos`, `koze` and a typo query. `/api/health` is fine (index 164 of 166 days). The cause is finding 1. I could not complete the production query table, so the recall and precision results below come from the matcher run locally against the real `api/_lib` code, plus code reading.

### Findings

1. **Production search outage · blocker · cross-area SEARCH-LEAD**
   - **Evidence:** `get_runtime_errors` (project `prj_PeaknPbv6DenbJgnwy6Qd1Jpbqot`, last hour) shows `[api/search] unexpected failure TypeError: Cannot read properties of null (reading 'flyerFront')` at `api/_lib/ra.ts:137`, first seen 19:16:40 UTC, on deployment `dpl_68hyQAYxF3FHHJkqrcQLu1pSaUrg`. One RA listing row has `event: null`. `transformListing` (`ra.ts:132-137`) dereferences `listing.event` with no guard. `collect` maps the whole page array at `ra.ts:541` (`pages.flat().map(transformListing)`), which sits outside the per-request `.catch` at `ra.ts:528`. So one bad row fails the entire search, and `api/search.ts:108-109` turns that into the generic 500.
   - **Reproduction:** `tests/agent-s2-probe-null.mjs` (run with `node`) shows `transformListing({id:"2", listingDate:"…", event:null})` throws `Cannot read properties of null (reading 'flyerFront')`. Any search whose live windows include that row fails, whatever the query.
   - **Proposed fix:** filter `listing.event == null` before transforming, and guard inside `transformListing`. Move the transform inside the per-request `try` in `collect`, so one bad row costs one window rather than the search. `fetchRAEvents` at `ra.ts:240` uses the same `map(transformListing)`, so the day view is probably exposed too. I did not verify that.
   - **Status:** still failing at 19:17:51 UTC. The bad row sits in a live window, so it persists until it ages out or the fix ships.

2. **Vocabulary entries match as substrings · bug · SEARCH-LEAD**
   - **Evidence:** `vocab.ts:34` (`bass` includes `uk`), `vocab.ts:43-44` (`queer` includes `unter`), `vocab.ts:50` (`live` includes `av`). The live matcher (`ra.ts:444`) and the SQL predicate (`eventCache.ts:270`) both use substring `includes`/`like`.
   - **Probe results:** `live` matches "Unrelated Night / Nowadays / Dave Clark" (via `av`). `bass` matches "Luke Hall / Luke Hess" (via `uk`). `queer` matches "Hunter" and "Gunter" (via `unter`).
   - **Reproduction:** `node tests/agent-s2-probe-matcher.mjs`.
   - **Proposed fix:** match vocabulary keys on word tokens, or drop the 2–4 character entries (`av`, `uk`, `tba`, `raw`, `late`, `trans`).

3. **No relevance ranking · bug · SEARCH-FAILSAFE**
   - **Evidence:** `upcoming` is sorted by date ascending and `past` by date descending, then sliced to 60 (`ra.ts:667-668`, `676-677`). Nothing ranks an exact artist match above a substring hit. In the index path, `searchCachedEvents` takes its 120-row cap ordered by distance from today (`eventCache.ts:285`). For a broad term, a real artist's distant match can fall outside that cap.
   - **Reproduction:** logic reading. The date-only order is what finds junk "ranked above the obvious hit". Any broad term (`live`, `day`, `ko`) shows it.
   - **Proposed fix:** tiered score. Exact artist name first, then artist token, then title or venue substring, then fuzzy. Sort by date within each tier.

4. **Typo recall gap for a single 4-letter word · bug · SEARCH-LEAD**
   - **Evidence:** `FUZZY_MIN_LENGTH = 5` (`ra.ts:408`). Words under 5 characters get no edit-distance pass. `kozz` (one substitution from `koze`) → `false`. `dj kozz` → `true`, because the pair `djkoze` is in the pool. `dj kose` → `true`.
   - **Reproduction:** `node tests/agent-s2-probe-typo.mjs`.
   - **Proposed fix:** allow one edit for 4-letter words, compared only against 4–5 letter haystack words, to keep the match set small.

5. **Non-Latin names erased to an empty key · papercut**
   - **Evidence:** `normalize.ts:40` (`[^a-z0-9]+`) removes all non-Latin characters. `searchKey("Кирилл")` is `""`, so `expandTerm` returns `[]` and the search finds nothing, even when the title contains the exact name. `ψ` behaves the same.
   - **Reproduction:** `node tests/agent-s2-probe-matcher.mjs` (rows `Кирилл`, `ψ`).
   - **Proposed fix:** when the folded key is empty, fall back to a lowercase raw comparison.

6. **Index path matches across field boundaries · papercut**
   - **Evidence:** `eventCache.ts:131-135` joins title, venue and artists with a space, then `searchKey` strips it. The index haystack for "Vanilla / Nowadays / Sam" is `vanillanowadayssam`. `llanow` matches via the index substring but not the per-field live matcher. The result depends on whether an event happens to be indexed. `searchCachedEvents` (`eventCache.ts:290`) returns indexed rows without calling `matchesTerm`.
   - **Proposed fix:** post-filter indexed hits with `matchesTerm`, as the live path already does.

7. **Empty searches are remembered · papercut · client**
   - **Evidence:** `SearchSheet.tsx:124-137` banks `data.q` whenever a response arrives, including zero-result responses. A typo that found nothing takes one of the six recent slots.
   - **Proposed fix:** only remember when `upcoming.length + past.length > 0`.

8. **Orphaned doc comment · papercut**
   - **Evidence:** `eventCache.ts:434` ("Days inside a window that the index has nothing at all for.") sits above the `staleDays` doc block, not above `missingDays`.

### Query table

**Production, attempted:** `villalobos`, `ricardo villabos`, `house`, `koze`, `villalobos` (retry). All returned 500 "Search failed". Rank and latency are not available. I stopped probing production once the cause was confirmed, to avoid adding noise to the error group.

**Local matcher (`matchesTerm` against a single event):**

| Query | Expected | Result | Note |
|---|---|---|---|
| `dj koze` | DJ Koze | true | ok |
| `koze` | DJ Koze | true | ok |
| `dj kose` | DJ Koze | true | ok, pair pass |
| `dj kozz` | DJ Koze | true | ok, pair pass |
| `kozz` | DJ Koze | false | finding 4 |
| `hélène` | Hélène | true | ok, diacritic folded |
| `ø` | Øyvind | true | ok |
| `ko` | none | false | correct (no match in event) |
| `live` | none | true | false positive, finding 2 |
| `bass` | none | true | false positive, finding 2 |
| `queer` | none | true | false positive, finding 2 |
| `Кирилл` | Кирилл | false | finding 5 |

### Ruled out

- **`MIN_QUERY`:** client `useSearch.ts:14` and server `search.ts:29` both use 2 and agree. Two-character names are reachable.
- **Diacritics:** `hélène` → `helene` and `ø` → `o` match correctly.
- **Punctuation and case:** `A-Trak` → `atrak`, `Dj. Koze` → `djkoze`, `ALL CAPS` folds to `allcaps`. `$hi` → `shi` is deliberate leet-folding on both sides.
- **Artists-only names:** `event.artists` is in the haystack (`eventCache.ts:131-135`) and in the live matcher (`ra.ts:436`). Artist-only names are indexed. The residual risk is stale index keys, which `staleDays` already addresses.
- **Debounce and abort:** 350 ms debounce (`useSearch.ts:17`). The signal is passed to `fetch` (`useSearch.ts:22`), and react-query v5 cancels a fetch when its last observer leaves. This is from code reading, not browser-verified.
- **`keepPreviousData`:** avoids a flash of empty results (`useSearch.ts:57`).
- **Minor:** `retry: 1` (`useSearch.ts:58`) also retries a 429 immediately. Harmless, but wasteful.

I did not run `tests/search.e2e.mjs`. Production is down, and the e2e run would not have told me anything new about ranking or the outage. The unit suites `searchIndex`, `normalize`, `vocab` and `recentSearches` pass (42 tests). Nothing under `src/` or `api/` was edited.

## 04 · S1 (sonnet, artist resolution lead) → Orchestrator — REPORT

*Delivered after 23 tool uses, 4m32s. Probe: `tests/agent-s1-match-probe.mjs` (run with `npx vite-node`).*

**What I could and could not do.** The Vercel `web_fetch_vercel_url` tool worked, so I queried production for health, search and five artists. Direct `curl` to `ra.co/graphql` returned `CONNECT tunnel failed, 403`. I therefore could not introspect RA's schema, and anything I say about RA's fields is recalled, not verified. Nothing in `src/` or `api/` was edited. `npm run test` passes with 198 tests, although CLAUDE.md still says 156.

**Side effect to know about.** Artist `173682` (Gianna (US)) was not cached, so my request ran a live resolve and wrote a `link_source='none'` row to the production `artist_links` table. The other four requests were cache hits. By the stickiness described in finding 9, that row stays until someone deletes it.

### Findings

**1. RA's `biography` field very likely never returns anything, so the handle and term machinery is inert in production · bug (high)**
- **Evidence:** `resolveRa` asks for `artist(id:$id){ contentUrl biography }` and silently retries without `biography` on any GraphQL error. It logs nothing. In 5 of 5 production artists, `bio.source` was never "Resident Advisor". Cosmo (NY) and Galcher got a Mixcloud bio, Cosmo 4421 got a SoundCloud bio, Colleen got a Mixcloud bio, and Gianna got none. I recall from third-party RA scrapers (not verified here) that `biography` is an object type (`biography { id blurb content discography }`). Selecting it as a scalar would be a validation error, which the retry then hides.
- **Reproduction:** from a machine with RA access, run `{ __type(name:"Artist"){ fields{ name type{ name kind ofType{ name } } } } }`. Failing that, send the current query and read `errors[0].message`.
- **Fix:** Add `console.warn("[ra] artist query errors", errors[0]?.message)` so the cause shows up in logs. Replace the all-or-nothing query with small independent queries run in parallel inside `RA_TIMEOUT_MS`: `{contentUrl}`, `{country{name urlCode}}`, `{residentCountry{name urlCode}}`, `{soundcloud instagram}` and `{biography{blurb content}}`. One unknown field then cannot discard the others.
- **Cross-area:** SEARCH-FAILSAFE.

**2. Origin (country) is not requested anywhere · improvement**
- **Evidence:** the only artist query is the one above. Event listings carry `artists{id name}` only (`api/_lib/ra.ts:92`). Full design is at the end.
- **RA schema, recalled and unverified:** `country{id name urlCode}`, `residentCountry{...}`, `soundcloud`, `instagram`, `bandcamp` and `website` fields. Country is coarse, and I do not recall a city field. That is why the `(NY)` parenthetical matters more for city.

**3. A confirmed wrong match: Cosmo (NY), RA 103962 · bug**
- **Evidence:** production returned Mixcloud `djcosmo_sns` and set the artist sheet's bio to that account's text: "DJ Cosmo is a Southwest Florida-based DJ…". RA lists this artist as NY. `isPlausibleMatch("Cosmo (NY)","djcosmo_sns")` is false in my probe, so the match came through the Mixcloud display name "DJ Cosmo" (the leading-`dj` affix). Because RA's bio is null (finding 1), the wrong person's bio is shown as the NYC DJ's bio. The SoundCloud pick is user "Cosmo" at `soundcloud.com/cosmobandz`. I could not verify whether that is right. It also carries a Club 89 WNYU 1990s set from `djmtraxxx`, and a "Blackpool NY Podcast #3: Cosmo Hamada…" set that is almost certainly a different person.
- **Fix:** the ranking in finding 2 and the RA fields in finding 1.

**4. `contextScore` is noisy and misses the obvious · bug**
- **Evidence (probe):** The parenthetical `NY` becomes the term `"ny"` and is matched as a raw substring. Score 1 for "company@…", and score 1 for "many… funny… sunny". It scores 0 for "Brooklyn / New York resident", which is the text you want it to hit. Place detection also lacks US cities and states (`PLACES` has no miami, houston, florida and so on). The Florida bio therefore never registers as a contradiction.
- **Fix:** Match terms on word boundaries, using the unnormalised lowercase tokens for short terms. Expand region codes: `ny` becomes `["new york","nyc","brooklyn","queens","manhattan"]`, and likewise for `la`, `uk`, `us` and so on. Add US cities and states to `PLACES`.

**5. SoundCloud matching is weak at the account level · bug**
- **Evidence (`artistLinks.ts:459-469`):** `search/users?limit=5` gives a thin pool. Cosmo has far more than 5 same-named accounts. The name test runs on the free-text display `username` only, never on `permalink` (the real handle). Anyone can set their display name to "Cosmo". In production, `soundcloudUser:"Cosmo"` sits next to the URL `…/cosmobandz`, and `isPlausibleMatch("Cosmo (NY)","cosmobandz")` is false in my probe. Ties go to the first search hit. No popularity signal is used: `ScUser` declares only `id, username, permalink_url, description, avatar_url`. `ArtistLink.detail` renders `@${display name}`, which gives "@Colleen Cosmo Murphy" and "@Gianna (US)". That mislabels a display name as a handle.
- **Fix:** see the scoring formula at the end. Also raise the limit to 20 (same single request) and add `permalink`, `full_name`, `city`, `country_code`, `followers_count`, `track_count` and `verified` to `ScUser`, all optional.

**6. `titleMentions` is a substring test, so unrelated sets get adopted · bug (SEARCH-FUZZY)**
- **Evidence (probe, using a verbatim copy of the function):** for the name "Cosmo (NY)" it returns true for "Cosmos Radio Hour", "Cosmopolitan Brunch Mix", "Cosmo Hamada…" and "Lepota Luba Cosmo - Lowest Edge". The same function backs the Archive filter (`artistLinks.ts:672`). Production Cosmo 4421 shows three Archive items that are other artists: "Radio Cosmo – Conspiración…", "Tofat – Cosmo Hip Hop" and "Lepota Luba Cosmo – Lowest Edge", plus a "COSMO Selektor" item I cannot verify.
- **Fix:** Require a word-bounded match on the tokenised title: `new RegExp("(^|[^a-z0-9])"+tokens+"([^a-z0-9]|$)")` against the lowercased title. For names of 7 letters or fewer, also require a separator pattern such as "@ ", " - ", "presents" or "mix". Do not apply the Archive and fallback-search paths to names that tie with several RA artists.

**7. The Archive is not a fallback, and the parenthetical leaks into queries · bug**
- **Evidence:** The comment says "fallback for artists the first two don't cover" and `FALLBACK_LIMIT=4`, but `getArtistLinks` always runs `resolveArchive` and always merges it (lines 1005, 1022-1026). `q`, the Mixcloud `search/?q=` and the Archive `title:("…")` query all use the raw RA name. That includes `(NY)` and `(1)`. Production fits this: the Cosmo (NY) response has zero Archive items and Cosmo 4421 has four.
- **Fix:** Use `searchName = name.replace(/\s*\([^)]*\)\s*/g," ").trim()` for all three queries. Run Archive only when SoundCloud and Mixcloud together yield no sets.

**8. The SoundCloud own-uploads fallback tests the wrong thing · bug**
- **Evidence (`artistLinks.ts:491`):** `if (ownUploads && tracks.length === 0)` checks the raw track count before the 45-minute filter. A matched profile with 50 short tracks never falls back to the scoped track search, which is where Lot Radio or NTS sets live. Those sets are the only ones such a DJ has. `users/{id}/tracks?limit=50` is also only the newest 50, with no paging. Gianna (US) shows this pattern: a matched profile with `sets: []`, `linkSource:"none"`. Whether she actually has sets elsewhere is unverified.
- **Fix:** decide on the post-filter result: `if (ownUploads && setsAfterFilter.length === 0) { fallback search }`.

**9. Transient failures are cached permanently · bug (high, SEARCH-FAILSAFE)**
- **Evidence:** `fetchJson` returns `null` for a 429, a 5xx, a timeout and a genuinely empty result alike. `getArtistLinks` always calls `writeCached`. `readCached` returns any row regardless of age. Migration 0006's own comment admits "nothing in the read path looks at `resolved_at`". Candidate victim: Galcher Lustwerk, RA 44260. Production has `soundcloudUser:null` and a search-link fallback, yet his own `soundcloud.com/galcher-lustwerk` uploads appear among the sets via the title-search fallback. A plain `galcher-lustwerk` account ought to have matched. Either a transient `search/users` failure was cached, or his display name fails the test. I cannot tell which from here.
- **Fix:** `fetchJson` returns a discriminated result `{ok:true,data}|{ok:false,reason}`. Each resolver reports `degraded:true` on any non-OK response. Skip `writeCached` when any provider is degraded, or when RA returned neither a URL nor a country. Send `s-maxage=300` instead of 604800 for that response. In `readCached`, treat `link_source='none'` or empty-sets rows as stale after 24 hours (`resolved_at < now() - interval '24 hours'`). Treat other `auto` rows as stale after about 90 days. Never treat `manual` rows as stale.

**10. There is no invalidation path today · bug**
- **Evidence:** `getArtistLinks(..., {refresh})` exists and has no caller; `grep` shows only the definition. A wrong match lives forever in the DB. The edge cache is `s-maxage=604800` plus `stale-while-revalidate=2592000`. Revalidation hits origin, which serves the same DB row. The browser keeps it 1 hour, and react-query keeps it 1 hour stale and 24 hours gc. Nothing in code ever writes `link_source='manual'`, so that protection only works for hand-run SQL.
- **Fix (minimal, not open):** Move `authorised()` from `api/backfill.ts:106` into `api/_lib/cronAuth.ts` and import it in both files. In `api/artist.ts`, read `refresh=1`. If `CRON_SECRET` is unset, return 503. If not authorised, return 401 with no detail, as backfill does. Otherwise call `getArtistLinks(id,name,{refresh:true})` and respond `Cache-Control: no-store`. Add a `Vercel-Cache-Tag: artist-<id>` response header on normal responses so the edge copy can be purged with the Vercel `invalidate_by_tags` tool. I am not certain tag purging works on function responses; verify it before relying on it. Fixing finding 9 also removes most of the need for manual purges.
- **Process note:** this edits a bearer check. Under CLAUDE.md that is reviewed on the spot, whatever the landing count.

**11. Mixcloud sets have no minimum duration · bug (PLAYLIST)**
- **Evidence:** the Cosmo (NY) sets include tracks of 142 s, 137 s, 135 s, 168 s, 191 s, 215 s, 236 s and 262 s ("Hurts Like Hell", "Revive Parties", "Not Like Us … Remix"). The code comment "Mixcloud is mixes by construction" is wrong in practice. Next-in-queue would play a 2-minute remix.
- **Fix:** apply a Mixcloud floor of about 20 minutes (`audio_length >= 1200`), lower than SoundCloud's 45 because Mixcloud radio shows run short.

**12. A prolific Mixcloud show crowds out everything else · papercut (PLAYLIST)**
- **Evidence:** Colleen Murphy's 50 sets are all weekly "Balearic Breakfast" episodes. `orderSets` sorts date-first and caps at `MAX_SETS=50`, so no SoundCloud or other set appears.
- **Fix:** interleave providers, or cap each provider at 30 before sorting.

**13. Bio-derived handles are decisive with no sanity check · theoretical, not observed**
- **Evidence:** `resolved.username && kind==="user"` is the only check. Today it can never fire in production (finding 1). Once bios work, the first `soundcloud.com/x` in a bio could be a collaborator or label.
- **Fix:** if the resolved user fails `isPlausibleMatch`, demote the handle to a +5 ranking boost. Trust a structured RA `soundcloud` field outright.

**14. Failsafes that work (confirmed in code), so no fix needed · not-a-bug**
- SoundCloud returns nothing: Mixcloud and Archive are not gated on it, because `Promise.all` runs all three in parallel. The name test rejects every candidate: `user` stays `undefined` and the top hit is not used. The link degrades to a search URL. Both providers fail: the response still carries links, a bio if there is one, and `linkSource:"none"`. `isPlausibleMatch` on handle shapes (probe): true for `objekt_official`, `beatricedillonmusic`, `ben-ufo-official`, `jordanrakeiofficial`, `bjorntorske` (from "Bjørn Torske"), `djpython` and `python` in both directions, and `cosmo.music`; false for `cosmos`, `Cosmo Hamada`, `lakutifanpage`, and `objekt-uk` (the accepted cost of the 3-character floor). `cosmo_nyc` passes for both Cosmo and Cosmo (NY), so the name test cannot separate those two.

### Design for the RA-origin signal

Fetch origin from RA, then use it two ways: to rank candidates and to decide whether to refuse to pick one.

**Fetching.** In `resolveRa`, replace the single query with parallel small queries (finding 1) that return `{url, biography, country:{name,iso2}|null, residentCountry:…|null, socials:{soundcloud?,instagram?}}`. Add `origin: {iso2: string|null, places: string[]}` to `ArtistContext`. `iso2` is `residentCountry` else `country` (mapped from `urlCode` or `isoCode`). `places` is the normalised union of the parenthetical expanded through a region table (`NY` → `new york, nyc, brooklyn, queens, manhattan`), the existing PLACES hits from the bio (extended with US cities and states), and the country name. A structured RA `soundcloud` URL goes straight into `context.handles.soundcloud`, using the existing `HANDLE_PATTERNS`. That reuses the decisive `/resolve` path with no new matching code. Every new field must be optional so that an unknown RA field degrades to today's behaviour.

**Ranking.** Replace `pickByContext`'s count with `scoreCandidate`, applied only to candidates that already pass the name test (display name OR permalink OR full_name). Add `city`, `country_code`, `followers_count`, `track_count`, `verified` and `permalink` to `ScUser`. These are recalled from api-v2 user objects and should be verified against one real response; use them only when present.

| Signal | Score |
| --- | --- |
| Country match | `+6` if both `country_code` and `origin.iso2` are present and equal |
| Country conflict | `-4` if both are present and different (soft, since DJs relocate) |
| City match | `+5` if candidate `city` normalised is in `origin.places` |
| Context terms | `+min(hits,4)` using word-boundary matching over description and city |
| Contradicting place | `-4` if the description names a place from the extended PLACES list that is not in `origin.places` |
| Permalink exactness | `+3` if `permalink` normalised equals the artist name |
| Account is real | `+min(3,log10(followers_count+1))`, `+2` if `verified`, `-8` if `track_count===0 && followers_count<10` |

Apply the same shape to Mixcloud, whose search results carry `biog` and, as I recall, `country` and `city` (verify). Mixcloud's `biog` already arrives in the search response, which is exactly what would have flagged the Florida Cosmo.

**Failsafe.** If two or more candidates are exact-name matches and the top score is no better than 0 with a margin of under 3 over the runner-up, return no user. That means a search link, no sets and no bio. This extends the file's "wrong is worse than empty" rule and is what Cosmo (NY) needs when geo data is absent. Mark the response `degraded`, so it is neither cached long nor served long.

**Rollout.** Ship the RA field probing and the logging first, because the signal depends on RA exposing the fields. After deploy, delete rows for artists with a parenthetical or other known collisions: `delete from artist_links where link_source<>'manual' and name ~ '\(' ;`. Cosmo (NY) 103962 and Cosmo 4421 should be re-resolved first as the acceptance test. Add unit fixtures for: a same-named pair (FL and NY Cosmo) with and without `country_code`; `cosmo_nyc` vs `cosmobandz`; the "ny" substring noise; the `tracks.length===0` fallback condition.

**Not verified:** RA's actual `Artist` schema. SoundCloud and Mixcloud `city` and `country` field names. The actual `search/users` hit lists for Cosmo and Galcher. Whether Vercel cache-tag purging works on these responses.

## 05 · L1 (sonnet, playlist queue lead) → Orchestrator — REPORT

*Delivered after 21 tool uses, 5m35s. Probes: `tests/agent-l1-queue.mjs` (T1–T10), `agent-l1-race.mjs` → `.gen.mjs`, `agent-l1-preview.mjs` → `.gen.mjs`. Did not run `player.e2e.mjs`.*

I found five real defects and four smaller issues. The core index math is correct: `removeAt` below the playhead, `jumpTo`, and `playNext` all behave. Nothing under `src/` or `api/` was edited by me. I ran the probes against the real app with the fake SoundCloud widget. They read the provider's context value off the React fiber tree, so they could call mutators the UI never exposes (for example removing the live row). The `source` and `artistName` findings also affect the lock-screen metadata.

### Findings

**1. The bar names the wrong DJ for every set after the first · bug**
- **Evidence:** `artistName` is a single `useState` for the whole queue (`PlayerContext.tsx:112`). `useEventPreview.ts:83` passes the first DJ's name to `playSets`, and `appendSets` takes no name (`:303`). The `name` argument of `enqueue` is used only when the queue is empty (`:328`). `playNext` with a name relabels the whole queue (`:361`). Lock-screen metadata takes the same per-queue value (`:255`).
- **Real-UI run (Preview the night, two DJs):** `after 2nd DJ appended + jumpTo(1) — ids=["sc-4","slow-3"] title=Set slow 3 subtitle=Test DJ · at Test Night · 2 of 2 lock=Test DJ`.
- **API run:** playing Alice's queue then appending Bob's and Carol's sets showed "Alice · at Test Night" on all three tracks. After `playNext(d, "Dave")`, track 1 read "Dave · at Test Night · 1 of 4".
- **Reproduction:** `node tests/agent-l1-preview.gen.mjs`, or the T7 section of `tests/agent-l1-queue.mjs`.
- **Fix:** Make the name per-set. Either store `{set, artistName}` entries in `queue`, or keep a `Map<keyOf(set), name>` in a ref or state. `appendSets` and `enqueue` should record the name for each set they add, and the bar and `publishMetadata` should read it for `current`. For `addNight`, which passes `null`, `usePlaylistAdd` should pass each DJ's name along with its set.

**2. A `+` that resolves late replaces the queue the user started in the meantime · bug (stale closure)**
- **Evidence:** In `usePlaylistAdd.ts:73-77`, `addArtist` calls `enqueue` inside `.then(...)` after the network round trip. That `enqueue` was captured at tap time with `queue.length === 0` (`PlayerContext.tsx:324-334`), so it takes the `playSets(...)` branch. `addNight` (`:92-100`) has the same problem and a longer window, because it waits for up to six requests.
- **Probe output:** `REQ id=98 Slow DJ (tap +, nothing playing)` → `[tap "Test DJ" chip -> artist sheet autoplays] ids=["sc-1".."sc-5"]` → `DONE id=98 (3s later)` → `race: after slow add resolves — ids=["slow-3"] cur=slow-3 name=Slow DJ`.
- **Reproduction:** With nothing playing, tap `+` on a DJ chip with a cold cache. Before it resolves, tap another chip's name. Run `node tests/agent-l1-race.gen.mjs`.
- **Reverse case (by code only, not run):** tap `+` while something is playing, then press X before it resolves. The stale `enqueue` calls `appendSets` onto an empty queue and music starts after the user closed the player.
- **Fix:** Make `enqueue` read live state. Keep `queueLenRef` updated each render, or put the "empty means start" decision inside one `setQueue(q => …)` updater. Alternatively `usePlaylistAdd` can hold the latest `enqueue` in a ref and call `enqueueRef.current` in the `.then`.

**3. `enqueue` dedupe is incomplete: duplicates stall playback · bug**
- **Evidence:** `appendSets` builds `seen` from the existing queue only (`PlayerContext.tsx:309-310`), so duplicates inside one batch both pass. The empty-queue path (`:328-331`) calls `playSets(sets, …)` with no dedupe at all. The comment at `usePlaylistAdd.ts:97` ("`enqueue` dedupes, so a b2b that resolved from both of its DJs goes in once") is false.
- **Probe output:** `FAIL non-empty queue: enqueue([Z,Z,W]) adds Z once — ["sc-1","sc-2","sc-3","sc-8","sc-8","sc-9"]`; `FAIL empty queue: enqueue([Z,Z,W]) starts with Z once — ["sc-8","sc-8","sc-9"]`.
- **Consequence beyond a double play:** the load effect is keyed on `current?.id` (`:240`), so advancing to an adjacent entry with the same id loads nothing. The bar then shows Pause with a frozen timeline and the queue never reaches the next set: `duration-id queue [S,S,T] after S ends — index=1 cur=sc-1 playing=true loads 8->8`; `FAIL [S,S,T]: reaches T eventually — cur=sc-1 index=1 playing=true`. The baseline `[S,T]` advances and loads correctly.
- **Reproduction:** `tests/agent-l1-queue.mjs`, sections T5 and T6. In the app: add a whole night (`+` next to "Preview the night") where two DJs share a b2b recording.
- **Fix:** Dedupe within the incoming batch by adding each key to `seen` as it is accepted (or run `dedupeSets` from `preview.ts` first). Apply the same dedupe in the empty-queue branch of `enqueue`. Also key the load effect on something unique per entry, or on `index` plus id, so a same-id neighbour still reloads.
- **Cross-area:** PLAYER (the effect key).

**4. Opening an artist sheet throws away a built playlist · bug (owner decision on intent)**
- **Evidence:** `ArtistSheet.tsx:92-106` calls `playSets(resolved, 0, name)` unconditionally on open. The `playNext` doc at `PlayerContext.tsx:67-74` says the point of `playNext` is that tapping play "quietly threw away a playlist somebody had just assembled". The auto-start reintroduces exactly that.
- **Probe output:** `FAIL opening an artist sheet keeps the playlist that was built — ["mine-1","mine-2","mine-3"] -> ["sc-1","sc-2","sc-3","sc-4","sc-5"]`.
- **Reproduction:** Build a queue (via `+`), then tap any DJ chip name in the event sheet.
- **Fix:** In the `ArtistSheet` auto-start effect, skip it (or call `playNext(resolved[0], …)`) when a queue already exists. Read the queue through a ref so the effect does not re-fire on every queue change.

**5. `source` is per-queue, so appended sets from another event inherit the party label and ticket link · bug**
- **Evidence:** `enqueue` and `appendSets` never touch `source` (`PlayerContext.tsx:303-335`). The probe showed "Alice · at Test Night" for every appended set, including ones added with a different name.
- **Reproduction:** Start a night preview for event A. Close the sheet and open event B. Tap `+` on a DJ there. That set now reads "… at A", and the Tickets link goes to A's page. Confirmed by the probe; the two-event flow was not driven end to end.
- **Fix:** Store `source` per entry alongside the name (same change as finding 1).

**6. `+` on a set already in the queue is silently ignored, including sets already played · papercut** — Probe T3 passes: `enqueue` of the current set or an earlier set leaves the count unchanged. No feedback; the artist sheet shows `+` on every non-live row. Fix: either let a re-add of an already-played set go on the end, or surface an "Already in playlist" state on the `+`.

**7. `enqueue` after the queue has finished does not start the new set · papercut** — After the last set finishes (`playing=false`, button "Play"), `enqueue([T])` appends but loads nothing: `enqueue(T) after queue finished — index=1 cur=sc-2 playing=false loads 8->8`. The doc comment says "With nothing playing … it starts", but the code tests `queue.length === 0` (`:328`) only. Fix: change the doc, or have `advanceRef` at the end of the queue advance into the next appended set.

**8. `playNext(X)` keeps an earlier copy of X · papercut** — `ids=["sc-1","sc-2","sc-7","sc-5","sc-1","sc-3","sc-4"]`. The filter at `:358` only removes copies after the playhead. Probably intended (history), but inconsistent with `enqueue`. Latent consequence: `removeAt` can make the two copies adjacent, triggering the stall in finding 3.

**9. An unplayable set stops the queue instead of being skipped · papercut** — `onError` (`:212-216`) sets `error` and `playing=false` but never advances. Cross-area PLAYER: Mixcloud and archive adapters have no `load`, so crossing provider boundaries in a mixed queue rebuilds the iframe with no user activation. Code reading only.

### Ruled out (not bugs)
`removeAt(i < index)` keeps `current` (`["sc-2".."sc-5"]`, `index=1`, `cur=sc-3`, `loads 0->0 built 1->1`). `setQueue`+`setIndex` are batched; no tearing in any probe. `removeAt` of the only set calls `stop()`. `playNext` of the current set only resumes; `playNext(X)` twice inserts once; `playNext` of a later set moves it. `enqueue` of the current set is dropped silently. FINISH at the end stops cleanly (`playing=false`, Play showing), no loop, not stuck. `removeAt(live)` is unreachable from the UI; via the API the replacement autoplays even if paused. No persistence anywhere (no `localStorage` in PlayerContext). `hasNext`/`hasPrevious` correct.

## 06 · Orchestrator → P1 (relay of L1's effect-key finding)

L1 reproduced a stall: a queue `[S,S,T]` (same set twice, which `enqueue`'s incomplete dedupe allows) finishes S at index 0, advances to index 1 whose id is identical, the load effect keyed on `current?.id` does not re-run, nothing loads, the bar sits on Pause with a frozen timeline. L1 proposes keying the effect on index plus id. Asked P1 to confirm that is safe against the iframe-reuse path and whether it also serves P3's retry-after-create-failure case, which wants the effect re-triggerable without an index change.

## 07 · Orchestrator — production check on S2's outage

Fetched `https://ra-nyc.vercel.app/api/search?q=house` at 19:20:04 UTC: **HTTP 200**, full result set (65KB). `/api/events?date=2026-10-31`: 200, 48 events. S2's 500s at 19:16–19:17 were real (the runtime error log on `dpl_68hyQAYxF3FHHJkqrcQLu1pSaUrg` is primary evidence) but the offending `event: null` row has since left the live windows. Downgraded from "ship now" to "harden in the repair plan": `transformListing` still has no null guard and `collect` still maps outside the per-window catch.

## 08 · P1 (sonnet, player state-machine lead) → Orchestrator — REPORT

*Delivered after 24 tool uses, 8m05s. Probe: `tests/agent-p1-probe.mjs` (11 scenarios, `E2E_PORT=5501 node tests/agent-p1-probe.mjs <name>`). Stock suite run once: 41/41.*

I found 7 real defects, 3 of them blockers or bugs worth fixing first. Nothing under `src/` or `api/` was touched. Every finding below was reproduced by a probe, which copies `FAKE_SC` and adds knobs for short tracks, ERROR events and delayed `load()` callbacks, plus a fake Mixcloud widget.

### Coordinator's three cross-area items (P3)

**(1) Pause during a swap is overridden: CONFIRMED, bug.**
- `soundcloud.ts:193` loads with `auto_play: true`, and `start()` at `:179` calls `widget.play()` unconditionally. `toggle()` at `PlayerContext.tsx:393-398` has no loading guard.
- Probe `pauseDuringLoad` (load callback delayed 800ms), Next then toggle mid-load: mid-load state `"spinner":true,"playBtn":"Pause"`; widget log `["play","load …/a1/2","pause","play"]`; 2s and 3.5s later position went 1 → 3, "still advancing: the pause was undone".
- The button says "Pause" with a spinner during loading because `playing` is still true from the outgoing track, so the tap looks valid and is then discarded. The initial-build path has the same hole: the READY handler (`:126`) calls `play()` unconditionally, and `pause()` only clears the retry timer.
- **Proposed fix:** the intent flag P3 suggested is right. Add `let wantPlay = true` in the adapter. `play()` sets it true and `pause()` sets it false. `start()`, the READY handler and the retry timers call `play()` only if `wantPlay`. `load()` should reset `wantPlay = true`, since a skip is a request to play.
- **iOS question:** cannot verify here. The comment at `soundcloud.ts:44-46` is about the iframe being *created* inside the tap; that path is untouched because the creation URL keeps `auto_play=true`. On a reused iframe, `types.ts` says the iframe "keeps its activation", so an explicit `play()` in the `load()` callback should work — an assumption, not a measurement. Lower-risk option: keep `auto_play: true` on `load()`, and if `wantPlay` is false call `widget.pause()` inside `start()`. Test on a real iPhone before dropping `auto_play`.

**(2) Same set cannot be retried after create() throws: CONFIRMED, bug.**
- Probe `retryAfterCreateFailure`, with `api.js` aborted on the first request only: after failed load `iframes:0`, subtitle `"Could not load https://w.soundcloud.com/player/api.js"`; after tapping the bar Play: unchanged, 1 api.js request; after tapping the set row (live, so it calls `toggle()`): unchanged; after Close then tapping the set: playing, 2 requests. The raw script URL is shown to the listener as the error text.
- **Proposed fix:** add a `retryNonce` state, included in the effect's deps and bumped from `toggle()` when `handleRef.current` is null. Map the thrown error to a friendly string such as "Couldn't load the player. Tap play to retry."

**(3) Mixcloud and Archive have no `load()`, so every track change rebuilds: CONFIRMED as behaviour; the activation loss is NOT PROVEN.**
- `mixcloud.ts:73` and `archive.ts:76` return handles with no `load`. Probe `mixcloudStaleReady`: two Mixcloud tracks, Next once, `window.__mcBuilt` reads 2; briefly 2 iframes, then M1's is removed. Could not show activation loss — the fake widget does not model autoplay policy. Plausible risk, code-derived; worst for auto-advance, which has no gesture at all. It does cause the real stale-event bug in finding 5.

### My findings

**1. Closing the player is undone by late async resolutions · blocker · cross-area PLAYLIST**
- `appendSets` (`PlayerContext.tsx:303-313`) has no "nothing is playing" guard. After `stop()` the queue is `[]`, so a late `appendSets([x])` makes `queue[0]` current and the effect starts it. `useEventPreview.ts:83-85` calls `appendSets` for each later DJ.
- Probe `stopThenLatePreview` (DJ2 delayed 2.5s): right after Close `"present":false,"iframes":0`; 4.5s later `"present":true,"title":"A2 Set 1","subtitle":"SoundCloud · 1 of 2","playBtn":"Pause","iframes":1`.
- Reproduction: tap "Preview the night", then tap "Close player" before the slowest DJ resolves. The player reopens by itself and plays a set the listener never chose.
- Fix: keep a `stoppedAtRef`/`epochRef` counter that `stop()` increments. `useEventPreview.start` captures the epoch and drops `appendSets` calls if the epoch changed. Alternatively `appendSets` becomes a no-op when `queueRef.current.length === 0` and the caller did not start the queue. The same epoch check should cover finding 2.

**2. `enqueue` closes over a stale `queue.length` · bug · cross-area PLAYLIST**
- `enqueue` at `:324-335` branches on `queue.length` from the render in which it was created. `usePlaylistAdd.ts:75` and `:98-99` call it inside a `.then`, so it is the click-time copy.
- Probe `staleEnqueueReplacesQueue`: tap "+ DJ2" (slow) while nothing plays, then "Preview the night". DJ1 starts: `"A1 Set 1"`. After DJ2 resolves: `"title":"A2 Set 1","subtitle":"DJ2 · SoundCloud"`. The add replaced the queue and interrupted the music; it should have been appended behind A1.
- Mirror case (code reading): queue non-empty at click time, listener closes the player, the late `enqueue` sees a stale length and calls `appendSets`, which reopens the player (finding 1's mechanism).
- Fix: have `enqueue` read `queueRef.current.length`, or decide inside a functional `setQueue` update. `playNext`, `removeAt` and `jumpTo` also read `queue`/`index` from the closure — fine for synchronous UI handlers, same class of risk.

**3. Duplicate ids in the queue desync `playing` · bug · cross-area PLAYLIST**
- `playSets` does not dedupe (`:280-301`). `appendSets` dedupes against the existing queue only, not within its own batch (`:309-310`). The comment on `usePlaylistAdd.ts` ("enqueue dedupes, so a b2b … goes in once") is not true for `addNight` on an empty queue, which goes through `playSets`. `advanceRef` on FINISH just does `setIndex(i+1)` (`:138-141`); the load effect is keyed on `current?.id`, so when the next entry has the same id nothing reloads and `playing` is never cleared.
- Probe `duplicateFromAddNight` (two DJs both resolving to the same upload, 3s tracks): `t=3s A7 Set 1 | SoundCloud · 2 of 2 | pos 3 / 3 | Pause` … `t=9s` identical; widget log `["play","FINISH"]`.
- Fix: dedupe by `url || id` inside `playSets` and within the `additions` batch in `appendSets`. Make the effect depend on something that changes per queue entry, or have `advanceRef`/`next`/`jumpTo` handle "next entry has the same id" by calling `handle.seek(0)` and `handle.play()`.

**4. Opening an artist sheet silently wipes the playlist · bug · cross-area PLAYLIST**
- The auto-start effect in `ArtistSheet.tsx` (~90-106) calls `playSets(resolved, 0, …)` unconditionally. Probe `artistOpenClobbersPlaylist`: before `"A1 Set 1","DJ1 · at Test Night · 1 of 2"`; after only opening DJ2's page `"A2 Set 1","DJ2 · SoundCloud · 1 of 5"`. The party queue, the `source` and its Tickets link are gone, and the music changed.
- Fix: in the auto-start effect, if `queue.length > 0` do not auto-start. Product decision, flagged for the owner.

**5. Superseded adapter builds still emit events · papercut**
- Events passed into `create()` are unguarded (comment at `:193-196`). A build cancelled while `create()` is in flight still calls `events.onReady` before returning. Mixcloud calls `events.onReady(duration)` inside `create`; Archive's `audio.pause()` in `destroy` fires a late `pause` event.
- Probe `mixcloudStaleReady` (M1 ready at 800ms, M2 at 3000ms, Next at ~150ms): ~450ms after Next `"title":"M2 slow","spinner":true,"max":"999"`; ~850ms after Next `"spinner":false,"max":"1111","disabled":false` with only 2 widgets built. M2 is still loading; the spinner is gone and the seek bar is enabled with M1's duration (1111). M2's own is 2222.
- Fix: give each build a `dead` flag. The effect cleanup sets `dead = true` only if the handle has not yet been adopted into `handleRef`. Wrap every event callback in `if (dead) return`.

**6. ERROR is never cleared on later success · papercut**
- `onPlay` (`:206-209`) never clears `error`. Probe `errorSticks`: after ERROR `"playBtn":"Pause","value":"1"`, subtitle `"SoundCloud couldn't play this set."`; 2.5s later `"value":"3"`, same subtitle, still red. Fix: `setError(null)` in `onPlay` and in `onProgress` when position advances.

**7. Resuming the live set resets `listened` · papercut**
- `playSets` always runs `setListened(0)` (`:292`), including the resume branch (`:296-298`). Re-tapping from a party preview's row drops the Tickets link and restarts the 60s clock. Not probed. Fix: skip the reset when the target id equals `currentIdRef.current` and `source` is unchanged.

### Could not reproduce / looked clean
FINISH and end of queue (probe `finishChain`: 1→2→3 with a single iframe, ends on Play, 3/3, loading false). Rapid Next ×3 (coherent, 1 iframe; all three `start` callbacks run since `start()` does not check it belongs to the latest `load()` — could not make it matter; a swap token would be cheap hardening). `removeAt` before current. `playNext` empty/at end. `enqueue` of current (deduped). `jumpTo` while loading (in-flight build cancelled, new one wins). `listened` gating (probe `listenedGate`: 2min paused → none, 30s play → none, 65s play → Tickets; does not tick while paused). StrictMode (not used). Provider unmount order. `stop()` and the hidden iframe (`iframes:0` after Close). Stale handlers (rebound; play/pause read `handleRef.current` at call time). `publishPosition` clamps and try/catches. Not testable here: iOS autoplay after a rebuild, real READY-after-`load()`, whether the real widget emits PAUSE on a swap.

## 09 · P1 → Orchestrator — ADDENDUM (verdict on L1's `[id, index]` proposal, in reply to relay 06)

**1. L1's stall is the same defect as my finding 3, and L1's trace agrees with my probe.** `duplicateFromAddNight` hit it from the UI; at t=3s the bar read "2 of 2", Pause, frozen at 3/3, widget log only `["play","FINISH"]`. Matches L1's `index=1 cur=sc-1 playing=true loads 8->8`. I concur.

**2. Keying the effect on index plus id is not safe. It would restart the playing set whenever an earlier playlist row is removed.** `removeAt` (`:387`) does `if (position < index) setIndex(index - 1)` while the current set's id is unchanged. With deps `[current?.id, index]` the effect would re-run on that decrement, take the reuse branch (`:176-179`), and `load()` swaps the same track back in from 0:00. Reachable in the UI: `PlayerBar.tsx:225` shows the remove X on every non-live row, including rows above the live one. The suite would not catch it — "removing it does not change what is playing" removes a *later* row. Index-keying also breaks: `playSets` with a new queue holding the live set at a different index would reload instead of resuming (the `:296-298` branch; the explicit `play()` there would double-fire); and the `ArtistSheet` auto-start would restart the song if it happened to be the live one. The `load()`/rebuild paths are not the problem; the problem is that index changes carry no intent to reload.

**3. Use an explicit reload nonce instead.** This also covers P3's item (2), which index-keying cannot. Add `const [reloadNonce, setReloadNonce] = useState(0)`; effect deps `[current?.id, reloadNonce]`. Bump it only where a reload is intended: **same-id neighbour** — in `advanceRef`, `next`, `previous` and `jumpTo`, bump when the destination entry's id equals `current.id` (`advanceRef` already has fresh `queue`/`index`; `next`/`previous`/`jumpTo` need to read them from the closure rather than functional `setIndex` updates; batched `setIndex`+`setReloadNonce` make the effect run once and the reuse branch replays from 0). **Retry after a failed create** — in `toggle()`, when `handleRef.current` is null, bump it; the effect takes the rebuild branch, which is exactly what P3's item (2) needs. Nothing is in flight then because the catch has already run; the effect's reset of `position`, `error` and `loading` is right for a retry. Index-keying cannot fix retry at all.

**4. Fix the cause as well.** Dedupe by `url || id` in `playSets` and inside `appendSets`' own batch (finding 3). Optionally make `advanceRef` skip a next entry whose id equals the current one. With those in place the nonce bump for same-id neighbours is a safety net; the retry bump is still required. Findings 1 and 2 (late resolution restarting/replacing the player) still need an epoch or ref guard, independent of this question.

## 10 · P2 (haiku, timeline) → Orchestrator — REPORT

*Delivered after 25 tool uses, 8m20s. Probes: `tests/agent-p2-timeline.mjs`, `agent-p2-paint.mjs`, `agent-p2-hold.mjs`, `agent-p2-stuck.mjs`. Rows sampled per rAF. Did not run `player.e2e.mjs`.*

The timeline core mostly holds. The real problems are a one-frame flash on every track change, a drag that survives a track change, and a stuck scrubber after a keyup.

**1. Track change paints the old track's position and length for two frames · bug · low (visible on every change)**
- Auto-advance at FINISH (`paint.mjs` A, 4s fixture): `commit 7535 Set Number 2 v=4 max=4` / `frame 7535 … v=4 max=4` / `frame 7540 … v=4 max=4` / `commit 7563 Set Number 2 v=0 max=2400 <- seed length`. The Next-click path paints `Set Number 3 v=2 max=4` for two frames before going to 0.
- Cause: `PlayerContext.tsx:170-173` resets `position`/`duration` inside a `useEffect` keyed on `current?.id`; the index (and title) changes in an earlier render, which paints the new title beside the previous track's position.
- Fix: store progress with the set id it belongs to, derive `position = progress.id === current?.id ? progress.at : 0` (same for length); or move lines 170-173 into a `useLayoutEffect`. Cross-area PLAYLIST (`jumpTo`, `removeAt`, `playNext` go through the same index change). The e2e check at `player.e2e.mjs:352-373` samples every 15ms over 300ms and cannot see a 30ms window, which is why this passed.

**2. A drag still held when the track changes is committed to the new track · bug · medium (skips a set)**
- `hold.mjs` D2: mouse held at far right of set 1 (`value 4`, `max 4`). After FINISH, still held: `{"title":"Set Number 2","value":"4","max":"4","bubble":"0:04 / 0:04"}`. On release: `seeks: [4000]`. ~1.5s later the title is `Set Number 3` — set 2 was skipped. D1: keyboard held across Next, set 2 shows `value 4`, bubble `0:04 / 2:00:00`.
- Cause: `scrubbing` (`PlayerBar.tsx:85`) is local state that never resets on track change; `commitScrub` (122-126) seeks whichever track is current.
- Fix: store `{ setId, value }` and commit only when `setId === current.id`; or `useEffect(() => setScrubbing(null), [current?.id])`.

**3. A keyup that lands on another element leaves scrubbing stuck · bug · low**
- `stuck.mjs` D3: hold ArrowRight ×3 on the seek input, click Next mix, release. At 0.0s and 1.5s: `{"title":"Set Number 2","value":"4","bubble":"0:04 / 2:00:00","active":"Next mix"}`. Playhead frozen, bubble stays up while the track plays. A tap on the bar clears it.
- Cause: commit happens only on `onKeyUp` of the input (`:268`). Fix: `onBlur={commitScrub}` plus a window-level keyup listener while scrubbing. Pointer path checked: a mouse drag released outside the input committed one seek and cleared the bubble. Touch implicit capture not tested.

**4. Drag bubble sits on the bar's top edge at the largest text size · papercut** — bar top 614px: default font 10px → bubble bottom 613 (1px gap); `text-size-5` 13.38px → 614 (−0.4); `text-size-5`+`type-late` 14.99px → 615 (−1.1). `-top-7`/`py-0.5` are spacing utilities scaling at 60% while the bubble font scales fully. Fix: anchor in rem, e.g. `bottom: calc(100% + 0.5rem)`.

**5. Seed length is shown while a new track loads · papercut** — after a track change the bar reads `max=2400`, aria `0:00 of 40:00` for one painted frame; `getDuration` returns 0 until parse so the seed stays until PLAY. Scrubber is disabled while loading and the fill is empty, so only assistive tech sees it. Fix: reset duration to `null` on track change, as part of fix 1.

**6. OS seek commands are unclamped and bypass the UI guards · papercut (code-read)** — `mediaSession.ts:107-108` passes `details.seekTime` straight to `seek` (`:408-418`), which has no clamp and no `loading` check. Negative → `position` negative, `--:--` until next tick; past-end → `seekTo` beyond the track. Fix: clamp to `[0, duration]` and ignore while `loading`.

**Ruled out:** duration arriving late (2400→7200 at PLAY, `relativePosition` correction works); stale PLAY_PROGRESS after `load()` (the `swapping` guard at `soundcloud.ts:119,153` works — after Next from 90% no later state shows 6481 for set 2); per-tick seeks during drag (12 input events, 0 seeks); commit count (one per pointerup/keyup); `seek(0)`; seek-to-90%-then-Next (set 2 reads 0:01 after 900ms, no UI seek); past-duration from the scrubber (clamped); seek before ready (disabled); `formatClock` (13 unit tests, all edge cases correct); 2h track `1:01:40 / 2:00:00`; Mixcloud/Archive have no stale-tick path; `max={length||1}` harmless; `seekable` branch unreachable. Theoretical, not reproduced: `onEnded` (`:211`) is not guarded by `swapping` — if the real widget emitted FINISH for the outgoing track after `load()`, the queue would skip a set.

## 11 · L3 (haiku, playlist panel UI) → Orchestrator — REPORT

*Delivered after 30 tool uses, 7m53s. Probes: `tests/agent-l3-playlist.mjs`, `agent-l3-playlist-b.mjs`; logs in scratchpad `l3-probe-a.txt`/`-b.txt`.*

**1. Focus is lost on every removal · bug (a11y, medium)** — after Enter on "Remove Set Number 2 from the playlist": `focus after removing via keyboard: {"tag":"BODY","label":null}`. The X is unmounted with its row and nothing moves focus (`PlayerBar.tsx:226-233`). Fix: after `removeAt`, focus the X of the row now at the same position (or the previous row's); if empty, focus the `ul` (`tabIndex={-1}`).

**2. The playing row can sit below the fold, and nothing scrolls to it · bug (medium)** — panel open, advance to the last row: `{"panelH":252,"scrollTop":0,"scrollHeight":326,"clientHeight":251,"liveTitle":"Set Number 9","liveFullyInPanel":false}`. Same after close/reopen. No `scrollIntoView` in `PlayerBar.tsx`. Fix: on `listOpen`/`index` change, `scrollIntoView({ block: "nearest" })` on `[aria-current="true"]`; check it does not move the page.

**3. The list reopens by itself on the next playback session · bug (minor)** — panel open, Close player, Preview the night: new session shows `Hide playlist` straight away; control run shows `{"panelRendered":false,"listButton":"Show playlist"}`. `listOpen` (`:82`) is never reset; the bar stays mounted through stop because `if (!current) return null` (`:113`) comes after all hooks. Contradicts the comment at `:74-81`. Fix: `useEffect(() => { if (!hasPlaylist) setListOpen(false); }, [hasPlaylist]);` before the early return.

**4. Badge count is missing from the list button's accessible name · bug (a11y)** — `{"ariaLabel":"Show playlist","text":"9","expanded":"false"}`: `aria-label` (`:373`) overrides the badge text. Fix: `Show playlist, ${queue.length} sets`; update `player.e2e.mjs:414` and `:472` which match the exact string.

**5. Tickets chip halves the title on a 390px phone · bug (medium, layout) · cross-area PLAYER** — title width 133px before the chip, 66px after. Chip 64×23 at x=226; list button stays at x=293; bar height 150 both. The chip does not push buttons or panel; it crushes the title. Fix: icon-only chip with a 44px target below a breakpoint, or move it into the subtitle line.

**6. Position-based row keys remount every row after a removal · papercut** — `rowsAfter: 8, survivors: 1`; removing row 2 remounted 7 of 8. No `li` enter animation so likely no flash, only DOM churn. `set.url || set.id` as key is unsafe today because `playSets` does not dedupe (`dedupeSets` in `preview.ts:62` has no caller in `src`). Safe fix: a per-entry id assigned when a set enters the queue — cross-area PLAYLIST-LEAD.

**Ruled out:** N of M after a removal before the live row (`4 of 8` → `3 of 7`, marker stays, `__built` stays 1). Live marker on `jumpTo` while loading moves immediately (matches Next/Previous). `--player-h` with panel open is correct (closed 50/50; open 302/302, `302.3125px`). Live row has no remove button; 8 X's for 9 rows, each 44×44. `aria-current`/`aria-expanded` valid; icons `aria-hidden`. Queue below two with panel open: panel unmounts, no empty list. Panel capped at 252px on 664 (`38vh`), scrollable. No React key warnings. Tickets chip does not change bar height.

## 12 · L2 (haiku, playlist-add resolution) → Orchestrator — REPORT

*Delivered after 29 tool uses, 12m00s. Probe: `tests/agent-l2-playlist-add.mjs` (fresh browser context per scenario — the query cache persists to localStorage and contaminates later runs).*

**1. A slow "+" replaces a queue that started playing while it resolved · bug · PLAYER** — `usePlaylistAdd.ts:75` calls `enqueue` captured at tap time (deps `:79`); `PlayerContext.tsx:328` checks `queue.length === 0` against that stale value and calls `playSets`. Probe S2: `t+1.1s: transport="Alpha · at Night One"` → `t+6s (Bravo resolved ~5.4s): transport="Bravo · SoundCloud"`. Alpha discarded, playback jumped. Reproduction: open Night One, tap "+" on Bravo (4s lookup), ~100ms later tap "Preview the night" (not disabled by the add: `EventDetailsSheet.tsx:321` vs `:339`/`:386`). Fix: decide at resolution time — a ref or functional update inside `PlayerContext`.

**2. A previous night's preview leaks into the next night's taster · bug · PLAYLIST-LEAD** — `useEventPreview.ts:54-55` guards on `event.id` only. A superseded run keeps its own `started` flag (`:67`) and still calls `appendSets` (`:85`); its `finally` at `:93` clears the shared `runningFor` ref while that run is still in flight. Probe S7 at +5s: `queue=["*Delta — set 0","Bravo — set 5"]`, transport "Delta · at Night Two · 1 of 2". Bravo belongs to Night One. Reachable because `EventDetailsSheet` is mounted once for the whole page (`HomePage.tsx:249`), so hook state and in-flight runs survive close and reopen; nothing aborts the fetch. Fix: a per-run token; a run plays or appends only if still current, superseded runs aborted. The same token stops an older run's `playSets` (`:83`) replacing a newer night.

**3. Failed adds are silent because `failed` is set but never read · bug** — `usePlaylistAdd.ts:76`, `:87`, `:96` set `failed`; nothing in `src/components` reads it. Probe S3: `Charlie=enabled feedback=[]`; S4 (every DJ has no sets): `NIGHT=enabled Ghost=enabled feedback=[]`. The spinner stops and nothing else happens. Fix: render `failed` beside the chip or under the night row, reusing the preview's "No sets found for this lineup." copy (`EventDetailsSheet.tsx:350-352`).

**4. Taps are silently dropped while any add is in flight · papercut** — `disabled={playlist.pending !== null}` at `:339`/`:386`; guards at `usePlaylistAdd.ts:70`/`:84`. Probe S1 at +100ms: `Bravo=disabled,spinning Alpha=disabled NIGHT=disabled`. Answer to the race question: `pending` is a single slot but is not clobbered — Bravo cannot be tapped while pending. Double-tap gives one spinner, one entry. Fix: per-key pending set, or let other chips queue.

**5. A failed lookup is retried once, so a 429 doubles request pressure · bug (low)** — `main.tsx:18` sets `retry: 1` as a QueryClient default; `fetchQuery` inherits it. Probe S3: `resp Foxtrot (429)` at +1571ms, `req Foxtrot` at +2580ms, another 429 at +2781ms. Failures are not cached. Fix: `retry: false` on the add path, or do not retry 429.

**6. No client timeout: a hung lookup freezes every add · bug (low frequency)** — `useArtist.ts:10-13` fetches with no timeout; pending holds until settle. Probe S5 at +6s: `Hang=disabled,spinning NIGHT=disabled`. Bound is server-side (`vercel.json` maxDuration 15). Because the sheet never unmounts, closing it does not clear pending. Fix: `AbortSignal.timeout(~8000)` combined with the query signal; on timeout, failed.

**7. Preview wipes a user-built playlist with no confirmation or undo · bug, needs owner decision · PLAYLIST-LEAD / PLAYER** — `PlayerContext.tsx:289` `setQueue(sets)`; preview uses it (`useEventPreview.ts:83`). Probe S6: queue held Delta from Night Two; after Preview Night One, `["*Alpha — set 2","Bravo — set 5"]`, Delta gone. The code comment at `EventDetailsSheet.tsx:314` says intended ("preview *this* means this"). I could not find the owner's wording ("keeps your playlist after the one playing") in `memorystate.md`, `readthis.md`, `ROADMAP.md` or `src`. The `playSets` doc says the play button "keeps the rest", the opposite. Decision needed: replace, append, or confirm.

**8. Downstream dedupe is silent · papercut** — re-adding a queued set dedupes by URL with a spinner and no message.

**9. Mixcloud and Archive have no duration floor · papercut, not reproduced** — `artistLinks.ts:142`/`:501` apply `MIN_SOUNDCLOUD_SECONDS` to SoundCloud only; `previewSet` (`preview.ts:45-53`) checks no duration, so the taster can pick a short Mixcloud upload.

**Ruled out:** duplicate enqueue on double-tap (swallowed by disabled + guard); pending stuck after errors/empties (`resolve()` catches everything, `.then` always runs); add and preview picking different sets (same `previewSet` seed); `previewSet` is a deterministic FNV-1a pick over the first 8 sets, server-ordered newest first; night lineup order preserved by `Promise.all`; date change/close mid-resolution lands adds after you leave (correct for adds; the harmful case is finding 2); unmount is moot (sheet never unmounts; the cost is pending surviving close, finding 6); "+" starts audio when nothing is playing is deliberate per the `enqueue` doc, flagged against the owner's "sound nobody asked for" note; preview single-event guard works for re-taps within one event.

## 13 · Orchestrator — ruling on the "preview/open replaces the playlist" question (P1 #4, L1 #4, L2 #7)

L2 searched the repo for the owner's intent and did not find it because it is not in the repo: it is in the owner's request that opened the playlist work in this session, verbatim — *"you can add sets to the playlist or just hit play and start playing that set which keeps your playlist after the one playing."* Ruling for the manager: **play keeps the playlist.** Opening an artist sheet or tapping Preview while a queue exists should `playNext` (insert after the live set and jump to it), not `playSets`. The `EventDetailsSheet.tsx:314` comment ("preview *this* means this") predates the playlist and is superseded.

## 14 · Orchestrator — status at eight of nine, and the hand-off to the manager

S3 (search failsafes) is still running at 13 minutes; its remit is already substantially covered by S1 #9/#10/#14 and L2 #5/#6. The **Opus manager** is spawned now on the eight reports with instructions to draft, hold, and integrate S3 before finalising; S3's report will be forwarded to it by message and logged here.

Out of band of the hunt: the owner's separate request for a hold-to-expand flyer is built and committed on the working branch (`useLongPress`, `FlyerViewer`, five checks in `preview.e2e.mjs`, 12/12). Two faults the new checks caught before shipping are described in the commit. Not in the manager's scope.

## 15 · Orchestrator → Opus manager (brief)

Read the transcript in full (sections 00–13). Consolidate the eight reports into one deduplicated, severity-ranked, dependency-ordered repair plan grouped by file so `PlayerContext.tsx` is touched in as few coherent passes as possible; for each step name the files, the exact change, which `tests/agent-*.mjs` scenarios to promote into permanent tests, and which existing e2e checks need updating. Adopt or reject P1's addendum vs L1 on effect keying with reasons. Rulings supplied: play keeps the playlist (resolves P1 #4 / L1 #4 / L2 #7); the search outage is a hardening, not an emergency; the flyer feature is out of scope; S1's RA-origin signal is in scope but must degrade safely where RA's schema is unverified; the standing security rules and CLAUDE.md's on-the-spot review for anything touching the bearer check. Include a "not now" list with reasons (phone-only, schema-unverified, product decisions beyond the ruling) and S1's production side effect as an owner action item. Hold the final until S3 is integrated. Write to `agents/repair-plan.md` and return in full.

## 16 · PAUSED — session usage limit

Both remaining agents were terminated by the API session limit (resets 22:00 UTC): the **Opus manager** after reading the transcript and starting on `PlayerContext.tsx`, before producing a plan; **S3** mid-probe, before reporting. Their saved state can be resumed in this session after the reset, or the manager can be re-run from this transcript. The owner has asked to pause and conserve usage.

**State at pause:** eight of nine reports in (sections 01–13). The flyer hold-to-view is committed (`22256b8`). No repairs have been made. The investigators' probes are committed under `tests/agent-*.mjs` as evidence; none are run by the suite.

**Owner's new request, not yet started:** "Need the open maps api" — needs one line of clarification on resume (OpenStreetMap-based API for the venue map, or a keyed maps provider).

**Owner action item from S1:** a `link_source='none'` row for RA artist 173682 (Gianna (US)) was written to the production `artist_links` table by S1's live resolve; sticky until deleted.
