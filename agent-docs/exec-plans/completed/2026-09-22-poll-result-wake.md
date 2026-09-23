# Wake Murph when native polls reach a result

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Outcome and invariants

Wake the existing conversation assistant once when a Murph poll has a unique option supported by more than half the current eligible participants, everyone has voted, or Telegram closes with votes. Include the observed tally as context so Murph can briefly acknowledge it or stay quiet if the conversation already settled it. A threshold does not close a poll or authorize another action.

## Owners and evidence

Linq exposes signed poll.vote.added/removed events and current chat handles; Telegram already supplies aggregate poll updates. The poll owner currently stores Telegram updates without waking the assistant. Reuse assistant.notification.requested and the encrypted, deduplicated mailbox; no new runtime protocol or scheduler. Add a nullable notification timestamp to the existing poll row, atomically committed with mailbox append. Bind new Linq receipts with the existing blinded message key.

## Product choices

- A majority means more than half the current electorate, not half of early votes. Multiple-answer ties never imply a winner.
- iMessage uses complete active human handles, excluding Murph; Telegram uses the current chat member count minus this bot, conservatively including other bots. Unknown rosters do not imply completion. Telegram close remains conclusive without a roster.
- One wake per poll; later changes remain readable. Describe counts as observed, not a permanently final decision. Preserve thread routing, access, quiet decisions and ordinary delivery idempotency.
- Legacy unindexed iMessage polls remain manually readable; newly created polls receive event binding.

## Failure and rollout

Provider and encryption work stays outside database transactions. The notification claim and prepared mailbox append share one short transaction with current access and route checks. Webhook redelivery recovers committed mailbox signaling, and compare-and-swap rejects stale preparation. Migration precedes Web. Existing notification consumers already accept this shape; no new runtime protocol. Retain the additive column and event consumer while polls exist.

## Work and verification

1. Implement bounded event binding, threshold evaluation, notification context, and durable one-shot append.
2. Prove ordinary majority/all-voted, early votes, ties, self-votes, unknown rosters, closed polls, replay, failed wake recovery, stale state and route/access denial.
3. Run relevant tests/typechecks and production-derived real-Codex result/quiet journeys; review replies and effects.
4. Update architecture/changelog, review the diff and complexity, push scoped candidate, complete ReviewGPT and exact-head CI.

## Progress

- Existing PR head and clean task worktree verified; PR returned to Draft.
- Official Linq and Telegram event contracts verified.

- Implemented provider-bound Linq event reads, Telegram checkpoint evaluation, conservative roster thresholds, one-shot mailbox claim and wake recovery.
- Parent review caught opaque assistant thread IDs versus native delivery targets; destination checks now use the canonical delivery target, and tests preserve an opaque context thread ID.
- Focused Web proof: 97 tests across poll effects, provider events, notification ordering/replay/authority, Linq route regression and changelog rendering pass.
- Web, assistant-engine and hosted-execution typechecks pass. Changed Web source ESLint, provider-request guard, docs drift and complexity guard pass. Existing webhook and prompt hotspots do not grow; new functions stay below 20.
- Two production-notification real-Codex journeys on gpt-5.6-terra, local subscription: an unacknowledged majority queues exactly one short truthful tally reply; an already settled conversation skips with zero outbox entries. Reply review Ready. No production channel send claimed.
- Changelog remains content-only, verified through the archive renderer and existing archive design reference. No new UI or screenshot required.
- Deployment requires the additive nullable column before Web and appropriate Linq poll vote subscriptions. Prior self-vote Web-before-runtime order still applies. Existing generic notification consumers accept the same envelope.

- Scope expanded to poll-result freshness during ordinary conversation. Add production guidance to refresh before current tally/voter/nudge claims, preserve unique participant semantics for multiple choices, and distinguish voting from activity completion. Verification uses independently synthetic planning scenarios, not private conversation reproductions.

- Freshness regression proof passes: production poll guidance makes a current read before participation claims; an independent five-attendee meetup fixture returns five distinct voters despite seven selections, with no unnecessary reminder. Real-Codex reply review Ready. Assistant deterministic tests and typecheck pass.
- Refreshed complete provider-input measurement against the original PR base: individual 150140 to 152616 UTF-8 bytes, group 140544 to 143020, each +2476. Assembled instructions +1085, tool/schema +840; exact tokenizer unavailable. The conditional poll-result notification is a newly admitted turn, not additional ordinary-turn input.

- Final ReviewGPT round 2 accepted one original-PR defect: the notification admission used the group-only authority checker for direct destinations. After user resume, replaced it with the existing direct/group-aware notification authority owner; no new state or abstraction.
- Composed Linq and Telegram webhook tests reproduce both direct-channel failures before the correction, then pass with the real destination resolver, binder and authority checker. They also prove replay does not append twice and changed routing or revoked access prevents admission. The focused routing/notification/migration batch passes 43 tests.
- Corrected the migration inventory proof to include the additive poll-notification migration. The billing PostgreSQL CI failure reproduced locally: a partial signal-runtime mock initialized cyclic consumers before replacement, escaping to a real unconfigured Temporal client. A complete boundary mock restores isolation; all 14 entitlement cases pass. No production billing change.

- Final ReviewGPT round 3 passes at cc0dac3fc6ebcc40d1711a31d1e95de27b7eac0d with no remaining qualifying findings. GPT-6 Pro exact-turn/model/attachment evidence and completion marker verified; capture exceeded ten minutes. The accepted round-2 direct-authority defect is resolved with no new state or abstraction.
- Parent final review confirms the post-review changes are isolated test-boundary correction, its Frog record and plan closure; no production behavior, schema, runtime config or implemented contract changes. Web typecheck and test ESLint pass after the billing proof correction. Existing prompt/reply journeys remain applicable unchanged.
- Current main merge-tree is clean. Final-head CI remains the handoff gate after this completion-record commit; no merge, deployment or live channel smoke is claimed.
Completed: 2026-09-22
