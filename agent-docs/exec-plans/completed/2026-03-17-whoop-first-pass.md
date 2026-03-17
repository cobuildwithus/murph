# WHOOP first-pass integration

Status: completed
Created: 2026-03-17
Updated: 2026-03-17
Completed: 2026-03-17

## Goal

- Port the provided device-provider import foundation into the current tree so WHOOP snapshot payloads can normalize into canonical event/sample writes through `@healthybob/core` while preserving immutable raw provider snapshots.

## Success criteria

- `@healthybob/contracts` exposes shared provider provenance fields for canonical events and samples.
- `@healthybob/core` exposes `importDeviceBatch(...)` and can stage raw provider snapshots from memory under `raw/integrations/**`.
- `@healthybob/importers` exposes a provider registry plus a WHOOP adapter and generic snapshot import entrypoint.
- Focused tests cover the core device-batch seam and the WHOOP importer surface.
- Architecture and contract docs describe the new storage and provenance rules without clobbering current unrelated doc work.

## Scope

- In scope:
  - contracts and generated schema updates for shared `externalRef` provenance
  - core device-batch write seam and inline raw artifact staging
  - importer provider registry/types/importer plus WHOOP adapter
  - focused tests and public docs for the new seam
- Out of scope:
  - OAuth/token storage
  - webhook ingestion or scheduled sync services
  - additional providers beyond WHOOP

## Constraints

- Preserve canonical writes inside `@healthybob/core`.
- Preserve append-only ledgers and raw immutability.
- Merge on top of current dirty `ARCHITECTURE.md` and `docs/architecture.md` edits without reverting unrelated work.
- Run required repo verification plus completion-workflow audit passes before handoff.

## Tasks

1. Port the archive changes for `contracts`, `core`, and `importers`.
2. Add the focused WHOOP/device-provider tests.
3. Merge the required architecture/contract docs and add the release note.
4. Run checks and audit passes, fix regressions, and commit only touched files.
