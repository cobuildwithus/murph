# Implement hosted Edge to Pulse scheduled plan switch

Status: completed
Created: 2026-05-06
Updated: 2026-05-06

## Goal

- Implement the hosted Edge-to-Pulse plan switch specified in
  `agent-docs/product-specs/hosted-plan-downgrades.md`.
- The switch schedules Pulse at the next Stripe renewal using Stripe
  Subscription Schedules; Murph must not reduce entitlement until Stripe
  subscription reconciliation observes the applied Pulse prices.

## Success criteria

- Paid Edge members can schedule a switch to Pulse from `/settings`.
- The API surface is single-purpose: `POST /api/settings/billing/switch-to-pulse`
  with no generic target-plan payload.
- Stripe schedule creation/update is retry-safe and rejects non-canonical or
  conflicting subscription state instead of becoming a generic schedule manager.
- Local pending fields are Stripe-derived display/reconciliation hints only.
- Schedule webhooks only refresh/clear matching pending display fields.
- Current plan, usage allowance, and runner nudges change only through existing
  subscription reconciliation after Stripe applies Pulse.
- Focused tests cover route, service, webhook/read-model, settings UI, and usage
  allowance timing from the spec.

## Scope

- In scope:
  - Prisma billing ref read-model fields for scheduled switch display.
  - Edge-to-Pulse schedule service and route.
  - Settings UI action, confirmation, and pending state.
  - Stripe subscription/schedule event reconciliation for pending display state.
  - Central plan detection needed for Pulse price-id reconciliation.
  - Focused tests and verification.
- Out of scope:
  - Generic plan-transition engine.
  - In-app "Keep Edge" reversal.
  - Customer Portal plan switching.
  - Local timers, cron, or app-owned entitlement transition state.
  - Broad billing refactors unrelated to Edge-to-Pulse scheduling.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty worktree edits.
  - Do not print or commit secrets, raw Authorization headers, Stripe secrets, or
    local identifiers.
  - Use existing hosted billing/encryption/privacy helpers where possible.
  - Keep Stripe as the durable owner of schedule timing.
- Product/process constraints:
  - User-facing copy says "Switch to Pulse", not "downgrade".
  - Keep UI aligned with `DESIGN.md`: flat, warm, simple, no nested cards.
  - Follow high-risk billing/security completion workflow before handoff.

## Risks and mitigations

1. Risk: Local state changes entitlement before Stripe applies Pulse.
   Mitigation: schedule request only writes pending display fields; entitlement
   writes stay in subscription reconciliation.
2. Risk: Unknown Stripe schedules or add-ons get accidentally managed by Murph.
   Mitigation: reject conflicting schedules and non-canonical subscription items
   in v1.
3. Risk: Two-step schedule creation leaves partial Stripe state.
   Mitigation: deterministic idempotency and compatible attached-schedule
   recovery path.

## Tasks

1. Inspect existing billing ref storage, plan detection, schedule event handling,
   settings UI, and tests.
2. Add Prisma/schema/read-model fields and billing-store codecs for pending
   schedule data.
3. Implement narrow billing switch service and route.
4. Wire schedule event cleanup/refresh and Pulse price-id reconciliation.
5. Add settings UI action, confirmation, and pending display.
6. Add focused route/service/webhook/settings/usage tests.
7. Run required verification and completion audits.
8. Close the plan with a scoped commit.

## Decisions

- Use a single-purpose route with no request body for v1.
- Omit in-app reversal; support releases the Stripe schedule if needed.
- Reject unknown attached schedules and non-canonical item sets.
- Settings switch eligibility must require paid Edge local state, active hosted
  access, no suspension, and present Stripe customer/subscription refs. The
  service still performs direct Stripe checks before scheduling.

## Verification

- Commands to run:
  - Focused Vitest route/service/webhook/settings/usage tests.
  - `pnpm --dir apps/web lint`
  - `pnpm --dir apps/web typecheck`
  - Additional `pnpm test:diff ...` or app verification if focused coverage is
    not sufficient.
- Expected outcomes:
  - All focused tests pass.
  - Lint/typecheck pass or any unrelated blocker is documented with evidence.
  - Diff/privacy checks show no accidental secret or local identifier leakage.
- Current outcome:
  - Focused billing/settings/usage Vitest passed after audit fixes and schedule
    lifecycle coverage tightening: 7 files, 110 tests.
  - `pnpm --dir apps/web lint` passed.
  - `pnpm --dir apps/web typecheck` passed.
  - Scoped `scripts/workspace-verify.sh test:diff` escalated to full
    `apps/web verify`; build/lint/smoke steps completed, but the app test lane
    is red in unrelated dirty settings/connect/device-sync tests outside this
    billing switch scope.
Completed: 2026-05-06
