# Oura And WHOOP Normalizer Simplify

## Goal

Replace repetitive metric emission in the Oura and WHOOP snapshot normalizers with descriptor-driven helpers while preserving the current canonical payloads exactly.

## Constraints

- No behavior change.
- Preserve emitted metric ids, units, titles, externalRef resource/facet construction, and raw artifact role naming.
- Preserve omission behavior by continuing to rely on the shared `pushObservationEvent` and `pushSample` helpers.
- Keep raw-artifact creation, timestamp selection, deletion handling, and session/activity event creation unchanged.

## Planned Scope

- `packages/importers/src/device-providers/oura.ts`
- `packages/importers/src/device-providers/whoop.ts`
- targeted `packages/importers/test/device-providers.test.ts`

## Current Read

- `normalizeOuraSnapshot` and `normalizeWhoopSnapshot` contain long runs of near-identical `pushObservationEvent(...)` and `pushSample(...)` calls.
- The repeated blocks mostly differ by metric metadata, field access, unit, title, facet, and a small number of numeric transforms such as seconds-to-minutes or milliseconds-to-minutes.
- Existing importer tests already cover the main Oura/WHOOP normalization paths, string-numeric handling, Oura deletion alias precedence, and shared raw-artifact omission behavior.

## Outcome

- Added generic descriptor-driven `emitObservationMetrics` / `emitSampleMetrics` helpers in `shared-normalization.ts`.
- Replaced the repetitive Oura daily activity/sleep/readiness/SpO2, sleep, session, and workout metric emissions with descriptor arrays plus the shared emitters.
- Replaced the repetitive WHOOP sleep, sleep-stage, recovery, cycle, and workout metric emissions with descriptor arrays plus the shared emitters.
- Added a focused regression test that pins representative Oura and WHOOP unit/facet mappings that are easy to drift during descriptor refactors.

## Verification

- `pnpm --dir packages/contracts build && pnpm --dir packages/core build && pnpm --dir packages/importers typecheck`
- `pnpm exec vitest run packages/importers/test/importers.test.ts packages/importers/test/input-validation.test.ts packages/importers/test/device-providers.test.ts --no-coverage --configLoader runner`
- Note: the package script `pnpm --dir packages/importers test` attempted the same Vitest files but could not run in this sandbox because Vite tried to write bundled config temp files under the symlinked root `node_modules/.vite-temp`. Using Vitest's runner config loader kept verification inside the writable isolated tree.
