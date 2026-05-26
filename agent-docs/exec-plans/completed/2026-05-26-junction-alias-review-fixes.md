# Junction alias review fixes

Status: completed
Created: 2026-05-26
Updated: 2026-05-26

## Goal

- Fix final subagent-review issues in the Junction alias/default patch before handoff.

## Success criteria

- Importer canonical alias collisions produce one canonical resource artifact/provenance entry instead of duplicate raw artifact roles.
- `calories_active` observations use canonical `kcal` units for common upstream calorie unit spellings.
- Resource jobs re-infer category when a queued alias job carries a stale/skewed `resourceCategory`.
- Focused importer/device-sync tests pass; broader verification is run or unrelated blockers are documented.

## Scope

- In scope: narrow Junction importer resource merging, Junction timeseries unit normalization, Junction resource-job category inference, focused regression tests.
- Out of scope: structured sleep-cycle/hypnogram normalizer, remote disconnect/orphan webhook work, direct webhook chunking work.

## Verification

- `pnpm --dir packages/importers exec vitest run --config vitest.config.ts test/device-providers-junction.test.ts --no-coverage` passed.
- `pnpm --dir packages/importers typecheck` passed.
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/junction-resource-aliases.test.ts --no-coverage` passed.
- `pnpm --dir packages/device-syncd typecheck` passed.
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/junction-provider.test.ts --no-coverage` passed.
- `pnpm test:smoke` passed.
- `pnpm typecheck` passed.
- `git diff --check` passed.
Completed: 2026-05-26
