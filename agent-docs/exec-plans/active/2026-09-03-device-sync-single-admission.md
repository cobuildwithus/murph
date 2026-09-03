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
- Recovery: cadence version conflict retains the committed record; replay
  observes an already-published cadence and clears it without provider work.
- Recovery: a completion-origin wake with a reconstructed provider retry keeps
  the exact mailbox item, and an epoch-less legacy or terminal completion drains
  without writing cadence.
- Difference from plan: final ReviewGPT exposed that completion reason alone was
  insufficient authority. Eligibility now derives from the empty retained-job
  set and exact active connection epoch, with no new state owner. No
  member-visible result, provider input, or cadence policy changes.
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
- Keep PR #2741 separate because its container-lifecycle change has a distinct
  owner and does not remove the completion runtime admission.
- Changelog is not applicable because this removes an internal redundant
  runtime admission without changing a member-visible result or promise.
