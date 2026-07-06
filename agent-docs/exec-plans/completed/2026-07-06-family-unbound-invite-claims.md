# Family unbound invite claims

## Why

Family invite binding is optional targeting, not mandatory verification. A
label-only invite should be claimable by the first verified identity that
explicitly presents the family token or taps accept after web sign-in, while
phone, email, and Telegram-bound invites keep enforcing their binding.

Utmost priority: clean, simple, long term maintainable and composable
architecture with minimal complexity.

## User-visible goal

- A label-only invite can be accepted through Messages, Telegram, or web sign-in.
- Bound invites still offer and accept only through their bound identity.
- The prefilled Messages body is human-readable while keeping the embedded
  `family_<code>` token as the explicit consent marker.
- The plan owner is notified when an unbound invite is claimed.
- The owner invite form puts phone first and uses the shared hosted phone input.

## Approach

1. Extend the existing family token parser and Messages href helper.
2. Adjust the existing invite acceptance authority checks so fully unbound
   invites bind to the accepting verified phone, email, or Telegram identity.
3. Reuse `appendHostedFamilyChatNotificationTx` and route resolution for owner
   announcements on unbound claims only.
4. Update the accept page CTAs and settings invite form in place, following the
   current component patterns.
5. Update tests and product/security docs for the final rule.

## Invariants

- No implicit acceptance: messaging paths still require a `family_<code>` token.
- Bound invite matching stays fail-closed for mismatched phone, email, or
  Telegram identities.
- Double-claim remains single-winner through the existing pending-row claim.
- No new tables, queues, or notification machinery.
- Do not commit in this task; the supervisor reviews and commits.

## Verification

- Requested hosted family Vitest batch.
- Any LinQ/webhook acceptance suites found by search.
- ESLint on touched `apps/web` files.
- `pnpm --dir apps/web typecheck`.

Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
