# Device-sync single-admission completion

Status: active
Created: 2026-09-03
Updated: 2026-09-03

## Goal

Finish a successful hosted device-sync mailbox item inside its current runtime
admission after the existing durability checkpoint, instead of scheduling a
provider-free completion-fence runtime.

## Success criteria

- Successful device-sync work checkpoints its exact completion record before
  advancing Web-owned provider cadence.
- Full local control-plane reconciliation is accepted before that record can
  authorize same-admission completion; one version conflict rehydrates and
  retries the full update without losing local credential progress or
  re-admitting completed work.
- The same runtime admission then publishes cadence, removes the mailbox item,
  and durably checkpoints that removal.
- Checkpoint, cadence-publication, and final-checkpoint failures remain
  replay-safe without repeating provider work after a durable completion
  record exists.
- A completion-origin wake carrying retryable jobs stays pending, while
  epoch-less legacy and terminal retained completion fences drain without
  mutating provider cadence.
- Foreground priority, dirty-state ownership, provider cadence, and bounded job
  execution remain unchanged.
- Focused runtime proof, package typecheck, exact-head CI, and the required
  final ReviewGPT gate pass.

## Scope

- In scope: assistant-runtime device-sync completion ordering, system-mailbox
  post-checkpoint handling, focused regression coverage, and matching durable
  runtime documentation.
- Out of scope: the separate wake-owner projection defect, Temporal worker
  deployment skew, payload-hash recovery, provider scheduling policy, and
  container lifecycle optimization from PR #2741.

## Constraints

- Keep Web as canonical cadence owner and the encrypted mailbox record as the
  exact recovery owner.
- Reuse the existing durable-effect and follow-up-checkpoint mechanism.
- Add no queue, service, table, scheduler, configuration, or persisted state.
- Preserve old snapshot readability and a safe rollback path.

## Product UX

- Effort: Patch.
- Outcome: connected-device refresh finishes without an otherwise invisible
  extra runtime admission while preserving the same imported data and cadence.
- Reaches: an existing member whose background device refresh reaches terminal
  provider work, including recovery after a checkpoint or control-plane error.
- Proof: a production-shaped checkpoint/restore test shows successful work
  publishes cadence and clears its mailbox item within one admission, while
  injected failures retain provider-free replay authority.

## Product UX walkthrough

- Person and path: an existing member whose scheduled connected-device refresh
  reaches terminal work, including a cold restore after checkpoint failure.
- Evidence: the production-shaped workspace test preserves the same eight
  provider requests and final 06:05 cadence while clearing the durable mailbox
  item between the completion-record and removal checkpoints in one admission.
- Recovery: a full-reconciliation version conflict rehydrates and retries once
  without re-admitting wake hints or dirty work before completion is exposed.
  A restored completion record returns to that ordinary full-reconciliation
  path instead of carrying independent deletion authority.
- Recovery: a completion-origin wake with a reconstructed provider retry keeps
  the exact mailbox item, and an epoch-less legacy or terminal completion drains
  without writing cadence.
- Difference from plan: final ReviewGPT first exposed that completion reason
  alone was insufficient authority, then exposed that cadence-only completion
  could outlive a rejected full update and lose a locally rotated credential,
  then exposed that retrying through the broad sync path re-admitted already
  completed retained and dirty work. Eligibility now requires accepted full
  reconciliation in the same admission, an empty retained-job set, and the
  exact active connection epoch. Conflict recovery now uses the existing
  hydration phase alone and carries current-pass terminal evidence into the
  refreshed state. Restored records use the full path. No persisted proof or
  new state owner was added.
- Verdict: Ready.

## Risks and mitigations

1. Risk: cadence publishes before completion is recoverable.
   Mitigation: run publication only from the existing durable post-checkpoint
   effect after the completion record is committed.
2. Risk: a crash after cadence publication loses mailbox removal.
   Mitigation: make publication idempotent and take the existing follow-up
   checkpoint; restore replays the committed record without provider work.
3. Risk: old retained completion fences stop draining.
   Mitigation: keep the legacy reader and retained record shape; epoch-less or
   terminal records drain without cadence mutation.
4. Risk: a completion-origin wake is later reconstructed with retryable jobs.
   Mitigation: direct completion requires zero normalized retained jobs, so the
   mailbox item remains the exact retry owner regardless of its reason label.
5. Risk: a concurrent canonical heartbeat rejects the full update while local
   provider work has rotated credentials.
   Mitigation: fetch and hydrate the fresh canonical snapshot without
   re-admitting wake hints or dirty work, carry the current pass's terminal
   evidence, compare local progress against that canonical baseline, and retry
   the full update once; another mismatch fails without exposing completion.
6. Risk: conflict recovery repeats completed provider work because local job
   dedupe intentionally excludes succeeded rows.
   Mitigation: keep hydration and work admission as explicit phases; retry only
   hydration and reconciliation. Production-shaped retained-page and dirty-row
   tests prove one provider execution across the conflict.

## Tasks

1. Add a failing production-shaped single-admission completion regression.
2. Collapse completion into the existing durable post-checkpoint effect and
   delete the separate completion-fence admission.
3. Add failure and legacy-snapshot coverage.
4. Update the hosted runtime architecture, reliability, and protocol docs.
5. Run focused verification, parent diff review, final ReviewGPT, exact-head CI,
   and merge the PR.

## Decisions

- Preserve two durable checkpoints across the snapshot/Web boundary, but keep
  both inside one runtime admission.
- Treat the already-checkpointed post-checkpoint record as the completion
  outbox; do not introduce another state owner.
- Derive completion authority from zero retained jobs plus the exact current
  active connection epoch; the reason label is classification, not authority.
- Require accepted full reconciliation in the current admission. Keep that
  proof transient so restored or yielded records fall back to the existing
  full-reconciliation admission rather than gaining a second durable owner.
- Keep canonical hydration independently callable from work admission so a
  version retry can refresh one baseline without replaying current-pass work.
- Keep PR #2741 separate because its container-lifecycle change has a distinct
  owner and does not remove the completion runtime admission.
- Changelog is not applicable because this removes an internal redundant
  runtime admission without changing a member-visible result or promise.
