---
name: paseo-fork-release
description: Keep the operator's Paseo fork (devorbitus/paseo) current with upstream stable releases and fork-only fixes, and deploy it to their daemon with their approval. Use when the daily fork-release schedule fires, when the operator asks to sync, stage, or deploy the fork, when a fork-only fix needs to ship, or when tending upstream PRs the fork carries.
---

# Paseo fork release

The operator runs their own Paseo daemon, built from `fork/main` in `~/code/paseo-fork` (pushed as
`main` on devorbitus/paseo): the newest stable upstream tag plus one commit per fork-only change.
Ground Control supervises the daemon and owns restarts. Read `scripts/fork/README.md` first.

## The operator's rules

- **Every deploy needs the operator's approval in chat.** A deploy restarts their main daemon
  (port 6767) and interrupts every running agent. Never run `request-deploy.mjs` without a yes
  from the operator in this conversation, for this release.
- Sync on **stable** upstream releases only (`vX.Y.Z`, no `-beta`). Fork-only fixes stage as soon
  as they are committed.
- Before asking, a release must pass: typecheck, lint, the test files its patches touch, and
  `smoke-release.mjs`.
- Resolve rebase conflicts yourself, rerun the checks, and list each conflict and its
  resolution in the approval ask.
- A patch upstream applied verbatim drops out of the rebase on its own. If upstream fixed the same
  thing differently, drop the patch only when its regression tests pass on upstream's code, and
  say so in the ask.
- New general fixes: ask the operator per fix whether to also open an upstream PR. Upstream's PR
  bar is in `CONTRIBUTING.md` and `docs/qa.md`; PRs there are closed by default.
- Upstream PRs the fork carries (getpaseo/paseo#6510): check for new review comments each run.
  Draft fixes, but ask before pushing or replying.

## Daily run

All commands run in `~/code/paseo-fork`.

1. `node scripts/fork/sync-upstream.mjs`
   - `up_to_date` and nothing new on `fork/main` since the live release (`~/.paseo-fork/current`
     → `release.json` sha): check the carried PRs, then stop. Don't message the operator.
   - `conflict` (exit 2): resolve, `git add`, `git rebase --continue`, rerun.
   - `rebased`: note `dropped` patches for the ask.
2. Checks: `npm run build:server`, `npm run typecheck`, `npm run lint`, then the test files each
   patch touches, one file at a time (`npx vitest run <file> --bail=1` in `packages/server`).
   Never the full suite.
3. `node scripts/fork/stage-release.mjs` → note the release name.
4. `node scripts/fork/smoke-release.mjs <release>`. On failure, fix the cause on `fork/main`
   and go back to step 2.
5. `git push --force-with-lease origin fork/main:main`.
6. Ask the operator in chat, in a few short lines: the release name, upstream version, patches
   kept/dropped, conflicts and resolutions, check and smoke results, and "Deploy? It restarts the
   daemon once things are quiet (15 min max) and resumes interrupted agents."
7. On a yes: `node scripts/fork/request-deploy.mjs <release> --agent "$PASEO_AGENT_ID" --reason
"<release> approved by operator"`, then end your turn. Ground Control messages you with the
   outcome; relay it to the operator in one line.

## Failure handling

- A rollback means the release was unhealthy on the real daemon. Read
  `~/code/ground-control/logs/paseo-daemon.log`, fix on `fork/main`, and restart from step 2.
- Never edit a staged release directory. Never run `paseo daemon restart` or stop the daemon
  yourself; Ground Control owns it.
