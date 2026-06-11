# `@murphai/importers`

Workspace-private ingestion adapters for documents, meals, explicit CSV sample ledgers, and provider snapshots. Importers may parse inputs and prepare metadata, but they must route all canonical writes through `@murphai/core`.

Adding a new wearable provider? Pair the importer work with the transport half described in `docs/device-provider-contribution-kit.md` at the repo root, and use the scaffolds listed in `docs/templates/README.md` so the provider lands through both seams together.

## Baseline Scope

- `document` import reads file metadata only and forwards a normalized document payload.
- `meal` import inspects photo/audio attachments and forwards a normalized meal payload.
- `samples` CSV import parses tabular sample rows and forwards an explicit raw/debug sample-ledger batch payload.
- No OCR, transcription, or structured lab parsing is performed in the baseline.

## Built-in Device Providers

`createImporters()` and `prepareDeviceProviderSnapshotImport()` ship with built-in adapters for `whoop`, `oura`, and `strava`. Garmin data is supported exclusively through the `junction` provider.

Provider transport stays separate from normalization. Each adapter accepts one provider snapshot, preserves only provider evidence that is needed for replay or product facts, and promotes fields that fit the current canonical device batch surface. High-frequency provider telemetry should be reduced in memory to compact display-grade events or metric facts instead of being persisted as full sample arrays.

The wearable raw ingest envelope is only a receipt: it stores the payload hash and the raw artifact roles for replay/audit, but it must not store another copy of the provider payload. Raw provider data belongs in the adapter's raw artifacts, and product/query surfaces should consume compact events, metric facts, or derived metric read models instead.

If a provider adapter returns a non-empty snapshot without any provider-owned raw artifacts, the import bridge adds one fallback `provider-snapshot` raw artifact before building the receipt. Adapters that intentionally drop dense provider payloads must sanitize those dropped sections or emit a tiny compact artifact first, so the fallback never re-stores the firehose under a generic role.

Built-in providers now share one descriptor surface in `device-providers/provider-descriptors.ts`. That descriptor is the single source for provider key, transport modes, OAuth paths/scopes, webhook support, default sync windows, metric families, and source-priority hints, so importers and `device-syncd` no longer drift on provider metadata.

For the next provider, importers should only need:
- one shared descriptor entry
- one adapter under `src/device-providers`
- tests that prove descriptor and adapter alignment

Auth, webhook preflight/admin behavior, token storage, and hosted control-plane
wiring stay outside this package. Importers own normalization only.

## Core Integration Seam

This package still supports an injected write port for tests and alternate callers, but its default workspace wiring now targets the concrete `packages/core` exports.

The assumed core surface is:

- `importDocument(payload)`
- `addMeal(payload)`
- `importSamples(payload)`

Importers never write vault files directly. They validate inputs, inspect source files, normalize payloads, and delegate the final canonical mutation to the injected core port.
