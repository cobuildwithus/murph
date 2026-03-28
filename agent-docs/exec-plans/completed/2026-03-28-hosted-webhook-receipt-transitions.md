# Centralize hosted webhook receipt transitions

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

- Centralize hosted onboarding webhook receipt lifecycle mutations behind explicit typed transition helpers so reclaim, queue, side-effect draining, completion, and failure are easier to audit without changing persisted JSON shape or replay behavior.

## Success criteria

- `apps/web/src/lib/hosted-onboarding/webhook-receipt-*` routes receipt-state mutation through one transition layer instead of scattered ad hoc object replacement.
- Existing hosted webhook duplicate/replay protections stay intact, especially for reclaiming failed receipts and avoiding redispatch of already-sent side effects.
- The anchored hosted onboarding tests keep passing without test expectation changes unless a helper-level proof gap is added by the required audit pass.

## Scope

- In scope:
  - Hosted onboarding receipt state helpers under `apps/web/src/lib/hosted-onboarding/`
  - Targeted hosted onboarding webhook tests needed to preserve or extend proof for the refactor
  - Coordination/plan artifacts required by repo process
- Out of scope:
  - Persisted receipt JSON schema changes or migrations
  - Dispatch semantic changes for hosted execution or Linq sends
  - Broader hosted onboarding/provider cleanup outside the receipt lifecycle seam

## Constraints

- Technical constraints:
  - Keep the existing serialized receipt shape compatible with stored rows.
  - Preserve optimistic compare-and-swap updates in Prisma for claim updates and dispatch enqueue handoff.
- Product/process constraints:
  - Preserve exact duplicate handling for `processing`/`completed` receipts.
  - Run required repo verification and delegated completion-workflow audit passes before handoff.

## Risks and mitigations

1. Risk: Refactoring the transition logic could accidentally requeue or resend effects that should remain durable/sent.
   Mitigation: Keep the persisted shape stable, reuse existing merge/minimization behavior, and hold the existing idempotency tests fixed.
2. Risk: Overlapping hosted onboarding work could create merge friction in nearby files.
   Mitigation: Keep the lane narrow to receipt transition modules/tests, read live file state before editing, and preserve unrelated dirty changes.

## Tasks

1. Register the refactor lane in the coordination ledger.
2. Introduce explicit pure receipt transition helpers and switch engine/store logic to use them.
3. Run focused hosted onboarding tests, then repo-required verification as far as the current dirty tree allows.
4. Run required `simplify`, `test-coverage-audit`, and `task-finish-review` subagent passes and integrate any high-severity findings.
5. Close the execution plan and commit only the touched files.

## Decisions

- Keep compare-and-swap persistence in `webhook-receipt-store.ts`; centralize only the state transition layer.
- Keep dispatch enqueue as the special durable handoff, but compute the next receipt payload through the same transition layer used by other side effects.

## Verification

- Commands to run:
  - `pnpm --dir ../.. exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
  - `pnpm --dir ../.. exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts -t "does not redispatch an already-sent Linq side effect when reclaiming a failed receipt"`
  - `pnpm --dir ../.. exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts -t "treats completed Stripe receipts as duplicates without replaying durable updates"`
  - `pnpm --dir ../.. exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts -t "dispatches active-member Linq messages to hosted execution instead of issuing a fresh invite"`
  - `pnpm --dir apps/web typecheck`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Focused hosted onboarding tests passed, including the three named replay/dispatch anchor scenarios.
  - `pnpm --dir apps/web typecheck` failed in pre-existing dirty-tree code at `apps/web/src/lib/device-sync/wake-service.ts:226`.
  - `pnpm typecheck` failed in unrelated pre-existing CLI/query work (`packages/cli/src/{commands/meal.ts,search.ts,query-runtime.ts,usecases/integrated-services.ts}`, `packages/cli/src/inbox-services/promotions.ts`).
  - `pnpm test` failed in unrelated pre-existing assistant-runtime code (`packages/assistant-runtime/src/hosted-device-sync-runtime.ts`).
  - `pnpm test:coverage` failed in unrelated pre-existing runtime-state/core work (`packages/runtime-state/src/{hosted-bundle.ts,hosted-execution.ts}`, `packages/core/src/operations/canonical-write-lock.ts`).
Completed: 2026-03-28
