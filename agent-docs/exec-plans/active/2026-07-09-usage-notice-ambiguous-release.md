# Usage Notice Ambiguous Release

## Goal

Prevent the deployed Telegram usage-limit sender from clearing its once-per-period
marker after a provider request may have started, so PR 465 cannot duplicate an
ambiguous send during rollout overlap or rollback.

## Constraints

- Delete the unsafe release; add no state, retry layer, error hierarchy, or service.
- Keep pre-claim configuration and target validation unchanged.
- Deploy and drain this prerequisite before PR 465.

## Working Set

- `apps/web/src/lib/hosted-orchestration/runtime-reconciliation-facts.ts`
- `apps/web/test/hosted-orchestration-reconciliation-facts.test.ts`
- `docs/contracts/00-invariants.md`

## Verification Plan

- Focused reconciliation-facts tests and hosted-web typecheck.
- Required diff verification and completion audits.
- ReviewGPT on the prerequisite PR before merge.
