Goal (incl. success criteria):
- Add `vault-cli event import-jsonl` so agents can import many canonical event payloads in one transactional batch instead of one `event import-json` process per row.
- Reuse the existing device-batch seams: per-payload validation via the same strict event contract path as single import, externalRef idempotent reconcile (system + resourceType + resourceId + facet), one WriteBatch commit, one audit record.
- Dry-run by default with `--apply` to write (same convention as `event dedupe-device-imports`).
- Success means a JSONL file of canonical event payloads imports in one CLI call with counts: received, created, skipped existing, superseded; invalid lines reject the whole batch with per-line errors; re-running the same input is idempotent.

Constraints/Assumptions:
- Only `packages/core` writes canonical vault data; CLI and vault-usecases stay composition-only.
- No new dedupe machinery: reuse `reconcileDeviceEventEntriesByExternalRef` and `buildJsonlAppendPlan`.
- Same public-write kind gate as generic `event import-json` (`PUBLIC_EVENT_WRITE_KINDS`).
- Atomic batch: any invalid payload rejects the whole batch before any write.
- Keep CLI assistant surface contract within its 45k char budget.

Key decisions:
- Input shape is the same canonical event payload as `event import-json`, one JSON object per line — not the device-provider seed shape — so agents reuse `event scaffold` knowledge and payloads round-trip exactly (rawRefs/externalRef preserved).
- No `--provider` flag: externalRef.system carries provenance and the reconcile index does not filter by source, so backfills and live device syncs stay mutually idempotent.
- Dry-run holds the canonical write lock like apply does, so reported counts are consistent with what apply would do.
- Counts come from the reconcile + append plan rather than a second scan.

State:
- Complete.

Done:
- Seam review: single upsertEvent path, importDeviceBatch reconcile/append plan, CLI command factories, manifest leaf-command registry.
- Core `importEventBatch` (atomic validate, externalRef reconcile, one WriteBatch, one audit, dry-run default), vault-usecases `importEventRecordsFromJsonl` (JSONL parse, line-number mapping, failures folded into the error message), CLI `event import-jsonl` + manifest/docs/generated artifacts.
- Explicit event ids rejected in batch payloads (per-shard dedupe cannot honor caller ids safely); externalRef is the only re-import identity.
- Tests: 9 core + 3 CLI; simplify/coverage-write/task-finish-review audits run and resolved; typecheck, test:diff, test:smoke green; direct 700-row scenario ~0.5s with clean validate.

Now:
- finish-task commit + PR.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/core/src/domains/events/ledger.ts (export buildPublicEventRecordForImport)
- packages/core/src/mutations.ts (importEventBatch)
- packages/core/src/public-mutations.ts, packages/core/src/index.ts
- packages/vault-usecases/src/usecases/event-record-mutations.ts (importEventRecordsFromJsonl)
- packages/vault-usecases/src/records.ts
- packages/cli/src/commands/event.ts (event import-jsonl)
- packages/cli/src/vault-cli-command-manifest.ts, packages/cli/src/incur.generated.ts
- packages/core/test/*, packages/cli/test/*
Status: completed
Updated: 2026-06-10
Completed: 2026-06-10
