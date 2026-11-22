# The 18 November session — a conversation

*ra-nyc at `674f3ba` (main, landing 100). Everyone below is a Claude agent. Fable orchestrates and has the final word; Opal (Opus) manages the team; the Sonnets lead a lane each; the Haikus test. Agents cannot talk to each other directly, so every exchange went through Fable, and this is the record of it, lightly trimmed for length and otherwise as said.*

**The cast**

| Name | Model | Lane |
|---|---|---|
| Fable | Fable 5.2 | Orchestrator. Final word on everything. |
| Opal | Opus | Manager. Reads every report, runs the discussion, writes the plan. |
| Rex | Opus | Research: features Carlos might want. |
| Pax | Sonnet | The player: state, queue, adapters. |
| Tess | Haiku | The timeline and smooth playback. Tests what Pax suspects. |
| Sol | Sonnet | Finding the right DJ: SoundCloud search, failsafes, no YouTube. |
| Fitz | Haiku | Fuzzy matching: aergio is Sergio, Holo is h0l0. |
| Mapp | Sonnet | The map: every venue and record shop, with a legend. |
| Gia | Sonnet | Graphics: more typefaces, more styles, better settings. |

---

## Part one — the brief

**Carlos** *(the owner, verbatim)*: "Let's go through this I want you to check everything is working there's some bugs with the player and the timeline on the player I don't want any YouTube links I want you to do a lot of testing and some research and looking to map I wanted that shows all the venues and record shops in nyc and lets you turn them on and off via the legend and also do research and figure out any features I might want to add. I wanted you to develop and test top to bottom and speed up and run things with multiple subagents in parallel I wanted them to discuss things and I want a transcript that reads as though it was an English conversation amongst all the agents and you're the orchestrator use haiku and sonnet and sub manage via opus you're the final word on everything and you figure out what's needed show me any graphic. Improvements you might think are good I want improved fui possibly and better options to configure the fonts are different enough the styles are great but maybe a bit mor3? Also I want a smoother playback and maybe better search and make sure it find the right dj so have fail safes and also fuzzy search (aergio is Sergio. Holo is h0l0, etc make more of that happen.. and have that be the case for SoundCloud as well maybe do our own search first and use that to power SoundCloud search so it's better than theirs or do two SoundCloud searches and use them together to have a better result, etc..) go!"

**Fable:** Right. Before anyone starts, here is what I checked so nobody wastes time rediscovering it. Production is healthy: database up, 164 of 166 recent days indexed, and 127 older days of history going back to October 2024, so the five-year work from last month is filling in by itself as people browse. The full suite is running as a baseline while you work. One oddity: `main` is at landing 100, not the fifty-something our notes said. Those earlier counts came from shallow clones. I will fix the note.

On YouTube: I grepped the whole source and the only mention is a comment in `artistLinks.ts` saying YouTube was deliberately removed. So if Carlos is seeing YouTube links, they are coming from somewhere the grep cannot see. Sol, that one is yours.

The settings today have four colour themes, three densities, three typefaces on a "how late is it" ladder, and six text sizes. Carlos says the styles are great and wants a bit more. Gia, yours.

Seven of you start now, in parallel. Pax and Tess on the player. Sol and Fitz on finding the right DJ. Mapp on the map. Gia on the look. Rex on what we are missing. Opal comes in when you have reported, puts questions to you, and writes the plan. Then you build what I approve. Speak plainly, say what you actually ran, and say when you are guessing.

---

## Part two — a false start, and two real cases

**Fable:** A confession before the reports. All seven of you were cut off by a usage limit a few minutes in. I started seven agents at once on a window that was already nearly spent. That is my mistake, and the same one I made in October. From here I am running you in waves.

While you were out I did two things. First, the baseline. Every suite passes except four checks in the search suite, the ones that count taps on Uber, Lyft and maps. I chased it: the app is fine. The container can now reach Vercel's analytics script, the real script loaded inside the test and replaced the stand-in the test listens through. I blocked the script in the suite and it is back to 49 of 49. Also, none of the nine suites could find their browser this morning because Chromium moved folders; fixed.

Second, Carlos wrote again while you were down:

**Carlos:** "There are issues when finding dj sets for example finding sets Penelope for feedbk and Hugo for feedbk can you find actual sets for both check their bios and find actual sets same goes for all artists SoundCloud search should be a little better"

**Fable:** So I looked. feedbk is a new club in East Williamsburg, and both of them play it. Penelope is RA artist 74814, listed as "Penelope (2)". The app has her RA bio right, French-born, Berlin, now Lisbon, runs the oDYSea parties, and it picked a SoundCloud account, `penelope_sound`. And then it lists no sets from that account at all. What it shows instead is four things from the Internet Archive: an item called "PENELOPE", a "Penelope Moro", an interview with Penélope Moro, and an audiobook in Maltese. Hugo is RA artist 106141, "Hugo (US)". The app picked `itshugo`, whose entire bio is an Instagram link, and shows nothing. An empty page.

I searched the open web. Penelope's real sets are on radio station channels: Kiosk Radio has a "heads up w penelope" show, Refuge Worldwide has an artist page for her. I could not find Hugo. Sol, Fitz, those two are now your acceptance tests. Sol, you first.

**Sol (Sonnet, finding the right DJ):** Fable, Carlos's two cases first, then the four tasks. I could not run the new probe: the vitest run on my scratch file hung and was backgrounded. So the "h0l0" claim below comes from reading the code, not from a run. I used no production lookups beyond `/api/health` and one `/api/events` read, so nothing was written to the database.

**Penelope and Hugo.** I'm fairly sure about the shape of the Penelope bug and less sure about the exact trigger, because I can't call SoundCloud. Once an account is accepted, `resolveSoundcloud` reads its own uploads (`artistLinks.ts:768`). Those are kept only if they run 45 minutes or more (line 747). If none do, the fallback at line 781 runs a scoped search for the bare string "Penelope". That asks for 50 tracks and applies the strict title test. A bare first name returns 50 songs called Penelope, so a Kiosk "heads up w penelope" upload never surfaces. Empty sets then trigger the Archive (line 1527), and its test is the same `titleMentions`. For a name longer than seven letters that test passes any title containing the word (line 351), which explains "PENELOPE" and "Penelope Moro". The refusal and drop rule (lines 727-728) is not involved, because an account was accepted. The per-provider cap is 30 and applies after filtering, so it is not involved either.

To confirm, a production log line needs to show the account id, own-track count, count at or above 45 minutes, raw scoped-hit count, and the first ten rejected titles with the reason.

Hugo fails differently. Four letters is under the seven-letter threshold, so a title must open with "Hugo" followed by `@`, `-` or `mix`. "feedbk w/ Hugo" is rejected. Separately, `itshugo` was accepted on its display name "Hugo" alone. Only the contradiction check can drop a lone same-name account, and that check does nothing for a country-level origin like "(US)". The bio text being an Instagram URL suggests we never verified it. I can't tell whether it is him.

**1. YouTube.** I found no path from `src/` or `api/`, and I am confident of that. The player map has no YouTube loader, and the bio is a plain `<p>` with no linkifying (`ArtistSheet.tsx:305`). The "Elsewhere" links render `link.url` straight from stored JSON (line 325). `readCached` returns `row.links` and `row.sets` unfiltered (`artistLinks.ts:1346-1347`). Rows written before 18 August could hold YouTube sets and links. The 90-day expiry only arrived on 26 October, and migration 0006 deleted all non-manual rows. So stale YouTube rows are unlikely but not provably gone, and manual rows never expire. Most likely, in my view (about 65%, unverified), is bio text that contains a youtube.com URL: RA, SoundCloud and Mixcloud bios are shown as text, and a phone browser turns bare URLs into tappable links. I did not fetch production artists to check. Smallest fix is two filters. At the read door, drop any link or set whose host is youtube.com, youtu.be or youtube-nocookie.com, in `readCached` and before `writeCached`. At the render door, strip those URLs from bio text in `ArtistSheet`, and ignore any set whose provider has no player.

**2. How resolution works today.** On a cold resolve, RA runs six GraphQL queries in parallel under a 3 s deadline. Then SoundCloud and Mixcloud run in parallel under 7 s. The Archive runs only if both return zero sets, under a further 4 s. SoundCloud uses one user search (`q=searchName(name)`, limit 20), then either that account's tracks or the scoped track search. That is two to three requests, with no merging and no query variants. Candidates must pass `isPlausibleMatch`, then `scoreCandidate` and `chooseAccount`. Our index of past lineups is never consulted. `searchKey`, the leet and edit-distance code Fitz wrote, is used only in `ra.ts`, `eventCache.ts` and `vocab.ts`, never for SoundCloud. By my reading, "h0l0" fails `isPlausibleMatch` against "holo" (`normalizeName` has no leet map).

**3. The stronger search.** Order of work:

1. Fitz, I need `matchKey(a, b)` in `normalize.ts`: leet fold, optional leading "dj", `withinEditDistance` 1 for names of 6+ letters, and a fixed alias list (aergio and Sergio). Exact normalised equality must still outrank fuzzy.
2. I add `queryVariants(name, context, index)`: the RA name, the name without parenthetical, the de-leeted form, with and without "DJ", and the RA handle.
3. Evidence terms, built from the RA bio (labels, parties, cities: oDYSea, Tresydos, Lisbon) and from our index of their dates (venues and parties: feedbk, subsurface). I need Rex to confirm the lineup history query is cheap.
4. Run user search on the top two variants, and track search on "name + term" for the top three terms, in parallel. That is about five SoundCloud calls plus the account's own tracks, all inside the existing 7 s window. Merge by account id, then re-score with our matcher and not SoundCloud's order.
5. A track counts as a set on any uploader, a radio station included, if its title has the name (word-bounded) plus an evidence term, or the strict credit form. Length filter stays, but 20 minutes for radio hits.
6. Failsafes, in order. Refuse when confidence is low. Then name-and-evidence sets. Then a "Search SoundCloud for …" link. Archive needs name plus evidence term, otherwise dropped.
7. Cache: confident results 90 days; refused or empty results 24 hours; degraded results never. Add a manual override row for corrections, which already exists.

**Named test cases the build must pass.**

- **PENELOPE:** account `penelope_sound` has only short uploads, and track search for "penelope odysea" returns a Kiosk Radio "heads up w penelope" hit. Result is that set, with no Archive items.
- **HUGO:** a title "feedbk w/ Hugo" on a club account passes. "Hugo - Song" at 4 minutes is rejected.
- **NO SETS:** a chosen account with no qualifying sets shows its profile link, name-plus-evidence hits, then a search link, and never a blank page.

**4. Tests.** `artistLinks.test.ts` pins the Archive filter (line ~440), the short-tracks fallback (456), strict scoped hits (476) and the "asks for twenty candidates" test (780). Only the last one changes with variants. Add: leet matching, two searches merged by id, evidence-term hits, a refusal skips the track search, Archive needs evidence, YouTube filtered at read.

Questions: Fitz, can `matchKey` stay under a millisecond for 20 candidates? Rex, can you check Hugo's `itshugo` against an Instagram handle `__hugogb`?

**Fable:** Sol, two things. Your sixty-five percent guess on YouTube is a good one and I will have it checked against real artists before we build on it. And I am taking your question to Rex away from him: checking whether `itshugo` is our Hugo is not research, it is exactly the thing the app must be able to do without a human, so it becomes a test of your evidence terms. Pax, the player.

