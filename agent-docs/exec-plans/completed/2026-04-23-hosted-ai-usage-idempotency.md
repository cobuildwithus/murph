# Backstop hosted AI usage idempotency per turn attempt

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Prevent one hosted assistant turn attempt from producing multiple canonical hosted AI usage rows, even if an upstream producer emits multiple distinct `usageId` values for the same `(turnId, attemptCount)` pair.

## Success criteria

- `HostedAiUsage` persistence fails closed on duplicate logical turn attempts by enforcing one row per `(turnId, attemptCount)` at the database layer.
- Hosted usage import either reuses or rejects non-canonical `usageId` values instead of silently accepting two rows for one logical turn attempt.
- Runtime-state parsing verifies that persisted assistant-usage records carry the canonical `usageId` derived from `(turnId, attemptCount)`.
- Focused regression coverage proves duplicate logical turn attempts cannot be imported twice or parsed as valid records.

## Scope

- In scope:
- `apps/web/src/lib/hosted-execution/usage.ts`
- `apps/web/prisma/{schema.prisma,migrations/**}`
- `packages/assistant-runtime/src/hosted-runtime/usage.ts`
- `packages/runtime-state/src/assistant-usage.ts`
- directly coupled `apps/web/test/**`, `packages/runtime-state/test/**`, and `packages/assistant-runtime/test/**` coverage for hosted usage import, assistant-usage parsing, and hosted pending-usage export resilience
- `agent-docs/exec-plans/active/{2026-04-23-hosted-ai-usage-idempotency.md,COORDINATION_LEDGER.md}`
- Out of scope:
- Stripe pricing, subscription policy, and other hosted billing changes outside this duplicate-usage fix
- broader assistant-provider target-resolution or hosted-run recovery changes already active in this tree

## Constraints

- Technical constraints:
- Preserve the current canonical `usageId` derivation contract instead of inventing a second identifier scheme.
- Any new storage backstop must remain app-owned in `apps/web` Postgres via the existing Prisma migration seam.
- Product/process constraints:
- Preserve unrelated dirty-tree edits in the already-modified `schema.prisma`, `usage.ts`, and `assistant-usage.ts` files.
- Work carefully around the active `hosted-stripe-hardening` and `assistant-provider-hardening` rows, keeping this change limited to the duplicate-billing/idempotency seam.
- Treat this as a high-risk storage and billing fix: run full acceptance, direct proof, required `coverage-write`, and required `task-finish-review`.

## Risks and mitigations

1. Risk: tightening the schema or parser could reject existing rows or fixtures that were previously accepted.
   Mitigation: derive the canonical usage id from existing persisted fields, add focused tests around accepted and rejected shapes, and keep the import path tolerant only where it still preserves one logical row.
2. Risk: changing the import upsert key could conflict with overlapping billing-seam edits already in progress.
   Mitigation: inspect the dirty-file overlap first, keep the diff narrow, and avoid unrelated refactors in the existing hosted billing files.

## Tasks

1. In progress: register the task in the ledger and capture the exact scope/constraints in this plan.
2. Pending: inspect the current dirty implementation and tests in `usage.ts`, `schema.prisma`, the relevant migration file, and `assistant-usage.ts`.
3. Pending: implement a database uniqueness backstop plus import/parser validation so one logical turn attempt cannot create two hosted usage rows.
4. Pending: add focused regression tests for duplicate logical imports, non-canonical `usageId` parsing, and review-driven hosted export resilience.
5. Pending: run `pnpm verify:acceptance`, capture direct scenario proof, complete the required `coverage-write` and `task-finish-review` audit passes, and address any blocking review findings in-scope.
6. Pending: create a scoped commit only if the dirty tree allows exact staging of this task’s paths without absorbing unrelated work.

## Decisions

- Pending during implementation review.

## Verification

- Commands to run:
- `pnpm verify:acceptance`
- direct focused proof for duplicate logical hosted usage import and assistant-usage parsing if the acceptance lane alone does not make the new invariants obvious
- `git diff --check`
- required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
- A second record for the same `(turnId, attemptCount)` cannot be persisted as a distinct hosted usage row.
- Non-canonical `usageId` values for a logical turn attempt are rejected before downstream metering can double-count them.
Completed: 2026-04-23
