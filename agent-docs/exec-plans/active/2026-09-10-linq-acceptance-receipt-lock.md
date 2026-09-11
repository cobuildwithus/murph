# Serialize Linq first-turn acceptance with receipt ingestion

## Outcome and invariant

Provider receipts and first-turn acceptance must observe each other's committed state, including when a receipt arrives while acceptance binds its message key. Preserve delivery timing, receipt ordering, onboarding effects, and exactly-once provider dispatch.

## Evidence and owner

Source inspection proves first-turn finalization calls `markHostedLinqDeliveryAcceptedTx` without the existing receipt advisory lock; runtime acceptance and receipt ingestion already use it. An uncommitted receipt can miss the not-yet-bound parent while acceptance misses the uncommitted receipt. Four synthetic PostgreSQL shared-milestone cases reproduce the lost delivered/failed receipt. No confidential production examples belong in this plan.

## Design

Reuse `lockHostedLinqMessageReceiptsTx` as the first statement of the existing first-turn finalization transaction, before member/line/delivery locks. Keep the single provider message id, canonical delivery row and buffered receipt replay. No new state, retry, schema, dependency, provider operation, or telemetry pipeline. ReviewGPT implements the source change and focused proof; parent reviews and verifies. Deployment is an ordinary Web-only functional correction, for human merge; no historical data repair.

Do not insert this lock into the generic milestone: group outreach already holds line/member locks before calling it, creating an inverse order against receipt ingestion. Other milestone callers remain outside this bounded correction.

## Product UX — Patch

Outcome: delivery tracking reflects the exact receipt even when acceptance overlaps ingestion.
Reaches: first-turn finalization; preserves other acceptance callers and runtime/terminal retry behavior.
Proof: real PostgreSQL paused-receipt interleavings through actual first-turn completion for delivered and failed outcomes, including durable mailbox handoff and no second provider send; existing ordering, duplicate and provider-boundary regressions. No prompt or reply content changes.

## Verification and completion

- [x] Synthetic fail-before and pass-after PostgreSQL proof, focused unit suite, Web typecheck.
- [x] Inspect bounded transaction/lock ordering, privacy, complexity and full diff.
- [ ] Scoped commit, draft PR, Ready after focused proof, final ReviewGPT with CI.
- [ ] Close plan, verify final-head required checks and current-base mergeability; leave for human merge.

## Progress

Isolated task checkout created from current origin/main. No competing open PR owns this first-turn race. Parent and ReviewGPT rejected a generic lock insertion because of the group-outreach lock inversion and narrowed implementation to the existing first-turn transaction. Production investigation remains read-only.

The composed exported-completion proof failed on unchanged source for both delivered and failed receipts; no-receipt acceptance passed. After the five-line source correction, all 104 tests across the full PostgreSQL and first-turn unit files pass. Web typecheck and complexity guard pass. The unchanged completion hotspot remains 37; no broader lifecycle refactor is justified. The lock adds one serial query in the existing post-send transaction, with no provider or connection-count increase. Parent candidate review is complete and Product UX is Ready. Changelog is not applicable: only internal delivery tracking changes, with provider sends and member-visible mailbox behavior preserved.
