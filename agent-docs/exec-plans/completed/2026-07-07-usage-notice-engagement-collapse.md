# Usage-limit notice at crossing + engagement-guard collapse (combined B+C)

Date: 2026-07-07
Owner: Claude (Fable supervises, Codex implements)
Branch: `feat/usage-notice-engagement-collapse` (stacked on `fix/linq-inbound-stamp-invariant`, PR #429; merge after it)

## Why

July 2026 incident follow-ups, founder-approved end state:
- B: a user whose AI allowance is exhausted (by automations or their own turn) is told at the
  moment of crossing — the turn's message delivers, then the out-of-usage notice. Today the
  notice exists only on the inbound gate-denied path.
- C: the 28-day recent-reply egress guard mis-modeled Apple's per-chat trust (reply-count,
  not recency), created a silent composed-then-discarded failure mode, and burned AI spend on
  undeliverable messages. Replace it with ONE engagement rule at ONE seam reading ONE source
  of truth: skip message-composing automation wakes for members with no inbound day in the
  last 28 days per `hosted_linq_daily_state` (the bookkeeping that never broke). Conversational
  replies are never gated, by construction.

## C scope

1. Wake admission (apps/web `runtime-reconciliation-facts.ts`): when a model-capable workspace
   wake is due AND there is no fresh conversation mailbox lag, read the member's
   `hosted_linq_daily_state` for the trailing 28 days (indexed member_id+day_utc range,
   inbound_count > 0). No qualifying inbound day → return blocked facts (new explicit reason,
   e.g. `automation_engagement_paused`) with a daily retryAt. Any inbound naturally unblocks:
   fresh conversation lag bypasses the check and the daily-state row refreshes.
2. Delete the recency guard: `decideHostedLinqRecentInbound`, the recency logic inside
   `assertHostedLinqRecentInboundEngagementForRuntime` and
   `readHostedLinqSideEffectRecentInboundDecision`, the currentInbound proof machinery (it
   existed only as a guard exception), `buildHostedLinqRecentInboundSkipReason`, the
   engagement recording writers (`recordHostedMemberLinqInboundEngagementTx`,
   `recordHostedThreadRouteLinqInboundEngagementTx`) and the pending→home stamp promotion
   plumbing — after verifying no other readers.
   PRESERVE UNCHANGED: first-contact egress authority, participant-target identity matching,
   route-authority validation (identity/authority checks, not engagement), and delivery-skip
   bookkeeping for the checks that remain.
3. Deploy-order constraints (encode, do not violate):
   - The internal runtime route `/api/internal/hosted-runtime/linq-egress/engagement` must KEEP
     existing and return ok (authority checks intact, recency logic gone) because stale
     Cloudflare runners call it before every delivery; deleting it causes 404 delivery churn
     (consume-route incident). Removing the runtime-side call + the route + the
     `linq_last_inbound_at`/`pending_linq_last_inbound_at` COLUMN DROP migration is an explicit
     follow-up PR after the CF rollout — this PR does not touch prisma schema or
     packages/assistant-runtime delivery callbacks.
4. Durable docs: update the deliverability/reliability docs describing the 28-day guard to the
   new model (wake-level engagement pause on daily state).

## B scope

As planned in 2026-07-07-usage-limit-notice-at-crossing.md: when post-turn usage accounting
crosses the allowance limit (blocked_at transition), send the usage-limit notice once per
period from `recordHostedAiUsageRecordsAndSendLimitNotices`, reusing
`claimHostedAiUsageLimitNotice` dedupe (+release on failure), `buildHostedAiUsageGateLimitNotice`
copy, the `ai_usage_quota` side-effect transport with
`buildHostedAiUsageGateNoticeIdempotencyKey`, and the reconciliation pending-conversation
sender as prior art for non-webhook sends. Notice failure never fails usage recording. Inbound
gate-denied reply stays as backstop. With C in the same PR, the notice send no longer needs
recency-skip handling (guard gone) — keep claim-release for transport failures.

## Invariants

- Inbound conversational replies are NEVER blocked by engagement state.
- Usage accounting unchanged beyond surfacing the crossing transition.
- One notice per allowance period across all send paths (single claim source of truth).
- First-contact/participant/route-authority checks byte-for-byte semantics preserved.
- No prisma schema changes in this PR.

## Follow-ups

- After the Cloudflare rollout, remove the CF-side engagement-route call, delete the internal
  Linq egress engagement route, and drop the old `linq_last_inbound_at`,
  `pending_linq_last_inbound_at`, and `hosted_thread_route.last_inbound_at` columns in a later
  migration PR.

## Verification

- Tests: wake blocked for 28d-silent member and unblocked by any inbound day / fresh lag;
  guard-deletion updates to egress tests (association/authority checks remain); B edge cases
  (one notice per period, race, release-on-failure, automation-crossing UX, inbound backstop).
- Focused vitest + apps/web typecheck + full apps/web suite; assistant-runtime tests only if
  its types reference deleted web exports (should not — route kept).
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
