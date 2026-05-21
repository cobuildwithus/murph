# Verify acceptance full command

Status: completed
Created: 2026-05-11
Updated: 2026-05-21

## Goal

- Make `pnpm verify:acceptance` complete materially faster than the observed 382s baseline, aiming for about half the baseline, without weakening the acceptance gate or adding new parallel scheduling.

## Success criteria

- `pnpm verify:acceptance` exits successfully in the current checkout.
- The command still covers the same acceptance surfaces: typecheck, package coverage, fixture/scenario coverage, and app verification.
- The measured wall time is materially below the 382s baseline, with the remaining gap to a 191s target explained if the full target is not technically credible without changing acceptance semantics.
- Changes are non-hacky: no skipped checks, lowered thresholds, hidden failures, or local-only bypasses.
- Any command wiring or package-boundary change has focused test/readback coverage.

## Scope

- In scope: `scripts/workspace-verify.sh`, package verification scripts affected by current full-run failures, verifier tests, and narrow build/test performance fixes that preserve acceptance coverage.
- Out of scope: broad product/runtime refactors, weakening test timeouts to hide hangs, and adding new parallel lanes.

## Current evidence

- A fresh `pnpm verify:acceptance` run on 2026-05-11 failed before app verification at about 271s.
- Failures observed:
  - contracts package coverage could not find `packages/contracts/dist/scripts/verify.js`;
  - CLI package coverage timed out in `packages/cli/test/device-cli.test.ts`;
  - the final package coverage summary reported an unreported background package coverage failure.
- Earlier app-verifier work reduced standalone hosted-web `next build` to 46s and reused prepared setup, but this does not prove the full-command objective.
- Later focused Cloudflare timing found `apps/cloudflare/test/runner-container.test.ts` spent a real 60s waiting for a timeout in the stale active-marker cleanup test.
- The focused stale active-marker test now settles the mocked runner request after the cleanup assertion and passes in about 1.6s wall-clock for the targeted command, without adding parallelism or skipping the behavior under test.
- Standalone Cloudflare node verification dropped from about 77s wall-clock to about 41s wall-clock, but the run is currently blocked by unrelated dirty `apps/cloudflare/test/user-runner-alarm.test.ts` failures.
- A fresh full `pnpm verify:acceptance` run is currently blocked before app verification by unrelated dirty Murph Age CLI work: `packages/cli` shape verification reports `config.schema.json` is stale.
- Full `pnpm verify:acceptance` now passes after aligning the unrelated dirty Cloudflare idle-checkpoint tests with the active no-destroy behavior. The verifier reported app verification complete at 191s since command start on the first passing run and 189s since command start on the second passing run.
- Both passing shell measurements included pre-verifier workspace-lock waits from other active processes, so the shell `time` totals were not clean no-lock proof. The verifier's own timer is the comparable acceptance-runtime signal for this task.
- Fresh no-lock completion audit on 2026-05-21 ran `pnpm verify:acceptance` from a clean worktree. The command reached final app verification successfully, and the verifier reported `App verification` done at 193s since command start. This is a 49.5% reduction from the 382s baseline, exceeding the >25% objective while retaining typecheck, package coverage, fixture smoke coverage, package-boundary checks, and app verification.

## Decisions

- Do not add new parallel scheduling to solve this.
- Treat full acceptance pass and wall-clock measurement as required proof, not optional follow-up.
- Fix blockers at their source rather than documenting them away.
- Count external workspace-lock wait separately from acceptance-runtime performance; the lock wait is coordination noise from other active work, not verification work added by this task.

## Verification plan

- Focused shell/script checks for any verifier changes.
- Focused package coverage checks for affected packages.
- Full `pnpm verify:acceptance` wall-clock run.
- Required completion audits before commit/handoff.
Completed: 2026-05-21