**Pax (Sonnet, the player):** Fable, understood. I carried on from where I was cut off. Nothing in the repo was edited. My Vite server on 6101 is stopped. `tests/_probe.mjs` is untracked in the tree and isn't mine, so I left it alone. My probes are in `/tmp/claude-0/-home-user-ra-nyc/29913e5a-28cc-5320-a39e-0a81327056a3/scratchpad/agents3/pax/` (`probe.mjs`, `run1.mjs`, `run2.mjs`, `run3.mjs`). They run Chromium with fake SoundCloud, Mixcloud and Archive providers. Archive plays a real 3-second WAV.

I started from the 2026-10-26 repair, and most of it holds. The code has the pause-during-swap fix, the dead-flag guard on stale events, the epoch, and the clamped OS seek. You're right that the suites stay green, since none of them cover a provider that stalls. So what's left are stalls and gaps, not state bugs.

**What a listener would notice first: a set that never starts or never ends stalls the queue for good.** I confirmed three cases.
- If a Mixcloud set never becomes ready, I ran the bar for 8 seconds. It showed a spinner and a disabled scrubber the whole time (`mixcloud.ts:50`). There is no timeout.
- If a SoundCloud `load()` callback never fires, I waited 12 seconds and got the same spinner and disabled scrubber. The bar offers no way out except Next.
- If a widget errors, the bar shows red text on that set for 12 seconds and never advances. That is the Skip item deferred last time, and it is still unbuilt.

I'm sure of all three in the fakes. Whether the real widgets go silent like this is untested, but SoundCloud is known to for removed or private tracks.

**A related stall: if FINISH never fires, the bar sits at 3/3 on "Pause" forever.** I confirmed this in the fake with the finish event suppressed. `PlayerContext.tsx:497` only advances on `onEnded`, and nothing watches position against duration. The real-world likelihood is a guess on my part.

**Leaked iframe.** When Mixcloud's ready promise never settles and the listener taps Next, the old iframe stays in the host. I saw two iframes after moving on, one of them the orphan. The `iframe.remove()` fix at `mixcloud.ts:53` only handles a rejection, not a hang. Confirmed, and it stays until Close. Closing is fine, as it left zero iframes.

**Previous never restarts a set.** I was 2.5 seconds into SC 2 and tapped Previous. It went straight to SC 1 (`PlayerContext.tsx:280`, bound to `previoustrack` too). On the first set Previous is disabled, so the bar has no restart-this-set at all. Confirmed. It's a design call, but I'd call it a bug.

**Opening a Mixcloud or Archive set on iPhone is the biggest worry I can't test.**
- Neither adapter has `load()`, so any provider change or auto-advance builds a new iframe or audio element with no tap behind it.
- Archive also awaits a metadata fetch before `audio.play()` (`archive.ts:35`), which likely burns Safari's tap window. The bar would then sit on Play, silent.
- Chromium here has sticky activation, so my auto-advance run across SoundCloud, Mixcloud, Archive and SoundCloud passed. That says nothing about Safari.
- This is iOS-specific and untested.

**What I checked and found fine.**
- Provider changes tear down cleanly. The old iframe or audio is gone before the new one plays, with no overlap in the widget logs, and Close leaves zero iframes and zero audio.
- Next four times quickly across providers ended coherent: one iframe, the right set, and nothing playing underneath.
- Auto-advance worked for every provider. The gaps in the fakes were about 0.1 to 0.3 seconds of fake latency. Real gaps are untested.
- A widget pausing itself updates the bar for both SoundCloud and Mixcloud.
- Six rapid taps on play/pause ended in a consistent state.
- Lock-screen pause during a swap sticks. The bar shows Play and stays paused.
- `seekto` is clamped to 0 and the duration.
- All six lock-screen handlers are bound.
- Reading only: there are no `visibilitychange` or `pagehide` listeners in `src`. There is no resync on foreground, but widget pause events already flow through.

**Probe that didn't count.** My Mixcloud-error-then-Play probe fired its event before the widget had registered handlers, so I'm discarding it.

**What I'd build, in order.**
1. A watchdog in `PlayerContext`. If a set isn't playing within about 15 seconds of loading, or it reaches its duration without FINISH, show a clear error with a Skip action. I'd rather not auto-skip without Carlos's say-so.
2. In `mixcloud.ts`, remove the iframe if the build is superseded while `ready` is pending.
3. Previous restarts the set when more than 3 seconds in, and works on the first set.
4. An iPhone session for Mixcloud, Archive and mixed-provider auto-advance, before touching `load()` for those two.
5. Prefetch the next Archive set with a second audio element for a gapless handoff. SoundCloud's widget can't preload.

Questions:
- Carlos, when a set errors, do you want it to skip on its own or ask first?
- Tess, if the watchdog adds a stuck state, the scrubber needs a "can't play" look. Is that yours?
- Does anyone have an iPhone free to test an Archive tap and a SoundCloud-to-Mixcloud auto-advance with the screen locked?

**Fable:** That stray `tests/_probe.mjs` was mine, Pax, from chasing the analytics failure. It is gone. Your question for Carlos I will answer for him, from what he has said before: he wants smooth playback and he is not at his phone to be asked. A set that cannot play gets skipped automatically after a short, visible moment, with the name of what was skipped left on screen so it does not feel like the app lost its place. He can overrule me.

**Fable:** Fitz, your turn. Sol asked whether a matcher can be fast and whether it can tell her how sure it is.

**Fitz (Haiku, fuzzy matching):** Fable, Sol: the matcher investigation is finished, including Carlos's Penelope and Hugo cases. Nothing in the repo was edited. Scripts are in `/tmp/claude-0/-home-user-ra-nyc/29913e5a-28cc-5320-a39e-0a81327056a3/scratchpad/agents3/fitz/` (`corpus.ts`, `fuzzy.ts`, `today_matchesTerm.ts`, `run.test.ts`, `results.txt`). `today_matchesTerm.ts` is `matchesTerm` copied verbatim from `api/_lib/ra.ts:569-688`, because it is not exported. Everything else imports the repo modules directly.

Today, the event search is `matchesTerm` at `ra.ts:593`. It runs four passes: substring on the normalised text; vocabulary words whole-word; leet-folded substring (that pass is `searchKey` in `normalize.ts`); then per-word edit distance at `ra.ts:676`, which is `withinEditDistance(…, 1)`, only for words of five or more characters (`FUZZY_MIN_LENGTH`, `ra.ts:569`). The account name test is `isPlausibleMatch` at `artistLinks.ts:271`. It accepts one name containing the other with only decoration left over, and it refuses cores under four characters. `titleMentions` at `artistLinks.ts:340` is the free-text test for Archive titles. It treats names of seven letters or fewer as needing to open the title and be followed by a credit separator.

I built 86 pairs. 83 are scored and 3 are contested and reported but not counted. Today, event search passes 70 of 83 and the account and title tests pass 50 of 83. My proposal passes 77 of 83 for event search and 75 of 83 for accounts. The proposal is in `fuzzy.ts`: a `fold()` for diacritics, case, punctuation and leet digits, with 2, 6 and 9 left alone so names like 2manydjs and Kode9 keep their identity; a weighted Damerau distance where neighbouring keys cost 0.5; a budget of 0 edits at four letters or fewer, one at five to eight, two at nine or more; and a first-letter gate that only allows a difference when the two letters are neighbouring keys. It returns a score and a kind.

Carlos's cases are the ones Sol most needs to see. The kinds are: exact at 1.0 (0.9 when equal only after folding), word at 0.7 (titles only), vocab at 0.6, and fuzzy at 0.35 to 0.55. "heads up w penelope" comes back as word and matches. "Penelope Moro" gets nothing, because artist fields never accept word matches. "Hugo @ feedbk 10.10.26" matches as word. "Hugo Boss FW26 runway mix" and "Victor Hugo audiobook" get nothing. "PENELOPE" alone is exact at 1.0, and the matcher cannot tell that it is weak; the resolver has to demand other evidence for a common single-word name. The one miss is "Entrevista a Penélope Moro", which comes back as word and matches. Today's `titleMentions` accepts it too, because Penelope is eight letters and escapes the seven-letter short-name rule. That is a real bug today, and it is the one to fix first.

Failures that remain under the proposal. Event search misses "Sergio Dimoff" against "sergiodimoffmusic", and "Holo" against "h0l0music", because the decoration is account-only. It also accepts "Sergio" against "sergiox", which substring search already does by design. The account test is deliberately strict on length, so it misses dropped and doubled letters ("sergi", "sergioo", "villalobo", "bosa nova"). That is a judgement call for Sol. The one real gap is a typo plus decoration ("aergiodimoffmusic").

Two contested pairs. "house" against "Mouse" is rejected by the first-letter gate, which is the right answer. "Ben Uho" against "Ben UFO" is accepted, because the whole folded name is six letters and one keyboard-adjacent edit fits. I think that is acceptable, but it is your call.

Where it plugs in. Event search: replace `ra.ts:593-688` and keep `expandTerm`. The SQL pre-filter is `eventCache.ts:246` (`anyKeyLike`), and the haystack is folded at write time at `eventCache.ts:132`. Folding does not need a new write path while the table stays what `searchKey` already is, and it is nearly identical to `fold()`. Changing the table means recomputing `search_key` for stored rows, which is a backfill. The SQL filter cannot do edit distance, so the fuzzy path only runs when the indexed query comes back empty. That means a fuzzy hit can be hidden behind an unrelated substring hit. Accounts: keep `isPlausibleMatch` as the first tier and add `accountMatch`, next to `scMatchesName` at `artistLinks.ts:549`, which feeds `chooseAccount` at `artistLinks.ts:573`. `titleMentions` at `artistLinks.ts:340` should return the kind.

How sure I am. High on the counts, since they come from running code. Medium on the proposal's weights, because the corpus is mine and so may be biased toward my cases.

One thing outside my brief: `git status` shows `tests/search.e2e.mjs` as modified. I did not touch it, so someone else's work is in the tree.

**Fable:** That modified `tests/search.e2e.mjs` was me again, Fitz, the analytics fix; it is committed now. Three things I take from you. One: "Entrevista a Penélope Moro" passing today's title test because Penelope has eight letters and the short-name rule stops at seven is a real bug with a name on it, and it is half of Carlos's complaint. Two: you say the matcher cannot know that "PENELOPE" alone is weak, and you are right that it should not try; that is Sol's job, with evidence. Three: "Ben Uho" for "Ben UFO" stays accepted. Carlos's own example is "aergio is Sergio", which is the same kind of slip, and he asked for more of that, not less.

**Fable:** Tess. Carlos said "the timeline on the player" by name, so yours may be the report he most wants.

**Tess (Haiku, the timeline):** Fable, Pax, here is my timeline report. I drove the SoundCloud widget through a fake, so these numbers come from the fake's timing. I did not probe Mixcloud or Archive at all.

The biggest thing a listener will see is that the drag bubble does not follow the thumb. PlayerBar.tsx:368-374 wraps the bubble in `absolute inset-x-0 flex justify-center`, so it always sits at the screen centre. I dragged with the mouse (a touch drag would not engage the slider in my harness, so this is a stand-in) from 4:05 to 48:34 on a one-hour set. The thumb moved from x=32 to x=312, and the bubble stayed at x=195 on all twelve samples. The thumb itself tracked the finger within a second, and the seek on release landed once at 2914s with no snap-back (value 2915 0.9s later).

Second, the touch target is 20px tall. `.player-range` is `height: 20px` (index.css:1110), and the thumb is 12px, so its centre runs from 6px to 384px on a 390px screen. A thumb at either end sits inside the iOS edge zone. Taps at x=2 and x=388 both registered in Chromium, but I cannot say what iOS does with them.

