# Automatically compress closed event ledger shards

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Automatically shrink canonical event history during ordinary hosted idle
  checkpoint maintenance without delaying foreground replies or weakening
  lossless replay, backdated writes, or rollback safety.

## Success criteria

- A true hosted idle checkpoint compresses every eligible closed event month
  through the existing core-owned archive primitive before snapshot creation.
- Current and future UTC months remain plain JSONL; canonical reads, backdated
  writes, hosted replay, retry, and rollback keep using logical event paths.
- A foreground wake or shutdown interrupts in-progress archive work, leaves one
  valid physical representation, and reaches the existing foreground path.
- Invalid or conflicting shards remain untouched and observable without
  blocking the checkpoint or healthy later maintenance forever.
- Focused core/runtime tests, package typechecks, direct compression evidence,
  required ReviewGPT gates, and exact-head CI pass on the PR candidate.

## Scope

- In scope: abortable initial event-shard compression, hosted idle-maintenance
  activation, structured aggregate diagnostics, focused tests, the existing
  storage/runtime owner contracts, and the related changelog item.
- Out of scope: deleting canonical event rows, compressing the open month,
  changing event schemas, adding a scheduler or persisted compaction cursor,
  recompressing already archived shards, or changing integration-ingest policy.

## Constraints

- Technical constraints: use the existing canonical write lock and idle
  maintenance owner; keep publication lossless, verified, atomic, bounded, and
  abortable; derive unfinished work from remaining plain closed shards.
- Product/process constraints: Product UX Patch. Outcome: established members
  with older event history carry smaller encrypted checkpoints automatically.
  Reaches: ordinary hosted idle checkpointing and later event reads/writes.
  Proof: a production-format encrypted snapshot is smaller after real event
  archiving and restores with the archived event readable; true idle invokes
  that real core path, while a wake observed during its atomic streaming write
  preserves the raw shard and skips later maintenance. No member action,
  message, file request, or new UI is introduced.

## Risks and mitigations

1. Risk: compression or validation delays a newly accepted message.
   Mitigation: share idle maintenance's existing wake signal and one total
   archive timeout, use streaming gzip/verification, and skip all archive work
   whenever member-visible work is already pending.
2. Risk: interruption leaves both raw and gzip copies or removes the source
   before the archive is proven.
   Mitigation: publish only an atomically prepared, fully re-read archive and
   remove the raw file only after verification; exact duplicate residue remains
   repairable while mismatches stay fail closed.
3. Risk: one malformed historical shard starves valid later months or blocks
   checkpointing.
   Mitigation: report a bounded blocked-shard count, leave that shard intact,
   continue independent months under the same owner lock, and keep runtime
   maintenance fail open with secret-safe diagnostics.
4. Risk: an older warm runtime cannot read a gzip written by a new runtime.
   Mitigation: the dual-format reader release is already fully deployed; this
   PR changes only writer activation and documents that reader release as the
   rollback floor after the first archive is published.

## Tasks

1. [completed] Make initial event archive creation streaming, abortable, and
   independently fail-open per closed shard while preserving atomic receipts.
2. [completed] Invoke it from the existing hosted idle archive slice with the
   same pending-work, wake, shutdown, and total-time budget as current archive
   maintenance; emit bounded aggregate diagnostics.
3. [completed] Add focused core and hosted-runtime proof, update live owner docs,
   and update the existing smaller-checkpoints changelog item.
4. [in progress] Run local proof, push a draft PR, complete preliminary and final
   ReviewGPT gates plus exact-head CI, merge, and retire the task worktree.

## Decisions

- Reuse hosted idle maintenance rather than creating a cron, queue, daemon,
  migration service, feature flag, or persisted cursor.
- Remaining plain closed shards are the durable worklist; successful archive
  replacement deletes work instead of recording another completion state.
- Validate JSONL in one pass over decoded chunks; retain only unfinished line
  fragments and join them once, without a cursor or retry state.
- Share one 30-second idle archive budget across event and integration history
  so activation does not extend the checkpoint publication bound.
- Compress event history before integration history because this activation is
  the new work; both converge over later true-idle passes and retain wake
  preemption.
- Preserve the existing changelog item and add this PR as the second source for
  the completed smaller-checkpoints outcome.

## Verification

- Commands to run: focused `@murphai/core` event-ledger tests; focused
  `@murphai/assistant-runtime` idle-maintenance tests; the Cloudflare local
  encrypted-snapshot test; all three affected package typechecks;
  `git diff --check`; required ReviewGPT passes; exact-head GitHub Actions.
- Expected outcomes: gzip is smaller and byte-equivalent, the raw closed shard
  disappears only after verification, current-month JSONL remains, a wake
  aborts archiving and preserves the pending notification, a long malformed
  month cannot starve later event or integration history, checkpointing stays
  fail open on archive errors, and all exact-head required checks pass.
