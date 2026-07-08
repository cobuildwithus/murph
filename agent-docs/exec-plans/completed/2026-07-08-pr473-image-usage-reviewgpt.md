# PR 473 Image Usage ReviewGPT Fix

## Goal

Fix the accepted ReviewGPT round-1 finding for PR 473: OpenAI image usage records with missing or empty provider usage must fail closed instead of being counted at zero cost.

## Constraints

- Keep the fix scoped to hosted usage allowance image pricing.
- Preserve the `gpt-image-2` pricing path for valid OpenAI Images usage.
- Do not reintroduce latency-trace changes already handled on `main`.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

## Working Set

- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/test/hosted-execution-usage-allowance.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Plan

1. Add focused tests for missing and empty OpenAI image usage.
2. Require a usable chargeable image usage signal before image pricing can return counted usage.
3. Run focused hosted usage tests and required diff verification.
4. Finish the plan, push the PR branch, and rerun ReviewGPT.

## State

Completed. Image pricing now rejects recognized OpenAI image records with no
provider usage token signal; regression tests cover direct pricing and
accounting-before-claim behavior. Focused Vitest and diff-aware hosted web
verification passed.
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
