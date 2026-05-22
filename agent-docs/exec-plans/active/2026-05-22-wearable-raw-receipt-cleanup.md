# Wearable Raw Receipt Cleanup

Status: active
Created: 2026-05-22
Updated: 2026-05-22

## Goal

- Finish the wearable raw ingest cleanup by making the payload-free object an
  explicit receipt schema, keeping raw provider evidence in raw artifacts only,
  compacting future inline raw JSON writes, and removing the duplicate persisted
  canonical-record raw artifact.

## Success criteria

- New device-provider imports emit `wearable.raw_ingest_receipt.v1` receipts
  through `buildWearableRawIngestReceipt`.
- Receipt IDs keep the existing provider/account/connection/resource/event/hash
  formula and do not include raw artifact roles or counts.
- Receipt builder input is named `payloadForHash`; provider payload bytes are
  not stored in the receipt.
- Core inline object raw artifacts are stored as stable compact JSON plus one
  trailing newline.
- Device-provider snapshot preparation still returns in-memory
  `canonicalWearableRecords`, but no longer persists
  `wearable-canonical-records:*` raw artifacts.
- Focused tests cover fallback provider evidence, provider-only receipt roles,
  receipt schema name, compact raw content, and the canonical-artifact removal.

## Scope

- In scope:
- `packages/importers/src/device-providers/raw-ingest-receipt.ts`
- `packages/importers/src/device-providers/import-device-provider-snapshot.ts`
- Importer public exports/types and focused importer tests.
- `packages/core/src/mutations.ts`
- Focused core raw artifact storage tests.
- Out of scope:
- Existing vault raw artifact rewrites or deletions.
- Gzip, chunking, timeseries tables, raw indexes, or Junction fetch-policy
  changes.

## Constraints

- Technical constraints:
- Preserve canonical event/sample ID behavior; only future raw artifact file
  bytes/import paths may change from JSON compacting.
- Keep provider raw artifacts as the durable source evidence.
- Do not use broad casts to hide TypeScript errors.
- Product/process constraints:
- Preserve unrelated dirty worktree edits and active ledger rows.
- Do not expose local account names, home paths, secrets, raw health payloads,
  provider credentials, or direct user identifiers in docs, logs, commits, or
  final notes.

## Risks and mitigations

1. Risk: Renaming the exported receipt type breaks stale callers.
   Mitigation: Search/update all repo callsites and keep focused typecheck.
2. Risk: Removing the canonical-record raw artifact drops a hidden consumer.
   Mitigation: Search consumers and preserve the in-memory
   `canonicalWearableRecords` return value.
3. Risk: Compacting raw JSON changes future raw artifact hashes/import paths.
   Mitigation: Do not migrate or rewrite existing vault artifacts; add a core
   test that documents the future-write behavior.

## Tasks

1. Update receipt type/builder names and schema version.
2. Update snapshot import wiring, exports, and type references.
3. Remove persisted canonical-record raw artifact creation while keeping the
   in-memory canonical projection.
4. Compact core inline raw content and add focused proof.
5. Update importer tests for receipt schema, fallback evidence, provider-only
   roles, and no canonical raw artifact.
6. Run verification, completion audits, and scoped commit.

## Decisions

- Use `wearable.raw_ingest_receipt.v1` rather than `wearable.raw_ingest.v2`
  because the stored object is now a receipt/hash/provenance object.
- Keep the receipt ID prefix and hash inputs unchanged from the prior envelope
  builder.
- Do not migrate old raw artifacts; existing `wearable.raw_ingest.v1` files
  remain historical data.

## Verification

- Commands to run:
- Focused importer/core Vitest targets while iterating.
- `pnpm --dir packages/importers test:coverage`
- `pnpm --dir packages/core test:coverage`
- `pnpm typecheck`
- `pnpm test:smoke`
- `git diff --check`
- Scoped privacy/identifier scan over touched files.
- Required completion audits: `security-privacy-review`, `coverage-write`, and
  `task-finish-review`.
- Expected outcomes: all required checks pass, or unrelated blockers are
  documented with exact failing targets.
