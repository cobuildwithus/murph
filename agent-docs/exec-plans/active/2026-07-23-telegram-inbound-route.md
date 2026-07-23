# Require inbound Telegram route for onboarding delivery

Status: active
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Stop treating a Privy Telegram user identity as a sendable Telegram conversation
  during hosted signup. A Telegram delivery route becomes ready only after Murph has
  observed and persisted an inbound Telegram thread.

## Success criteria

- A Telegram-only signup with no inbound thread remains messaging-setup-required.
- Activation does not enqueue a Telegram signup welcome against a bare Telegram user ID.
- Once an inbound Telegram thread exists, activation still targets that exact thread.
- Focused onboarding tests and the canonical diff verification pass.

## Scope

- In scope: the shared hosted messaging-state boundary, direct Telegram ingress route
  materialization for uniquely linked non-suspended members, and focused production-path
  onboarding tests.
- Out of scope: Telegram identity lookup, ingress persistence, historical resend or
  backfill, Cloudflare runtime behavior, and onboarding copy/UI.

## Constraints

- Technical constraints: preserve `telegramUserId` as identity-only state; keep
  `telegramThreadId` as the sole Telegram delivery target; add no state or queue.
- Product/process constraints: preserve setup recovery through the existing Telegram
  deep-link and inbound webhook, and avoid the overlapping member-activation source lane.

## Risks and mitigations

1. Risk: Telegram-linked members could lose legitimate delivery after messaging Murph.
   Mitigation: retain the inbound-observed `telegramThreadId` path and cover it directly.
2. Risk: requiring a route could deadlock setup if inactive inbound is rejected before
   route persistence.
   Mitigation: persist only a uniquely resolved, non-suspended direct binding before the
   active-access gate while leaving mailbox append, reply, and wake strictly gated.
3. Risk: signup could appear messaging-ready without a route.
   Mitigation: derive readiness, member channels, and notification routing from the same
   shared messaging-state boundary.

## Tasks

1. Remove the Telegram user-ID fallback from hosted messaging route resolution.
2. Allow the first inactive direct inbound to materialize the verified thread without
   entering the assistant runtime.
3. Update unit and activation tests for pre-inbound setup and post-inbound delivery.
4. Run focused and canonical verification, then obtain the required product-experience
   review before opening the initial PR candidate.

## Decisions

- Correct the shared route/readiness boundary instead of adding guards in individual
  callers. This keeps one source of truth and also prevents other provider sends from
  targeting an identity-only value.
- Do not add a resend path: the existing inbound flow owns route materialization and
  subsequent conversation continuity.
- An ignored inactive direct webhook plan still commits its transaction, so route
  persistence can unblock setup without appending a mailbox item or waking the runtime.

## Verification

- Commands to run: focused Vitest files, `pnpm test:diff` for the changed production
  and test paths, and `git diff --check`.
- Expected outcomes: no route or welcome before inbound, exact inbound thread after
  inbound, setup-required response before inbound, and no regressions in affected Web
  tests/typecheck.
- Results:
  - Focused messaging, activation, Privy completion, Telegram dispatch, and join setup
    tests passed: 6 files, 105 tests.
  - Canonical `pnpm test:diff` passed, including Web typecheck, 6,283 tests, lint with
    pre-existing warnings only, dev smoke, and production build.
  - Product-experience remediation review passed with no findings or material evidence
    gaps.
