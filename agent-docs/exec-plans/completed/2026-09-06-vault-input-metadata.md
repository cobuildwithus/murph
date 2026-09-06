# Consolidate hosted mailbox metadata files

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Outcome and invariant

Replace per-input mailbox metadata files with one durable SQLite store at the
existing assistant-engine ownership boundary. Preserve raw acknowledgement IDs,
blinded source IDs, private group context, input retention, and replay behavior.
Sanitized assistant input records and model-visible assembly do not change.

## Evidence and design

Each hosted input currently creates an additional metadata file. These records
share the input lifetime but have a distinct privacy classification, so merging
them into sanitized inputs or substituting sourceRef IDs is incorrect. Reuse the
same native runtime SQLite migrations, private filesystem helpers and assistant
write lock already used by session routing and outbox indexing. Metadata remains
durable truth, not a disposable projection.

The new table has an input ID key and a validated metadata JSON value. DELETE
journaling and closed handles retain one checkpoint file. Secure deletion erases
expired quotes from retained database pages. Foreground reads use one handle and
exact keyed lookups, with exact legacy fallback only when a current row is absent.
No foreground legacy-directory scan is introduced. Existing residue maintenance
validates legacy files, atomically inserts missing rows without overwriting current
state, validates stored rows, then removes the old files. Interruption leaves
readable duplicates. Pruning removes metadata only after its input no longer
survives. No new dependency, scheduler, migration marker or recovery service.

## Failure and deployment

Corrupt or unsupported databases fail closed without obsolete legacy fallback.
Malformed or symlinked legacy inventories are retained. New code reads both old
and new storage. The metadata-capable runner is the rollback floor after the
first database write; coordinated rollout must drain older bundles before
converted workspaces reopen. Legacy support is removable after retained legacy
checkpoints and workspaces have drained. No input schema or Web protocol changes.

## Tasks and verification

- Implement the single metadata owner and existing maintenance integration.
- Test file count, private permissions, legacy/current precedence, migration
  cancellation, corrupt database handling, quote erasure, and input pruning.
- Run focused assistant-engine/runtime and runtime-state tests, typechecks,
  complexity review, privacy review, required exact-head CI and final ReviewGPT.

## Scope

No message-policy changes, provider-input changes, canonical vault migration,
new external calls, query-cache changes or ledger compression changes.

## Local evidence

- Assistant-engine focused storage/input/residue tests: 86 passed.
- Hosted pending-input and turn-input regressions: 79 passed.
- Runtime-state security and hosted bundle tests: 71 passed.
- Assistant-engine and runtime-state typechecks passed.
- Complexity diff passed; existing residue-planner hotspots are unchanged.
- Parent review verified private context stays outside sanitized input records,
  database pages erase retired quotes, and legacy fallback cannot override a
  valid current row. External PR checks and final review follow publication.

## Completion review

Final ReviewGPT round 1 passed on 49c4720a5486 with no qualifying findings. The
captured response and model-attestation hashes match; the requested and observed
model are gpt-6-pro on the Hercules lane, with more than six minutes of capture.
The source-level review traced persistence, acknowledgement, private quote
retirement, migration, pruning and snapshot consumers. Supplemental isolated
probes covered interruption, overflow-page quote erasure and snapshot readback.
Parent final review agrees: no unresolved accepted findings remain.

An earlier too-fast response was retained as untrusted diagnostic only, and a
browser lane failed before staging. Neither was counted as a completed round.
The successful retry preserves the repository's normal review gate.

Implementation and focused proof are complete. Plan closure changes documentation
only; final-head CI and mergeability are the remaining handoff checks. This task
opens the PR without merging or deploying it.
Completed: 2026-09-06
