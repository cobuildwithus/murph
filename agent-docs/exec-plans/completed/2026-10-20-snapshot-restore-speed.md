# Reduce workspace restore overhead

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Goal

Reduce cold workspace transfer time while preserving every selected archive byte,
query-cache reuse, authentication before extraction, cancellation, atomic durable
root replacement, and compatibility with existing encrypted v2 snapshots.

## Success criteria

- Measured size/restore benefit without excessive checkpoint cost.
- Production snapshot round trips, byte readback, failure/cancellation tests,
  Cloudflare typecheck and parent review pass.

## Scope

- In scope: bounded compression experiments and a proven improvement in the
  existing Cloudflare snapshot owner, synthetic proof and documentation.
- Out of scope: deleting canonical data or the query cache, encryption changes,
  new storage owners, private snapshot downloads, production deployment.

## Constraints

- Snapshot-local creates encrypted tar/zstd objects; the snapshot port downloads
  and authenticates them before extraction. Runtime State owns selection.
- Read-only diagnostics identified transfer waiting as the main cost. Private
  records remain outside artifacts and fixtures.
- Existing readers must accept new objects and old objects remain readable.

## Product UX (Patch)

Outcome: faster first response after a cold wake with complete prior context.
Reaches: small/large workspaces, old/new snapshots, interrupted/corrupt restores.
Proof: production create/restore round trips, byte readback, existing failure and
cancellation tests, paired synthetic transfers. Warm reuse remains unchanged.

## Risks and mitigations

1. Larger windows consume memory: cap below the existing decoder limit and
   measure checkpoint time and memory.
2. Independent compressed media cannot shrink: retain an incompressible control
   and do not forecast synthetic savings as production results.
3. Removing cache state shifts work into rebuilds: preserve selection/freshness.

## Tasks

1. Inspect bounded snapshot composition and restore timing metadata.
2. Measure current and candidate compression on synthetic cache/ledger-shaped data.
3. Implement only a proven improvement and focused compatibility proof.
4. Run focused tests, typecheck, complexity review and document limitations.
5. Review the diff, close the plan and create a scoped commit.

## Decisions

- Current compression is level 9 with two workers. Measure longer-window
  matching before changing defaults; retain the existing snapshot format.

## Verification

- Added regression fails under the original compressor (about 24 MiB for three
  copies of an 8 MiB payload), then passes with long-distance matching and exact
  SHA-256 readback of all restored files.
- Snapshot-local, snapshot-interruption and runner-platform focused suites:
  350 tests passed. Existing legacy short-window archive, corruption, tag/hash,
  durable-root preservation, cancellation and decoder/extractor tests pass.
- Cloudflare typecheck passed after generating the fresh checkout's Prisma
  client with `pnpm --dir apps/web prisma:generate`. The initial missing-client
  failure matches existing Frog issue #2378; no new workaround was needed.
- Changelog generation and `changelog-page.test.tsx`: 10 tests passed.
- `pnpm complexity:diff`: passed, no debt increase or changed hotspots above 20.
- Paired production writer/restore-port benchmark: three measured alternating
  pairs plus warmups per synthetic fixture, 600 files and 120 MiB unpacked,
  paced at 10 MiB/s. Distant repeated data shrank from 50.5 to 16.9 MB;
  median restore fell from 5.004 to 1.796 seconds. Creation rose from 109 to
  123 ms. Independent data stayed at 50.5 MB; restore changed from 5.006 to
  5.116 seconds and creation from 110 to 190 ms. Every file passed readback.
- A separate synthetic SQLite/JSON compression probe measured compressor peak
  RSS of about 190 MB versus 116 MB with the original settings. This is a local
  observation, not a worst-case bound; the decoder window is capped at 128 MiB.
- Parent review: production change is one compression argument; archive byte
  selection, protocol, crypto, extraction and cancellation are unchanged.
  Product UX: Ready for the measured local boundary; production savings depend
  on repeated data and require native Linux/live observation after rollout.
- Changelog item: `smaller-workspace-restores`, with no numeric production claim.
- No production mutations, snapshot downloads, deployment, push or PR creation.
  External ReviewGPT and exact-head CI remain PR delivery gates, not local proof.
Completed: 2026-10-20
