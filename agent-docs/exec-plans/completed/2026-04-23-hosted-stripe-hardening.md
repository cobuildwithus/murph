# Harden hosted Stripe activation, ordering, dedupe, and metering

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Remove browser-driven activation authority from hosted onboarding, harden Stripe webhook ordering/dedupe and checkout idempotency, and make hosted AI usage metering durable across concurrency and crash/retry paths.

## Success criteria

- The browser billing-success path never activates a member or forces `billingStatus=active`; it only binds durable Stripe refs and refreshes stored billing facts.
- Hosted checkout creation is idempotent for duplicate logical requests and does not reuse one Stripe idempotency key across different customer-binding payload shapes.
- `invoice.paid` can still resolve the member and activate exactly once when Stripe events arrive out of order and local billing refs have not been bound yet.
- Older `customer.subscription.*` events cannot regress newer stored billing state or overwrite fresher Stripe refs.
- Webhook intake surfaces retryable reconciliation failures instead of acknowledging them as `200 OK`.
- Duplicate Stripe invoice business events are coalesced at the activation/welcome boundary even when Stripe emits different Event ids for the same invoice.
- Hosted AI usage metering uses durable local claims/progress fences so concurrent drains and crash/retry paths do not resend external Stripe meter events.
- Existing databases receive the new billing freshness column and hosted-AI-usage uniqueness guard through a forward migration.
- Focused regression coverage exists for the reported billing, webhook, dedupe, migration, and metering failure modes.

## Scope

- In scope:
- `apps/web/prisma/{schema.prisma,migrations/2026040600_init/migration.sql,migrations/2026042301_hosted_stripe_hardening/migration.sql}`
- `apps/web/src/lib/hosted-onboarding/{billing-service,billing-success-service,hosted-member-billing-store,stripe-billing-events,stripe-billing-lookup,stripe-billing-policy,stripe-event-reconciliation,webhook-service-stripe}.ts`
- `apps/web/src/lib/hosted-execution/{usage,stripe-metering}.ts`
- directly coupled `apps/web/test/**` coverage for hosted onboarding, Stripe webhook, migration privacy-contract, and hosted usage metering behavior
- `agent-docs/exec-plans/active/{2026-04-23-hosted-stripe-hardening.md,COORDINATION_LEDGER.md}`
- Out of scope:
- RevNet behavior changes beyond the already-disabled billing path
- unrelated hosted-run, hosted-ingress, auth/device-sync, browser-vault, or Cloudflare runner refactors already active in this tree
- resolving unrelated merge-conflict markers or unrelated red tests elsewhere in the branch

## Constraints

- Technical constraints:
- Treat `invoice.paid` as the only positive Stripe entitlement source.
- Keep hosted billing monotonic under unordered webhook delivery and duplicate event delivery.
- Keep checkout idempotency stable only across truly identical Stripe request shapes.
- Any new persisted state must stay app-owned in `apps/web` Postgres and use the Prisma migration seam.
- Product/process constraints:
- Preserve unrelated dirty-tree edits, especially the active edits in `schema.prisma`, the init migration, and the broader hosted execution/runtime areas.
- Treat this as a high-risk `apps/web` change: run focused direct proof, `apps/web` typecheck, `git diff --check`, required `coverage-write`, and required `task-finish-review`; broader `apps/web verify` may be reported as blocked when unrelated branch state prevents it from reflecting this slice.

## Risks and mitigations

1. Risk: removing browser-side activation could strand the current success path.
   Mitigation: keep success-path ref binding and invite-status refresh, and cover non-activation explicitly across subscription states.
2. Risk: webhook freshness guards could suppress legitimate newer transitions.
   Mitigation: persist a single Stripe event-created watermark on the billing-ref owner seam and add stale-order regression coverage.
3. Risk: deterministic checkout idempotency could create Stripe parameter mismatches after refs bind.
   Mitigation: split the key by customer-binding shape (`customer`, `email`, `none`) and cover the retry-after-binding path directly.
4. Risk: metering durability changes could either resend or dead-end rows.
   Mitigation: claim rows before sending, fence token-side progress durably, preserve partial progress, and fail closed on unknown crash-window outcomes.
