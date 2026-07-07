# Linq inbound engagement stamp: invariant, not best-effort

Date: 2026-07-07
Owner: Claude (Fable supervises, Codex implements)
Branch: `fix/linq-inbound-stamp-invariant` (worktree `.claude/worktrees/linq-inbound-stamp-invariant`)

## Why

Root cause of the July 2026 silent-automation incident: the inbound engagement stamp
(`hosted_member_routing.linq_last_inbound_at`) is written by a chat-lookup-key-matched
`updateMany` that silently no-ops when the stored key was bound from a different chat-id
representation (Linq API `chat.id`) than the webhook sends (`chat_id`). The
`routeAlreadyBound` short-circuit preserves the stale key forever, so affected members were
never stamped even while texting daily. PR #427 made the egress guard tolerate the missing
stamp; this change makes the stamp itself reliable so the guard runs on real data.

## Invariant to establish

Processing a member's home-line inbound must leave the routing row with:
1. a chat lookup key derived from the live webhook chat id (self-heals stale/drifted keys), and
2. a fresh `linqLastInboundAt` (or `pendingLinqLastInboundAt` for the pending flow), written
   scoped by `memberId` (unique on the table) with explicit home/pending intent from the
   caller — never re-gated on the chat-key match that the binding step just performed.

## Approach

- The bind+track helpers (`bindHostedMemberHomeLinqChatAndTrackInbound`,
  `bindHostedMemberPendingLinqChatAndTrackInbound`) run only after the webhook's home-line
  binding resolution has decided this is the member's home/pending chat — the association is
  proven upstream. Remove the stale-key-preserving skip so the binding upsert always runs from
  the live webhook chatId (verify idempotence when already correctly bound), and stamp
  engagement by memberId with explicit home/pending intent.
- The current-inbound-proof path in linq-egress-engagement.ts (memberId already verified
  against the mailbox item; reply target is the home chat) gets the same by-memberId stamp.
- Preserve home-line binding authority semantics (routing-conflict machinery) — investigate
  `resolveIncomingHostedLinqHomeLineRouteBindingTx` / `upsertHostedMemberHomeLinqBindingTx`
  and keep redirect/blocked/capacity outcomes unchanged; the heal applies only on `bind`
  outcomes.
- No latency-visible work: one idempotent row write inside the existing webhook transaction.

## Verification

- Focused vitest on touched files + apps/web typecheck; full apps/web suite.
- Regression test reproducing the incident shape: routing row bound with a drifted chat key,
  inbound arrives with webhook-form chat id → key healed AND `linqLastInboundAt` stamped.

## Follow-ups (separate)

- Limit notice at usage-crossing (PR B), guard redesign to 3-reply lifetime trust (PR C,
  pending founder decision), automation pause / retry-amplification (PR D).
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
