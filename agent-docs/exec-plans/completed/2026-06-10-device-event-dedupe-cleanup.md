# Device Event Dedupe Cleanup Primitive

Created: 2026-06-10
Status: completed

## Problem

Vaults that imported wearable data before device imports became idempotent on
externalRef (#116) carry duplicate device events (one hosted vault: ~4,100
duplicates across ~341 provider records). The importer fix stops new
duplicates but old ones are outside every trailing poll window, so they never
self-heal. Affected hosted users need a safe, repeatable cleanup they can run
by asking their Murph.

## Change

- `packages/core`: `dedupeDeviceEventsByExternalRef({ vaultRoot, apply })` —
  groups live device events per monthly shard by the same externalRef identity
  the importer reconciles on, keeps the spine-latest copy per group, and
  appends tombstone spine revisions for the rest (same shape as `deleteEvent`,
  append-only). Dry-run by default; `apply: true` writes one canonical batch
  with one `event_delete` audit record. Idempotent.
- `packages/vault-usecases`: `dedupeDeviceImportEventRecords` usecase wrapping
  the core port with CLI error translation.
- `packages/cli`: `vault-cli event dedupe-device-imports [--apply]`, dry-run
  report by default; regenerated `incur.generated.ts` / `config.schema.json`.

## Safety decisions

- Revision-visibility guard: any duplicate id that has a higher spine revision
  anywhere in the ledger than the device-filtered view can see (e.g. a user
  edit that dropped the device source or externalRef) is skipped entirely and
  surfaced as `skippedRevisedElsewhereCount`, never tombstoned.
- Duplicates of one provider record split across different monthly shards
  (pre-#116 occurredAt drift) are not collapsed; this mirrors the importer's
  per-shard reconcile scope and stays visible in the dry-run report.

## Verification

- Core tests: dry-run/apply/idempotency/no-op coverage in
  `packages/core/test/device-import.test.ts`.
- Built-CLI scenario: seeded vault with 2 legacy duplicates → dry-run reports
  2, `--apply` tombstones 2 + audit, rerun reports 0.
Updated: 2026-06-10
Completed: 2026-06-10
