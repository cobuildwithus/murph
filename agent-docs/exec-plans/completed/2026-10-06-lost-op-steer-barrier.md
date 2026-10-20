# Wait for observable active-turn steering in lost-operation E2E

Status: completed
Created: 2026-10-06
Updated: 2026-10-06

## Outcome and invariant

Make the lost-active-operation scenario hold its first provider response until
its second input reaches the existing runtime steering path. Preserve every
existing delivery, request-count, mailbox-drain, fence-clearance, and fresh-wake
assertion. Production code and runtime authority remain unchanged.

## Evidence and ownership

The provider stub releases on HTTP 202 after mailbox admission and Temporal
signal acknowledgement, before the overlapping direct wake and runner
import/admission necessarily finish. Web owns mailbox admission; the runner imports
and stages inputs; the assistant active-turn controller admits and steers them.
The existing ingress trace records exact-mailbox input acceptance for execution
from the pre-provider/pre-steer callback. Match that milestone and the original
runtime attempt before releasing the test gate. No new production signal or
persisted state is needed. A timeout must fail, with finally releasing the gate
for cleanup. Existing final assertions still prove provider consumption.

## Completed work

1. Trace release failures and the composed steering path.
2. Run the pre-change original sleep-tool test against current main production.
3. Replace the test barrier with exact-input execution-admission observation.
4. Run the fixed scenario three times and the related five-scenario lane.
5. Typecheck, review, close this plan, index it, and commit locally.

## Scope and authority

Only the public scenario and this verification record/index may change. Reuse
the clean private Temporal checkout detached at its current main. All E2E runs
serialize under the caller-provided shared lock, retried every 30 seconds and
released in finally. Stop if production recovery is implicated. No push, PR,
deployment, or production access. Changelog is not applicable: test timing only.

## Verification

- Public base: `d1d0fadd7c9b9a81fd81d666b1325053b6db9240`.
- Private Temporal base: `6f7b634459f148ccdbca4002263a760fb976f9f5`, detached.
- Original scenario body restored byte-for-byte from `5c8df43751^`, including
  `sleep 3` and no provider gate, against unchanged current-main production:
  `pnpm hosted-local e2e linq-lost-active-operation` passed (1/1).
- Final test: `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm complexity:diff` passed; the guard excludes test-only changes.
- Fixed scenario: three independent runs passed (1/1 each), with no test edits
  between runs. Vitest test times: 77.00 s, 76.20 s, 76.36 s.
- `pnpm docs:drift` and `git diff --check` passed.
- Full lane passed: `pnpm hosted-local e2e linq-delivery
  linq-lost-active-operation temporal-orchestration timezone-injection
  linq-same-wake-batching` (5 files, 21 passed, 4 default-gated cases skipped).
  This includes a fourth fixed-scenario pass; command elapsed time was 431.7 s.
- Every E2E command used `MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR` pointing to the
  sibling private checkout's `packages/hosted-orchestrator-temporal`, plus
  `WRANGLER_WRITE_LOGS=false` and `WRANGLER_SEND_METRICS=false`. The shared lock
  was acquired with mkdir, retried every 30 seconds when occupied, and removed
  in finally after each command. All runs exited zero and released the lock.
- Parent diff review confirmed all pre-existing assertions and executable lines
  remain; only cleanup comments were replaced. The new fence assertion binds
  the milestone to the original attempt. No production code changed.
- Privacy review passed. No new repository friction entry was needed.
- Original-body and repeated fixed-test success against the same production
  code isolate the regression to test ordering. The completion-only Worker
  change runs after the failed reply boundary and remains unchanged.
- No CI/release rerun, live-provider test, production validation, push, PR, or
  deployment was performed. Default-gated skipped cases remain unverified here.
  Telemetry absence fails the bounded wait rather than falling back to a sleep.
Completed: 2026-10-06
