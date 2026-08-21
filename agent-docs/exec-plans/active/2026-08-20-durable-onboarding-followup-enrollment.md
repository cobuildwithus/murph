# Durable Onboarding Follow-up Enrollment

Status: active
Created: 2026-08-20
Updated: 2026-08-21

## Goal

Make member activation the single owner of unfinished-onboarding follow-up
enrollment for every signup path. Welcome delivery remains an optional channel
behavior; suppressing or skipping it must not suppress the durable finite
follow-up.

## Root Cause

- Follow-up creation was coupled to accepted signup-welcome delivery.
- Linq instant-start intentionally suppresses that welcome even though it has a
  direct conversation route.
- Telegram activation intentionally has neither proactive delivery nor, before
  the member starts the bot, a usable direct route.
- Fixing either channel at its message boundary would create another owner and
  leave future signup variants vulnerable to the same gap.

## Architecture

- `member.activated` starts canonical onboarding state exactly once at the
  activation timestamp.
- The activation contract carries an optional direct follow-up route separately
  from the optional welcome payload.
- When a route is present, activation immediately performs the canonical,
  idempotent finite automation upsert before optional welcome delivery.
- When a route is absent, the persisted onboarding start is the durable pending
  fact. Existing managed-automation reconciliation uses the first later
  deliverable direct member route, while preserving the activation-anchored
  three-day window.
- Completed, expired, group, or archived onboarding follow-ups stay closed.
  There is no new queue, scheduler, receipt index, or channel-specific state.
- Activation seed failures remain retryable through the activation mailbox;
  later-route failures reuse the existing managed-setup retry ladder.

## Product Behavior

- Standard Linq signup: seed the follow-up and send the existing welcome.
- Linq instant-start: seed the follow-up without sending a duplicate welcome.
- Telegram with an established direct thread: seed without proactive welcome.
- Telegram before bot start: remain silent, then seed from the first available
  direct route only if the original activation window is still live.

## Verification

- Hosted activation contracts preserve and parse the independent route.
- Web activation tests cover standard Linq, Linq instant-start, and established
  Telegram routing.
- Runtime tests cover route-only activation, welcome-plus-route activation,
  Telegram suppression, retryable persistence failure, and legacy notification
  non-ownership.
- Engine tests cover activation replay, delayed route availability, direct-only
  routing, original-window expiry, completed state, and archived records.
- The hosted-local Telegram scenario proves activation silence, the ordinary
  first direct reply, and inbound replay idempotency.

## Progress

- Activation now persists canonical onboarding start independently of channel
  and carries follow-up route separately from welcome delivery.
- The canonical seed reads that state, enforces direct delivery, preserves the
  original finite window, and uses the existing automation slug for idempotency.
- Managed reconciliation fills the route-later case without reconstructing
  conversation receipts or creating a Telegram-specific lifecycle.
- Preliminary specialist review found that the system-mailbox importer still
  treated no-welcome activation as bootstrap-only and acknowledged it before
  the activation owner ran. The obsolete terminal shortcut is now deleted, so
  every activation reaches the same owner; the corrected importer boundary is
  covered directly.
- Prompt proof now reads the automation actually persisted by the engine
  instead of reasserting an imported constant in an unrelated runtime test.
- The Telegram hosted-local scenario now reads canonical onboarding and
  automation state through the production CLI before checking inbound replay.
  Local execution built the runner and passed parity and bundle budgets, but
  the full stack cannot start without the private Temporal worker package;
  exact-head integration CI owns that remaining environment proof.
- Focused remediation proof passes: 109 assistant-runtime tests, 45
  assistant-engine tests, and typechecks for assistant-runtime,
  assistant-engine, and Cloudflare. Remaining work is the corrected exact-head
  CI run, final ReviewGPT round, parent review, and plan closure.
