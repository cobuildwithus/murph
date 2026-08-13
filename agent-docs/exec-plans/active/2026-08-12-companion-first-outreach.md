# Companion Signup First Outreach

Status: active
Created: 2026-08-12
Updated: 2026-08-13

## Goal

When a new member activates through the native companion app with a verified
phone number, use Murph's existing signup-welcome path to assign an eligible
home line and send the canonical first iMessage. Preserve the normal
capacity-exhausted behavior: activation succeeds and the member can still text
an active Murph line first when no line may safely open a proactive conversation.

## Root Cause Evidence

- Native companion admission currently passes `suppressSignupWelcome: true`
  through the shared companion member-access and Starter enrollment owners.
- That policy prevents activation from reserving a Linq home line, adding the
  canonical signup-welcome mailbox item, and attempting provider delivery.
- The ordinary Web Starter path already owns line selection, capacity,
  idempotency, welcome text, mailbox retry, provider delivery, and home-chat
  materialization. No new delivery owner is needed.

## Constraints

- Keep native admission bearer-authenticated, member-bound, and response-shape
  compatible.
- Reuse `ensureHostedStarterUsageEnrollment` and the canonical activation
  welcome. Do not add a queue, scheduler, fallback sender, or persisted state.
- Preserve launch-consent, active-access, suspension, line-health, proactive
  pacing, daily capacity, exact verified-phone, and delivery-idempotency gates.
- Keep Linq instant-start suppression unchanged because the inbound message is
  already that member's welcome turn.
- Preserve the canonical finite unfinished-onboarding continuation after a
  successfully delivered welcome; disclose it instead of adding another owner.
- Keep the signup welcome email Web-only; companion admission requested an
  iMessage conversation, not parallel email outreach.
- Do not retry or backfill historical companion activations in this patch.
- Keep all tests, docs, changelog copy, and review artifacts free of production
  member data and direct identifiers.

## Planned Changes

1. Let companion enrollment use the canonical signup welcome while keeping
   instant-start suppression and the separate Web welcome email policies intact.
2. Make no-line activation companion-specific and require a successful runtime
   wake, with active-admission replay signaling the exact pending mailbox item.
3. Prove routed, no-line, missed-wake, replay, and maximum-pool behavior in
   focused unit and PostgreSQL-backed integration tests.
4. Keep proactive assignment eligibility out of exact active-member inbound
   authority so a managed reply-safe line can durably accept the first text.
5. Update the owning architecture, security, product, control-plane, index, and
   public changelog documentation.

## Verification

- Focused companion admission route and member-access tests.
- Focused Starter enrollment/member activation/Linq home-routing tests selected
  by the final diff.
- Web typecheck.
- Direct static scenario proof that companion admission reaches the same
  default welcome policy as Web while instant-start remains suppressed.
- Exact-head GitHub Actions, preliminary completion-specialists ReviewGPT, and
  the sensitive final ReviewGPT gate.

## Progress

- ReviewGPT returned a checksum-verified patch that removes only the companion
  suppression, preserves Linq instant-start suppression, and updates the
  overlapping contracts.
- Parent inspection added direct Starter-owner coverage proving that a fresh
  `companion_onboarding` activation reaches member activation with signup
  welcome suppression disabled.
- Focused proof passes across four Vitest files (98 tests), including hard-cap
  and inbound-routing cases. Full workspace typecheck passes.
- PR 1761 supplies the changelog source number; its public fragment generation
  and focused archive proof pass across two files (45 tests).
- Preliminary and final ReviewGPT found the same no-assignable-line rollback:
  companion activation now tolerates a missing line while Web signup retains
  its fail-closed policy. The specialist also found a silent runtime-wake gap
  and parallel welcome email; companion replay now re-signals the exact pending
  activation item, and the email remains Web-only.
- Focused proof now passes across 206 ordinary tests (two expected skips) plus
  two PostgreSQL-backed companion enrollment scenarios covering routed welcome,
  no-line activation, durable grant/mailbox state, no email, duplicate-free
  replay, and maximum-pool success and contention bounds.
- Final ReviewGPT round 2 found that the same proactive-line eligibility could
  still discard the first inbound after route-less activation. The route owner
  now distinguishes outbound-first-contact from an exact active member's
  provider-attested direct input: a managed reply-safe line binds and appends
  durably without proactive eligibility, while unowned or unsafe inputs remain
  fail-closed. Focused unit and real-PostgreSQL proof cover the first bind and
  duplicate replay.

## Rollout

Deploy Web only. Existing companion clients keep the same request and response
contract. After deploy, verify a fresh consented phone signup receives one
canonical first iMessage when a healthy line has proactive capacity, and that
an exhausted or unavailable pool still activates the member without sending.
Also verify that a route-less active member's first direct input on a managed
reply-safe line binds and reaches the canonical mailbox, while an unmanaged or
unsafe recipient line stays ignored.
Also verify that a deliberately failed activation wake returns the retryable
account-gate outcome and that retry re-signals the existing mailbox item.
