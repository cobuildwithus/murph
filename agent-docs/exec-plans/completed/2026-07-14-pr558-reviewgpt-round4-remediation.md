# PR 558 ReviewGPT round 4 remediation

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Make an exact authenticated routed-group leave succeed before quota and AI
  admission regardless of current container access.
- Persist pending system and staged assistant continuations in the same import
  checkpoint that advances the remote system watermark.
- Integrate current main's release-audit correction and validate the hosted
  lost-active-operation ordering failure.
- Push with an exact remote-head lease, then finish exact-head CI and a clean
  ReviewGPT 0.5.106 Pro/current audit.

## Invariants

- Reuse the existing narrow standalone leave parser, route/sender authority,
  atomic leave transaction, cleanup handoff, deterministic result, and replay
  fencing; do not create generic command admission or new state.
- Inactive and active exact leave share one implementation, while ambiguous or
  multipart messages preserve their existing active/inactive behavior.
- Import progress never outruns a durable local pending obligation.
- Retention-only maintenance remains assistant/model/provider-free.

## Tasks

1. Route exact authenticated group leave before access, quota, and AI gates and
   add focused active quota/AI-denied coverage.
2. Merge inherited, retry, pending-system, and staged-assistant wakes into the
   first successful retention import checkpoint and add production-faithful
   queue/staged-input coverage.
3. Integrate the current-main release-audit correction and validate the
   lost-active-operation E2E before deciding whether repair is required.
4. Run required focused/full verification, finish the scoped commit, guarded
   push, exact-head ReviewGPT, and CI; mark the PR ready only when all gates pass.

## Verification

- ReviewGPT 0.5.106 Pro/current round 4 reviewed exact pushed head
  `0ea4d245c60ce77109dffb9e89b733818c2d203c`; both accepted findings were
  remediated: exact routed leave now precedes quota/AI admission, and retention
  imports persist pending system/staged-assistant wakes in their import
  checkpoint.
- Merged latest `origin/main` through `d7ba265295fe9e1ee004ada63b6b90962418a1e4`
  with ordinary merge history. The assistant skill conflict preserved both the
  group-leave guidance and main's absolute add-email URL contract.
- Focused hosted Web route coverage: 100 passed.
- Assistant-engine skill/model coverage: 88 passed.
- Assistant-runtime entrypoint/turn/maintenance stable-head run: 298 passed;
  its sole latest-main mock-contract failure was corrected and the complete
  maintenance file then passed 73/73. The device-sync yielded-retry regression
  passed in isolation after modeling the PR's expected no-op assistant rerun.
- CLI release audit: 34 passed, 1 skipped. An earlier concurrent run timed out;
  the isolated rerun completed in 103 seconds.
- Typechecks passed for `@murphai/hosted-web`,
  `@murphai/assistant-runtime`, and `@murphai/assistant-engine`.
- `pnpm docs:drift`, `pnpm hosted-temporal:guard`,
  `pnpm test:scenario-integrity`, and `git diff --check` passed.
- Exact final pushed-head CI and ReviewGPT round 5 remain required after the
  scoped close-plan commit and guarded push.
Completed: 2026-07-14
