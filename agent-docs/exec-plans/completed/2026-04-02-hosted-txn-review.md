# Hosted Transaction Review Patch

## Goal

Land the supplied hosted onboarding/share transactional patch so member session creation, invite issuance, share acceptance, and first-time phone member creation are race-safe without changing product behavior.

## Why

- Hosted session rotation currently has no DB-backed single-live-session invariant, so concurrent logins can revoke each other's fresh session rows.
- Hosted invite issuance currently checks for an open invite before create without serializing per-member access.
- Hosted share acceptance currently derives acceptance metadata from a stale pre-transaction read and can emit divergent outbox event ids under retries.
- First-time hosted member creation by phone can lose a unique-key race and fail instead of reusing the concurrently-created row.

## Scope

- `apps/web/src/lib/hosted-onboarding/{invite-service.ts,member-identity-service.ts,session.ts,shared.ts}`
- `apps/web/src/lib/hosted-share/acceptance-service.ts`
- Focused hosted onboarding/share tests that cover the touched transaction behavior

## Constraints

- Preserve existing hosted onboarding/share contracts and user-visible behavior.
- Do not widen into the Stripe checkout lane, migration edits, or broader device-sync locking changes.
- Preserve unrelated dirty worktree edits, especially adjacent hosted onboarding changes already in progress.

## Verification

- Required `apps/web` verification per repo policy
- Focused hosted onboarding/share tests covering touched seams
- Direct proof from the updated focused tests for the stabilized idempotency paths

## Commit Plan

- Use `scripts/finish-task` while this plan remains active so the completed plan artifact ships with the scoped commit.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
