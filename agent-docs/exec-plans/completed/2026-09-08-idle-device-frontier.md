# Unblock mailbox work behind retained device continuations

Status: completed
Created: 2026-09-08
Updated: 2026-09-08

## Outcome and invariant

Restore progress for due system work when an earlier device operation has
already transferred to a retained runtime continuation. Preserve exact
connection ownership, historical retry deadlines, foreground priority, and
ordered execution of mailbox obligations that have not transferred.

## Product UX

- Outcome: Due background maintenance and device updates can progress while an independent historical retry waits.
- Reaches: Restored runtimes, retained device work, later system requests, and foreground preemption.
- Proof: Synthetic persisted-state replay through wake selection, execution, checkpoint, and restore; no live member fixture data.

## Owner and evidence

The existing system mailbox state owner derives handling and scheduling.
Handling excludes validated continuation owners, but execution currently picks
the lowest sequence across all retained items. Reproduce the mismatch before
changing production behavior. Review same-connection scheduling separately;
never infer provider retry failure from a pending mailbox count.

## Design and constraints

Reuse the validated continuation projection and current queue selectors. Keep
state in the existing mailbox envelope; add no scheduler or persisted field.
Untransferred work and invalid ownership remain barriers. Retained jobs keep
their exact retry and connection authority. Production state stays read-only.

## Tasks

1. Recheck idle-runtime metadata and identify the failing boundary.
2. Add failing synthetic composed regression proof.
3. Correct the existing selection owner and update its protocol contract.
4. Run focused tests, typecheck, complexity and documentation checks; review the full candidate.
5. Commit the scoped fix and report proof and remaining deployment limits.

## Verification

- Four regressions fail against the unchanged base and pass against the candidate: due maintenance and browser-vault wake selection, plus composed checkpoint/restore for maintenance and already-covered schedules.
- The five focused runtime files pass all 353 tests, covering device execution, mailbox state/recording, cold snapshots, and foreground preemption.
- A second cold invocation preserves the exact retained job, owner, retry deadline, and handled high-water without another checkpoint.
- Existing cadence tests now require covered schedules to retire in the recording pass; failed scheduler and equal-cadence cases remain pending.
- Assistant-runtime and Web typechecks pass; all 10 changelog archive tests pass.
- Complexity guard passes with unchanged debt in each of the three source files. The changed preparation owner stays at 30; unrelated runtime hotspots are unchanged.
- Documentation drift initially required an index update; the owner description was updated accordingly.
- Product UX: Ready for local code delivery. Independent background work advances while history waits; same-connection manual work, invalid transfer authority, webhook obligations, and foreground priority retain their boundaries.

Runtime interpretation and model-facing prompts are unchanged. Deterministic
execution proof covers this model-free change; no real-model journey is needed.
Production metadata identified an idle retained-owner failure pattern, but it
does not prove the encrypted hint contents for every affected runtime. No
production recovery claim is made before runner deployment and live readback.

## Deployment

No schema or wire change is intended. New runners must restore old envelopes
without changing retained job deadlines. Existing runners retain the old
selection behavior until full runner rollout. Production drain remains a
separate verification boundary.

## Final owner decisions

Reuse the existing validated continuation projection for the untransferred
frontier. Reuse retained-cadence compaction after recording and, only when no
eligible work is runnable, retire eligible covered hints through the normal
processed-item checkpoint lifecycle. Preserve a future device wake even when
assistant execution is blocked and no runnable execution class exists yet.
No provider fetch, new scheduler, durable field, or migration is added.

Delivery is a scoped local commit under the change request. No PR, merge,
deployment, production mutation, or Temporal signal is performed. A later PR
requires the normal exact-head CI and sensitive ReviewGPT gate.
Completed: 2026-09-08
