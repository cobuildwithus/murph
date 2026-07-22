# Compress closed vault shards and portable snapshots

Status: completed
Created: 2026-07-21
Updated: 2026-07-22

## Goal

- Losslessly reduce steady-state vault and transfer size by automatically
  compressing closed integration-ingest shards and using an appropriate solid
  compression level for hosted/portable snapshot output.

## Success criteria

- Closed integration-ingest months compact automatically in portable bundle
  staging while the source vault and current month remain appendable.
- Readers, validators, repair/amendment paths, and packaging include supported
  compressed canonical shards without data loss or silent omission.
- Hosted/portable snapshot compression improves measurably without changing
  restore semantics or snapshot contents.
- Focused round-trip, boundary, and packaging tests plus required verification,
  audits, acceptance, and PR review pass.

## Scope

- In scope:
  - automatic closed-month integration-ingest compaction in portable staging
  - canonical compressed-shard bundle inclusion and round-trip reads
  - moderate hosted snapshot zstd tuning where benchmark evidence supports it
  - focused tests and durable layout/operator documentation
- Out of scope:
  - lossy data reduction
  - compacting the active/current month
  - destructive mutation of unrelated vault records
  - a new background service or archive format outside the existing contract

## Constraints

- Reuse the vault contract's supported `.jsonl.gz` / `.jsonl.zip` semantics.
- Make replacement atomic and fail closed on verification mismatch.
- Preserve immutable-record identity, amendment behavior, and restore support.
- Keep generic archives excluded while explicitly including contract-owned
  compressed canonical shards.

## Risks and mitigations

1. Risk: packaging excludes newly compressed canonical shards.
   Mitigation: change the classifier narrowly and test canonical compressed
   paths alongside generic archive exclusions.
2. Risk: compaction races an append or targets the active month.
   Mitigation: run under the existing canonical mutation owner and select only
   fully closed months with deterministic boundary tests.
3. Risk: higher snapshot compression harms recurring runtime latency.
   Mitigation: benchmark a moderate zstd level, keep the change bounded, and
   retain the same tar/restore contract.

## Tasks

1. Trace current shard readers/writers/amenders, snapshot emitters, packaging
   filters, and recent remote-main changes.
2. Add closed-month round-trip, current-month exclusion, and bundle
   inclusion regressions.
3. Implement the smallest automatic compaction owner and moderate snapshot
   compression tuning supported by measurement.
4. Update durable layout/operator docs and direct compression proof.
5. Run focused and acceptance verification plus required audit and ReviewGPT
   gates, then publish the dedicated PR.

## Verification

- `pnpm test:diff <touched paths>` or truthful owner coverage equivalents
- temporary-vault compaction/read/amend/package/restore scenarios
- affected package and app typechecks
- `pnpm verify:acceptance`
- required `coverage-write` audit and PR ReviewGPT loop

## Progress

- Worktree created from current `origin/main`.
- The package owner now stages closed JSONL shards as deterministic gzip while
  leaving the source and active month untouched; existing canonical gzip/ZIP
  shards are explicitly included and generic archives remain excluded.
- Hosted snapshot zstd level moved from 1 to the measured moderate level 3.
- The required coverage audit added future-month, source-immutability,
  deterministic-gzip, oversize fail-open, and representation-conflict cases;
  its follow-up found no remaining gaps.
- Focused shell, CLI, and Cloudflare snapshot checks pass, as does the complete
  `pnpm verify:acceptance` suite.
Completed: 2026-07-22