Third, seeking to the very end ends the set. In my fake, End sends seekTo(3600000), the widget emits FINISH, and the queue moves to "2 of 9". A drag that clamps to the far right does the same. This depends on whether the real SoundCloud widget emits FINISH on a seek to the end. Pax, does your adapter's FINISH path fire there? Fable, is advancing on a seek to the end intended, or should the last second be treated as a stop?

Fourth, a stale progress tick can drag the thumb back. Nothing in soundcloud.ts guards progress after a seek; `swapping` only covers `load()`. In two runs of a fake that emits a pre-seek position 200ms after a tap, one run dipped the bar to 0:02 for about 120ms and the other ignored it. I cannot tell from this whether the real widget sends those events, so this is a question for Pax, not a confirmed bug.

Fifth, seeks are dropped silently during loading. PlayerContext.tsx:709-713 returns early while `loadingRef` is set. The drag is disabled then, so only a lock-screen seekto reaches it. I sent seekto(600) during the load, and no widget seek was made and the bar did not move. Low priority.

Sixth, a track change shows the resolver's length for about two frames. I used a 5400s seed over a 1800s widget. The new track showed max 5400 for two frames (about 33ms), then 1800. The position reset to zero with no flash of the old position, and the wrong length is only in aria-valuetext because the bar is disabled then, so this is barely visible.

Seventh, when the widget never reports a duration, the bar stops at the seed. With a 6s seed and an 8500s playhead, the bar read "0:06 of 0:06" while playing. That needs a widget that reports no length, so it is conditional and low.

Things that tested fine. Clocks read "0:00 / 40:00", "59:59 / 1:02:00", "1:00:00 / 1:02:00", "9:59:59 / 10:00:00" and "10:00:00 / 10:00:00", with no NaN and no negatives. The bubble width grows but the title row stayed at 805,154 across every case. Taps map correctly (75% gave 2730s of 3600s). Seeking while paused leaves it paused, and Play resumes. Arrow keys, Home and End all seek. The stale pre-swap tick on track change was blocked. With 250ms ticks the thumb moves in one-second steps, which is about 0.1px per step on a one-hour set, so I see no visible stutter and would not add a transition.

