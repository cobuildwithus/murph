# Prevent WHOOP `*.updated` webhook follow-up 404s from tombstoning live records

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Keep WHOOP `sleep.updated`, `recovery.updated`, and `workout.updated` webhooks from synthesizing delete snapshots when the follow-up resource fetch returns `404`.

## Success criteria

- WHOOP resource jobs for `*.updated` events do not emit delete snapshots when the detail fetch returns `404`.
- Explicit WHOOP `*.deleted` jobs still emit the existing delete snapshot shape.
- Focused `packages/device-syncd` tests cover the regression and preserve real delete handling.
- Required scoped verification, completion audits, and the scoped commit complete, or any unrelated blocker is documented.

## Scope

- In scope:
  - `packages/device-syncd/src/providers/whoop.ts`
  - directly coupled `packages/device-syncd/test/whoop-provider.test.ts`
  - `agent-docs/exec-plans/active/{2026-04-23-whoop-update-404-tombstone.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - changes to WHOOP importer tombstone normalization
  - changes to canonical wearable tombstone/query suppression rules
  - broader WHOOP webhook or reconcile redesigns beyond this missing-resource boundary

## Constraints

- Technical constraints:
  - Keep explicit delete jobs on the existing tombstone path.
  - Do not weaken WHOOP webhook parsing, signature checks, or supported resource handling.
  - Work safely in the current dirty tree and avoid unrelated provider or hosted-runtime edits.
- Product/process constraints:
  - Treat this as webhook/reliability work and capture direct proof in addition to scripted checks.
  - Follow the plan-bearing repo workflow, including the required completion audits.

## Risks and mitigations

1. Risk: Flipping the resource-job behavior too broadly could break legitimate WHOOP delete handling.
   Mitigation: Scope the change to `resource` jobs only and keep `delete` jobs on the existing `buildDeleteSnapshot` path.
2. Risk: A missing update fetch could now silently hide a stale-record case if tests only assert the absence of deletions.
   Mitigation: Add an explicit regression test that asserts `importSnapshot` is not called for the `404` update fetch while preserving the existing explicit delete-job assertions.

## Tasks

1. Register the task in the active plan and coordination ledger.
2. Change the WHOOP resource-job path so missing update fetches no longer synthesize delete snapshots.
3. Update focused WHOOP provider tests for missing update fetches and explicit delete jobs.
4. Run scoped verification, direct proof, required completion audits, and the scoped commit flow.

## Decisions

- Treat a WHOOP `*.updated` follow-up `404` as a non-delete miss. Only explicit `*.deleted` webhook jobs may emit delete snapshots/tombstones.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/device-syncd/src/providers/whoop.ts packages/device-syncd/test/whoop-provider.test.ts`
- Direct proof:
  - Run the focused WHOOP provider regression test that proves `workout.updated` `404` misses do not import a delete snapshot.
- Expected outcomes:
  - Device-syncd typecheck and focused diff-aware verification pass.
  - Explicit WHOOP delete-job coverage still passes with the unchanged tombstone shape.

## Outcome

- Completed the WHOOP provider fix so missing `resource` fetches no longer synthesize delete snapshots.
- Strengthened focused proof so the same no-tombstone behavior is covered for both `workout.updated` and `sleep.updated` `404` follow-up fetches.
- Explicit WHOOP delete-job coverage remains unchanged and still proves the tombstone snapshot shape for real `*.deleted` events.
- Required audits completed:
  - `coverage-write` found no additional test additions worth making once the focused regression proof and package coverage were green.
  - `task-finish-review` found no blocking issues for this tombstone fix.
- Verification results:
  - Focused direct proof passed: `pnpm exec vitest run packages/device-syncd/test/whoop-provider.test.ts -t "does not synthesize delete snapshots"`.
  - `pnpm --dir packages/device-syncd typecheck` passed.
  - `pnpm --dir packages/device-syncd test:coverage` passed.
  - `git diff --check -- packages/device-syncd/src/providers/whoop.ts packages/device-syncd/test/whoop-provider.test.ts agent-docs/exec-plans/completed/2026-04-23-whoop-update-404-tombstone.md` passed.
  - `pnpm typecheck` remains blocked by unrelated pre-existing workspace-boundary failures under `packages/cli` / `packages/assistant-engine` and unrelated `packages/inbox-services` type errors.
  - `bash scripts/workspace-verify.sh test:diff packages/device-syncd/src/providers/whoop.ts packages/device-syncd/test/whoop-provider.test.ts` remains blocked by those same unrelated repo failures before it can complete the focused lane.
- No scoped commit was created because `packages/device-syncd/src/providers/whoop.ts` and `packages/device-syncd/test/whoop-provider.test.ts` already contain unrelated in-progress refresh-token-rotation edits from another active row, and the shared `COORDINATION_LEDGER.md` also carries unrelated concurrent churn. An exact task-only commit would have risked absorbing work outside this fix.
