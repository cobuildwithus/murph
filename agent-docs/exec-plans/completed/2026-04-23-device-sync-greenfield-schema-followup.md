# Collapse device-sync schema versioning back to a single greenfield schema

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Keep the new device-sync replay-fence revision columns, but remove the schema-version bump and legacy upgrade-path machinery because this repo is treated as greenfield.

## Success criteria

- `packages/device-syncd` exposes the revision columns in the base schema while reporting schema version `1`.
- No schema-migration-only helpers or legacy backfill code remain for the dropped version `2` path.
- Focused tests and repo-required verification pass with schema-version expectations aligned back to a single greenfield version.

## Scope

- In scope:
- `packages/device-syncd/src/store/schema.ts`
- directly coupled `packages/device-syncd/test/{service,store}.test.ts`
- any directly coupled device-syncd test fixtures that need expectation-only updates
- this plan and the coordination-ledger row for the lane
- Out of scope:
- replay-fence behavior changes beyond removing the greenfield-unneeded upgrade path
- hosted-runtime, apps/web, or vault-sync logic

## Constraints

- Preserve the revision-column replay fence introduced in the prior device-sync hardening work.
- Remove only the version-bump / migration-path machinery that is unnecessary in a greenfield install.
- Preserve unrelated dirty-tree work.

## Decisions

- The device-sync revision columns remain in the base schema, but the repo now treats them as part of schema version `1` instead of introducing a separate version `2`.
- The temporary upgrade-path helpers and legacy backfill logic were removed entirely because this environment is treated as greenfield.
- Versioned rejection tests now only assert that schema user_version `2` is newer than the supported version `1`.

## Verification

- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/store.test.ts test/service.test.ts --no-coverage`
- `pnpm --dir packages/device-syncd test:coverage`
- `pnpm typecheck`
- `git diff --check -- packages/device-syncd/src/store/schema.ts packages/device-syncd/test/store.test.ts packages/device-syncd/test/service.test.ts agent-docs/exec-plans/active/2026-04-23-device-sync-greenfield-schema-followup.md`
- Outcomes:
- Focused `device-syncd` store/service Vitest run passed.
- `pnpm --dir packages/device-syncd test:coverage` passed.
- `pnpm typecheck` passed.
- `git diff --check --` on the task paths passed.
Completed: 2026-04-23
