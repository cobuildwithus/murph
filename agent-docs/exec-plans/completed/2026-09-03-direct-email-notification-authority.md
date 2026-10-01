# Direct Email Notification Authority

Status: completed
Created: 2026-09-03
Updated: 2026-09-03

## Goal

Restore exactly-once assistant welcome delivery for an activated member whose
only direct route is verified email, so the retained activation and legacy
welcome mailbox items complete instead of producing repeated
`ASSISTANT_AUDIENCE_UNVERIFIED` wakes.

## Root Cause Evidence

- Web correctly resolves the activated member's verified email into a direct
  email route and persists that route in the encrypted activation mailbox
  envelope.
- The hosted runtime strips every `explicit` route from
  `bindingDeliveryTarget` unless external-thread authority accompanies it.
- Direct email intentionally uses an explicit route, so conversation policy
  receives a claimed-direct route with no binding target and rejects it before
  provider work.
- The provider-entry boundary already replaces every direct email target with
  the callback-bound member's current verified email, which is the independent
  delivery-authority check this path needs.
- The canonical activation welcome remains pending on failure, so the
  deterministic pre-provider rejection repeatedly schedules the existing
  one-minute mailbox retry.

## Architecture

- Keep Web/Postgres as the verified-email owner, the existing mailbox as the
  retry owner, and the existing runtime provider-entry callback as final egress
  authority.
- At notification composition, treat an explicit target as the conversation
  binding only for a direct hosted email whose wake member matches the bound
  runtime member. Continue requiring external-thread authority for explicit
  Linq and Telegram destinations.
- Add no contract field, queue, scheduler, database state, or channel-specific
  retry owner. The retained production payload is therefore repairable by a
  runtime-only rollout.
- Keep canonical welcome failures retryable. A generic retry cap would silently
  discard a product-critical first contact; fixing the stable authority
  mismatch lets the existing item converge instead.

## Product UX Plan

- Effort: Product UX Patch.
- Email-only new member: receives the existing welcome exactly once at the
  current verified email, then normal onboarding follow-up remains available.
- Linq member: existing thread or participant delivery is unchanged.
- Telegram member: proactive activation welcome remains suppressed.
- Revoked or missing verified email: provider entry still fails closed before
  sending; this repair does not widen delivery authority.
- Recovery: the already-retained activation item retries after rollout; the
  legacy item uses the same first-contact and idempotency identity and then
  skips rather than duplicating delivery.

## Verification

1. Add a failing runtime regression for embedded and legacy email welcome
   composition, including a wrong-member and non-email fail-closed case.
2. Prove the assistant conversation-policy boundary now classifies the exact
   direct email input as direct while the existing unverified cases remain
   rejected.
3. Run the focused assistant-runtime and assistant-engine tests and typechecks.
4. Add and run one focused real-Codex welcome journey built through the
   production notification turn; review the exact member-visible reply.
5. Run diff, privacy, complexity, and final cross-cutting review gates, then
   open the repair PR for the Cloudflare runner rollout.

## Deployment And Rollback

- The change is runtime-consumer-only and accepts existing mailbox payloads;
  Web does not need to deploy in tandem.
- Old warm containers may keep retrying until replaced. Roll out Cloudflare,
  verify the active runner version, then confirm the error aggregate stops and
  the affected mailbox items are consumed.
- Rolling back restores the pre-provider rejection for email-only welcomes but
  does not corrupt persisted payloads; the mailbox items remain retryable.

## Progress

- Root cause and current production shape reproduced before implementation.
- Isolated worktree created from the latest `origin/main`; no overlapping open
  PR owns this authority seam.
- The regression failed before the fix because both activation and legacy
  welcome paths supplied a null binding target, then passed after the direct
  same-member email rule was applied.
- Runtime, engine, hosted-execution, Web, and Cloudflare runner typechecks pass.
  Focused runtime, audience-authority, provider-entry, activation, and
  verified-email tests pass.
- The focused real-Codex harness produced the exact welcome and a queued
  delivery through the production notification turn. Its deterministic
  exact-text policy correctly made no model-provider request.
- Workspace boundary, cycle, docs-drift, complexity-diff, and diff checks pass;
  the candidate keeps existing owners and introduces no new state or retry
  path.
- Draft PR #2764 owns the repair. Its privacy-safe changelog item describes the
  restored email welcome and current verified-recipient boundary without
  exposing incident evidence.
Completed: 2026-09-03
