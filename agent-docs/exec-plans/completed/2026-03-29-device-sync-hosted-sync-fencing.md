# Harden hosted device-sync snapshot/apply fencing

Status: completed
Created: 2026-03-29
Updated: 2026-03-29

## Goal

- Close the remaining hosted/local device-sync sync correctness gaps so hosted disconnects, webhook receipts, and first-run marker rollout cannot overwrite fresher local runtime state or recreate hosted secrets on disconnected rows.

## Success criteria

- Hosted reconcile updates carry and enforce a hosted connection-version fence in addition to the existing token-version fence.
- Hosted hydration no longer treats webhook-only hosted touches as authoritative connection advancement.
- Existing local rows with missing `hostedObserved*` markers preserve divergent local state on the first post-hardening sync instead of eagerly trusting hosted.
- Focused runtime/store regressions cover the new fencing and rollout behavior.
- Required repo verification commands and mandatory completion-workflow audits are run, or any unrelated blockers are documented with evidence.

## Scope

- In scope:
- `packages/assistant-runtime` hosted device-sync snapshot/hydration/reconcile logic.
- `apps/web` hosted device-sync runtime snapshot/apply helpers and Prisma-backed connection store behavior.
- Focused runtime/store tests that prove the three reviewed gaps stay closed.
- Out of scope:
- Broader hosted execution architecture changes outside the device-sync snapshot/apply seam.
- Unrelated CLI/worktree verification failures except as documented blockers for required repo checks.

## Constraints

- Technical constraints:
- Preserve the existing hosted/local split and the current snapshot/apply control-plane contract shape unless the fence fix requires a small additive field.
- Do not reintroduce token writes onto hosted disconnected rows.
- Product/process constraints:
- Preserve unrelated dirty worktree edits.
- Follow the repo completion workflow, including the required `simplify`, `test-coverage-audit`, and `task-finish-review` spawned audit passes.

## Risks and mitigations

1. Risk: Connection-version fencing skips legitimate end-of-pass hosted writes and leaves stale state behind.
   Mitigation: Restrict the new fence to stale-baseline protection and rely on the next sync pass to reconcile against a fresh snapshot; cover the intended skip behavior with targeted tests.
2. Risk: First-run marker hardening could leave old mirrors permanently unable to acknowledge hosted state.
   Mitigation: Preserve local state only when the hosted snapshot actually diverges; allow matching hosted state to seed the observed markers.

## Tasks

1. Completed: registered the narrow device-sync fencing lane in the coordination ledger.
2. Completed: patched hosted runtime reconcile/apply to include and enforce a hosted connection-version fence and to reject token writes for disconnected hosted rows.
3. Completed: patched hosted snapshot/hydration and webhook receipt handling so webhook-only touches do not advance hosted authority and first-run rows with null observed markers preserve divergent local state.
4. Completed: added focused regressions in the assistant-runtime and hosted web test suites.
5. Completed: ran focused checks plus the mandatory `simplify`, `test-coverage-audit`, and `task-finish-review` audit subagents; repo-required verification remains blocked by unrelated active-lane failures documented below.

## Decisions

- Use an additive observed-connection timestamp fence on runtime apply/reconcile rather than a wider architectural rewrite.
- Treat webhook receipt updates as non-authoritative for hosted connection advancement.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts --config packages/assistant-runtime/vitest.config.ts --no-coverage`
- `pnpm exec vitest run apps/web/test/device-sync-internal-runtime.test.ts apps/web/test/prisma-store-oauth-connection.test.ts --config apps/web/vitest.config.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- Observed outcomes:
- Focused assistant-runtime Vitest passed (`14` tests).
- Focused hosted web Vitest passed (`13` tests).
- `pnpm typecheck` failed in unrelated `packages/contracts/scripts/{generate-json-schema,verify}.ts`.
- `pnpm test` failed in unrelated `packages/core/src/bank/goals.ts`.
- `pnpm test:coverage` failed in unrelated `packages/core/src/bank/goals.ts`.
- Additional scope-specific wrappers also showed unrelated worktree blockers:
- `pnpm --dir apps/web typecheck` failed in unrelated `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts`.
- `pnpm --dir packages/assistant-runtime typecheck` failed in unrelated `packages/assistant-runtime/src/hosted-runtime/callbacks.ts` plus cross-package Goal lane errors.
- Direct-scenario note:
- A standalone `tsx` scenario for the hosted apply helper was attempted, but the current dirty workspace/build state prevented a non-Vitest execution path from resolving the workspace packages. Focused Vitest boundary coverage is the strongest proof captured in this lane.
Completed: 2026-03-29
