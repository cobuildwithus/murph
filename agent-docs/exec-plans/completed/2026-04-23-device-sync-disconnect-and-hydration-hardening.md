# Clarify device-sync disconnect dead-lettering and hosted hydration token flow

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Make provider-initiated disconnect behavior internally consistent by choosing one job-outcome model and encoding it directly in the worker/service/store flow.
- Refactor hosted account hydration so connection-state acceptance, token-observation acceptance, and final credential-clearing behavior are expressed as one ordered decision path instead of overlapping booleans.

## Why

- The current provider disconnect path dead-letters queued and running jobs for an account before `runWorkerOnce()` reaches an `executionDisconnected` branch that still suggests it can complete the current job, which makes the actual outcome opaque.
- Hosted hydration currently recombines overlapping booleans around connection state, token observations, and token clearing, which makes secret-handling and replay rules harder to audit and easier to drift.

## Scope

- `packages/device-syncd/src/{service.ts,store.ts,store/jobs.ts,providers/strava.ts}`
- directly coupled `packages/device-syncd/test/**` only where needed for the reported seams
- `agent-docs/exec-plans/active/{2026-04-23-device-sync-disconnect-and-hydration-hardening.md,COORDINATION_LEDGER.md}`

## Out of scope

- the already-claimed `packages/device-syncd/src/hosted-runtime.ts` parser-hardening lane
- broader provider-manifest or hosted-runtime contract redesign
- unrelated WHOOP provider/test edits already present in the dirty tree

## Constraints

- Keep the fix narrow to the reported disconnect/hydration seams and preserve unrelated dirty-tree edits.
- Treat token-clearing rules as high-sensitivity behavior: prefer fail-closed, explicit phases over compact but ambiguous boolean algebra.
- Follow the plan-bearing repo workflow, including coverage-bearing verification and required completion audits.

## Risks and mitigations

1. Risk: Simplifying the disconnect path could accidentally change job metrics or recovery behavior for provider-triggered deauthorization.
   Mitigation: Pick one explicit model, update the directly coupled worker/store/provider tests, and capture direct proof of the chosen current-job outcome.
2. Risk: Refactoring hosted hydration could change token-retention semantics on replay or disconnect edges.
   Mitigation: Preserve current accepted/rejected cases under focused tests while rewriting the control flow into explicit ordered phases.

## Tasks

1. Register the lane and inspect the disconnect and hosted-hydration code/tests, plus subagent findings.
2. Encode one explicit provider-disconnect job-outcome model across service/store/worker flow and add focused regression coverage.
3. Refactor hosted hydration into ordered decision phases for connection state, token observation, and final credential clearing, preserving intended behavior under focused tests.
4. Run truthful `packages/device-syncd` verification and direct scenario proof, then complete the required audit path and handoff/commit flow.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/device-syncd/src/service.ts packages/device-syncd/src/store.ts packages/device-syncd/src/store/jobs.ts packages/device-syncd/src/providers/strava.ts`
- Direct proof:
  - provider-driven disconnects leave the current running job in the explicitly chosen terminal state
  - hosted hydration applies connection state and token observations through ordered decisions, with the final token-clearing rule remaining consistent on disconnect and replay paths

## Outcome

- Implemented:
  - removed the unreachable provider-driven self-disconnect completion branch so `runWorkerOnce()` now relies on the existing dead-letter + cancellation model after `markPendingJobsDeadForAccount()`
  - rewrote hosted hydration into an ordered local plan that decides connection acceptance, token payload action, and token observation advancement without changing the existing stale/replay semantics
  - added focused service/store regression tests for provider-driven disconnect dead-lettering, replayed connection + fresher hosted tokens, and stale token observations blocking disconnect-triggered credential clears
  - tightened adjacent `device-syncd` service tests so the file is runnable again and one Strava provider test name reflects the seam it actually proves
- Required audits:
  - `simplify`: no actionable findings in the disconnect/hydration lane; one low-risk `close()` cleanup in `packages/device-syncd/test/service.test.ts` landed
  - `coverage-write` (`gpt-5.4-mini`): no additional proof needed; `pnpm --dir packages/device-syncd test:coverage` was already green and remained green
  - `task-finish-review`: no findings in the reviewed lane
- Residual risk called out by final review:
  - provider-side effects that happen before a provider calls `disconnectAccount()` are still tolerated rather than rolled back
  - hosted hydration still depends on callers keeping `hostedObservedUpdatedAt` and `hostedObservedTokenVersion` coherent

## Verification Results

- PASS: `pnpm --dir packages/device-syncd test:coverage`
- PASS: `pnpm --dir packages/device-syncd exec vitest run test/service.test.ts -t "worker batch logs drain failures once and skips reentrant ticks|worker handles missing providers, disconnected jobs, and reauthorization-required jobs|token refresh races as cancelled work|provider-driven disconnect jobs" --config vitest.config.ts --no-coverage`
- PASS: `pnpm --dir packages/device-syncd exec vitest run test/store.test.ts -t "preserves replayed connection state while applying fresher hosted tokens|keeps local tokens when hosted disconnect clear requests arrive with stale token observations" --config vitest.config.ts --no-coverage`
- PASS: `pnpm test:smoke`
- PASS: `git diff --check -- packages/device-syncd/src/service.ts packages/device-syncd/src/store.ts packages/device-syncd/test/service.test.ts packages/device-syncd/test/store.test.ts packages/device-syncd/test/strava-provider.test.ts agent-docs/exec-plans/active/2026-04-23-device-sync-disconnect-and-hydration-hardening.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- FAIL unrelated during local verification: `pnpm typecheck` and `bash scripts/workspace-verify.sh test:diff ...` both stop on out-of-scope branch churn first seen at `packages/core/src/history/api.ts(464,13)` (`TS2352`)

## Landing Status

- No scoped commit was created because `packages/device-syncd/src/service.ts` and `packages/device-syncd/src/store.ts` contain overlapping unrelated dirty hunks outside this lane, so any non-interactive path-level commit would absorb work I did not make.
Completed: 2026-04-24
