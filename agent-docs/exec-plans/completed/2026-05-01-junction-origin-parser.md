# Junction origin parser real-payload support

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

Make Junction source attribution resolution accept real Junction payload shapes across summaries, timeseries, webhook payloads, and source projection.

Success criteria:

- One shared `resolveJunctionOrigin(record, fallback)` helper owns Junction origin path resolution.
- `sourceProviderSlug` accepts flat fields, nested `source` fields, provider slug aliases, and grouped source fallbacks.
- `sourceType`, source device id, and source app id accept the requested flat and nested paths.
- Raw source device/app ids are used only to derive opaque source instance ids and are not persisted.
- Source projection keys hash Junction user id, provider connection id, provider slug, and source device/app ids when present; provider slug-only fallback is metadata-visible.
- Focused Junction importer and device-syncd tests prove nested/grouped/webhook/source projection attribution.

## Scope

Expected files:

- `packages/importers/src/device-providers/junction-origin.ts`
- `packages/importers/src/device-providers/junction.ts`
- `packages/importers/src/device-providers/index.ts`
- `packages/importers/package.json`
- `packages/importers/test/device-providers-junction.test.ts`
- `packages/device-syncd/src/providers/junction-client.ts`
- `packages/device-syncd/src/providers/junction.ts`
- `packages/device-syncd/test/junction-provider.test.ts`

## Constraints

- Preserve active Junction PR3/foundation work and unrelated dirty checkout edits.
- Do not persist raw upstream device/app/user identifiers in origin contracts, source projection summaries, logs, docs, or fixtures; only opaque hashes and fallback metadata are allowed.
- Keep `externalRef.system = "junction"` and source attribution under `DeviceDataOrigin`.
- Use package public entrypoints for cross-package helper imports.

## Verification

Passed:

- `pnpm --dir packages/importers typecheck`
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir packages/importers exec vitest run test/device-providers-junction.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/device-syncd exec vitest run test/junction-provider.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/importers test:coverage`
- `pnpm test:smoke`
- `git diff --check`

Blocked / unrelated red in current checkout:

- `pnpm --dir packages/device-syncd test:coverage` ran 399 tests; 397 passed, with unrelated failures in `test/config.test.ts` (missing Junction env in connect-target config read) and `test/store.test.ts` (webhook trace minimization row returns null).
- `pnpm typecheck` failed in `packages/cli` on existing device connect-target exports / `sourceProviderSlug` option mismatch.
- `bash scripts/workspace-verify.sh test:diff ...` failed in the same `packages/cli` typecheck target.

Commit status:

- No scoped commit. The touched Junction files overlap broad active uncommitted device-provider handler / grouped-timeseries work in this checkout, so staging these files would include changes outside this task.

Current source-projection-key state:

- Junction provider connection parsing now preserves provider connection id plus source device/app ids for transient hashing.
- Source projection keys now include Junction user id, provider connection id, source provider slug, and source device/app ids when available.
- Slug-only fallback keeps the prior user+slug basis and marks `sourceInstanceKeyFallback` in sanitized source metadata.
- Hosted browser resource counts ignore the fallback metadata key.

Current source-projection-key verification:

- Passed: `pnpm --dir packages/importers typecheck`
- Passed: `pnpm --dir packages/importers exec vitest run test/device-providers-junction.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir packages/device-syncd exec vitest run test/junction-provider.test.ts --config vitest.config.ts --no-coverage`
- Passed: `git diff --check` on the source-key boundary files.
- Blocked: `pnpm --dir packages/device-syncd typecheck`, `pnpm --dir apps/web typecheck`, the focused hosted-web Vitest, and root `pnpm typecheck` all stop on unrelated dirty `packages/device-syncd/src/providers/strava.ts` syntax errors owned by the active provider-handler row.
Completed: 2026-05-01
