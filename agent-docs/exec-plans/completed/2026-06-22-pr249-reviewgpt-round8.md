# PR 249 ReviewGPT Round 8 Follow-Up

## Goal

Resolve accepted ReviewGPT round 8 high-severity findings on PR 249 without broad schema churn.

Success criteria:

- Deterministic import IDs include every input-derived field persisted under immutable integration-ingest equality, including source, normalized provenance, evidence metadata, and first-class receipt data.
- New first-class raw ingest receipts allow dense `debug_temporary` evidence to be retention-pruned without reintroducing duplicate receipt files; legacy receipt artifacts remain supported.
- Provider snapshot import no longer manufactures raw artifact roles that core intentionally rejects for debug-only evidence.
- Omitted `importedAt` derives from stable delivery timestamps or fails for timestamp-less evidence-only imports; it never falls back to vault creation time for fresh imports.
- The manifest-only evidence-catalog suggestion is re-evaluated, but only implemented if direct inspection shows it is smaller and safer than targeted fixes.
- Focused and diff-wide verification pass before committing and rerunning ReviewGPT.

## Scope

- `packages/core/src/mutations.ts`
- `packages/core/src/wearable-storage-migration.ts`
- `packages/importers/src/device-providers/import-device-provider-snapshot.ts`
- Focused core/importer tests for identity, retention, fallback, and omitted timestamp behavior
- Review artifact `audit-packages/pr-249-round-8.md`

## Notes

- Preserve existing vaults, legacy raw receipt artifacts, and durable evidence references.
- Do not switch the journal to manifest-only evidence catalog storage unless it eliminates more code than it adds in this round and preserves existing validation/query behavior.
- Current pushed head `c44f19ddf` has green PR checks after rerunning one external Wrangler/Docker startup failure.
- Decision: keep the existing journal plus manifest model. The accepted findings are fixed with narrower compatibility-preserving changes; a manifest-only evidence catalog would be broad schema churn in this PR.
- Implemented:
  - Deterministic import IDs now cover persisted source, normalized provenance, evidence metadata, and first-class receipt data.
  - Omitted `importedAt` now derives from `ingestReceipt.observedAt` or explicit event/sample timestamps, and timestamp-less evidence-only imports fail validation instead of using vault creation time.
  - Dense debug retention accepts first-class receipt coverage from raw import manifest provenance while preserving legacy physical receipt artifacts.
  - Provider snapshot imports no longer assign a sole raw artifact role to every event.
- Verification passed:
  - Focused core/importer vitest files for device import, wearable storage migration, provider snapshots, and wearable evidence.
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - `bash scripts/workspace-verify.sh test:diff ...` for the round 8 working set.
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