5. Risk: schema drift could break existing databases if only the historical init migration is edited.
   Mitigation: keep the init migration greenfield-only and apply the new billing freshness column plus hosted-AI-usage unique index through a forward migration.

## Tasks

1. Completed: inspect the hosted billing, webhook reconciliation, and hosted usage metering seams and map overlap with existing dirty edits.
2. Completed: remove browser-success activation authority and route that path through shared checkout-session Stripe-ref binding only.
3. Completed: add deterministic checkout idempotency keyed to the logical request plus customer-binding shape, and cover duplicate and post-binding retries.
4. Completed: harden invoice lookup, subscription reconciliation, webhook retry behavior, duplicate invoice activation dedupe, and stale Stripe billing writes.
5. Completed: harden hosted AI usage metering with row claims, progress fencing, partial-progress retries, and crash-window resend refusal.
6. Completed: move the billing freshness / hosted-AI-usage uniqueness schema changes into a forward migration and keep the historical init migration aligned with the greenfield baseline.
7. Completed: add focused regression coverage for the reported billing, webhook, migration, and metering behaviors.
8. Pending: create the scoped commit and hand off the remaining out-of-scope `apps/web verify` blockers.

## Decisions

- Browser success is a ref-binding/status-refresh seam only; it is not an activation authority.
- Checkout ref freshness is derived from the Checkout Session itself, while subscription/invoice freshness is derived from canonical Stripe event/subscription state.
- Stripe freshness is persisted as `lastStripeEventCreatedAt` only; the unused persisted Stripe source-event id was removed.
- Duplicate invoice activation dedupe is normalized on `invoice:<invoice.id>` rather than Stripe `event.id`.
- Checkout idempotency keys include the customer-binding mode so retries cannot reuse one key across `customer_email` and `customer` payloads.
- Metering refuses automatic resend when a prior worker fenced token-side progress and the external POST outcome is unknown.

## Verification

- Commands to run:
- focused hosted Stripe / metering Vitest proof
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web verify`
- `git diff --check`
- required `coverage-write` and `task-finish-review` audit passes
- Ran:
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-billing-service.test.ts apps/web/test/hosted-onboarding-billing-success-service.test.ts apps/web/test/hosted-onboarding-stripe-billing-events.test.ts apps/web/test/hosted-onboarding-stripe-billing-lookup.test.ts apps/web/test/hosted-onboarding-stripe-billing-policy.test.ts apps/web/test/hosted-onboarding-stripe-checkout-completed.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts apps/web/test/hosted-onboarding-stripe-webhook-service.test.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/hosted-execution-stripe-metering.test.ts apps/web/test/hosted-execution-usage.test.ts --no-coverage` ✅
- `pnpm --dir apps/web typecheck` ❌ blocked by unrelated `packages/core/src/domains/events.ts` type errors (`relatedIds` / `normalizeRelationIds` not present on `BuildEventSpineEnvelopeInput`)
- `git diff --check -- <task files>` ✅
- `pnpm --dir apps/web verify` ❌ blocked by unrelated branch/worktree state:
  - unrelated `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
  - unrelated `apps/web/test/browser-vault-dashboard-pages.test.tsx`

## Outcome

- Hosted Stripe activation, webhook ordering/dedupe, checkout idempotency, forward migration safety, and hosted AI metering durability are implemented for this slice and covered by focused proof.
- The only remaining verification blockers are outside this task boundary and are caused by unrelated dirty-branch state plus unrelated red tests.

## Audits

- `simplify` review found and drove three real fixes:
  - add a forward migration instead of relying on edits to the historical init migration
  - split checkout idempotency by customer-binding shape to avoid Stripe parameter mismatches after refs bind
  - remove the unused persisted Stripe source-event field
- `coverage-write` (`gpt-5.4-mini`) reran the focused Stripe/metering suite and `apps/web` typecheck, found no further proof gaps, and made no edits.
- `task-finish-review` reran after the follow-up fixes and found no remaining actionable issues in the updated Stripe billing / webhook slice.

## Commit note

- Use `scripts/finish-task` for the scoped commit because this plan remains the active plan file for the landing.
Completed: 2026-04-23
