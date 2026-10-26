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
## 17 · Orchestrator → Opus manager (resume after the usage limit)

Resume and finalise from the eight reports; S3 will not report and is not being re-run — its remit is covered by S1 #9/#10/#14 and L2 #5/#6. Do not re-read the transcript; read source only to verify a claim. Split the plan into two lanes touching disjoint files, because that is how it will be executed in parallel: **Lane A** (player/playlist) `PlayerContext.tsx`, `PlayerBar.tsx`, `usePlaylistAdd.ts`, `useEventPreview.ts`, `ArtistSheet.tsx`, `src/lib/players/*`, `mediaSession.ts`; **Lane B** (search/API) `ra.ts`, `artistLinks.ts`, `artistContext.ts`, `vocab.ts`, `api/artist.ts`, `SearchSheet.tsx`, `recentSearches.ts`. Per step: exact change, probe scenarios to promote, existing e2e checks to update. Rulings stand.

## 18 · Orchestrator — Lane B progress while the manager finalises

Four hardenings landed in the working tree, each unambiguous from the evidence and independent of ranking: (1) `transformListing` returns `null` for a listing with no event and both call sites drop it with a warning — S2 #1; (2) `resolveRa` logs the GraphQL error it was silently retrying past — S1 #1's diagnostic; (3) vocabulary expansions match whole words in the live matcher — S2 #2; (4) `matching()` is applied to the indexed rows as well as the live ones, closing S2 #6 and the SQL-side substring hole in one line; (5) a search that found nothing is no longer banked in recent searches — S2 #7. Two unit tests added (null listing; word-bound expansions); the `stubRA` fixture now filters on `listingDate` so it can serve a null-event row. Typecheck clean, units green. The larger S1 resolution rework waits for the plan's ordering.

## 19 · Opus manager → Orchestrator — REPAIR PLAN

*Delivered after 6 tool uses, 8m41s on resume. Written to `agents/repair-plan.md`; reproduced verbatim.*

# Repair plan: player, playlist and search (manager consolidation)

**Base:** `84ece05`. **Inputs:** eight reports (P1 and its addendum, P2, P3, L1, L2, L3, S1, S2). S3 did not report. The orchestrator assigned S3's remit (timeouts, 429, sticky empties, offline) to S1 #9/#10/#14 and L2 #5/#6, and they are counted as S3's contribution below.

**Source checks:** I re-read the source behind every finding the plan acts on. Every file:line the agents cite matched `84ece05`. No claim was wrong on inspection. The plan disagrees with three of them: L1's index keying, S2's blocker severity, and P2 #5's fix. See §1.

**Lanes:** the two lanes touch different files.
- **Lane A** (player and playlist): `PlayerContext.tsx`, `PlayerBar.tsx`, `usePlaylistAdd.ts`, `useEventPreview.ts`, `ArtistSheet.tsx`, `src/lib/players/*`, `src/lib/mediaSession.ts`. Tests: `tests/player.e2e.mjs`, a new `tests/playlist.e2e.mjs`, and the `test:playlist` script in `package.json`.
- **Lane B** (search and API): `api/_lib/ra.ts`, `artistLinks.ts`, `artistContext.ts`, `vocab.ts`, `api/artist.ts`, `SearchSheet.tsx`, `recentSearches.ts`. Tests: `tests/unit/*`. B6 optionally adds `api/_lib/eventCache.ts`, which stays outside Lane A.
- **Lane C** (orchestrator, after both lanes merge): `src/components/EventDetailsSheet.tsx`. It holds the orchestrator's uncommitted flyer work, so neither lane may touch it. Lane A must not add checks to `tests/preview.e2e.mjs` either, because that file is also modified.

---

## 1. Consolidated findings

Severities: B = blocker, b = bug, p = papercut, i = improvement, n = not-a-bug, d = deferred (§3).

### Lane A: player and playlist