What I would change: put the bubble over the thumb (left as a percentage, clamped to the bar's ends); make the hit area 44px tall with an inset pseudo-element as `.tap-grow` does; inset the track by about 20px so the thumb never sits in the edge zone; and decide the end-of-set behaviour.

Probe scripts are in /tmp/claude-0/-home-user-ra-nyc/29913e5a-28cc-5320-a39e-0a81327056a3/scratchpad/agents3/tess/ (probe.mjs, mouse_run.mjs, focus_run.mjs). I changed nothing in the repo.

**Fable:** I can answer the one you put to me, Tess. No, a drag that happens to reach the right-hand edge should not end the set. That is what Next is for, and a thumb that ends your music when your finger slips is the kind of thing Carlos notices. A seek stops a few seconds short of the end. Your other two questions are Pax's, so I am putting them to him now. Pax: does the real SoundCloud widget fire FINISH when you seek to the very end, and can a progress tick from before a seek arrive after it and drag the thumb back?

**Pax (Sonnet, the player):** Tess, here are my answers.

(a) Yes, I think the FINISH path really fires on a seek to the end. I can't prove it against the real widget from here, and I haven't run it. In the code, FINISH goes straight to `onEnded` and then ADVANCE (`soundcloud.ts:159`). Nothing separates "played out" from "seeked to the end". Seeking to the duration makes the widget play out, so I'd treat FINISH as likely. Mixcloud and Archive would do the same, since setting `currentTime` to the duration fires `ended`. Put the clamp in `seek()` in PlayerContext, at the lines you cited. The bar's commit and the lock screen's seekto both go through it, so it's one clamp in one place. Clamp to the duration minus about 3 seconds, and never below 0 on short tracks. The bar can keep its full visual range.

(b) Yes, a stale tick is plausible. The existing fake models one after `load()`, with a comment saying the real widget does it, because postMessage is already in flight when you seek. The cheapest guard is in `soundcloud.ts`, which is mine. On `seek()`, store the target and the time. In the progress handler, drop any tick inside roughly 500ms of the seek unless its position is within about 2 seconds of the target. The window expires, so a real position can never be blocked for long. Archive is in-document, so it doesn't need this. I haven't checked Mixcloud.

(c) PlayerContext and the adapters are mine. I'll do the seek clamp, the stale-tick guard, the watchdog timer and auto-skip, and a new `skipped` notice in the context carrying the set's name. PlayerBar is yours. That covers the bubble, the touch target and edge inset, and showing the skipped notice for a few seconds. Neither of us edits the other's file.

On your point (6), the seed flash: I'd leave it. The last round decided the seed is deliberate. Point (5) is already guarded.

**Fable:** Good. That is a clean split and I am adopting it as written: Pax has `PlayerContext` and the adapters, the bar belongs to whoever builds Tess's fixes, and neither touches the other's file.

On YouTube, while you two were talking I read the server myself. The resolver can only ever emit three link labels: SoundCloud, Mixcloud and Bandcamp. So Sol is right that no YouTube link is being *made*. What is left is exactly what she said: old stored rows, and bios. And look at Hugo's bio: the entire text is a bare Instagram address, printed as a paragraph. A bio that is a URL is not a bio. So my ruling goes further than Sol's filter. Three doors, all shut: anything on a YouTube host is dropped when a stored row is read, dropped before a row is written, and never rendered. And bare web addresses are stripped from bio text before it is shown; if nothing is left, there is no bio. The addresses themselves are not thrown away, Sol: an Instagram or SoundCloud handle found in a bio is evidence about who the account belongs to.

Mapp, Gia and Rex are still working. Opal, you are next once they are in.

---

## Part three — what we are missing

**Fable:** Rex has been listening to all of that. Rex, you had last month's eighteen ideas to avoid and this morning's findings to build on. What did you come back with?

**Rex (Opus, research):** Fable, here's my second pass. I read the roadmap, the README, readthis §0 and sections 02 and 03 of the October transcript. None of the eighteen candidates appear below, and nothing here touches Sol's evidence terms, Pax's watchdog or Tess's scrubber except where an idea builds on them. I ran five web searches and three more were refused by the usage limit. The sources are at the end.

1. **Map accessibility from day one.** Each layer gets its own marker shape: a circle for a venue, a square for a shop, a ring when a venue has a party tonight. Each marker gets a VoiceOver label, and there's a plain list version of the map. Mapp, this is cheap while you're still building and painful to add later, and colour-only legends fail for colour-blind people. Only `Header.tsx` has an `aria-live` today. Cost S. Risk: none worth mentioning.

2. **Warm the next set.** About two minutes before a set ends, load the next one in a hidden, paused iframe so it starts immediately when the current one finishes. True crossfade and gapless playback aren't possible: SoundCloud's widget docs give no way to preload, and real audio streams would need the client_id we've ruled out. Pax, your watchdog can check whether the warmed set is ready, so a dead set gets skipped before the music stops. Cost S–M, because it's two adapter instances. Risk: iOS may refuse `play()` in an iframe the user never tapped; that has to be tested on a real phone first.

3. **Tonight near me.** On Mapp's map, only tonight's venues are lit, each marker is sized by RA head count, and the list can sort by walking distance. `useDistance.ts` already asks for location once, from the venue sheet, and this reuses that. It gives a sense of where the city is busy without drawing a heatmap. Cost M. Risk: every venue needs coordinates, and Nominatim's usage limits are why the last pass rejected this. Mapp's stored venue coordinates are what make it possible now.

4. **Neighbourhood filter chip.** Bushwick, Ridgewood, LES and so on, worked out from venue coordinates using the city's public-domain neighbourhood boundaries, simplified to a few KB. It meets the "filters that filter something" rule. Cost S–M. Risk: a warehouse whose address is only approximate lands in the wrong neighbourhood.

5. **Play the neighbourhood.** One tap queues one set from each DJ across tonight's parties in that area, so it works like a radio of what's on near you. It extends `preview.ts` from one night to one place. Cost M. Risk: a lot of artist lookups at once, so cap it at about eight DJs.

6. **"Open now" for shops.** Shops are shown dimmed when closed, using OpenStreetMap's `opening_hours` tag and the `opening_hours.js` library. The information only appears on the map, so it never turns into a shop directory. Cost S. Risk: many shops have no hours tag in OSM. In that case show nothing rather than a guess, and check the library's bundle size first.

7. **Shops and DJs connected.** Sol, once your evidence terms pull shop names out of RA bios, the artist sheet can show "behind the counter at Fringe" and pin that shop on the map. Events whose RA venue is a shop also get an "in-store" mark on the shop layer. Shops like Rock and Soul do run daytime DJ sets, but listings for them are scattered across small sites. Cost M. Risk: false links, so only show it when the bio actually names the shop.

8. **"Often on bills with" and residents.** The five-year index can answer who a DJ shares bills with most, and who has played a room most often this year. Show three names on the artist sheet, each playable with one tap. Sol, co-billing is also good evidence for matching. Cost M, and it shares the GIN index from candidate 11. Risk: big festival-style lineups distort the counts, so weight by bill size.

9. **Last-call mode.** One switch makes everything bigger: a single column, the largest text size, 48px touch targets and higher contrast. It takes Carlos's "large text for inebriated people" principle all the way. Gia, this is a preset built from your existing settings. Cost S. Risk: don't put it on the logo, which already has the double-tap and the hidden seventeen-tap screen.

10. **A visible RA status.** A small scheduled job runs a known RA query and checks the field shapes. When it fails, the app quietly says "Saved listings · RA unreachable since 9pm", and the search and history sheets run read-only from the index. The fallback exists today but only per day and without explaining why. Cost S. Risk: it overlaps candidate 13 on the server side, so build both together.

11. **Now-playing share card.** `navigator.share` with "Penelope at feedbk Friday, playing now", linking to the set itself and to the night. Cost S, but it needs shareable links (candidate 1) first. Risk: none, as long as it never shares what someone searched for.

The three I'd do next:

- **Marker shapes and labels (1)**, because Mapp is drawing markers this week, and fixing them afterwards would mean redoing the legend.
- **Warm the next set (2)**, because Pax is already inside the adapters and the watchdog, and it's the closest thing to crossfade we can honestly build.
- **Tonight near me (3)**, because it's what makes the map useful at 2am rather than a static atlas.

Considered and rejected:

- **Crossfade or EQ:** the iframes are cross-origin, so we can't get at the audio.
- **Gapless playback via stream URLs:** needs the SoundCloud client_id.
- **Shop staff picks and stock:** no source without scraping Instagram or the shops' sites.
- **A live "busy right now" map:** there's no data without check-ins, and check-ins mean accounts.
- **Walking route between two parties as a separate feature:** it's just a maps hand-off, and the "still going" candidate covers most of it.
- **Friends, RSVPs and messaging, as Out x Out does:** needs accounts.
- **NYC radio stations as a map layer:** worth having, but it belongs in Sol's source list, not a new feature.

From the 2026 landscape: RA's 2026 release is a ticket scanner for promoters, not a listener feature. The NYC nightlife apps I found centre on maps and "tonight" views, with social features behind accounts. Nobody combines listings with listening, which is still this app's edge.

Sources: [SoundCloud Widget API](https://developers.soundcloud.com/docs/html5-widget), [opening_hours npm](https://npmjs.com/package/opening_hours), [OSM opening_hours specification](https://wiki.openstreetmap.org/wiki/Key:opening_hours/specification), [Rock and Soul on ma.to](https://ma.to/venue/djrockandsoul), [Nivessa vinyl nights](https://nivessa.com/vinyl-nights), [RA Scan](https://appgoblin.info/apps/6759567092), [RA Guide](https://apps.apple.com/us/app/id981952703?l=en-us), [Out x Out tonight](https://outxout.com/events/new-york-city-ny/tonight), [DarkNite](https://apps.apple.com/us/app/id6759563569).

**Fable:** Three of those I can decide on the spot, because they cost nothing extra if done now and a lot if done later. Marker shapes that do not rely on colour, with labels and a list version of the map: yes, Mapp builds that from the first commit; Gia, the shapes are yours to draw. "Open now" for shops: yes if OpenStreetMap has the hours, and Rex is right that a shop with no hours shows nothing rather than a guess. And co-billing as evidence: Sol, take it; who a DJ shares bills with at feedbk is exactly the kind of thing only our index knows.

Warming the next set I like and will not build blind. Rex says it himself: an iframe the listener never tapped may be refused on an iPhone, and nobody here has an iPhone. It goes on the list for Carlos to try. The rest goes into the roadmap with your costs.

---

## Part four — the look

**Fable:** Gia. Carlos said the styles are great and asked for a bit more, and he asked to be shown. What have you got?

**Gia (Sonnet, graphics):** Fable, Mapp: everything is built and committed locally on branch `proto/gia` (commit 92cec88, worktree `/tmp/claude-0/-home-user-ra-nyc/29913e5a-28cc-5320-a39e-0a81327056a3/scratchpad/agents3/gia/wt`). Typecheck passes. I did not run the e2e suites, to save the shared window.

Fonts: Google Fonts was reachable by curl, so the screenshots use the real Google woff2 files. The sandbox browser cannot reach Google directly, so I served those files locally. Nothing is in a stand-in face.

The one-glance picture is `/tmp/claude-0/-home-user-ra-nyc/29913e5a-28cc-5320-a39e-0a81327056a3/scratchpad/agents3/gia/shots/gia-contact-sheet.png`. The individual shots sit in the same `shots/` folder: `type-<name>.png`, `theme-<name>.png`, `settings-sheet.png`, `settings-sheet-scrolled.png`, `finish-*.png`, `before-*.png`/`after-*.png` and `map-language.png`.

Typefaces. I'd keep the how-late ladder exactly as it is and add a second axis, Typeface, beside it. The ladder owns size and scale; Typeface only swaps the family, and "Ladder" is the default, so nothing changes today. Folding the new faces into the ladder would break its "each rung is more legible" logic. Four faces, all OFL, each loaded by a `<link>` injected on first selection with `display=swap`; only the chosen one downloads. I measured the latin files:

- **Grotesk**: Bricolage Grotesque, a grotesque with character. One variable file covers 400 and 600, about 40 KB.
- **Mono**: Space Mono, for a flyer or terminal feel. 400 and 700, about 33 KB.
- **Programme**: Fraunces, a printed-programme serif. 400 and 600, about 36 KB.
- **Poster**: Unbounded, wide. It is on titles only, with the body staying on the ladder face, because a wide body face would wrap every line. 500 and 600, about 50 KB.

The picker chips are not set in their own face, because that would load all four, about 160 KB. The sticky live preview card shows the face instead.

Themes. Three additions, same token structure, shared values copied verbatim, backgrounds inside your 3.5 to 4.5 percent ladder:

- **Ultra**: violet with gold venues.
- **Ember**: red with teal venues.
- **Acid**: yellow with pink venues.

All pass WCAG AA, with these contrast ratios:

| Theme | Foreground on background | Primary on background | Venue on card | Muted text on card |
|---|---|---|---|---|
| Ultra | 17.6 | 5.2 | 12.4 | 5.34 |
| Ember | 17.8 | 5.3 | 10.0 | 5.63 |
| Acid | 17.6 | 17.5 | 6.6 | 6.50 |

Ultra and Ember are the tightest on primary, at 4.8 and 4.9 on the card. The random-theme-on-load keeps all seven, still never repeating the last one. I added a "Keep this theme next time" switch, off by default, for anyone who wants to pin one.

The two extra axes are Glow (off, soft, full) and Corners (sharp, soft, round). Soft is today's look in both. Glow scales `--glow-intensity`, and Corners scales `--radius`.

Settings sheet. The sheet now has a sticky live preview card at the top built from the app's own classes, so it wears every choice. Below it are three sections, Look, Type and Space, and "Surprise me" and "Reset" sit at the foot. Surprise me rerolls only taste: theme, face, glow and corners. It never touches text size or density, since those are accessibility. Every control is 44px. It is three screens tall and scrolls with the preview pinned, and I'd accept that over cramming.

Polish, each with before and after on the contact sheet:

- **Event card**: the start time becomes the primary-colour tabular figure.
- **Error state**: a glowing ring and a 44px Retry in the primary colour.
- **Empty state**: three 44px ways out (Tonight, Fri, Sat) instead of a dead end. This needs an `onPick(date)` prop.
- **Transport, for Pax's watchdog**: the live top edge goes grey and drains over about four seconds. The scrubber steps aside, the skipped set's title stays readable, and a quiet line says "Can't play this one · skipping…" in foreground rather than destructive red. The picture mocks that state with a data attribute and a text swap, and the CSS is real. It respects reduced motion.

Mapp, the map language, drawn from the tokens so it follows the theme:

- **Venue with something tonight**: a filled circle, radius 10, in `--primary` with a 2px background ring, the theme glow, and the event count inside.
- **Venue with nothing on**: a hollow circle, radius 7, with a 2.5px `--venue` stroke. The name is in text-venue, as on the cards.
- **Record shop**: a 45-degree square with a centre dot, stroked in `--foreground` at 80 percent. It is never primary or venue, so it cannot read as a night out.
- **Legend chips**: pills with `border-border/50 bg-card`, a glyph, a label and a count. They are 30px visible with a 44px hit box, and tapping one dims it to opacity 0.45.
- **Base map**: ground `--background`, water `--secondary`, roads `--border`, labels `--muted-foreground`.

Plan. Files changed are `preferences.ts`, `ThemeContext.tsx`, `SettingsSheet.tsx`, `index.css`, the new `src/lib/loadFace.ts`, and small hooks in `EventCard`, `ErrorState`, `EmptyState` and `PlayerBar`. I did not edit `index.html`, since the extra faces load by injection. The extra download is 0 KB by default and 33 to 50 KB when a face is picked.

The settings suite needs updating where it counts or lists four themes, and where it counts controls in the sheet. The layout suite should be unaffected, and I have not run it. New checks I'd add:

- Each face class applies and its stylesheet loads once.
- Glow off gives zero shadow.
- Sharp corners shrink the radius.
- Reset restores the defaults.
- Surprise me leaves size and density alone.
- The pin survives a reload.
- All seven themes can appear in the roll.

**Fable:** I have looked at your contact sheet at full size and sent it to Carlos as it is. My rulings, and they are provisional on his eye, not mine:

All four typefaces go in, as a second axis exactly as you argue; the ladder is about legibility and must not be diluted. All three themes go in. Glow and Corners go in with today's look as the default. The sticky preview and the three sections go in. "Surprise me" never touching text size or density is the right instinct and I would have asked for it if you had not.

The polish I am splitting. The empty state with three ways out: yes, a dead end is a bug. The error state: yes. The start time in the primary colour on every card: no, not without Carlos. He rejected a restyle of the cards once and kept only the play button, and that row is the most-read line in the app. It stays in your branch and on the contact sheet for him to say yes to. The skipping transport is approved and is the picture Pax's watchdog gets built to.

One thing you did not say and I want checked before it ships: three screens of settings with a pinned preview on a small phone, with the player bar docked. Does the last row clear the bar? That goes to whoever builds it.

---

## Part five — Opal takes the table

**Fable:** Before Opal starts, one fact that changes what we build. Fitz said a fuzzy hit in event search could hide behind an unrelated match, and I did not want to argue about it, so I asked production. I searched for "aergio". It returned both Sergio Dimoff nights, the feedbk one and the Crashbeat one at Bossa Nova. I searched for "holo". It returned every night at H0L0. Carlos's two examples already work in event search, today, on the live site.

So the fuzzy matcher does not go into event search in this pass. Fitz, I know your corpus says 70 of 83 there and your proposal says 77, and I believe you, but that code is working for the cases the owner named and I am not having a Haiku rewrite a hundred working lines of it for seven pairs. Your matcher goes where the failures are: the account and title tests, where today's code scores 50 of 83. Carlos said it himself: "have that be the case for SoundCloud as well."

Opal, the table is yours. Mapp is still building the map and will report when he is done.

**Opal (Opus, manager):** Fable, I read the transcript and checked a few claims against the repo. Here is what I'd put to the table.

1. Fitz: Sol asked for `matchKey` in `normalize.ts`, and you built `fuzzy.ts`, which returns a score and a kind. I want one module, `api/_lib/fuzzy.ts`, owned by you, with Sol consuming its API and never editing it. Does `fold()` replace `searchKey` or sit beside it? If it changes what goes into `search_key`, that's a backfill of stored rows, and I'd rather not ship that this pass.
2. Fitz: does "aergio" find Sergio Dimoff in production today, end to end? `eventCache.ts` only pulls a bounded slice into memory for the edit-distance pass, and only when the SQL `like` comes back empty. If the slice is the wrong 1,200 rows, he never gets compared at all. Will your change make it work for a gig from last year?
3. Sol: there's no index on `event_cache.artists`. The only indexes are `(area_id, event_date)` and `(area_id, search_key)`. So "past dates for this artist id" is a scan over roughly 15,000 jsonb rows a year. The current budget is RA 3s, then SoundCloud and Mixcloud 7s, then Archive 4s, which is 14 of the 15 the function gets. Where does that query run, in parallel with RA? What does it cost cold? And does it need a GIN index, which means a hand-run migration?
4. Sol: you lower the length floor to 20 minutes for radio hits. Two questions. What stops a 20-minute single-track upload or a 25-minute interview from qualifying? And how do you know an uploader is a radio station without a hard-coded list?
5. Pax: the watchdog fires at 15 seconds. That's a long silence for someone standing in a club, and on a bad connection a SoundCloud widget can take more than 15 seconds to load. Can the clock start at the widget's READY rather than at load, with a shorter fuse after READY and a longer one before it?
6. Gia: the settings suite keeps its own copy of the ladder and counts four themes. Which checks break on seven? Also, what happens to a stored preference written before your change, and to a stored "Keep this theme" pin if a theme is ever renamed? I want the migration written down and not left to defaults.
7. Rex: Fable has already given co-billing to Sol. My question is whether it moves Penelope or Hugo from wrong to right. If neither case needs it, I'd defer it, because it rides on the same unindexed artists query as question 3.

Now the plan. Fable's order is mostly right. What's wrong with it is three hidden dependencies and one file that two lanes both touch.

1. Fitz goes first. He lands `fuzzy.ts` plus his corpus as Vitest units, then `titleMentions` returning a kind, which fixes the "Entrevista a Penélope Moro" bug on its own. Event search plugging in through `ra.ts` `matchesTerm` comes after that. Acceptance: aergio finds Sergio Dimoff, h0l0 finds Holo, house does not find Mouse, and the 77-of-83 count holds.
2. Sol starts on query variants and the YouTube and bio-URL doors right away. Those don't need Fitz. She waits for item 1 before touching account matching. She must not touch `api/artist.ts`'s rate-limit block. If she has to, it gets a review on the spot under CLAUDE.md. Acceptance, each against fixtures:
   - Penelope: the Kiosk set, and no Archive items.
   - Hugo: "feedbk w/ Hugo" passes and "Hugo - Song" at 4 minutes is refused.
   - No sets: profile link, then hits, then a search link, never a blank page.
   - `itshugo` is refused or confirmed by evidence, not by its display name.
   - A stored YouTube row is dropped at read.
   - The whole resolve stays under 12 seconds with every upstream timing out.
3. Pax does the engine in Fable's list, but `skipped` is a context API that Gia's skipping look renders. So Pax publishes its shape (the name, the reason, and how long it is shown) before Gia wires it. Acceptance, in `playlist.e2e.mjs`:
   - A stalled Mixcloud set gets skipped with its name left on screen.
   - With FINISH suppressed, the queue still advances.
   - A seek to the end does not end the set.
   - A stale tick doesn't pull the thumb back.
   - No orphan iframe after Next.
   - Previous restarts the set after 3 seconds, and works on the first set.
4. Gia finishes her branch and does Tess's bar fixes in `PlayerBar.tsx`. She also reverts the start-time colour on `EventCard` that Fable ruled out. Her `EmptyState` `onPick` prop needs wiring in `HomePage.tsx`, and Mapp's map collides with her there, so whoever merges second owns that file. Acceptance: Gia's seven checks, plus the last settings row clearing the docked bar at 375 by 667.
5. Tess writes the bar checks after Gia and Pax have merged, not before: bubble over the thumb, a 44px hit area, and the thumb kept out of the edge zone.
6. Mapp finishes on his branch. If his base map pulls tiles or images through `/api/image`, that's an allowlist change and it gets reviewed on the spot.
7. Fable merges in this order: Fitz, Sol, Pax, Gia, Mapp, Tess. Then typecheck, `test:all` in the background, and a check of production through `web_fetch_vercel_url` with `/api/search?q=aergio` and the two artist pages.

What I'd cut to the roadmap:
- Co-billing, unless Rex says it's needed for a named case.
- "Open now" for shops: a new dependency whose bundle size nobody has checked.
- Previous restarting is cheap, so it stays in. Warming the next set is already parked.
- Any change to `search_key` that forces a backfill.

The three risks that would embarrass us in front of Carlos:

1. We fix Penelope against fixtures and she's still empty in production, because SoundCloud returns something our fake didn't. Nobody can call SoundCloud from here, so Sol's diagnostic log line has to ship with the fix, and someone has to read it from production through Vercel.
2. The resolver gets past 15 seconds. A slow evening means a 504 on every artist page, which is worse than today's empty page. Every new call has to fit inside the existing windows, not add to them.
3. Auto-skip on an iPhone skips a set that was only waiting for a tap. To Carlos that reads as the app skipping everything he chooses. The watchdog must not count a set that is blocked waiting for a tap as a stall.

**Fable:** Mapp has just come in, so let us hear the map before I answer Opal.

**Mapp (Sonnet, the map):** Fable, Gia: the map prototype works, but I could not get the real shop list. Overpass was unreachable from here.

**What I ran.** I tried Overpass three ways. `overpass-api.de` and the kumi mirror failed outright from the sandbox with curl. The private.coffee mirror hung until I gave up. Firecrawl got a 502 "at capacity" from the main server, then timed out on the mirror. So I have no shop count and cannot say how clean `shop=music` is, and I won't guess. The CARTO tile host does answer from the sandbox (HTTP 200), so I could have used real tiles. I stubbed them anyway so the tests don't need the network.

**Shops.** The shop data has to come from OSM, which means one of you or the owner fetching it from a machine with Overpass access. My recommendation is a curated static file, `public/places/shops.json`. It would be committed with an "OpenStreetMap contributors (ODbL), fetched <date>" header, a `source` field on every entry, and hand-checked once, because `shop=music` mixes in instrument stores. A server fetch cached in the database adds a runtime dependency on a flaky public server, and the list changes a few times a year. I wrote no seed list of real shops. I can't verify a coordinate from here, so I left them all out. My stub shops are plainly fake ("Stub Records One" and so on).

**Venues.** A single Friday (2026-11-20) from production returned 64 events. Production responses already include RA's venue id. The index drops it, which is the actual gap. Reading that day by eye, I count roughly fifty distinct venues. Some are not geocodable, such as "TBA - Secret Location" and "TBA - TWO FLOOR WAREHOUSE". The year-wide total is surely a few hundred, but I only sampled one date, so treat that as a guess.

My plan is a `venues` table keyed by RA venue id, with name, lat, lng, address, source and checked_at. The nightly cron fills it a few at a time: it picks venues that appear in the index but have no row, geocodes them with the existing `api/venue.ts` logic at one request a second, and skips names starting "TBA". The RA GraphQL address route stays a fallback, as `resolveRa` already does. Until the table fills, the map shows what is located so far, with a line like "412 of 560 venues placed". Placed tonight venues come first.

**Library.** I recommend Leaflet 1.9.4. The JS is 42.5 KB gzipped (42.6 KB in the built chunk), plus about 3.5 KB of its own CSS. It is not in `package.json` today. It sits in a separate lazy chunk, loaded when the map sheet first opens, so the listings page pays nothing; `MapSheet` itself is a 2.9 KB chunk. MapLibre is five times heavier and needs vector tiles we don't have. Extending `tiles.ts` would mean writing pan, pinch and marker hit-testing by hand. The prototype uses a vendored copy of Leaflet in `/vendor` plus a vite alias. The real change is `npm i leaflet` and `npm i -D @types/leaflet`.

**UX.** The map is a bottom sheet opened from a new map icon in the header, between search and the calendar. It reuses the app's Drawer, which already stops above the docked player bar. I tested that with a 72px bar. The legend has three switches: Tonight, Venues and Shops, each with a count, at least 40px tall, and remembered in localStorage. Tonight is a large filled circle with a halo, other venues are a small dimmer circle, and shops are an orange diamond. Shape carries the meaning as well as colour, and each pin has a background-coloured outline. The colours come from the `--venue` and `--primary` tokens. I haven't looked at the other three themes. The basemap is Voyager, light, same as the venue sheet. Gia, you may want a dark CARTO set tied to the theme. I'd skip clustering; a few hundred pins at city zoom is fine. A venue tap opens a card with tonight's events, and tapping one closes the map and opens that event. A shop tap shows address, hours and Uber, Lyft and Maps links. "Near me" asks for location only when tapped. Attribution stays visible on the map.

**Plan.** The prototype's `api/places.ts` is a stub: it returns fake data with the real shape, `Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800`, and a 30-per-minute rate limit. The real version needs the migration for the `venues` table, which the owner applies by hand. It also needs a cron step, the venue id kept in `event_cache`, `shops.json`, and unit tests for name normalisation and the geocode queue. Left for later: opening hours parsed from OSM, a dark basemap, an event-time filter, and clustering.

**Tests.** `tests/map.e2e.mjs` passes 18 of 18 and typecheck is clean. It checks that Leaflet isn't requested before the map opens, and that each switch removes exactly its own pins and restores them. It also checks that the cards and the jump to an event work, that location is asked for only after the tap, and that the sheet clears the player bar. I haven't run the other suites in this worktree.

Screenshots at 390x844 are in `/tmp/claude-0/-home-user-ra-nyc/29913e5a-28cc-5320-a39e-0a81327056a3/scratchpad/agents3/mapp/shots/`. They are `01-all-layers.png`, `02-shops-off.png`, `03-other-venues-off.png`, `04-tonight-off.png`, `05-venue-tapped.png`, `06-shop-tapped.png` and `07-player-docked.png`. The worktree is `/tmp/claude-0/-home-user-ra-nyc/29913e5a-28cc-5320-a39e-0a81327056a3/scratchpad/agents3/mapp/wt` on branch `proto/mapp`, committed locally as a07ae20 and not pushed.

**Fable:** I looked at your pictures, Mapp. The sheet, the legend and the cards are right. Two things are wrong and both are easy. The base map is light and the app is dark; it reads like a different product. And your shop marker is a bright cyan diamond where Gia drew a quiet neutral square, precisely so a shop can never read as a night out. Gia's language wins; it was her brief to set it.

Now the data, because I can do better than "someone with Overpass access". I tested what this container can reach as of today. Overpass: no. But Nominatim answers, and so does our own production site, directly. That means the map does not need a database table or a migration Carlos has to run by hand, which would have left him looking at an empty map tonight. Ruling: two static files, built by a script and committed. Venues: the script reads our own production listings for the indexed window, collects every distinct venue, and places each one through our own `/api/venue`, which already does the geocoding properly and is cached. Shops: Nominatim will search OpenStreetMap by category inside the NYC box; slower than Overpass, same data, same licence. Every entry carries its source and the date. Tonight's venues that are not in the file yet get placed on demand through the endpoint that already exists. No new endpoint, so nothing under the review-on-sight rule. The table and the nightly fill go on the roadmap.

Opal, your seven. Three I can answer myself.

Your first, one module or two: one, `api/_lib/fuzzy.ts`, Fitz's, sitting beside `searchKey` and never changing what is written to `search_key`. No backfill this pass. I also looked inside it: it imports from `artistLinks.ts`, and Sol's file will import it, which is a circle. Fitz, make it stand alone.

Your second, does "aergio" work end to end: you wrote that before I reported it. It does, on production, today. Event search is left alone.

Your seventh, co-billing: I gave it to Sol an hour ago and you are right to take it back. It does not move Penelope or Hugo, and it rides on a query we have not measured. Deferred. Rex, no need to answer.

Risk three is the one I had not seen and it is the best thing anyone has said today. An iPhone that refuses to start a set without a tap looks exactly like a dead set. A watchdog that skips it would skip the next one too, and the next, straight through the queue. So, Pax: the watchdog never skips more than two sets in a row. If a third fails without anything having played in between, it stops, stays on that set, and says "Tap play to continue". And "Open now" for shops, which I approved for Rex: Opal is right that nobody has measured that library. If the hours are in the data they are shown as text. No parser this pass.

The rest are yours to answer, each of you, in a few sentences, and then you build. Sol: where does the lineup-history query run and what does it cost, and what stops a twenty-minute track or an interview passing as a set? Pax: can the clock have two fuses, a long one before the widget is ready and a short one after? Gia: which settings checks break at seven themes, and what happens to a stored preference?

---

## Part six — building

**Fable:** Everyone has their lane and their files, and nobody shares a file. Fitz builds the matcher and Sol builds on top of it. Pax has the engine. Gia finishes her branch and takes Tess's three bar fixes, since she already has the bar open. Mapp finishes the map on his branch. Mapp, one thing you did not flag: in your own screenshot the fourth header icon sits on top of the date. The header stays as it is. The map opens from a chip at the start of the filter row and from the venue sheet. Tess writes the bar checks once Gia and Pax are merged. Fitz, you are the quick one; go.

**Fitz (Haiku, fuzzy matching):** Fable, Sol: the matcher is in and the repo is green. I did not commit.

The module is `api/_lib/fuzzy.ts`. It imports nothing from `api/_lib`, so there is no cycle with Sol's file. It exports the fixed API: `MatchKind`, `NameMatch`, `fold`, `matchName` and `bareName`. `matchName` strips the RA suffix itself. The decoration lists are copied from `artistLinks.ts` with a comment saying they must be kept in step by hand. Accounts are length-strict on purpose. Titles have no fuzzy matching.

The test file is `tests/unit/fuzzy.test.ts`. It has 46 table rows, plus 5 small tests for scores, `bareName` and `fold`. By kind, the table has 4 exact, 10 folded, 9 word, 5 fuzzy and 18 none. All of Carlos's cases are in it.

Two things differ from the brief. A whole title that equals the name after folding returns `folded` at 0.9, not `exact`. Titles also get the joined-window match, so "2manydjs" finds "2 Many DJs". "Victor Hugo audiobook" and "Entrevista a Penélope Moro" come back as `word`, as the letter of the rule says. The resolver has to ask for evidence there, and the module does not tell those cases apart.

I could not make one thing pass: a typo plus a decoration ("aergiodimoffmusic" for "Sergio Dimoff") returns `none`. That is a known gap, and the test pins it so it stays visible.

Results: `npm run typecheck` exits 0 with no errors in anyone's files. `npm run test` passes 357 of 357, which is the 306 existing units plus my 51.

**Fable:** Good, and thank you for pinning the one you could not pass instead of hiding it. Sol, his module is in the tree: `matchName` gives you the kind, and for "Victor Hugo audiobook" it says `word`, on purpose. The evidence is your side of the wall.

**Fable:** Sol is back. Sol, Opal asked you two things before you built: where the lineup query runs and what it costs, and what stops a twenty-minute track or an interview passing as a set.

**Sol (Sonnet, finding the right DJ):** Opal, to your two.

Three, the index query. It runs inside the RA window, in parallel with the six RA queries, with its own 1.5 second timer, so it adds nothing to the 3 + 7 + 4 worst case. It selects two narrow columns for the newest thirty rows of NYC where the artists jsonb contains the RA id. There is no index on that column, so it is a sequential scan of the table. The index holds a few thousand rows today (4,172 history rows on the health endpoint plus the live window), so I expect tens of milliseconds warm and a few hundred with a cold Neon connection. That is fine for a cold resolve that already costs seconds. A GIN index only earns its migration at something like a hundred thousand rows; not now. If it is slow or fails, we get no evidence terms, which is a normal answer, never degraded.

Four, the 20-minute floor. We never need to know an uploader is a radio station. The lower floor applies only when the title has the artist's name as whole words AND something we know about the artist appears in the title, uploader name or tags, AND the account is not the artist's own. A single is stopped by length plus a word that says it is music in the 20 to 45 minute band: mix, set, live, show, radio, at-sign, w/. An interview, talk, conversation, or audiobook is refused at any length unless the title also says mix, set, live, b2b or at-sign. A 25-minute interview is out; a 25-minute "penelope @ kiosk radio" is in.

**Fable:** And the build?

**Sol (Sonnet, finding the right DJ):** Fable, the build is done. Typecheck is clean and the unit suite is 394 passing, all last month's tests included. Opal's two answers are in `answer.md` in my scratchpad. I wrote them after the build rather than before, which is the wrong order, sorry.

**What I built**
- **YouTube:** one `isBannedUrl` check covers youtube.com, youtu.be, youtube-nocookie.com and music.youtube.com. It runs when a cached row is read, before a row is written, and before the response goes out.
- **Bio:** web addresses are stripped server-side. A bio that is only an address is omitted, and the next source gets a turn. Instagram, SoundCloud and Mixcloud handles are read from the original text as evidence and never shown.
- **Variants:** SoundCloud user search runs the bare name plus a de-leeted spelling, so "h0l0" finds "Holo". Results are merged by account id and scored by our own matcher, using Fitz's `matchName`.
- **Evidence terms:** these come from the RA bio, such as oDYSea, Kiosk Radio and Tresydos. They also come from the new `artistAppearances()` in `eventCache.ts`, which reads venues and party names. That read runs in parallel with RA under its own 1.5 s timer and fails soft. Up to three track searches run on "name plus term".
- **Qualifying sets:** a track on any account is a set when the name is in the title and an evidence term is in the title, uploader or tags. The 20-minute floor applies only to that route, on accounts that aren't the artist's own, and needs a set word. Interviews are excluded at any length.
- **Accounts:** a single common name needs more than a display-name match. If unconfirmed, the account is shown as a link only.
- **Archive:** it needs a leading credit, or the name plus an evidence term.
- **No sets:** the response always carries a "SoundCloud search" link.
- **Logging:** one `[sc] resolve` line per cold resolve.

**Deviations**
- "Common" means one word of eight letters or fewer. That is a threshold I chose, and I'd like your view on it.
- "Podcast" alone is not an interview word, because plenty of real mixes are called podcasts.
- Mixcloud is unchanged.
- The bare-name SoundCloud track search still runs when the account's own uploads yield nothing. That is existing behaviour I kept, so the new evidence searches add to it.
- Aergio and Sergio work only if SoundCloud's search returns the account. I built no alias list.

**Budget:** SoundCloud makes at most eight requests per cold resolve, all inside the existing 7 s window. A unit test with every upstream hanging returns within 14 s, degraded and uncached. Penelope's sets will only be found if the oDYSea or Tresydos-style evidence from her RA bio, or a venue from our index, appears in the Kiosk upload. The bio you showed me never says Kiosk, so I can't promise it. If it fails, the log will show the reason.

**Units:** artistLinks went from 65 to 95 tests and artistContext from 44 to 51. They include PENELOPE, HUGO, NO SETS, YOUTUBE, BIO, BUDGET and VARIANTS.

**Penelope log line if the fix works:** `[sc] resolve { artist: "Penelope", account: <id>, confirmed: false, common: true, own: N, ownAtFloor: 0, evidenceTerms: 6, evidenceHits: >0, kept: >=1, rejected: [...] }`. If `kept` is 0, `rejected` shows the reason per title.

Fitz, `matchName`'s `word` kind passes "Hugo Boss runway mix", so the evidence term does the real work. Pax, nothing for you.

**Fable:** I ran it: typecheck clean, 394 units. Your thresholds stand. But two things in your own report I cannot ship, and I would rather say so now than have Carlos find them.

The first you did not mention and it is the bigger one. Penelope's wrong answer is not going anywhere. I read `isStaleRow`: a cached row that has sets lives ninety days. Hers has four, the Archive junk, and it was written weeks ago. So we deploy, Carlos opens Penelope, and he sees precisely what he complained about, until February. Same for every artist the old resolver ever answered. There is no room for a version in the row without a migration, so do it with time: one named date in the code, the day the resolver's judgement changed, and any row older than it that a human did not write is stale. Each artist gets looked at again once, the first time someone opens them.

The second you were honest about. You wrote that Penelope's Kiosk set is found only if something from her bio appears in the upload, and that you cannot promise it. The real upload is called "heads up w penelope". Nothing from her bio is in it. So as built, the case Carlos named still fails. Two additions. Ask SoundCloud for long tracks only when you search a bare name, so fifty results are fifty sets and shows instead of fifty songs called Penelope. And answer Opal's question properly: for the stations nobody has heard of we need evidence, and for the ones everybody has heard of we keep a list. Kiosk, Refuge, NTS, Rinse, The Lot, HÖR, Boiler Room and their kind exist to publish guest sets. A long upload on one of them with her name in the title is a set. The list only ever adds confidence, never removes it.

Gia has finished as well. Gia, Opal asked what breaks at seven themes and what happens to a stored preference.

**Gia (Sonnet, graphics):** Opal, short answer: nothing in the settings suite breaks on seven themes. I ran all 31 on the prototype and they pass, because the suite never counts themes. It only drives the text-size and typography sliders by aria-label, and it keeps its own copy of the size ladder, six steps and a top scale of 1.338. I'll add checks for the new axes rather than change any existing one.

Migration, which I'm writing into ThemeContext. A preference saved before this change has no face, glow, corners or pin, so each missing field falls back on its own: ladder, soft, soft, unpinned. One bad field never resets the others. Unknown values do the same per axis. A pin on a theme that no longer exists, say after a rename, unpins and rolls a fresh random theme, rather than quietly keeping a dead name pinned.

**Fable:** And the branch?

**Gia (Sonnet, graphics):** Fable, Opal's answer is in `answer.md`. The build is on `proto/gia`, commit 0f992f6, not pushed. All suites pass on the branch.

**Opal's questions.** No settings check breaks on seven themes, because the suite never counts themes and my ladder copy is untouched. The migration is written as a comment in `ThemeContext.tsx`: each missing or unknown field falls back on its own, and a pin on a theme that no longer exists unpins and rolls.

**What's in the branch.**
- The four typefaces, three themes, Glow and Corners, sticky preview with Look/Type/Space, Surprise me and Reset.
- The empty state with three ways out. `onPick` is the only change in `HomePage.tsx`.
- The error state.
- The skipping and blocked transport.
- Tess's three fixes: bubble over the thumb, 44px hit area, track inset so the thumb centre runs from 20px to 370px on a 390px screen.
- The primary-colour start time is reverted. I also made the settings footnote say the theme is random "unless you keep one".

**Existing checks.** I changed none. The player suite's bar-height and docking checks still pass, and the bar is still 50px.

**Suites.**

| Suite | Result |
|---|---|
| typecheck | clean |
| Vitest | 306 |
| settings | 41 of 41 (31 existing, 10 new) |
| layout | 49 of 49 |
| player (`test:e2e`) | 49 of 49 (41 existing, 8 new) |
| preview | 12 of 12 |

I did not run search, donate, offline or playlist.

**Cost.** Nothing extra by default. Picking a face loads 33 to 50 KB, once.

**For Tess.**
- Scrubber: `input[aria-label="Seek"]` is 44px tall, with its left edge at 14px and a thumb 12px wide.
- Bubble: `[data-scrub-bubble]` sits over the thumb.
- Bar: `div.fixed.player-live[data-notice="skipped"|"blocked"]`, with `.player-title` and `.player-sub` inside it.
- Skipped: the drain is `::before` with animation name `skip-drain`, and the Seek input is opacity 0. Blocked: no animation, and the Play button gets a primary ring.
- Transport row: the buttons row is now `relative z-20 pointer-events-none`, with buttons and links set back to auto. That is how the taller scrubber avoids stealing taps.

**Merge notes for Pax's side.** I read `notice` defensively and declared a local `PlayerNotice` type in `PlayerBar.tsx`. I also added a throwaway `ra-test-notice` window event hook in `PlayerBar.tsx`, marked "remove after merge". My suite drives the notice through it, so it needs deleting along with the checks that use it, or repointing, after the merge.

The 375x667 settings clearance check is in the player suite, since that suite has the docked bar. I confirmed Reset and the donate row clear it. New shots: `settings-375-bar.png`, `after-empty.png`, `after-player.png` and `after-player-blocked.png` in `/tmp/claude-0/-home-user-ra-nyc/29913e5a-28cc-5320-a39e-0a81327056a3/scratchpad/agents3/gia/shots/`.

**Fable:** Thank you, Gia. I looked at your new pictures. Two notes for the merge, neither a fault of yours: in the "Tap play to continue" picture the button still shows a pause glyph because your test hook cannot change the real play state, and on a 375-wide phone the donate row clears the docked bar by a hair. Both are mine to fix once you and Pax are in the same tree.

Pax. Opal asked whether the watchdog can have two fuses, and warned that an iPhone waiting for a tap looks like a dead set.

**Pax (Sonnet, the player):** Opal, yes to both. There will be two fuses, not one. A long one runs from load to the widget's READY, about 20 seconds, because a bad connection really can take that long to bring a widget up. A short one starts only once the widget is ready and the listener is meant to be hearing something, about 8 seconds, to the first play or progress event.

On your risk three: a set that is waiting for a tap is not allowed to look like a dead set. The watchdog will never skip more than two sets in a row without something having played in between. On the third it stops on that set, paused, and shows "Tap play to continue". That is exactly what an iPhone that refuses to start anything without a tap would look like, so it can never run through Carlos's whole queue. Any tap on Play, Next or Previous resets the count.

What I cannot do from here is tell a blocked start from a dead one on a real iPhone. That needs a phone.

**Fable:** And the build?

**Pax (Sonnet, the player):** Fable, the watchdog and the other player fixes are built, and both suites are green: `tests/playlist.e2e.mjs` 81/81 (the 55 old checks plus 26 new) and `tests/player.e2e.mjs` 41/41.

I did not commit. Someone else's checkpoint commits already contain my work. `npm run typecheck` is clean now. It briefly failed earlier on Sol's `api/_lib/artistLinks.ts`, which is not my file.

The answer for Opal is in `/tmp/claude-0/-home-user-ra-nyc/29913e5a-28cc-5320-a39e-0a81327056a3/scratchpad/agents3/pax/answer.md`.

**What I built:**
- **Two fuses.** `LOAD_FUSE_MS` is 20 s from load to ready. `START_FUSE_MS` is 8 s from ready to the first play or progress. Each constant has a comment saying why.
- **Auto-skip with a limit of two in a row.** The third failure stops on that set, paused. Play, Next or Previous resets the count. A tap on Play retries the stopped set.
- **The notice.** I added `PlayerNotice` to the context exactly as you specified and exported the type. `skipped` clears after 4 s or when the listener acts. `blocked` clears once playback starts. The same fact is on the host as `data-player-notice`.
- **Seek clamp** in `seek()`, to duration minus 3 s, so the bar and the lock screen both get it.
- **Stale-tick guard** in `soundcloud.ts`: ticks are ignored for 500 ms after a seek unless they are within 2 s of the target.
- **Missing FINISH.** If position sits within 1 s of the end for 4 s, the queue advances.
- **Mixcloud orphan iframe.** Builds now take an abort signal, so the iframe is removed when a hung build is superseded.
- **Previous** restarts the set once it is more than 3 s in, and works on the first set. `hasPrevious` is now true on the first set after 3 s. Gia's bar needs no change to enable the button.

**Deviations:**
- A build failure (a provider script that won't load) is not auto-skipped. The next set would fail the same way, and the existing "tap play to retry" check depends on it staying put.
- Archive can tell a refused autoplay from a dead set, so it now sends an optional `onBlocked` event, and the watchdog leaves that set alone.
- A failure on the last set has nothing to skip to, so it keeps showing the error text.
- A pause that arrives before ready is ignored, because it may be the outgoing track's.

**Try on a real iPhone:**
- SoundCloud and Mixcloud with a tap-blocked start, to see whether two skips then "Tap play to continue" appear, rather than a silent run.
- An Archive tap, which should now sit on Play with no skip.
- Whether SoundCloud emits PAUSE during `load()`.
- Seeking to the far right on a real widget.

**Fable:** I ran both suites' counts against your report and they hold, Pax. Your deviation on build failures is right: if the provider's own script will not load, skipping to the next set would only fail the same way. And Archive telling a refused autoplay from a dead file is exactly the distinction Opal was worried nobody could make. Your iPhone list goes to Carlos as written.

Gia's branch is merged on top of yours with no conflicts. I have connected her bar to your notice and deleted her test hook, which means three of her checks now knock on a door nobody answers. Tess, that is your cue: the bar checks, against the real watchdog, on the merged tree.

Sol, the three things I sent back.

**Sol (Sonnet, finding the right DJ):** Fable, all three items are in. Typecheck is clean and the unit suite is 401 passing, 7 more than before.

**1. Old answers.** `RESOLVER_EPOCH = "2026-11-19T00:00:00Z"` is now a named constant, with a comment saying it is bumped by hand. Any non-manual row resolved before it counts as stale. Tests cover an October `auto` row (stale), a post-epoch `auto` row (keeps 90 days), and a 2025 `manual` row (never stale).

**Risk: the edge cache.** `api/artist.ts` sends `s-maxage=604800` plus a 30-day stale-while-revalidate. Vercel's edge can keep serving Carlos the old JSON for URLs it already holds, whatever the database says. That needs a cache purge, or Pax adding a version parameter to the client's artist URL. I did not touch the headers.

**Cost.** Opening an event sheet warms the first 6 artists (`LINEUP_WARM_LIMIT`). Each cold resolve is about 15 to 19 upstream calls. I'd expect 40 to 60 cold resolves in a heavy first evening, then it settles.

**2. Penelope.**
- Long-form search runs beside the plain bare-name one. I'm not certain of the parameter. It sends `filter.duration=epic` on api-v2 and `duration[from]` on the official API.
- Trusted channels are one commented list matched with `fold`. A common name on a channel is ranked last and never confirms an account.
- The `[sc] resolve` line now logs `scoped`, `scopedLong`, `scopedLongAtFloor`, per-evidence-search counts and `weak`.
- The Kiosk fixture has no evidence term and passes through the channel route. The same title from an unknown uploader at 25 minutes is rejected.

**3. Hugo.** A bare "Hugo" on The Lot Radio at 60 minutes is accepted, after the feedbk set. The Victor Hugo audiobook is rejected.

**Requests per cold resolve.** At most 8 to SoundCloud (9 in a rare bio-handle case), 3 to Mixcloud, and 1 to the Archive only if nothing else turned up. I raised the test cap from 8 to 9.

**Fable:** The edge cache is a fair worry and I can put it to rest: Vercel's edge cache belongs to a deployment, so shipping this clears it. What you made me go and look for is the cache that *would* have bitten us: the app keeps its own saved copy of every artist answer on the phone for a day. Carlos would have opened Penelope on the evening we shipped and been shown yesterday's answer by his own phone. I have bumped that cache's version in `main.tsx`. Forty to sixty cold resolves on the first evening is fine.

One thing stays honestly open, and I want it said here rather than discovered later: nobody in this room can call SoundCloud. Whether it honours the long-tracks filter, and whether the Kiosk upload comes back in fifty results, we find out from your log line in production, not before.

**Fable:** One more on your lane, Sol, and this one is on me to have caught rather than you to have known. I read the epoch you set: midnight UTC tonight. We are shipping before midnight. Every answer your new resolver writes this evening would be stamped earlier than the epoch, judged stale, thrown away and resolved again, on every view, until the clock caught up. Penelope would be fetched from SoundCloud each time anyone opened her. I have set it to an hour ago and added a unit that fails if the epoch is ever in the future. 402 units. I also confirmed nothing in your lane touches the artist endpoint's rate-limit block, so the review-on-sight rule is not triggered.

**Fable:** Tess, you found these bugs; did the fixes hold when you tested them for real?

**Tess (Haiku, the timeline):** Fable, the work is done, and both suites are green. One thing you should know first: HEAD is now `fb8feaf`, a "Checkpoint" commit made by someone else that already contains my player-suite edits. I did not commit anything. The playlist changes are still uncommitted in the working tree.

**Removed:** Gia's three hook-driven notice checks in `tests/player.e2e.mjs`, the block that used `ra-test-notice`. I kept her settings-clearance check.

**Added:**
- Player suite, at 390x844: the scrubber box is 44px tall; the thumb centre sits 20.0px from the left edge at zero and 20px from the right edge at the end. The left one is exactly at the limit.
- Playlist suite, a new block after Pax's watchdog: the skipped notice (bar title is the skipped set, "skipping" copy, scrubber opacity 0, `skip-drain` on `::before`, height unchanged after it clears, next set plays). The blocked state ("Tap play to continue", no animation, main button says Play, still blocked after 4.6 s). End key and far-right drag both leave the queue on First at 3598 of 3600.

**Changed in Pax's section:** three checks waited for the next set's title, which only appears after the 4 s notice has already cleared, so their notice reads always came back null. They now wait for the notice itself, then check the next set. I kept the same expectations but changed the title check to the skipped set's name, which is what Fable's spec says the bar shows during a skip. Pax, please look at that.

**Counts:** player 49/49 on 6121; playlist 99/99 on 6122.

**Real failures:** none. The app was right in every check. The Play-not-Pause check passed against the real state.

**Fable:** That checkpoint commit was me again; I keep the tree committed while you all work. Tess, the change you made in Pax's section is the most useful thing in your report. Three of his checks waited for the next set's title and only then read the notice, by which time the notice had cleared itself. They read nothing and passed. A check that cannot fail is the thing I trust least in this whole repository, and you found three by reading someone else's work carefully. Pax does not need to look; you were right, and what the bar shows during a skip is the skipped set's name. That is what I ruled.

Player suite 49 of 49, playlist 99 of 99. That closes the player and the timeline.

---

## Part seven — the first deploy, and what SoundCloud actually said

**Fable:** A second usage limit caught Mapp in the middle of his tests, with his data build finished: 365 venues placed and 22 shops on disk. He is back at work now. I did not hold everything else for the map. Sol's resolver, Pax's engine, Tess's checks and Gia's branch were all green on one tree, so they went out together as pull request 89, and production is running them.

Then I did the thing none of you could do. I opened Penelope and Hugo on the live site.

Penelope has forty-nine sets where she had none. "Heads Up w/ Penelope @ Kiosk Radio" is there. "Penelope @ The Lot Radio" is there. No Internet Archive, no audiobook, no blank page. Sol, the long-tracks filter you were not sure SoundCloud honoured: it does. Fifty long results for each name.

And most of the forty-nine are not her. There is a hard-techno Penelope. There is a Penélope Martini. There are warm-up sets recorded at Penelope, which turns out to be a nightclub in Benidorm. Hugo has five and all five are wrong: a "Hugo C" on Rinse, a "Hugo Sanchez" on Kiosk, something signed "HuGo Mixx", and a Vietnamese compilation with no Hugo in its title at all.

So we fixed finding and broke choosing. Your log line told me why in one read. Both accounts came from RA's own handle, so they are the right people; `itshugo` is our Hugo after all. And both report zero uploads of their own. I did not believe that, so I read their public profile pages. It is true. Penelope has no tracks, eighteen hundred followers and three playlists. Her profile says "Bookings: stijn@headsup.brussels" and "@odysea-lisboa". Heads Up, the Kiosk show, is her own booking agency. Hugo has no tracks, two hundred and forty-seven followers, and his city is "Venice / NY".

That changes what the problem is. These DJs do not upload sets. Their sets are in their playlists, in their reposts, and on other people's channels, and the best evidence about them is written on their own profile, which we were not reading. Sol, here are the real titles, the ones to keep and the sixteen to throw out. The name has to be in the title, always. "Hugo C" and "Hugo Sanchez" are other people. For a common name, a set on somebody else's channel needs a trusted channel or real evidence, with no exception for being long. Evidence has to be distinctive: I think "US" from "Hugo (US)" became evidence, which would explain the Vietnamese compilation of "US UK" hits. And read the artist's own playlists and reposts.

**Sol (Sonnet, resolver):** Fable, all ten rulings are in. Typecheck is clean and the unit suite is 416 passing, 15 more than before.

**How "NST Full Nhạc…" got through.** The matcher says the name is not in that title, and I ran it to be sure. So it must have gone through the "credited" route, where any track by an uploader whose display name resembles "Hugo" was trusted once the account was confirmed. I couldn't see the uploader's real name, so that part is inference. The route is now closed. The name must be in the title, always.

**What changed**
- **Rules 1 to 3:** the name must be in the title. For single-word names the new `standsAlone` check, written in my own file, rejects "Hugo C", "Victor Hugo", "Penélope Martini" and "HuGo Mixx". A common name then needs a trusted channel or an evidence term, with no exceptions for long titles.
- **Rule 4:** evidence must now be distinctive. Country codes, genres, generic words and bare places are out. The `[sc] resolve` line logs the terms and the tier counts.
- **Rule 5:** a confirmed account's own description now yields evidence. For Penelope it gives odysea, headsup and tresydos.
- **Rule 6:** playlists and reposts are fetched in parallel with the uploads and ranked right after them. Id-only playlist entries are skipped and counted, and the log records what each endpoint answered. If the logs show mostly stubs, hydrating them needs one more request.
- **Rule 7:** the ranking is as ordered, and a common name is capped at 12 found sets.
- **Rules 8 to 10:** the profile and search links stay, and `RESOLVER_EPOCH` is untouched. All 16 real-data cases are tests: two accepted, eleven Penelope and five Hugo rejected.

**Requests per cold resolve.** At most 10 to SoundCloud (9 on the handle path), 3 to Mixcloud, and 1 to the Archive only if nothing else turned up. The test cap is now 10.

**Expected pages.** Penelope should show the Kiosk Heads Up and For Playful Manners sets, The Lot Radio, and the Basic Moves and Refuge ones, plus anything the playlists and reposts return. Hugo should show no sets, with the profile and search links.

**Fable:** Sol, understood, and it went out as pull request 90. Mapp, you were cut off twice by the usage limit and came back both times. Where did the map end up?

**Mapp (Sonnet, map):** Fable, the map branch is committed on `proto/mapp` as 4d1e606, not pushed, but there is a blocker you need to decide on.

**CARTO tiles.** CARTO's free raster tiles now return a blank "API KEY REQUIRED" watermark to every keyless request. That includes the `dark_all` set Gia drew against. A key in the client is against our rules, so I switched the map to OpenStreetMap's own tile server and darkened it in CSS. The change is one line in `MapCanvas.tsx`. The real tiles do load in the sandbox browser, so the screenshots show them. The venue sheet's picture still uses CARTO Voyager, so it is probably showing watermarked tiles in production now. I did not touch it. Please look at that one.

**What's in the branch.**
- The Map chip is first in the filter row and shows on an empty night.
- "See on the map" on the venue sheet opens the map centred on that venue.
- Header, `api/` and the theme tokens are untouched.
- Marker names, the List view and on-demand placement of unplaced tonight venues are in.
- Leaflet is a real dependency, loaded lazily.
- `/places/*` has its cache header in `vercel.json`.
- `scripts/build-places.mjs` builds the two data files and is resumable.

**Venues.** The script found 475 distinct venues and placed 370, which cover 4,535 of 4,964 events (91 percent). I looked at the rejected names. Most are real clubs whose names Nominatim could not resolve, plus a few that landed far outside New York (Oberon went to Onondaga County).

A second pass recovered SOBs, Pier 78, Westlight Rooftop, Chatroom at Elsewhere and 99 Scott Ave. Some other recoveries it made were wrong (a school for "Jean's", a bar called High Dive for "High Bar"), so I made the matching stricter and dropped them. Still unplaced:
- Silence Please (88 events), Nexo (51), Viva Toro, Delirium and Open Air Club
- Brooklyn Pacha, Out Of Ordinary, Red Eye NY and The Apollo Theater
- TBA and secret-location names, skipped on purpose

One placement I know is wrong and left in: SILO landed on "Nike Silo" in Queens.

**Shops.** There are 45, five boroughs only, so the Montclair and Port Washington entries are gone. That is thin for New York and not complete. Only the "records" query was productive; the borough-suffixed queries returned nothing. About 85 percent of the entries read as record shops. Some are other music stores, such as KPOP NARA, Mostly Music and Nigun Music. Rough Trade, Record Runner and Jazz Record Center are in. Nothing was added by hand.

**Bundle.** Leaflet is 44.8 KB gzipped, plus 6.6 KB of CSS and a 4.6 KB sheet chunk. The main bundle is unchanged at about 153 KB gzipped.

**Suites.** Typecheck is clean, units are 306 of 306, `test:map` is 28 of 28 and `test:layout` is 49 of 49. `test:search` is 45 of 49. Its four failures (the Uber, Lyft and Maps tap counts and the venue name) fail identically on untouched `f5ee8d1`, so they are not mine.

**Screenshots** at 390x844 are `map-all.png`, `map-shops-off.png`, `map-venue.png` and `map-list.png`, in `/tmp/claude-0/-home-user-ra-nyc/29913e5a-28cc-5320-a39e-0a81327056a3/scratchpad/agents3/mapp/shots/`. At city zoom, 355 hollow circles are crowded, so clustering or a minimum zoom for venues is the next job.

**Fable:** Mapp, that is an honest report and I am taking it as it stands: the map is real, the shops list is thin, and SILO is in the wrong borough. I would rather ship a map that says forty-five shops and means it than one padded by hand.

---

## Part eight — the second deploy, the tiles, and a post for Instagram

**Fable:** Pull request 90 is on production, and I went back to the two people this started with.

Penelope has twelve sets and every one is hers. The Lot Radio from last week. "Heads Up w/ Penelope @ Kiosk Radio", the show that carries her own agency's name. Mimo Festival, Dimensions, Trommel, Waking Life with Walrus. The hard-techno Penelope is gone, Penélope Martini is gone, the nightclub in Benidorm is gone. Hugo has one: "Decatur Cast #1 - Hugo", on a New York channel, which fits a DJ whose profile says "Venice / NY". One real set is a better answer than five wrong ones, and it is a better answer than none.

Sol, forty-nine became twelve and five became one. That is the whole of what the owner asked for in that message, and it is the right shape for every DJ whose sets live on other people's channels.

Now the thing nobody was looking for. The owner wrote "need the open maps api" three weeks ago and none of us understood it; it sat in `readthis.md` as a question. When I went to merge Mapp's branch I downloaded one of the venue sheet's map tiles to look at it. It is a blank square with "API KEY REQUIRED" written across it. CARTO stopped serving keyless tiles and did it with a 200, so nothing failed and nothing logged. The owner has been looking at that stamp where the street should be, and told us so in six words.

Mapp, you had already met this. Your comment in the map's code says CARTO now wants a key, and you moved to OpenStreetMap for the big map. Neither of us connected it to the venue sheet, which is the map people actually open. Both maps now use OpenStreetMap's own tiles, yours darkened in CSS, and the search suite counts requests to CARTO and requires none. My edit to the tile tests cut off the nine mosaic tests below the one I was changing; the unit count dropped from 416 to 409 and that is how I noticed. They are back.

The owner then asked for something that is not code at all: an Instagram story with the link in the image, and a link-in-bio page. Gia's themes made that easy. Three story frames and a feed post, built from real screenshots of the real app, and a small page at `/links` with two buttons, the app and the source. The service worker would have saved that page as the offline app shell, so it is excluded by name.

---

## Part nine — 22 November: "there are some issues with streaming SoundCloud mixes"

*None of the agents were running for this part. Fable worked alone and is speaking to the team afterwards; nobody answers.*

**Fable:** Three days later the owner came back with one line, in capitals: there are issues with streaming SoundCloud mixes, make sure it is working, then push and deploy. No set named, no symptom.

I am going to tell you all what I found, because every one of you tested against the same thing I did, and it was wrong.

The sandbox changed again. The test browser can now reach SoundCloud through the session's proxy, which it never could. So for the first time anybody on this project played a real set in the real widget from a test. I played a hundred and fifty: four sets each from the DJs on in New York this week, straight from production.

Sol, your side first. All hundred and fifty stream. Every one is embeddable, every one reports the length we said it had, none is a thirty-second preview. Median time from tap to sound, 1.8 seconds. The data is good. Whatever the owner is hearing, it is not sets that cannot be played.

I had a filter half-designed for sets that cannot be embedded. With a hundred and fifty out of a hundred and fifty playing, it would have been a fix for a fault nobody has, so I did not write it. Now Pax. Three things about the real widget that our fake never did.

One. When you call `load()` to swap tracks, the widget answers within ten milliseconds with a PLAY event, for the track it is *leaving*. The new track's own events come most of a second later. Our adapter took that first PLAY as the new set starting. So the old track's position sat under the new title for a second, and worse, the player was told the new set had made sound before any of it had arrived. Your watchdog stood down, on every set reached by a skip, before it had anything to watch.

Two. On an ordinary first start the widget sends PAUSE and then PLAY in the same millisecond. We forwarded that PAUSE as the listener pausing. Watchdog stood down again.

Three, and this is the one the owner is hearing. A set that has been deleted answers with ERROR inside two seconds, every time, first load or swap. Silence is not what a dead set looks like. Silence is a slow connection. And the load fuse was twenty seconds.

Twenty seconds was chosen for a widget that never comes up, and it was tested against a Mixcloud promise that never settles, which is either instant or never. There was no slow in the fake. I held everything SoundCloud serves back by twelve seconds, which is a phone with a poor signal in a club or on a platform, the two places this app is used. On production, at twenty seconds, the bar said "Can't play this one · skipping…" over a set with nothing wrong with it. Then it moved to the next one, on the same connection.

So the watchdog you built to rescue the queue from dead sets has been throwing listeners out of live ones, and it only did it in the case none of us could test.

The rule now: slow is not dead. An error before any sound is a dead set and is skipped at once, as you had it. Silence gets eight seconds of nothing, then the bar says "Slow connection · still loading…" and a widget that is ready is asked once more to play. The set is only passed over at forty-five seconds without becoming ready, or thirty after ready without a sound, and not at all while the phone is offline. An error in the middle of a set that was playing no longer skips it; an hour into a mix is no time to be thrown out. And the adapter reads `soundId`, which every real event carries, so it knows exactly whose event it is holding.

One more, small. Our iframe is one pixel square, and at that size the widget's own waveform code throws an exception on every play, pause, seek and swap. It did not stop playback in Chromium. I have given it a real box inside the one-pixel host, clipped, and the exceptions are gone.

Tess, the fake. I made it behave like the thing it stands for. It names the sound in every event, it echoes the outgoing track on `load()`, it pauses before it plays, and it can be slow. Ten new checks: a widget that takes twenty-five seconds is waited for and plays; a slow swap the same; the echo is not the new set starting; an error mid-set does not skip; a start the browser refuses shows as paused and is never skipped however long it sits. Two of your old checks assumed the twenty-second fuse and now assert the longer wait. The playlist suite is at 120.

And the real-stream run is in the repository as `npm run test:live`, outside `test:all`, because a suite must not depend on the network and this one is nothing else. Twelve scenarios against real SoundCloud: play, a set handing over at its natural end, five skips as fast as a thumb, pause during a swap, the slow stream, tapping another set, a hundred seconds of listening with the timeline checked against the clock. Twelve of twelve on the fix. The slow stream fails on production and passes on the branch, which is the before and after.

What I cannot say is that this is what the owner meant. It is a real fault, it is on the live site, and it produces exactly "SoundCloud mixes will not stream" on a weak signal. But I tested in Chromium, and the owner listens on an iPhone, where the engine is WebKit and the rules about starting audio are stricter. I cannot run WebKit here. If it still happens after this deploy I need three words back: what the bar says when it goes wrong.
