# PR 219 ReviewGPT Round 2 Follow-Up

## Goal

Fix the two accepted ReviewGPT follow-up findings on PR 219 before merge:

- Do not retry Stripe trial-ending subscription updates under a new idempotency key after an indeterminate failure.
- Remove the redundant full-period usage ledger aggregation from every usage-accounting transaction.

## Constraints

- Preserve the existing Stripe trial-ending idempotency key and update parameters for the first mutation.
- After ambiguous Stripe failures, reconcile by retrieval only; do not issue a second `trial_end: "now"` mutation with a fresh key.
- Keep hosted AI usage ledger rows as the spend authority.
- Preserve unrelated working-tree edits and active ledger rows.

## Implementation Notes

- Replace the trial-ending retry mutation with retrieve-only reconciliation that returns any proven invoice result, otherwise `billing_pending`.
- Keep subsequent status checks in the same pending state when local billing still says trial but Stripe has already left trialing without invoice proof.
- Remove the accounting-path call that updates allowance period metadata after usage row claim.
- Retain period metadata repair only in the mutating usage gate where `blockedAt` is needed for notice claiming.

## Verification Plan

- Focused hosted onboarding billing and usage allowance tests.
- Hosted web typecheck.
- `pnpm test:diff` over touched files.
- Required local completion audits for billing/persisted-state changes.
- Push and rerun the PR ReviewGPT loop before merge readiness.

## Verification Evidence

- Focused hosted onboarding billing and usage allowance Vitest passed: 83 tests.
- `pnpm -C apps/web typecheck:prepared` passed.
- `pnpm test:diff -- ...` over the touched files passed through hosted web verify, including lint, dev smoke, hosted web Vitest, and Next build.
- `git diff --check` passed.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
