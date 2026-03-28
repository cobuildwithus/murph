# CLI Health Simplification Pass 2

## Goal

Finish the CLI health ownership migration so the remaining health families use explicit CLI adapters and the generic health service fallback can be deleted without changing the public command/help/schema/tool surface.

## Why

- The first pass proved the explicit-adapter pattern for registry-doc health families plus the `protocol` and `supplement` seam.
- The remaining fallback still centralizes behavior for `assessment`, `family`, `genetics`, `profile`, `history`, and `blood_test`, which keeps ownership split across descriptors, generic builder logic, and runtime method registries.
- Deleting the fallback is the point where behavior stops rippling through descriptor-driven construction.

## Constraints

- No rewrite and no user-facing CLI surface change.
- Keep descriptor metadata as the manifest for docs/help/registration in this pass.
- Preserve noun-specific commands, generic `show`/`list` parity, schema output, and assistant tool exposure.
- Read live state first in already-dirty CLI files and avoid widening overlap into unrelated assistant or query work.

## Target Shape For This Pass

1. Move `family` and `genetics` onto explicit registry-doc adapters beside the existing `goal`/`condition`/`allergy`/`protocol` cluster.
2. Add explicit adapters for the specialized families:
   - `assessment` query-only reads
   - `profile` scaffold/upsert/show/list
   - `history` scaffold/upsert/show/list
   - `blood_test` scaffold/upsert/show/list
3. Remove `createHealthCoreServices` and `createHealthQueryServices` from the integrated CLI service assembly and delete the generic fallback module.
4. Keep the remaining descriptor file focused on docs/help/registration and runtime shape validation.

## Expected Files

- `packages/cli/src/usecases/explicit-health-family-services.ts`
- `packages/cli/src/usecases/health-services.ts`
- `packages/cli/src/usecases/integrated-services.ts`
- `packages/cli/src/usecases/types.ts`
- `packages/cli/src/health-cli-method-types.ts`
- `packages/cli/src/health-cli-descriptors.ts`
- `packages/cli/src/usecases/runtime.ts`
- `packages/cli/test/health-tail.test.ts`
- `packages/cli/test/incur-smoke.test.ts`

## Verification

- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/cli test -- --runInBand health-tail.test.ts incur-smoke.test.ts` if feasible
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Direct CLI help/schema spot checks for the migrated families if broader verification remains blocked by unrelated repo failures

## Completion Notes

- Required audit sequence after implementation: `simplify` -> `test-coverage-audit` -> `task-finish-review`.
- Close this plan with `scripts/finish-task` if the task lands in this turn.

Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
