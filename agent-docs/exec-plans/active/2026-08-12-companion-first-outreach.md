# Companion Signup First Outreach

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

When a new member activates through the native companion app with a verified
phone number, use Murph's existing signup-welcome path to assign an eligible
home line and send the canonical first iMessage. Preserve the normal
capacity-exhausted behavior: activation succeeds and the member can still text
Murph first when no line may safely open a proactive conversation.

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
- Do not retry or backfill historical companion activations in this patch.
- Keep all tests, docs, changelog copy, and review artifacts free of production
  member data and direct identifiers.

## Planned Changes

1. Remove the companion-admission request for signup-welcome suppression and
   delete the now-unneeded companion-service option if no other caller needs it.
2. Update focused route and service tests to prove a fresh phone-based companion
   activation uses the default welcome policy while existing active members
   remain side-effect free.
3. Update the owning security/reliability/product documentation to describe the
   restored first outreach and its safe capacity fallback.
4. Add one public changelog fragment describing the member-visible outcome.

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

## Rollout

Deploy Web only. Existing companion clients keep the same request and response
contract. After deploy, verify a fresh consented phone signup receives one
canonical first iMessage when a healthy line has proactive capacity, and that
an exhausted pool still activates the member without sending.
