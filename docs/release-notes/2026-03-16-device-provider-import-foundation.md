# 2026-03-16 Device-provider import foundation

## Summary

Runtime-visible package seam plus contract/docs update for normalized device/provider imports. This change adds a provider-agnostic device-batch write path in `@healthybob/core`, a registry-based adapter seam in `@healthybob/importers`, and a WHOOP-first normalizer that can be followed by Garmin/Oura-style adapters.

## What changed

- Added shared `externalRef` provenance for canonical event and sample records so normalized device/provider imports can carry upstream `system`, `resourceType`, `resourceId`, optional `version`, and optional `facet` metadata.
- Added `core.importDeviceBatch(...)` plus inline raw-payload staging so API snapshots can be persisted immutably under `raw/integrations/<provider>/YYYY/MM/<transformId>/` with manifests and audit coverage.
- Added a provider registry/import seam in `@healthybob/importers` and a WHOOP-first adapter that maps sleeps, recoveries, cycles, and workouts into baseline `sleep_session`, `activity_session`, `observation`, `hrv`, `respiratory_rate`, and `temperature` records without fabricating unsupported minute-level streams.
- Updated architecture/contract/safe-extension docs to reserve `raw/integrations/**` and document the composable provider-adapter pattern.

## Verification

- Added focused tests for deterministic device-batch import behavior in `packages/core/test/device-import.test.ts`.
- Added focused tests for WHOOP normalization and custom provider composition in `packages/importers/test/device-providers.test.ts`.
- In this offline audit container, package-manager-backed `pnpm` verification was unavailable, so verification here was limited to code review plus parse-level TypeScript checks on the changed source files.

## Follow-up

- Add runtime OAuth/webhook/scheduler services outside the vault for WHOOP account connection and background sync.
- Add concrete Garmin/Oura adapters on top of the shared provider registry once their normalization rules are finalized.
