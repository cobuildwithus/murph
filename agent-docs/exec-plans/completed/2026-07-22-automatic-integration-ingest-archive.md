# Automatic Integration-Ingest Archival

## Goal

Finish the live-vault lifecycle introduced by PR #475: automatically replace
closed raw integration-ingest month shards with deterministic gzip archives
during abortable hosted idle maintenance, without changing logical records or
blocking foreground work.

## Constraints

- Keep canonical integration-ingest mutation and representation replacement in
  `packages/core`.
- Keep the current UTC month and any future-dated shard raw and appendable.
- Preserve exactly one physical representation per logical month.
- Prove archive equivalence before removing the raw representation, and retain
  recoverable source bytes on any failure or interruption.
- Keep gzip history reads bounded and streaming so validation and repair remain
  safe on small hosted containers.
- Run compaction before snapshot planning, under the existing workspace write
  owner, subordinate to foreground aborts and a fixed pass timeout.
- Add no queue, scheduler, state file, or second archive format. Remaining raw
  closed months are the durable derived worklist.

## Approach

1. Add a core-owned, bounded closed-month archive operation that inventories
   eligible raw shards, validates their rows, writes deterministic gzip bytes,
   verifies the archived logical content, and atomically replaces the raw
   representation.
2. Refactor gzip row reads to stream decompression through the existing JSONL
   parser and byte/row bounds instead of buffering a whole decompressed shard.
3. Invoke a bounded, abortable archive pass from hosted idle-shutdown maintenance
   immediately before the already-required workspace snapshot, so every
   successful representation replacement is published by that same checkpoint.
4. Document the live archive lifecycle and add focused corruption, duplicate
   representation, interruption, month-boundary, late-amendment, restore, and
   small-container proof.

## Verification

- Focused core archive/read tests and hosted idle-checkpoint tests.
- Direct temporary-vault proof that records and hashes survive compaction and
  restore, current-month shards stay raw, and interruption preserves one valid
  representation.
- `pnpm test:diff <changed paths>`.
- `pnpm verify:acceptance`.
- Required `coverage-write` audit, parent final review, PR CI, and ReviewGPT.

## State

- Status: active
- Started: 2026-07-22
Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
