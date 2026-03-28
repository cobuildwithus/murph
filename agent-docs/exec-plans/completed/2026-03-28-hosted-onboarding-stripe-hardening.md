# 2026-03-28 Hosted Onboarding Stripe Hardening

## Goal

Close the reported hosted onboarding Stripe correctness gaps and land the agreed simplifications for the hosted Stripe lane:

1. Keep Cloudflare dispatch journaling transactional with the originating Stripe mutation.
2. Make Stripe billing state monotonic under out-of-order delivery.
3. Revoke access when subscription state loses entitlement.
4. Make checkout/customer creation idempotent under retries and double submits.
5. Fail closed when RevNet broadcast succeeds but the issuance write-back does not.
6. Gate activation on the configured RevNet issuance step, and make the docs match the real sequencing.
7. Stop stale checkout expiry from clobbering a newer open session.
8. Decouple webhook-only Stripe paths from the checkout price-id requirement.
9. Move Stripe webhook ingress to durable fact ingestion plus queued reconciliation, with one positive entitlement source per billing mode.

## Constraints

- Preserve adjacent in-flight dirty worktree edits and integrate on top of the current live tree.
- Keep hosted execution dispatches written to `execution_outbox` in the same transaction as the originating Stripe mutation.
- Keep receipt journals only for receipt-local Linq or Telegram side effects; do not re-introduce inline Stripe side effects under the webhook HTTP request.
- Add the minimum truthful schema/docs changes needed for the new behavior.
- Run the repo-required checks plus the mandated spawned audit passes before handoff.

## Planned Shape

1. Extend hosted member billing state with a Stripe freshness marker and gate member mutations on monotonic event progress.
2. Refactor Stripe billing policy helpers so subscription mode has one positive source, cancellation/unpaid/paused revoke sessions, RevNet-backed activation waits for confirmed issuance, and checkout expiry only affects the latest attempt.
3. Move Stripe ingress to durable fact insertion plus queued reconciliation and add the internal cron path that drains queued Stripe work and RevNet confirmations.
4. Make checkout creation reuse a single open attempt and use Stripe idempotency keys for customer/session creation.
5. Add/update focused onboarding tests and refresh the architecture/idempotency docs.
6. Run focused tests, repo-wide verification, required audit passes, then close the plan and commit the touched files only.

## Verification Target

- Focused hosted onboarding Vitest coverage for webhook idempotency, checkout creation, and session gating.
- Prisma schema validation/generation as required by the touched migration.
- Repo-required commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Status

- Context gathered from the current tree and repo docs.
- Implementation updated to use queued hosted Stripe facts plus the internal Stripe reconciliation cron.
- Focused hosted onboarding tests now cover queue-based Stripe reconciliation, single-open checkout attempts, session gating, and fail-closed RevNet sequencing.
- Required spawned audit passes completed and the substantive findings were integrated.
- Final verification completed: `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` all passed on the final diff.
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
