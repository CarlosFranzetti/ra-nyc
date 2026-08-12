# CLAUDE.md

Standing instructions for this repository. These are rules, not suggestions —
they hold across sessions unless the owner changes them here.

## Code review cadence

**Run the Sonnet code review only every 7th landing on `main`. Never on the
others.**

The review is a model call over the diff and it is the only genuinely expensive
thing in this project's workflow — the test suites are local processes and cost
nothing but wall-clock time. Running a review on every push spends real money to
re-read code that has not meaningfully changed since the last one.

The counter is the repository itself, so there is no state file to keep in step:

```bash
git rev-list --count --first-parent origin/main
```

First-parent, deliberately — it counts one per merge rather than one per commit,
so "7 commits" means seven things *landing*, which is what the rule is about. A
merge with eight commits behind it is one landing.

Review when that count is a multiple of 7. Otherwise skip it silently: do not
announce that a review was skipped, and do not offer to run one anyway.

Two exceptions, both narrow:

- The owner explicitly asks for a review. An explicit ask always wins.
- A change touches money, credentials, or anything that writes to a user's
  account — `src/lib/donate.ts`, `/api/image`'s allowlist, `/api/backfill`'s
  bearer check, rate-limit headers. These get reviewed on the spot regardless of
  the count, because the failure mode is not "a bug ships" but "money or a
  secret goes somewhere it should not".

Last review: **landing 60**, on the theme-ladder / card-rhythm change. It found
three real defects — a display face that never reached the settings preview
because the rule was a descendant selector and the preview puts both classes on
one element; a `.text-glow` left at the old radii while every box-shadow around
it shrank; and a font weight fetched that nothing can set. All three fixed
before merge. The cadence then widened from 5 to 7 to conserve tokens, so the
next review lands at the next multiple of seven.

## Tests

Run the suites freely — they are local and cost nothing but time. Pipe output
through `tail`; a full untruncated dump of all seven suites is thousands of
tokens of PASS lines nobody reads.

```
npm run test          # 139 Vitest units
npm run test:all      # everything: units + layout, player, search, preview,
                      # donate and offline e2e (~2 minutes)
```

The e2e suites each spawn their own Vite server on a fixed port. If one fails
with `EADDRINUSE`, a previous run left a server behind — pass `E2E_PORT=<free
port>` rather than killing processes blindly.

## Git

- Develop on a `claude/<topic>` branch, open a PR, merge it. Never commit
  directly to `main`.
- **Squash merges are disabled on this repository.** Use a normal merge; a
  squash attempt returns `405`.
- **Branch deletion is impossible from a session.** Both routes are blocked at
  the proxy: `git push --delete` returns 403 on `git-receive-pack`, and the REST
  `DELETE` returns 403 with *"Write access to this GitHub API path is not
  permitted through this proxy."* Do not retry them; list the merged branches
  for the owner to delete on github.com instead.

## Deploys

Vercel deploys `main` automatically. Confirm the production deployment reached
`READY` before reporting a deploy as done — a merge is not a deploy.

Project `prj_PeaknPbv6DenbJgnwy6Qd1Jpbqot`, team `team_2sVeVCDGjXW2eMc1O6Qr78l5`.

## Where the rest is written down

- **[memorystate.md](./memorystate.md)** — the running journal: every decision
  and why, the open questions, and the map of the code.
- **[readthis.md](./readthis.md)** — everything outstanding that needs a human.
- **[INSTALL.md](./INSTALL.md)** — running, configuring and deploying it.
- **[ROADMAP.md](./ROADMAP.md)** — what is next, in priority order.
