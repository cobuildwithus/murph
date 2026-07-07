# Linq egress guard: stop failing closed on null last-inbound

Date: 2026-07-07
Owner: Claude (Fable supervises, Codex implements)
Branch: `fix/linq-egress-null-inbound` (worktree `.claude/worktrees/linq-egress-null-inbound`)

## Why

Production incident (2026-07-06): members whose `hosted_member_routing.linq_last_inbound_at`
was never recorded (a chat-lookup-key bind/write drift; see follow-up work below) had every
server-initiated Linq/iMessage send silently skipped by the 28-day recent-reply egress guard
with `skip_reason last_inbound_at=null`, while cron automations kept running and burned their
entire trial AI allowance on messages that were discarded at egress. 8 members affected; users
were deaf to Murph for a week with no signal.

Founder decision: a null `last_inbound_at` on an established member route is a bookkeeping-bug
state, not evidence of a cold contact. The guard must only deny on affirmative staleness
(a recorded inbound older than the 28-day window), never on missing bookkeeping.

## Behavior change

In `apps/web/src/lib/hosted-onboarding/linq-egress-engagement.ts`:

1. `decideHostedLinqRecentInbound`: `lastInboundAt === null` → `{ allowed: true, lastInboundAt: null }`.
   Keep the future-skew denial and the >28d `stale_inbound` denial unchanged.
2. Preserve the targeting constraint: when the send target cannot be associated with the member
   at all (no routing row, or no chat/phone lookup-key match), keep denying (`missing_inbound`).
   `readHostedMemberLinqRouteLastInboundAt` must therefore distinguish "matched a route key but
   timestamp is null" (→ allow) from "no route association" (→ deny). Same for the
   `!memberId` branch in `readHostedLinqSideEffectRecentInboundDecision` (keep deny).
3. Thread-route path (`route.lastInboundAt` from a validated route authority): null → allow
   (route existence + membership already authority-checked).
4. Update tests in `apps/web/test/hosted-onboarding-linq-egress-engagement.test.ts` (and any
   webhook-transport tests asserting the old missing→deny behavior); add coverage for
   matched-route-null → allowed and no-association → denied.
5. Update durable docs that document the guard as failing closed on missing inbound
   (grep `RECIPIENT_RECENT_REPLY_REQUIRED`, `28-day`, `missing_inbound` under `agent-docs/`
   and `docs/`).

## Invariants to preserve

- First-contact authority path (`engagementKind: "first_contact"`) unchanged.
- Participant-target identity matching unchanged.
- Route-authority validation unchanged.
- Skip bookkeeping (`markHostedLinqDeliverySkippedTx`) unchanged for remaining denials.
- No new tables, queues, or state.

## Verification

- `pnpm test:diff` over touched files (or the apps/web scoped coverage command).
- Typecheck.
- Required audits: security-privacy-review (egress trust boundary loosened deliberately),
  coverage-write; parent local final review; PR-lane Codex deep-review loop after push.

## Follow-ups (separate tasks, not this branch)

- Root fix: chat-lookup-key bind/write drift so `linq_last_inbound_at` records correctly
  (engagement write should share the read path's phone-key fallback; self-heal stale keys on inbound).
- Pre-check delivery viability before model-capable cron wakes spend AI allowance.
- Proactive AI-usage limit notice for blocked automation wakes (reuse `limitNoticeSentAt` claim).
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
