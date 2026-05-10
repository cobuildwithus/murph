# DeepSec High-Bug Fixes

Status: completed
Created: 2026-05-10
Updated: 2026-05-10

## Goal

Fix the six reviewed DeepSec high-bug findings with owner-level changes that keep the architecture simple, durable, and composable.

## Success Criteria

- Stripe refunds only suspend hosted members when the refund materially reverses the active paid entitlement.
- `WriteBatch` staging cannot allocate duplicate staged artifact paths under concurrent stage calls.
- JSONL append recovery and hosted replay authenticate the append base, not just append offset and payload.
- Versioned runtime-state JSON writes replace files atomically.
- Parser subprocess execution has bounded time/output and can be aborted.
- Daily sample summaries aggregate dense sample groups without retaining every numeric value or spreading large arrays.
- Focused tests cover the new invariants.
- Required verification and completion audits pass, or unrelated blockers are documented.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts`
  - `apps/web/test/hosted-onboarding-stripe-billing-events.test.ts`
  - `packages/core/src/operations/write-batch.ts`
  - `packages/core/src/event-attachments.ts`
  - Core tests for write-batch staging, hosted replay, and event attachments.
  - `packages/runtime-state/src/versioned-json-files.ts`
  - Runtime-state tests for atomic versioned JSON writes.
  - `packages/parsers/src/shared.ts`
  - Parser adapter/tests for bounded native subprocesses.
  - `packages/query/src/summaries.ts`
  - Query tests for dense daily sample summaries.
- Out of scope:
  - Broader payment hold-state redesign.
  - Full parser attachment size-budget work beyond subprocess execution policy.
  - Broad hosted checkpoint or canonical-write receipt lifecycle redesign.

## Constraints

- Keep changes at owner seams and avoid one-off call-site patches when a shared helper owns the invariant.
- Preserve existing dirty worktree edits and active ledger rows.
- Do not expose local usernames, home paths, secrets, raw credentials, or provider identifiers in code, tests, docs, logs, or handoff.
- Maintain backward compatibility for stored write-operation metadata where possible, while failing closed for unsafe replay states.

## Tasks

1. [x] Harden `WriteBatch` stage-path allocation and JSONL append base authentication.
2. [x] Add atomic replacement to shared versioned JSON state writes.
3. [x] Add Stripe refund entitlement classification and focused billing tests.
4. [x] Add parser command resource policy and abort propagation for native subprocesses.
5. [x] Stream daily sample summary aggregation and cover dense sample groups.
6. [x] Run focused verification and required audits; close the plan without a commit because unrelated pre-existing edits overlap the Stripe files.

## Verification

- Passed: `pnpm --filter @murphai/runtime-state test -- local-state-versioned-json.test.ts`
- Passed: `pnpm --filter @murphai/query test -- query.test.ts`
- Passed: `pnpm --filter @murphai/core test -- operations-thresholds.test.ts core.test.ts`
- Passed: `pnpm --filter @murphai/parsers test -- parsers-coverage.test.ts parsers.test.ts`
- Passed: `pnpm --dir ../.. exec vitest run apps/web/test/hosted-onboarding-stripe-billing-events.test.ts --config apps/web/vitest.workspace.ts --project hosted-web-onboarding-core --no-coverage`
- Passed: `pnpm --filter @murphai/core typecheck`
- Passed: `pnpm --filter @murphai/assistant-runtime typecheck`
- Passed: `pnpm --filter @murphai/assistant-engine typecheck`
- Passed: `pnpm --filter @murphai/runtime-state typecheck`
- Passed: `pnpm --filter @murphai/parsers typecheck`
- Passed: `pnpm --filter @murphai/query typecheck`
- Passed: `pnpm --filter @murphai/hosted-web typecheck:prepared`
- Required audits completed with follow-up fixes applied.
- Broad diff test attempted: `bash scripts/workspace-verify.sh test:diff ...`; blocked by unrelated existing failure in `packages/cli/test/recipe-save-typed-parity.test.ts`.
Completed: 2026-05-10
