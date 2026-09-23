# Wake Murph when native polls reach a result

Status: active
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
- Focused Web proof: 96 tests across poll effects, provider events, notification ordering/replay/authority, Linq route regression and changelog rendering pass.
- Web, assistant-engine and hosted-execution typechecks pass. Changed Web source ESLint, provider-request guard, docs drift and complexity guard pass. Existing webhook and prompt hotspots do not grow; new functions stay below 20.
- Two production-notification real-Codex journeys on gpt-5.6-terra, local subscription: an unacknowledged majority queues exactly one short truthful tally reply; an already settled conversation skips with zero outbox entries. Reply review Ready. No production channel send claimed.
- Changelog remains content-only, verified through the archive renderer and existing archive design reference. No new UI or screenshot required.
- Deployment requires the additive nullable column before Web and appropriate Linq poll vote subscriptions. Prior self-vote Web-before-runtime order still applies. Existing generic notification consumers accept the same envelope.
