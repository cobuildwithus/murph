# Hosted Stripe Inline Activation

## Goal

Simplify hosted onboarding so Stripe subscription success activates members inline in the webhook path, keeps `execution_outbox` as the single durable async boundary, and sends one deterministic Linq welcome message immediately after activation when a signup thread exists.

## Why

- The current hosted Stripe fact queue adds an avoidable scheduler dependency to the happy path.
- Production onboarding should make `Stripe says paid` map directly to `member is active`.
- The first Murph welcome should be exact copy and fast, not model-generated or delayed behind runner bootstrap.

## Constraints

- Keep subscription billing semantics based on `invoice.paid` as the positive activation source.
- Do not remove RevNet support; keep it out of the launch happy path when disabled.
- Preserve the shared `execution_outbox` boundary and treat cron as fallback/recovery.
- Preserve dirty-tree edits outside the touched hosted billing/onboarding scope.

## Intended Changes

1. Process Stripe webhook events inline after signature verification and durable event-id dedupe.
2. Mark members active in the same transactional billing path and enqueue `member.activated` immediately.
3. Best-effort drain the just-enqueued hosted execution event right after commit.
4. Persist the Linq signup thread on the member so activation can send the deterministic welcome back into the same chat.
5. Send the welcome copy once, idempotently, after activation; keep the prompt-based first-reply fallback for later turns.
6. Reduce the Stripe cron route to recovery work only for deferred/failure paths that still exist.

## Verification Target

- Required repo/app checks per `apps/web` lane.
- Focused hosted onboarding tests for inline activation, welcome send idempotency, and fallback cron behavior.
- Direct scenario proof for `invoice.paid` -> active member -> queued/attempted immediate outbox drain -> welcome send.
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
