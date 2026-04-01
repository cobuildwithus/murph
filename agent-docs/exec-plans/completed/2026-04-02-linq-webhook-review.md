# Linq Webhook Review Patch

## Goal

Land the supplied hosted Linq webhook review patch so duplicate in-flight receipts stay retryable, hosted Linq dispatch snapshots do not retain the shared recipient phone identity, suspended Linq senders are ignored consistently, and invite issuance drops unused Linq-only parameters.

## Why

- The current webhook receipt claim path treats an in-flight duplicate as a completed duplicate, which can acknowledge a duplicate request before the original attempt finishes or fails.
- Hosted Linq dispatch snapshots still retain `recipient_phone`, which lets later normalization bind against the shared Linq recipient identity instead of the sender lookup key.
- Suspended members are blocked in other hosted onboarding/auth paths but not in the Linq onboarding path.
- `issueHostedInvite` still accepts Linq-specific parameters that its implementation ignores, which keeps dead coupling at the call sites.

## Scope

- `apps/web/src/lib/hosted-onboarding/{authentication-service.ts,contact-privacy.ts,invite-service.ts,webhook-provider-linq.ts,webhook-receipt-store.ts,webhook-receipt-types.ts}`
- Focused hosted onboarding tests covering Linq snapshot sanitization, webhook receipt retries, and Linq dispatch/idempotency behavior

## Constraints

- Preserve existing hosted onboarding behavior outside the reviewed retry, dispatch-snapshot, suspended-member, and dead-parameter cases.
- Preserve unrelated dirty worktree edits, especially adjacent hosted onboarding transaction and Telegram review lanes already in progress.
- Keep the change bounded to the supplied review intent; do not widen into timestamp-freshness or broader Linq routing refactors.

## Verification

- Focused `apps/web` tests for the touched Linq/onboarding seams
- Required `apps/web` verification per repo policy
- Direct proof from the updated focused tests for the retry-safe duplicate and sparse-snapshot routing behavior

## Commit Plan

- Use `scripts/finish-task` while this plan remains active so the completed plan artifact ships with the scoped commit.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