| ID | Sev | Finding and sources | Root cause (one line) | Step |
|---|---|---|---|---|
| A-F1 | **B** | **Late resolutions restart or replace the player.** Variants: Close, then a late preview DJ reopens and plays (P1 #1). A late `+` replaces a queue started meanwhile (P1 #2, L1 #2, L2 #1). A late `+` after Close restarts music (L1 #2 reverse case, P1 #2 mirror, by code). | `enqueue` branches on the tap-time `queue.length` (`PlayerContext.tsx:328`, deps `:334`). `appendSets` has no guard for an empty queue or a stopped player (`:303`). Callers run in `.then` with closures captured at tap time (`usePlaylistAdd.ts:75,99`, `useEventPreview.ts:83-85`). | A1, A4 |
| A-F2 | b | **A previous night's preview leaks into the next night** (L2 #2). The older run's `playSets` can also replace a newer night. | `useEventPreview.ts:54` guards on `event.id` only. There is no per-run token, and `finally` (`:93`) clears the shared `runningFor` while the older run is still in flight. | A4 |
| A-F3 | b | **Duplicate entries stall playback** (frozen timeline, Pause showing, never advances). Sources: L1 #3, P1 #3, P1 addendum, L1 #8 (`removeAt` can make an earlier copy adjacent), L3 #6 (keys cannot use url/id until dedupe holds). The `usePlaylistAdd.ts:97` comment ("enqueue dedupes") is false. | `playSets` never dedupes (`:280`). `appendSets` dedupes against the existing queue only, not within its own batch (`:309-310`). The load effect is keyed on `current?.id` (`:240`), so a same-id neighbour never reloads. | A1 |
| A-F4 | b | **Opening an artist sheet or tapping Preview wipes the playlist.** Sources: P1 #4, L1 #4, L2 #7. Ruled by the orchestrator (ruling 1): play keeps the playlist. | `ArtistSheet.tsx:101` and `useEventPreview.ts:83` call `playSets` unconditionally. | A1, A4 |
| A-F5 | b | **Wrong DJ name and party label on every set after the first.** This also affects the lock screen and sends the Tickets link to the wrong event. Sources: L1 #1, L1 #5. | `artistName` and `source` are per-queue `useState` (`:112-113`). `appendSets` and `enqueue` drop the name. `playNext` relabels the whole queue (`:361`). | A1, A4 |
| A-F6 | b | **Pause tapped during a track swap is undone about 2.5 s later.** Sources: P3 #1, P1 (1). Both reproduced it. Confirming the full fix needs a real iPhone. | `soundcloud.ts:193` loads with `auto_play:true`. `start()` (`:179`) and the READY handler (`:126`) call `play()` with no intent check. `toggle` shows Pause because `playing` is still true from the outgoing track. | A2 (+A1 toggle) |
| A-F7 | b | **A set whose player failed to build cannot be retried from its row or the bar.** The raw script URL is shown as the error. Sources: P3 #3, P1 (2). | `toggle` returns early when there is no handle (`:394-395`). Effect deps are `[current?.id]`, so nothing re-runs it. The catch shows `cause.message` (`:230`). | A1 |
| A-F8 | b | **Error text stays red after playback resumes.** Sources: P3 #2, P1 #6. | `onPlay` (`:206-209`) never clears `error`. | A1 |
| A-F9 | p | **A superseded build still emits events.** A stale ready event clears the spinner and enables the seek bar with the old set's duration. Related: a Mixcloud iframe is orphaned when `ready` never settles. Sources: P1 #5, P3 #7. | Events passed to `create()` are unguarded (`:193-196`). `mixcloud.ts:47-51` appends the iframe before `await widget.ready`, with no cleanup. | A1, A2 |
| A-F10 | p | **Resuming the live set resets `listened`**, which drops the Tickets link. Source: P1 #7. | `playSets` always runs `setListened(0)` (`:292`). | A1 |
| A-F11 | b(low) | **The old position and length paint for 2 frames on every track change.** Source: P2 #1. | The reset (`:170-173`) runs in a `useEffect`, after the new title has already painted. | A1 |
| A-F12 | b | **A drag held through a track change is committed to the new track, which skips a set.** Source: P2 #2. | `scrubbing` (`PlayerBar.tsx:85`) is never reset on track change. | A5 |
| A-F13 | b(low) | **A keyup that lands on another element leaves the scrubber stuck.** Source: P2 #3. | The scrub is committed only on the input's `onKeyUp` (`:268`). | A5 |
| A-F14 | p | **OS seek commands are not clamped and are not ignored while loading.** Source: P2 #6. | `seek` (`:408`) has no clamp or `loading` check, and `mediaSession.ts:107` passes `seekTime` straight through. | A1 |
| A-F15 | p | **Lock-screen position is never cleared** on Close or for a set with no duration. Source: P3 #4. | `publishPosition` returns early when `!duration` (`mediaSession.ts:65`). | A3 |
| A-F16 | p | **`enqueue` after the queue has finished does not start the new set.** Source: L1 #7. | `enqueue` only tests `queue.length === 0`. | A1 |
| A-F17 | b | **Failed adds are silent.** Source: L2 #3. | `failed` is set but nothing renders it. | **C1** |
| A-F18 | b(low) | **A 429 on add is retried immediately, and a hung lookup freezes every add.** Sources: L2 #5, L2 #6 (S3's remit). | Default `retry:1` (`main.tsx:18`, `useArtist.ts:50`). No client timeout. | A4 |
| A-F19 | b(a11y) | **Focus is lost on every removal, and the badge count is missing from the list button's accessible name.** Sources: L3 #1, L3 #4. | The X unmounts with its row. `aria-label` (`:373`) overrides the badge text. | A5 |
| A-F20 | b | **The live row can sit below the fold of the panel.** Source: L3 #2. | Nothing scrolls the live row into view. | A5 |
| A-F21 | b(minor) | **The playlist panel reopens by itself on the next session.** Source: L3 #3. | `listOpen` (`:82`) is never reset. | A5 |
| A-F22 | b(layout) | **The Tickets chip halves the title on a 390 px screen.** Source: L3 #5. | The chip is a text pill in the flex row. | A5 |
| A-F23 | p | **The drag bubble overlaps the bar edge at the largest text size.** Source: P2 #4. | `-top-7` scales differently from the font. | A5 |
| A-F24 | p | **Row keys use position, so 7 of 8 rows remount after a removal.** Source: L3 #6. | Key is `${set.id}-${position}` (`:192`). | A1, A5 |
| A-F25 | hardening | **FINISH is not guarded by `swapping`.** Source: P2 (theoretical). | `soundcloud.ts:152` | A2 |
| A-F26 | d | Mixcloud and Archive have no `load()`, so every track change rebuilds the player. P1 confirmed the rebuild; the activation loss is **unproven**. Sources: P3 #6, P1 (3), L1 #9 (part). | Adapter capability. | §3 |
| A-F27 | d | An unplayable set stops the queue, and the error replaces the queue context. Sources: P3 #5, L1 #9. | Product decision. | §3 |
| A-F28 | d | `+` on a set already queued gives no feedback. Sources: L1 #6, L2 #8. Taps are dropped while any add is pending (L2 #4). | UI design. | §3 |
| A-F29 | d | iOS background playback and lock-screen routing. Source: P3 #8. | Needs a phone. | §3 |
| A-F30 | n | `playNext(X)` keeps an earlier copy of X (L1 #8). This is history and intended. Its latent stall is covered by the reload rule in A1. | | |
| A-F31 | d | Seed length shows while a new track loads (P2 #5). **Not adopted:** the seed is deliberate (see the comment in `seek`, `:409-413`). Only assistive tech sees it for about 1 frame. | | §3 |

**Disagreement: index keying vs a reload nonce (L1 #3 against the P1 addendum).** I adopt **P1's nonce**. Keying the load effect on `[id, index]` restarts the live set from 0:00 whenever a row above it is removed (`removeAt` decrements `index`, `:387`). The PlayerBar shows an X on rows above the live one (`:225`), so this is reachable. It also turns the `playSets` resume branch (`:296`) into a reload. And it cannot fix A-F7 (retry with no index change), which the nonce can. I generalise P1's "bump where intended" into one rule in the reducer: **bump `reload` whenever a transition changes the current entry (uid) but not the current set id.** That covers advance, next, previous, jumpTo and removing the live row onto a same-id neighbour without listing each call site.

### Lane B: search and API

| ID | Sev | Finding and sources | Root cause | Step |
|---|---|---|---|---|
| B-F1 | b (hardening, ruling 2) | **One `event:null` listing 500s every search.** It also exposes the day view. Source: S2 #1. The outage was real and transient (§07 of the transcript). | `transformListing` dereferences `listing.event` (`ra.ts:133-137`). `collect` maps outside the per-window catch (`:541`). `fetchRAEvents` (`:235`) has the same pattern. | B1 |
| B-F2 | b | **Transient upstream failures are cached permanently.** Covers 429, 5xx, timeout and genuinely empty. Source: S1 #9 (S3's remit). | `fetchJson` returns `null` for all of these (`artistLinks.ts:261-283`). `writeCached` runs unconditionally (`:1062`). `readCached` ignores `resolved_at`. The edge cache is `s-maxage=604800`. | B2 |
| B-F3 | b | **Vocabulary keys match as substrings.** `live`→`av` hits "Dave". `bass`→`uk` hits "Luke". `queer`→`unter` hits "Hunter". Source: S2 #2. | Substring `includes`/`like` against 2–5 character entries. | B3 |
| B-F4 | b | **`titleMentions` is a substring test**, so "Cosmos Radio Hour" and others are adopted, including in the Archive results. Source: S1 #6. | `artistLinks.ts:256-259`. | B4 |
| B-F5 | b | **Archive runs as a peer rather than a fallback, and the parenthetical leaks into every provider query.** Source: S1 #7. | `:1005`, `:1022-1026`. The raw name, including `(NY)`, is used in `q`. | B4 |
| B-F6 | b | **The own-uploads fallback tests the raw track count**, not the count after the 45-minute filter. Source: S1 #8. | `:491` | B4 |
| B-F7 | b | **Mixcloud sets have no minimum duration**, so 2-minute remixes enter the queue. Sources: S1 #11, L2 #9. | No floor near `:619`. | B4 |
| B-F8 | p | **One prolific Mixcloud show crowds out every other provider.** Source: S1 #12. | Sorted date-first, then capped at `MAX_SETS=50`. | B4 |
| B-F9 | b(high) / i | **RA `biography` probably never returns, and origin is never requested.** Sources: S1 #1, S1 #2. In scope by ruling 4. **The RA schema is unverified.** | A single query asks for `biography` as a scalar. On error it retries silently and logs nothing (`:745-767`). | B5 |
| B-F10 | b | **`contextScore` is noisy**: "ny" matches inside "company" but not "Brooklyn". It also has no US places. Source: S1 #4. | Raw substring (`artistContext.ts:242`). Short `PLACES` list. | B6 |
| B-F11 | b | **SoundCloud account matching is weak.** `limit=5`. Only the display name is tested, never the permalink. Ties go to the first hit. The detail text shows "@display name" as if it were a handle. Sources: S1 #5, with S1 #3 (Cosmo NY → Florida DJ, confirmed in production) as the acceptance case. | `:428`, `:459-469`, `ScUser`. | B6 |
| B-F12 | latent → b after B5 | **A handle found in a bio is trusted with no sanity check.** Source: S1 #13. This goes live as soon as B5 makes bios return. | `resolved.username && kind==="user"` | B6 |
| B-F13 | b(low) | **Single 4-letter typo misses** (`kozz` does not find `koze`). Source: S2 #4. | `FUZZY_MIN_LENGTH = 5` (`ra.ts:408`). | B7 |
| B-F14 | p | **Zero-result searches take a recent-search slot.** Source: S2 #7. | `SearchSheet.tsx:124-137`. | B8 |
| B-F15 | p | **The index path matches across field boundaries.** Plus an orphaned comment. Sources: S2 #6, S2 #8. | `eventCache.ts:131-135,290,434`. | B9 (optional) |
| B-F16 | d | **No invalidation path** (`refresh=1` gated by the bearer check). Source: S1 #10. | | §3 |
| B-F17 | d/i | **No relevance ranking.** Source: S2 #3. I reclassify this from bug to improvement: it is a design change that spans `ra.ts` and `eventCache`'s 120-row cap. | | §3 |
| B-F18 | d | Non-Latin names fold to an empty key. Source: S2 #5. | `normalize.ts`, outside both lanes. | §3 |
| B-F19 | d | `useSearch` retries a 429 once. Source: S2 minor. | `useSearch.ts`, outside both lanes. | §3 |
| B-F20 | n | Confirmed working by S1 #14: providers run in parallel, the name test rejects candidates correctly, and "both providers empty" degrades to links. | | |

**Severity disagreement:** S2 rated B-F1 a blocker. Per ruling 2 it is downgraded to a hardening item: production returned 200 at 19:20 UTC.

---

## 2. Repair plan

Run `npm run typecheck` after every step, not only at the end. esbuild strips types without checking them, and that is how `/api/backfill` once shipped a `ReferenceError`.

### LANE A: player and playlist (order A1 → A2/A3 → A4 → A5 → A6)

#### A1 · `src/context/PlayerContext.tsx`: one structural pass

Covers A-F1 (context side), A-F3, A-F4 (API), A-F5, A-F7, A-F8, A-F9, A-F10, A-F11, A-F14, A-F16, A-F24 (uids).

**(a) Queue entries.**
- Define the types:
  ```ts
  interface QueueEntry {
    uid: number;
    set: ArtistSet;
    artistName: string | null;
    source: PlaybackSource | null;
  }
  export interface QueueItem {
    set: ArtistSet;
    artistName?: string | null;
    source?: PlaybackSource | null;
  }
  ```
- Mint uids from a module counter, `let nextUid = 1`, **outside** the reducer, so StrictMode double-invocation stays pure.
- Expose `entries: readonly QueueEntry[]`.
- Keep `queue: ArtistSet[]` as a memoized derivation, `entries.map(e => e.set)`, so other consumers do not change.
- Derive `artistName = entries[index]?.artistName ?? null` and `source = entries[index]?.source ?? null`.
- Delete the `artistName` and `source` `useState`s. `publishMetadata` then receives the per-entry name, which fixes the lock screen too.

**(b) Replace `queue`/`index` state with `useReducer`.**
- State is `{ entries, index, ended, reload }`. The reducer always sees live state, which removes the whole stale-closure class (A-F1 context side). All mutators become stable `useCallback(..., [])`.
- Actions, using `key = s => s.url || s.id`:
  - **`PLAY_SETS {items, start}`**
    - Compute `targetKey = key(items[start].set)`, then run `dedupe(items)`, then set `index = findIndex(targetKey)`.
    - This remap is required: ArtistSheet passes `position` from the un-deduped list.
    - Sets `ended=false`.
  - **`APPEND {items}`**
    - **No-op on an empty queue.** This is the backstop for A-F1.
    - Dedupe against the existing queue **and** within the batch.
  - **`ENQUEUE {items}`**
    - Empty queue: behaves like `PLAY_SETS` with `start` 0, deduped.
    - Otherwise: behaves like `APPEND`.
    - If `ended`, also set `index` to the first added entry and `ended=false` (A-F16).
  - **`PLAY_NEXT {item}`**
    - Empty queue: behaves like `PLAY_SETS`.
    - Same key as the current set: no-op. The caller resumes.
    - Otherwise: splice after `index`, drop later copies (keeping today's behaviour at `:355-359`), then `index+1`.
  - **`INSERT_AFTER {anchorUid, item}`**
    - Key already present: no-op.
    - Anchor missing: append.
    - Otherwise: splice after the anchor. If the insert position ≤ `index`, then `index+1`.
  - **`JUMP {position}`, `NEXT`, `PREV`, `REMOVE {position}`**: keep the existing logic.
  - **`ADVANCE`**: at the end, set `ended=true`; otherwise `index+1`.
  - **`RETRY`**: `reload+1`.
  - **`STOP`**: return the initial state.
- **Reload rule.** Wrap the reducer once:
  ```ts
  if (action.type !== "PLAY_SETS"
      && cur(next)?.set.id === cur(prev)?.set.id
      && cur(next)?.uid !== cur(prev)?.uid) next.reload++;
  ```
  - This handles the same-id neighbour for advance, next, previous, jumpTo and remove-live (A-F3, A-F30 latent).
  - Removing a row **above** the live one changes neither the uid nor the id, so nothing reloads. This is the P1 addendum concern.
- **`advanceRef`**: reads a `stateRef` that is assigned every render. At the end it dispatches `ADVANCE` and calls `setPlaying(false)`.

**(c) Stop epoch.**
- Add `const epochRef = useRef(0)`.
- `stop()` increments it **synchronously, before** dispatching `STOP`. Do not derive the epoch from rendered state: a `.then` microtask can run before the re-render.
- Expose a stable `getEpoch(): number`.

**(d) Public API changes.** These must be reflected in `PlayerContextValue` and its doc comments.
- `playSets(sets, startIndex, name, source?)`: unchanged signature. Remove `setListened(0)` from it (A-F10).
- `enqueue(items: QueueItem[])`: changed. Fix the doc comment at `:58-66`.
- `playNext(set, name?, source?): number | null`: adds `source` and returns the uid of the entry now holding the set. That is the existing entry's uid when the set is already current or already queued.
- **New** `insertAfter(anchorUid, set, name?, source?): number | null`: returns a uid in the same way.
  - Compute the returned uid by pre-checking `stateRef.current.entries` for the key.
  - Otherwise mint a uid and dispatch.
- `appendSets` stays, with the empty-queue guard. After A4, nothing in `src` calls it; leave it in place and note that it is unused.
- New: `entries` and `getEpoch`.

**(e) `listened` follows the source.**
- Add `useEffect(() => setListened(0), [source?.url])`.
- Drop the reset in `playSets`. Keep the reset in `stop` (harmless).
- Resuming no longer resets the clock. Moving to a different party's entry does reset it, which is the honest version of "since this source started".

**(f) Load effect.**
- Deps: `[current?.id, reload]`.
- Move the reset block (`:169-173`: `currentIdRef`, `setLoading(true)`, `setError(null)`, `setPosition(0)`, `setDuration(current.duration)`) into a **`useLayoutEffect`** with the same deps. This fixes A-F11. Keep the seed-duration behaviour.
- The build or reuse part stays in `useEffect`.

**(g) Dead flag (A-F9).**
- Per build, declare `let adopted = false, dead = false`.
- Wrap every event callback passed to `create()` in a guard: `(fn) => (...a) => { if (!dead) fn(...a); }`.
- On adoption, set `adopted = true` and store `killRef.current = () => { dead = true; }` next to `handleRef`.
- Cleanup: `cancelled = true; if (!adopted) dead = true;`. A reused handle is never deafened; this preserves the invariant in the comment at `:193-196`.
- Call `killRef.current()` immediately before every `destroy()` at `:183`, in `stop`, and on unmount. That silences Archive's late `pause` on destroy.

**(h) Errors.**
- `onPlay` adds `setError(null)`. `onProgress` adds `setError(null)`; React bails out when the value is already null. (A-F8)
- The catch at `:229` maps every thrown error to `"Couldn't load the player. Tap play to try again."`, which stops the raw URL leaking (A-F7).
- The catch also sets `buildFailedRef.current = true`. The layout effect clears it.

**(i) `toggle` (A-F7, A-F6 context side).**
```ts
const h = handleRef.current;
if (!h) {
  if (buildFailedRef.current) {
    buildFailedRef.current = false;
    dispatch({ type: "RETRY" });
  }
  return;
}
if (playing) {
  h.pause();
  if (loadingRef.current) setPlaying(false);  // optimistic only while loading
} else {
  h.play();
}
```
- Gate the retry on `buildFailedRef`, not on "no handle". A tap during a normal initial build must not tear the build down.

**(j) `seek` (A-F14).** Read `loadingRef` and `durationRef`, which are assigned each render.
- Return early while loading.
- Clamp to `[0, duration ?? seconds]`.
- Then call `handle.seek` and `setPosition`.

**(k) Unchanged:** the resume branch in `playSets` (`:296`), the `playNext` resume when the set is already current, and `isCurrent`.

#### A2 · `src/lib/players/soundcloud.ts`, `mixcloud.ts`: needs a phone for the full variant

**SoundCloud (A-F6, A-F25).**
- Add `let wantPlay = true`.
- `play()` sets `wantPlay = true`, then plays.
- `pause()` sets `wantPlay = false`, then does the existing clear-retry and pause.
- `load()` sets `wantPlay = true`, because a skip is a request to play.
- The READY handler (`:126`), `start()` (`:179`) and both retry timers call `widget.play()` only `if (wantPlay)`.
- **Ship the lower-risk variant:** keep `auto_play: true` on `load()`. In `start()`, if `!wantPlay`, call `widget.pause()` and `events.onPause()`, and do not arm the retry.
- **Do not** switch to `auto_play:false` until it has been tested on a real iPhone (P1's activation question). Leave a code comment pointing at that test.
- FINISH handler: `if (swapping) return;` before `events.onEnded()`.

**Mixcloud (A-F9).** Wrap `await widget.ready` in `try { … } catch (e) { iframe.remove(); throw e; }`.

**Archive:** no change. The dead flag in A1 covers its late `pause`.

#### A3 · `src/lib/mediaSession.ts` (A-F15)

In `publishPosition`, when `!duration || duration <= 0`, call `try { navigator.mediaSession.setPositionState(); } catch {}` and then return.
- `stop()` already sets `duration` to null, so the existing effect at `PlayerContext.tsx:276` clears the state on Close with no extra call.

#### A4 · Callers: `usePlaylistAdd.ts`, `useEventPreview.ts`, `ArtistSheet.tsx`

Depends on A1.

**`usePlaylistAdd.ts`** (A-F1, A-F5, A-F18)
- Capture `const epoch = getEpoch()` at tap time in `addArtist` and `addNight`.
- In `.then`: `setPending(null)`, then `if (getEpoch() !== epoch) return;`. A Close in between drops the add silently.
- `addArtist` calls `enqueue([{ set, artistName: artist.name, source: { label: event.title, url: event.url } }])`.
- `addNight` keeps the `{artist, set}` pairs from `Promise.all` in lineup order and enqueues an item per pair with the DJ's own name and the event as source. Fix the false comment at `:97`: it becomes true once A1 lands.
- In `resolve`, use `fetchQuery({ ...artistQuery(id, name), retry: false })` and race it against an 8 s timeout that resolves `null` (L2 #6). A hung lookup then ends as `failed`.

**`useEventPreview.ts`** (A-F1, A-F2, A-F4, A-F18). Applies ruling 1.
- Add `const runRef = useRef(0)`. In `start`, set `const run = ++runRef.current` and `const epoch = getEpoch()`, and define `live = () => run === runRef.current && getEpoch() === epoch`.
- Every resolution returns early unless `live()`. That covers `playNext`, `insertAfter`, `setPreparing` and `setEmpty`.
- First DJ back: `anchor = playNext(chosen, artist.name, source)`.
  - With an empty queue, `PLAY_NEXT` behaves like `PLAY_SETS`, so the empty case keeps today's behaviour.
  - With a queue, the taster goes in after the live set and plays now, and the user's playlist resumes after it.
- Later DJs: `anchor = insertAfter(anchor, chosen, artist.name, source) ?? anchor`. The taster stays contiguous instead of landing after the user's whole playlist.
- `.finally`: `if (run === runRef.current) runningFor.current = null`.
- Also use `retry: false` on the `fetchQuery`.
- Remove `appendSets` and `playSets` from the hook's dependencies.

**`ArtistSheet.tsx`** (A-F4, A-F5). Applies ruling 1.
- Keep `queueRef` and `currentRef` (from `usePlayer()`), assigned every render.
- In the auto-start effect at `:92-106`, after the `startedFor` guard:
  - If `queueRef.current.length === 0`, call `playSets(resolved, 0, name)`, as today.
  - Else, if any of `resolved` has the same key as `currentRef.current`, do **nothing**. You are already listening to this DJ. Re-opening their sheet must not jump or un-pause.
  - Else call `playNext(resolved[0], name)`.
- The `+` at `:238` becomes `enqueue([{ set, artistName: artist?.name ?? null }])`. Source is null because there is no event context in this sheet.
- The row tap at `:185-195` is already correct.

#### A5 · `src/components/PlayerBar.tsx`

Depends on A1 for `entries`.
- **Row keys (A-F24):** iterate `entries` and use `key={entry.uid}`.
- **Panel reset (A-F21):** add `useEffect(() => { if (!hasPlaylist) setListOpen(false); }, [hasPlaylist])` **above** `if (!current) return null`.
- **Scrub on track change (A-F12):** add `useEffect(() => setScrubbing(null), [current?.id])`.
- **Stuck scrub (A-F13):** add `onBlur={commitScrub}` to the range input. While `scrubbing !== null`, also add a `window` `keyup` listener that commits, removed on cleanup.
- **Bubble position (A-F23):** replace the bubble wrapper's `-top-7` with `style={{ bottom: "calc(100% + 0.5rem)" }}` and drop `top`.
- **Accessible name (A-F19, L3 #4):** use `aria-label={`${listOpen ? "Hide" : "Show"} playlist, ${queue.length} sets`}`. Update `tests/player.e2e.mjs:414` to `button[aria-label^="Show playlist"]` and `:472` to `button[aria-label^="Hide playlist"]`. These are exact-match today and **will fail** without this change.
- **Focus after removal (A-F19, L3 #1):**
  - Before `removeAt(position)`, record the target position.
  - In a `useEffect` on `queue.length`, focus `ul.querySelectorAll('button[aria-label^="Remove"]')` at `min(pos, count-1)`.
  - If there are none, focus the `ul`, which gets `tabIndex={-1}`.
  - Use a ref for the pending focus target.
- **Live row in view (A-F20):**
  - On `[listOpen, index]`, find `[aria-current="true"]` inside the panel container ref.
  - Adjust the **container's** `scrollTop` so the row is fully visible.
  - Do not call `scrollIntoView`; it can scroll the page behind the sheets.
- **Tickets chip (A-F22):**
  - Render the label text as `<span className="max-[400px]:sr-only">Tickets</span>`, so the chip is icon-only on narrow screens.
  - Keep a 44 px hit area by adding `tap` sizing there.
  - **Keep** `aria-label="Tickets for …"`: `preview.e2e.mjs:239` matches `aria-label*="Tickets for"`.

#### A6 · Tests (Lane A)

Promote the probes into **new `tests/playlist.e2e.mjs`**.
- It spawns its own Vite server, like the other suites, on its own default `E2E_PORT`.
- Add `"test:playlist": "node tests/playlist.e2e.mjs"` to `package.json` and append it to `test:all`.
- Do **not** add checks to `preview.e2e.mjs`, which has uncommitted orchestrator work.
- Reuse the `FAKE_SC` and fake-Mixcloud scaffolding from `tests/agent-p1-probe.mjs`.

| Source probe → scenario | New check, written so that PASS means healthy |
|---|---|
| `agent-p1-probe.mjs` `stopThenLatePreview` | After Close, a late DJ does not reopen the bar: `present:false` at +4.5 s. |
| `agent-p1-probe.mjs` `staleEnqueueReplacesQueue` and `agent-l2-playlist-add.mjs` S2 | A slow `+`, then Preview: the first set keeps playing and the added set is **appended**. |
| `agent-l1-race.gen.mjs` | A slow `+`, then opening another DJ: the add lands behind and does not replace. |
| `agent-p1-probe.mjs` `duplicateFromAddNight` and `agent-l1-queue.mjs` T5/T6 | `enqueue([Z,Z,W])` adds Z once on both an empty and a non-empty queue. `[S,S,T]` (forced via removeAt) reaches T. |
| `agent-p1-probe.mjs` `artistOpenClobbersPlaylist` and L1 `opening an artist sheet keeps…` (**inverted per ruling**) | Opening DJ2 with a queue: the prior entries survive, DJ2's first set is at `index+1` and current. Re-opening the DJ already playing changes nothing. |
| `agent-l2-playlist-add.mjs` S6 (**inverted per ruling**) | Preview with a user queue: Delta survives. The taster sets are contiguous after the live entry. |
| `agent-l2-playlist-add.mjs` S7 | The previous night's late DJ does not appear in the next night's queue. |
| `agent-l1-preview.gen.mjs` and `agent-l1-queue.mjs` T7 | The subtitle names the correct DJ and the correct "at <event>" for each set. The lock-screen artist matches. |
| `agent-p1-probe.mjs` `retryAfterCreateFailure` and `agent-p3-lifecycle.mjs` Phase 3 | api.js fails once, then the bar Play tap plays. There are 2 api.js requests, and the error copy contains no URL. |
| `agent-p1-probe.mjs` `errorSticks` and `agent-p3-lifecycle.mjs` Phase 1 | After ERROR then Play, the subtitle is no longer the error. |
| `agent-p1-probe.mjs` `pauseDuringLoad` and `agent-p3-lifecycle.mjs` Phase 4 | Next, then Pause mid-load: position does not advance at 2 s and 3.5 s. |
| `agent-p1-probe.mjs` `mixcloudStaleReady` | While M2 loads, the spinner stays and `max` ≠ M1's 1111. |
| `agent-p3-lifecycle.mjs` Phase 2 | After Close, `setPositionState` was called with no argument (`posNullCalls ≥ 1`). |
| `agent-p2-paint.mjs` A and the Next path | rAF sampling: no frame shows the new title with the old `max` or `value`. |
| `agent-p2-hold.mjs` D2 / `agent-p2-stuck.mjs` D3 | A drag held across FINISH does not seek the new set, so set 3 is not reached. A keyup elsewhere clears the bubble. |
| `agent-l3-playlist.mjs` / `-b.mjs` | Focus after a keyboard removal is not BODY. The live last row is fully in the panel. The panel is closed on a new session. The button's name contains the count. 7 of 8 rows survive a removal. |
| **New, missing today** (P1 addendum point 2) | Removing a row **above** the live one leaves the position advancing, with no reload (`__built` and the load count unchanged). |
| `agent-p1-probe.mjs` `finishChain`, `listenedGate` | Keep as regressions. `listenedGate` also covers A-F10: re-tapping the live row keeps the Tickets link. |
| `agent-l1-queue.mjs` T8 `enqueue after queue finished` | It now starts T. |

**Existing checks to update:** only `player.e2e.mjs:414` and `:472`, as described in A5.

After A6 passes, delete the promoted `tests/agent-*.mjs` probes from the working tree. They are untracked and must not be committed.

### LANE B: search and API (order B1 → B2 → B3 → B4 → B5 → B6 → B7 → B8 → [B9])

#### B1 · `api/_lib/ra.ts`: null-event hardening (B-F1)

- `transformListing`: change it to return `RAEvent | null` and return `null` when `!listing?.event`.
- Mark it `export` so it can be tested.
- In `collect` (`:541`), replace the map with a `flatMap` that wraps each listing in `try`. A throw is logged with `console.warn('[search] bad listing', listing?.id)` and that listing is dropped.
- Apply the same `flatMap` and guard at `fetchRAEvents` (`:235`).
- **Test:** add to `tests/unit/ra.test.ts` the case from `agent-s2-probe-null.mjs`: `{id:"2", listingDate, event:null}` returns null and does not throw.

#### B2 · `api/_lib/artistLinks.ts` + `api/artist.ts`: stop caching failures (B-F2)

This is S3's remit.
- `fetchJson` returns `{ ok: true, data } | { ok: false, reason: "http" | "timeout" | "network", status? }`. A 200 with an empty body is `ok:true`.
- Update every call site.
- Each resolver also returns `degraded: boolean`, which is true on any non-OK response.
- `getArtistLinks` returns `{ links, degraded }`. If degraded, it **skips `writeCached`**.
- `readCached` adds `resolved_at` to the select and treats a row as a miss when either:
  - `link_source = 'none'`, or `sets` is empty, and `resolved_at < now() - interval '24 hours'`; or
  - `link_source = 'auto'` and it is older than 90 days.
- `manual` rows never go stale.
- `api/artist.ts`: when degraded, send `Cache-Control: public, max-age=60, s-maxage=300` instead of the 604800 at `:94`.
- No change to any auth.
- **Tests** in `tests/unit/artistLinks.test.ts`, with mocked `fetch`:
  - a 429 on `search/users` produces `degraded:true` and `writeCached` is not called;
  - an empty 200 produces `degraded:false`.

#### B3 · `api/_lib/vocab.ts`: substring false positives (B-F3)

- Lane-local fix: **remove the short entries** `av`, `uk`, `tba`, `raw`, `late` and `trans`, using S2's second option.
- Word-token matching would also need `eventCache.ts:270`'s SQL to change, and it would split the two paths again (B-F15).
- **Tests** in `tests/unit/vocab.test.ts`, from `agent-s2-probe-matcher.mjs`:
  - `live` no longer matches "Unrelated Night / Nowadays / Dave Clark";
  - `bass` no longer matches "Luke Hall";
  - `queer` no longer matches "Hunter".
- Update any existing vocab test that asserts the removed entries.

#### B4 · `api/_lib/artistLinks.ts`: matching hygiene

Covers B-F4 to B-F8. One pass, with B2 already in the file.
- **`searchName` (B-F5):** `searchName = name.replace(/\s*\([^)]*\)\s*/g, " ").trim()`. Use it for the SoundCloud `q`, the Mixcloud `search/?q=` and the Archive `title:(…)` query.
- **Archive as fallback (B-F5):** start `resolveArchive` only when SoundCloud and Mixcloud together yield 0 sets. Await those two, then Archive. This adds latency only in the empty case.
- **`titleMentions` (B-F4):** match word-bounded on the lowercase title, `(^|[^a-z0-9])<tokens joined by [^a-z0-9]+>([^a-z0-9]|$)`. For `searchName` of 7 letters or fewer, also require a separator: `" - "`, `"@ "`, `presents` or `mix`.
- **Own-uploads fallback (B-F6):** `:491` becomes `if (ownUploads && afterFilter.length === 0)`, testing the result after the 45-minute filter.
- **Mixcloud floor (B-F7):** exclude Mixcloud items with `audio_length < 1200` (20 min). Keep items whose `audio_length` is unknown.
- **Provider mix (B-F8):** in `orderSets`, cap each provider at 30, then sort, then slice to `MAX_SETS`.
- **Tests** (`artistLinks.test.ts`, from `agent-s1-match-probe.mjs`):
  - `titleMentions("Cosmo (NY)", …)` is false for "Cosmos Radio Hour", "Cosmopolitan Brunch Mix" and "Lepota Luba Cosmo - Lowest Edge";
  - it is true for "Cosmo @ Nowadays";
  - the `tracks.length>0 && afterFilter.length===0` fallback condition;
  - a 142 s Mixcloud item is dropped.

#### B5 · `api/_lib/artistLinks.ts` `resolveRa`: RA fields, logging first (B-F9, ruling 4)

- Log first: every GraphQL `errors[0]?.message` goes to `console.warn('[ra] artist query', field, msg)`.
- Replace the single query with independent queries run in parallel under the existing `RA_TIMEOUT_MS`:
  - `{contentUrl}`;
  - `{biography{blurb content}}`;
  - `{biography}`, the scalar fallback. Only one of the two biography shapes will validate, and that is fine.
  - `{country{name urlCode}}`;
  - `{residentCountry{name urlCode}}`;
  - `{soundcloud}`.
- Each one is `Promise.allSettled` and optional. An unknown field fails only its own query and is logged.
- Return `{ url, biography, origin?: { iso2: string | null, countryName: string | null }, socials?: { soundcloud?: string } }`.
- **Nothing downstream may require the new fields.** When they are all missing, behaviour equals today's.
- Cost: about 6 RA requests per cold resolve instead of 1–2. They run only on a cache miss and are bounded by the timeout.
- **Verify after deploy:** read `[ra] artist query` lines with `get_runtime_logs` (project `prj_PeaknPbv6DenbJgnwy6Qd1Jpbqot`). Then trim the queries that always fail to save requests.
- **Tests:**
  - mock `fetch` so `country` returns a GraphQL validation error and `contentUrl` succeeds; the result has a URL and no origin, with no throw;
  - the biography object shape and the scalar shape both parse.

#### B6 · `api/_lib/artistContext.ts` + `artistLinks.ts`: origin-aware ranking (B-F10, B-F11, B-F12)

Ship in the **same PR as B5**: once bios return, B-F12 goes live.

**`artistContext.ts` (B-F10)**
- Match terms on word boundaries. Use raw lowercase tokens for terms of 3 characters or fewer.
- Add a region table: `ny` → `[new york, nyc, brooklyn, queens, manhattan, bronx]`. Add `la`, `uk`, `us`, `sf` and `dc` the same way.
- Add the US cities and states S1 lists to `PLACES`.
- Add an optional `origin?: { iso2: string | null; places: string[] }` to `ArtistContext`.
  - `places` is the union of the expanded parenthetical, the bio's `PLACES` hits and RA's `countryName`.

**`artistLinks.ts` (B-F11)**
- `search/users` limit goes from 5 to 20.
- Add optional fields to `ScUser`: `permalink`, `full_name`, `city`, `country_code`, `followers_count`, `track_count`, `verified`.
- The name test passes on display name **or** `permalink` **or** `full_name`.
- Replace `pickByContext`'s count with S1's `scoreCandidate` table, verbatim from the transcript §04 "Ranking". Each term applies **only when its field is present**.
- Failsafe:
  - if ≥2 exact-name candidates exist, the top score is ≤ 0, and the margin over the runner-up is < 3, then return no user;
  - in that case, mark the response `degraded` (B2), so it is not cached long.
- An RA `soundcloud` field, when present, goes into `context.handles.soundcloud`, which routes it through the existing decisive `/resolve`.

**`artistLinks.ts` (B-F12)**
- A bio-derived handle whose user fails `isPlausibleMatch` is demoted to a +5 ranking boost instead of being decisive. A structured RA `soundcloud` field stays decisive.

**`ArtistLink.detail`**
- Render `@${permalink}` when known, else the display name **without** `@` (S1 #5).

**Tests** (`artistContext.test.ts`, `artistLinks.test.ts`, S1's fixture list):
- "ny" scores 0 on "company / funny / sunny" and >0 on "Brooklyn / New York resident";
- a "Southwest Florida-based" bio counts as a contradiction for Cosmo (NY);
- a same-name FL/NY pair with and without `country_code`: the NY one wins with country data, and none is returned without it;
- `cosmo_nyc` beats `cosmobandz`;
- a bio handle that fails the name test is not decisive.

**Acceptance (production, after deploy):** re-resolve Cosmo (NY) 103962 and Cosmo 4421. That needs the owner's row deletion in §3, or the 24 h staleness from B2 for `none` rows. Cosmo (NY) must no longer show the Florida bio.

#### B7 · `api/_lib/ra.ts`: 4-letter typo (B-F13)

- For a query word of exactly 4 characters, allow 1 edit against haystack words of 4–5 characters only. Keep `FUZZY_MIN_LENGTH = 5` for everything else.
- **Test:** from `agent-s2-probe-typo.mjs`, in `searchIndex.test.ts` or `ra.test.ts`:
  - `kozz` matches `koze`;
  - `kozz` does not match "Unrelated Night";
  - `ko` still does not match.
- **Optional:** it adds false-positive surface. Drop this step if `search.e2e` precision checks move.

#### B8 · `src/components/SearchSheet.tsx`: remember only hits (B-F14)

- At `:124-137`, bank `data.q` only when `upcoming.length + past.length > 0`.
- `recentSearches.ts` is unchanged. If the condition is extracted as a helper, test it in `recentSearches.test.ts`.

#### B9 (optional, adds `api/_lib/eventCache.ts` to Lane B) · index path consistency (B-F15)

- Post-filter `searchCachedEvents` hits with `matchesTerm` (`:290`).
- Move the orphaned comment from `:434` to above `missingDays`.
- `eventCache.ts` is outside Lane A, so the lanes stay disjoint.

### LANE C: orchestrator, after both lanes merge

**C1 · `EventDetailsSheet.tsx` (A-F17).**
- Render `playlist.failed`:
  - under the DJ chip when `failed === key`;
  - under the night row when `failed === NIGHT_KEY`;
- Reuse the "No sets found for this lineup." copy from `:350-352`.
- Add a check, in `playlist.e2e.mjs` or after the flyer work lands, from `agent-l2-playlist-add.mjs` S3/S4: an all-empty lineup shows the message.
- Also update the comment at `:314` ("preview *this* means this"), which ruling 1 supersedes.

**Docs.**
- CLAUDE.md says "156 Vitest units". S1 measured 198. Update it after Lane B adds tests.
- Record ruling 1 and the reload-nonce rationale in `memorystate.md`.

---

## 3. Not now

| Item | Reason |
|---|---|
| **S1 #10:** `refresh=1` on `/api/artist`, moving `authorised()` to `api/_lib/cronAuth.ts` | It edits `/api/backfill`'s bearer check. CLAUDE.md requires an on-the-spot review, and `backfill.ts` is outside both lanes. B2's 24 h staleness removes most of the need. Ship it later as its own landing with that review. The `Vercel-Cache-Tag` purge is unverified on function responses. |
| `soundcloud.ts` `auto_play:false` (full form of A-F6) | Needs a real iPhone to confirm that `play()` in the `load()` callback keeps activation. A2 ships the lower-risk variant. |
| A-F26: `load()` for Mixcloud and Archive | The activation loss is unproven. It needs a phone and an adapter API check. |
| A-F29: iOS lock screen and background routing | Needs a phone with the screen locked. |
| A-F27: skip an unplayable set, keep context beside the error | Product decision: auto-advance or a Skip affordance. |
| A-F28: feedback for already queued, per-key pending | UI design. The fix lives in `EventDetailsSheet` and `ArtistSheet` copy. |
| A-F31: P2 #5, seed length while loading | Not adopted: the seed is deliberate, and only assistive tech sees it for one frame. |
| B-F17: S2 #3, relevance tiers | An improvement that needs design. It spans `ra.ts` and `eventCache`'s distance-ordered 120-row cap. |
| B-F18: S2 #5, non-Latin names | `normalize.ts` changes the index key, so it needs a re-index plan. Low traffic. |
| B-F19: `useSearch` `retry:1` on 429 | Outside the lanes. Harmless. |
| S1 rollout bulk delete (`delete from artist_links where link_source<>'manual' and name ~ '\('`) | **Owner action**: a destructive production write. Do it after B5 and B6 deploy. |
| **S1's production side effect** | **Owner action:** S1's probe wrote a `link_source='none'` row for RA artist **173682** (Gianna (US)) to production `artist_links`. Delete it: `delete from artist_links where artist_id='173682' and link_source='none';` (confirm the column name first). Otherwise B2's 24 h staleness makes it a miss once B2 deploys. |
| Branch cleanup | Branches cannot be deleted from a session. List the merged `claude/*` branches for the owner. |

---

## 4. Risk notes

The stock e2e counts are player 41, search 44, layout 41, preview 7, donate 9, settings 31, offline 12. This is the `test:all` order: `test:e2e`, `test:search`, `test:layout`, `test:preview`, `test:donate`, `test:settings`, `test:offline`. Any drop is a regression. Run with `| tail`, and on `EADDRINUSE` pass `E2E_PORT`.

1. **A1 rewrite → `player.e2e` (41).**
   - **Index remap in `PLAY_SETS` after dedupe:** a wrong remap starts the wrong set when the catalogue has duplicates. Detect with the T5/T6 checks plus "tap row N plays row N" in `player.e2e`.
   - **Reload rule over-firing:** this restarts the live set. Detect with the new "remove a row above the live one" check: the load count must stay unchanged.
   - **Resume path:** `playSets` with the same id must not reload. Covered by the existing "re-opening an artist keeps it playing" check.
2. **`useLayoutEffect` reset (A1f).** It runs before paint on every track change, and React re-renders synchronously. If any e2e reads `position` immediately after Next and expected the old value, it will flip. That would be a test bug, not an app bug.
3. **Preview semantics (ruling 1) → `preview.e2e` (7).**
   - Any preview check that starts from an existing queue and expects replacement will fail. Fix the expectation, not the code.
   - `preview.e2e.mjs:239` (Tickets absent) now depends on `listened` resetting per `source.url`. A new preview of a **different** event resets it. Re-previewing the **same** event no longer does. Check which case `:239` exercises.
   - Run this suite on top of the orchestrator's uncommitted flyer changes.
4. **`player.e2e:414/472`** fail deterministically until they use prefix selectors (A5).
5. **Tickets chip and bubble (A5) → `layout.e2e` (41).** The chip goes `sr-only` text below 400 px; the 44 px target must hold. The bubble repositions. Run `layout.e2e` and spot-check 390 px with `text-size-5` and `type-late`.
6. **SoundCloud `wantPlay` (A2).** Explicitly calling `pause()` in `start()` emits PAUSE. The `player.e2e` check "Wait for the pause label" (commit `4836230`) should still pass. If it flakes, the optimistic `setPlaying(false)` in `toggle` is the place to look.
7. **Epoch drop (A4).** A `+` tapped while playing, followed by Close, is now discarded. That is intended. Verify that no `player.e2e` check closes the player mid-add and then expects the add.
8. **Lane B → `search.e2e` (44).** Removing vocab entries (B3) can lower recall for `live`, `bass`, `late` and `trans` titles. Fuzzy-4 (B7) can add false positives. If B7 moves precision checks, drop B7 and keep B3.
9. **Lane B → production behaviour.**
   - B2 and B6 change what is cached. `degraded` responses now carry `s-maxage=300`, so expect more origin hits for a few days.
   - B5 adds about 6 RA requests per cold resolve. Watch `get_runtime_errors` for RA 429s after deploy.
   - Confirm the production deployment reaches `READY`. Then use `web_fetch_vercel_url` on `/api/health`, on `/api/search?q=koze` (B1 and B7), and on `/api/artist` for 103962 (B6 acceptance).
10. **Typecheck.** `enqueue`'s signature change (`QueueItem[]`) and the `fetchJson` return-type change will surface every missed call site only under `tsc`. Run `npm run typecheck` before every commit in both lanes.

## 20 · Orchestrator — lane assignment

Already landed in Lane B before the plan arrived, verified 200/200 units and search 44/44: B1 (null guard — `transformListing` returns null, both call sites filter), B3 (word-bound vocabulary expansions in the live matcher, rather than deleting entries), B8 (no banking of empty searches), B9 (`matching()` over indexed rows, which also closes the SQL substring hole B3's deletion was meant to cover), and the `resolveRa` warning from B5. Remaining Lane B — B2, B4, B5, B6 — goes to one Sonnet repairer; B7 is skipped per the plan's own caveat about precision. All of Lane A goes to one Sonnet repairer. Lane C and the ship stay with the orchestrator. Two agents for the repair phase.


## 21 · Orchestrator — Lane C done

While A and B run. `EventDetailsSheet.tsx`: `playlist.failed === NIGHT_KEY` now shows the existing "No sets found for this lineup." line under the play/add row (same element as `preview.empty`, so the two states cannot stack). A DJ's failed add shows "No sets found for {name}." once under the chip row — the chip is too small to carry it, and the name is looked up in the full bill rather than the visible slice because the chip may have folded away under "+N more". The comment at `:314` ("preview *this* means this") rewritten to ruling 1: the preview starts this night's sets now and keeps whatever was queued behind them. `npm run typecheck` clean with Lane A's in-flight edits in the tree. The e2e check waits for Lane A's `tests/playlist.e2e.mjs` to exist, so there is no file collision.

## 22 · Lane B repairer (Sonnet) → Orchestrator — final report

> Lane B is done: B2, B4, B5 and B6 are implemented, tests are in, and B7 is skipped as instructed. `npm run typecheck` is clean and `npm run test` is 274/274 (was 200). I ran no e2e suites.
>
> ### Per step
>
> **B2: done, with two deviations.**
> - `fetchJson` returns a discriminated result and every resolver reports `degraded`.
> - `getArtistLinks` returns `{links, degraded}` and skips `writeCached` when degraded.
> - `readCached` treats `none`/empty rows older than 24h and `auto` rows older than 90d as misses, via the new `isStaleRow`. `manual` rows never expire.
> - `api/artist.ts` sends `public, max-age=60, s-maxage=300` when degraded, with no stale-while-revalidate.
> - **Deviation 1:** a 404 or 410 is not "degraded". A dead bio handle is an answer, not an outage, and degrading on it would leave every artist with one stale handle permanently uncached.
> - **Deviation 2:** RA counts as degraded only on a timeout, network error, 429 or 5xx. A 400 "no such field" does not, which is the expected schema case. A RA field that persistently times out would keep an artist uncached.
>
> **B4: done, with three deviations.**
> - `searchName` is applied to the SoundCloud, Mixcloud and Archive queries.
> - Archive runs only when SoundCloud and Mixcloud yield no sets, under its own 4s deadline (worst case 3+7+4 = 14s of the 15s limit).
> - The own-uploads fallback now tests the post-filter count, and the Mixcloud floor is 1200s with unknown lengths kept.
> - **Short-name rule:** the plan's own acceptance case ("Lepota Luba Cosmo - Lowest Edge" must be false) cannot pass if a separator anywhere in the title is enough. For names of 7 letters or fewer I require the name to open the title (an optional "DJ" aside) and be followed by ` - `, `@`, `presents` or `mix`.
> - **Per-provider cap:** a plain cap of 30 per provider would cut a one-provider artist to 30 and break the existing `orderSets` cap test. Each provider's newest 30 are guaranteed a slot, and unused slots go back to the overflow, newest first.
> - **Null guards:** I added guards for null elements in the SoundCloud user and track lists, which S3's probe saw. They are cheap.
>
> **B5: done.**
> - Six parallel queries under `RA_TIMEOUT_MS`, each failure logged as `console.warn('[ra] artist query', selection, message)`. A 4xx body is read so the message is visible.
> - With every guessed field rejected, `resolveRa` returns what it did before: URL only, no bio, no origin, no socials.
> - Both biography shapes parse, preferring `content` over `blurb`. HTML is stripped, because showing raw tags once a bio lights up would be a visible regression.
> - `iso2` is set only when `urlCode` is a two-letter code. I did not query `isoCode`, since an unknown field would sink that query.
> - I exported `resolveRa`. `ra.ts` is untouched.
>
> **B6: done, with extensions beyond the plan.**
> - Word-boundary matching with a region table, US places added to `PLACES`, optional `origin`, a 20-candidate search, the name test on display name, permalink or full_name, S1's score table, the refuse-to-pick failsafe, the `@permalink` detail, and the bio-handle demotion are all in.
> - `scoreCandidate`, `isContradicted` and `contradictsOrigin` live in `artistContext.ts`, and `chooseAccount` lives in `artistLinks.ts`. I added `handleSource: "structured" | "bio" | null` to `ArtistContext`.
> - **Contradiction refinement:** the -4 applies only when every place the description names is outside the artist's origin. S1's literal rule would penalise an NYC DJ whose bio says "NYC / Berlin". It is also skipped when the artist's only known origin is a country, because Miami is in the US.
> - **Extension, lone candidate:** a sole name-matching candidate that is contradicted (the Florida Cosmo) is dropped on both SoundCloud and Mixcloud. Without this, a lone candidate wins by default and the acceptance case would still show the Florida bio whenever RA returns no bio. After a refusal or a drop, SoundCloud also skips the scoped track search, which would otherwise re-adopt the wrong Cosmo's uploads.
> - **Mixcloud:** it is ranked and contradiction-dropped but never refused. Mixcloud search results carry no follower or location fields we can rely on, so every exact-name pair would look like a tie.
> - **Bio-handle +5 boost:** it is implemented as written but nearly vacuous. A user that fails the name test cannot reach the candidate list, so the real effect is "ignore a bio handle that fails the name test".
> - **Short codes:** the bare codes `us` and `la` count only when written in capitals ("join us" is not a claim about the United States).
>
> ### Files touched
> - `api/_lib/artistLinks.ts`
> - `api/_lib/artistContext.ts`
> - `api/artist.ts`
> - `tests/unit/artistLinks.test.ts`
> - `tests/unit/artistContext.test.ts`
> - Deleted from the working tree (unstaged): `tests/agent-s1-match-probe.mjs` and `tests/agent-s2-{matcher,probe-matcher,probe-null,probe-typo}.mjs`.
>
> I did not touch `ra.test.ts`; the B5 tests are in `artistLinks.test.ts` because the RA queries live there. I ran one stray `git rm --cached` and reverted it, so the index is clean.
>
> ### Outside my list
> - **`tests/agent-s3-artist-server.mjs`:** it reads the old `getArtistLinks` return shape (`result.sets`) and will break; delete it or update it.
> - **`CLAUDE.md`:** the unit count is now 274.
> - **Deleted S2 typo probe:** `agent-s2-probe-typo.mjs` is the raw material for B7. It is in git history if B7 is picked up.
>
> ### Where the plan or S1 was wrong
> - The plan's per-provider cap and its short-name separator rule are both flawed as written (see B4).
> - Migrations 0002, 0004 and 0005 set `resolved_at = to_timestamp(0)` to force a re-resolve, but nothing ever read it. With B2 those rows are now stale, so each re-resolves once on first view. That is a one-time cost and probably what was intended.
> - With a parenthetical like "(NY)", the origin is known even with no RA data. So the Cosmo (NY) fix does not depend on RA's schema.
>
> ### For the owner after deploy
> Search runtime logs for `[ra] artist query <selection> <message>`. Each cold resolve fires six queries: `contentUrl`, `biography { blurb content }`, `biography`, `country { name urlCode }`, `residentCountry { name urlCode }` and `soundcloud`.
> - A selection that logs "Cannot query field" on every call is a dead guess. Delete that query to save a RA request per cold resolve.
> - Of the two biography shapes, one will always fail. Keep the other.
> - If both country queries fail, origin falls back to the parenthetical and bio places only.
> - If `country` works but `iso2` stays null, `urlCode` is not an ISO code and `isoCode` is the next field to try.
> - Watch for RA 429s (degraded responses are not stored and get `s-maxage=300`, so origin traffic will rise for a few days). Also watch for SoundCloud lookups that return no account after the refusal rule; those are same-name ties that need a signal.
> - Acceptance: re-resolve Cosmo (NY) 103962 and Cosmo 4421. Their `none` rows go stale on their own after 24h.

*(Orchestrator: 234,863 tokens, 33 tool uses, 10m 44s. The S3 server probe it flags was already deleted in section 21.)*

## 23 · Orchestrator — Lane B verified

Independently: `npm run typecheck` clean, `npm run test` 274/274 (16 files), `npm run test:search` 44/44 on port 5801. Read the `api/artist.ts` diff: the only behavioural change at the endpoint is the cache header fork on `degraded` (`public, max-age=60, s-maxage=300`, no stale-while-revalidate), with the long-lived header unchanged for a full answer. Nothing in the lane touches `/api/backfill`, `/api/image`, donate or rate-limit headers, so the cadence rule stands and no on-the-spot review is triggered. The four deviations and two extensions are accepted as written — each one is argued from an acceptance case the plan itself set. Committed as a checkpoint; Lane A still running.

## 24 · Lane A repairer (Sonnet) → Orchestrator — final report

> All of Lane A is implemented; the suites below are green and `npm run typecheck` is clean. I did not commit.
>
> **Steps**
> - **A1: done, with deviations.**
>   - `PlayerContext.tsx` now uses a reducer with per-entry uids, a stop epoch, and `playNext`, `insertAfter` and `getEpoch` exposed.
>   - The reload nonce is in as specified in A1(b).
>   - Deviations:
>     - **Live `stateRef`:** every dispatch also runs the reducer on a `stateRef` copy, instead of assigning `stateRef` each render. That way `playNext` followed at once by `insertAfter` sees the first.
>     - **`playNext` return value:** it returns the uid of the entry now holding the set. It does not return an existing queued copy's uid, because the reducer drops later copies and inserts a new one.
>     - **`insertAfter` return value:** it returns `null` when the set is already queued. Returning the existing uid moved the preview's anchor to the duplicate and scattered the taster; the player e2e's taster check caught this.
>     - **`STOP` keeps counting `reload`** (monotonic) instead of resetting to the initial state, so Close plus play in one batch still reloads.
>     - **New `RESUMED` action:** it clears `ended` on `onPlay`, so a replayed last set doesn't make a later `+` jump.
> - **A2: done.** Lower-risk `wantPlay` variant with `auto_play: true` kept, a comment pointing at the iPhone test, the FINISH guard on `swapping`, and Mixcloud's `ready` try/catch.
> - **A3: done.**
> - **A4: done.**
>   - Callers: `usePlaylistAdd`, `useEventPreview` and `ArtistSheet` as specified, with the epoch captured at tap time, the `runRef` token, `retry: false`, and an 8 s lookup timeout.
>   - `appendSets` is unused in `src` and kept; it now takes `QueueItem[]`.
> - **A5: done.** Everything is in as specified, with these differences:
>   - **Focus after removal:** focus goes to the nearest row that still has a remove button, rather than the plan's `min(pos, count-1)`, because the live row has no X.
>   - **Badge:** it is `aria-hidden`, since the label now carries the count.
>   - **Player e2e:** only the two selector updates (`:414`, `:472`).
> - **A6: done.** `tests/playlist.e2e.mjs` is new, `test:playlist` is in `package.json` and appended to `test:all`. I deleted the 14 promoted `tests/agent-p*`, `agent-l1*`, `agent-l2*` and `agent-l3*` files from the working tree only, so the orchestrator should record the removals.
>
> **Suites**
> - Units: 274/274. That count includes Lane B's tests; it was 200 when I ran it after A1.
> - `player.e2e`: 41/41, run after A5 and again after A6.
> - `playlist.e2e`: 49/49. Against the pre-repair source (37fd46b) it is 12/49, so the checks do bite.
> - Not asked for but run, because they exercise my code: `preview.e2e` 12/12 and `layout.e2e` 41/41.
>
> **Files touched**
> - `src/context/PlayerContext.tsx`
> - `src/components/PlayerBar.tsx`
> - `src/components/ArtistSheet.tsx`
> - `src/hooks/usePlaylistAdd.ts`
> - `src/hooks/useEventPreview.ts`
> - `src/lib/players/soundcloud.ts`
> - `src/lib/players/mixcloud.ts`
> - `src/lib/mediaSession.ts`
> - `tests/player.e2e.mjs`
> - `tests/playlist.e2e.mjs` (new)
> - `package.json`
> - 14 `tests/agent-*` files deleted
>
> **Outside my list**
> - `EventDetailsSheet.tsx` (Lane C) needs the C1 change for failed adds. Its `:314` comment ("preview *this* means this") is now stale after ruling 1. It matters for the A4 contract: the `+` and Preview calls are unchanged, so the sheet needs no code change for A4.
> - The plan's A4 describes `insertAfter` as returning the existing uid when a set is already queued. Callers should treat `null` as "already queued, anchor unchanged".
>
> **Plan versus source**
> - **Preview race:** the plan assumes a cached DJ resolves first in a preview. In the playlist test DJ1 won, so it plays now and DJ2 goes in directly behind it. The playlist test asserts a contiguous block, not a particular DJ first.
> - **Modal focus trap:** an open event sheet traps keyboard focus, so focus can't reach the player bar at all. That predates my work. The focus-after-removal check therefore closes the sheet first.
> - **Verified:** the plan's A-F6 pause fix needs no iPhone to confirm the lower-risk variant. The `auto_play: false` form still does.

*(Orchestrator: 251,631 tokens, 49 tool uses, 29m 39s. Lane C's C1 and the `:314` comment were done in section 21 while this ran.)*

## 25 · Orchestrator — Lane A verified, Lane C checked, docs refreshed

Independently after Lane A's report: `npm run typecheck` clean, units 274/274, `test:e2e` (player) 41/41 on 5811, `test:playlist` 49/49 on 5812. Then six checks for Lane C appended to `tests/playlist.e2e.mjs` as section 11 ("failed adds": a DJ's add that finds nothing says so by name, the `+` is live again, the night's message is not shown for one DJ, the whole lineup finding nothing says so under the play row, the DJ's message is cleared by the new add, no player appeared) — 55/55 on 5813. The fourteen P/L probes Lane A deleted from the tree are recorded as removals. Docs: `CLAUDE.md` (274 units, playlist suite in `test:all`, probes gone), `ROADMAP.md` (both P1 items struck as shipped, deferrals listed), `readthis.md` §0 (the Gianna row heals itself under B2's 24 h rule, so no production `DELETE` is needed; the post-deploy log read Lane B asked for), `memorystate.md` (a "repaired and shipped" entry after the "paused" one, with the accepted deviations and the cost). Now `test:all`, then one PR.
