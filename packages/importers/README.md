# `@murph/importers`

Owns ingestion adapters for documents, meals, and sample streams. Importers may parse inputs and prepare metadata, but they must route all canonical writes through `@murph/core`.

## Baseline Scope

- `document` import reads file metadata only and forwards a normalized document payload.
- `meal` import inspects photo/audio attachments and forwards a normalized meal payload.
- `samples` CSV import parses tabular sample rows and forwards a normalized batch payload.
- No OCR, transcription, or structured lab parsing is performed in the baseline.

## Built-in Device Providers

`createImporters()` and `prepareDeviceProviderSnapshotImport()` ship with built-in adapters for `whoop`, `oura`, and `garmin`.

Provider transport stays separate from normalization. Each adapter accepts one provider snapshot, preserves the upstream payloads as raw artifacts, and only promotes fields that fit the current canonical device batch surface.

The Garmin adapter keeps one provider key, `garmin`, and expects a snapshot with optional `profile`, `dailySummaries`, `epochSummaries`, `sleeps`, `activities`, `activityFiles`, `womenHealth`, and `deletions` collections. Unsupported or file-shaped Garmin payloads are still retained as raw artifacts so future FIT/GPX/TCX expansion can happen without changing the importer seam.

## Core Integration Seam

This package still supports an injected write port for tests and alternate callers, but its default workspace wiring now targets the concrete `packages/core` exports.

The assumed core surface is:

- `importDocument(payload)`
- `addMeal(payload)`
- `importSamples(payload)`

Importers never write vault files directly. They validate inputs, inspect source files, normalize payloads, and delegate the final canonical mutation to the injected core port.
