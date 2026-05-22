# Make wearable raw envelopes payload-free receipts

Status: active
Created: 2026-05-22
Updated: 2026-05-22

## Goal

- Make wearable raw ingest envelopes payload-free receipts so dense provider snapshots live only in raw provider artifacts, while canonical records and metric projections remain the product/query layer.

## Success criteria

- `WearableRawIngestEnvelope` no longer stores the sanitized provider snapshot payload.
- Device-provider imports still compute a stable payload hash and attach a raw-envelope receipt artifact.
- The receipt records small raw-artifact metadata such as role/count, not timeseries sample payloads.
- Focused importer tests prove Junction dense timeseries are not duplicated inside the envelope.
- Package verification and required completion audits pass or any unrelated blockers are documented.

## Scope

- In scope:
- `packages/importers` raw ingest envelope type/build path.
- Device-provider snapshot import wiring for raw artifact receipt metadata.
- Focused importer tests covering the receipt shape and large Junction payload non-duplication.
- Out of scope:
- Raw artifact chunking, gzip/byte artifact storage, new timeseries tables, or metric ingest policy systems.
- Provider normalizer rewrites beyond the minimum needed to pass artifact roles into the receipt.

## Constraints

- Technical constraints:
- Keep raw provider data in existing `rawArtifacts` archive primitives.
- Preserve payload hashing for dedupe/provenance, but do not persist the payload in the envelope.
- Avoid new storage architecture or search/query indexing over raw artifacts.
- Product/process constraints:
- Preserve unrelated dirty worktree edits and active ledger rows.
- Do not expose raw provider payloads, secrets, local paths, or direct identifiers in logs, docs, tests, or handoff.

## Risks and mitigations

1. Risk: A downstream path expects `rawIngestEnvelopes[*].payload`.
   Mitigation: Search all usages and update tests/callers to the receipt contract; keep `payloadHash` stable.
2. Risk: The receipt becomes a new manifest subsystem.
   Mitigation: Store only role/count metadata now; rely on existing raw artifact storage for evidence.

## Tasks

1. Inspect current raw-envelope, snapshot-import, and provider tests.
2. Change the envelope type/builder to receipt metadata only.
3. Thread raw artifact roles from snapshot import into the receipt.
4. Update focused importer tests.
5. Run verification and required audits.

## Decisions

- Raw envelope remains an audit receipt and hash carrier, not a raw data store.
- No raw chunking, gzip support, or new timeseries storage abstraction in this change.

## Verification

- Commands to run:
- Focused importer Vitest targets covering raw envelopes and device provider snapshots.
- `pnpm --dir packages/importers test:coverage`
- `pnpm typecheck`
- `pnpm test:smoke`
- `git diff --check`
- Scoped privacy scan over touched files.
- Expected outcomes: all required checks pass, or unrelated dirty-worktree failures are reported with scope.
