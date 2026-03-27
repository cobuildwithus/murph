# 2026-03-26 Assistant observability and reliability

## Goal

Integrate the supplied assistant resilience patch on top of the current assistant runtime without introducing a database, background repair worker, or model-authored governance layer:

1. host-written turn receipts with coarse timeline milestones and durable status snapshots
2. file-backed idempotent outbox intents with deferred, retryable, and replay-safe drain behavior
3. persisted diagnostics and provider/model failover state with cooldown tracking
4. env-driven assistant fault injection for robustness coverage
5. read-only `murph status` / `murph doctor` surfaces for assistant-state visibility and integrity checks

## Constraints

- Keep `assistant-state/` non-canonical and rebuildable.
- Keep the implementation additive and file-backed.
- Prefer coarse milestone receipts over high-volume provider/event logs.
- Scope delivery idempotency to a logical turn/request, not indefinite semantic dedupe.
- Keep deferred delivery replay-safe and bounded; do not invent a background daemon beyond the existing foreground automation loop.
- Do not widen delivery audiences or mutate canonical vault data.
- Preserve overlapping in-flight assistant changes already present in the worktree.

## Planned shape

- Extend runtime assistant-state paths with richer status/diagnostic/failover snapshots while preserving the in-flight receipts/outbox layout already present in this tree.
- Add assistant diagnostics helpers plus persistent counters/warnings and append-only event journaling.
- Add assistant failover route schemas/helpers with persisted cooldown/success/failure accounting.
- Broaden the outbox schema/helpers to cover deferred retry state, attempt scheduling, and replay-safe drain behavior.
- Thread receipt creation and state transitions through `sendAssistantMessage()`, manual delivery, and automation/outbox draining.
- Thread provider failover and diagnostics through provider execution without regressing the active provider-recovery lane.
- Add read-only assistant status/doctor read models plus status snapshot persistence.
- Add focused tests for deferred delivery, outbox drain, failover cooldown persistence, run-lock visibility, and injected faults.

## Deliberate non-goals

- No plugin or middleware marketplace.
- No background repair daemon.
- No model-authored receipts.
- No broad policy or approval engine.
- No new database or vector-memory dependency.

## Verification follow-up

- Add smoke scenarios for nested and root `status|doctor` commands so the documented command surface stays covered.
- Keep repo verification truthful by updating doc-index entries touched by the new observability docs.
- Add direct runtime proof for deferred outbox drain and failover/cooldown persistence if the scripted suite alone does not exercise those operator-visible states clearly enough.
- If required checks expose runner fragility instead of feature regressions, allow the minimum verification-only fixes needed to keep `pnpm test` and `pnpm test:coverage` reliable for this lane.
