# Junction history review remediation

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Make sparse Junction history reach durable terminal coverage after valid
  aggregate imports or bounded malformed-data retries, and represent every
  supported source/resource completion within existing metadata limits.

## Success criteria

- Daily aggregate resources use importer-owned durable acceptance rather than a
  false one-provider-row-to-one-event assumption.
- Blood pressure keeps exact per-record resolution and note keeps its explicit
  valid no-op completion behavior.
- Coverage for all 33 fixed Junction sources across all ten extended resources
  fits one versioned metadata scalar with headroom under existing limits.
- The shipped blood-pressure and note coverage keys remain readable during
  mixed-version rollout.
- Provider/importer receipt handling, SQLite success persistence and reload,
  and hosted/local merge tests prove terminal suppression.

## Constraints

- Do not widen global metadata limits, retain full provider timeseries, add a
  new state owner, or weaken source-admission and blood-pressure repair rules.
- Preserve the eight-job scheduling cap and bounded 30-day provider windows.
- Use only synthetic provider and health fixtures.

## Tasks

1. [complete] Replace aggregate row/event count comparison with durable importer receipt
   evidence while preserving per-record and note paths.
2. [complete] Replace ten resource-specific completion scalars with one fixed-catalog
   bit-matrix encoding and two legacy-reader compatibility keys.
3. [complete] Prove successful aggregate completion, retry recovery, malformed no-progress
   exhaustion, 33-by-10 store/reload survival, and hosted/local merge.
4. [complete] Run focused tests and typechecks, commit, push, and update the PR description.

## Decisions

- The fixed source and extended-resource catalogs define bit positions. A
  catalog change must bump the compact encoding version before rollout.
- A completed provider fetch whose aggregate snapshot is durably accepted by
  the importer clears transient aggregate unresolved state even when several
  rows intentionally reduce to one event.
- Malformed aggregate rows retain the existing empty/no-progress retry ladder,
  but successful importer acceptance no longer creates an irreversible
  unresolved-record bit.
- Blood-pressure and note legacy scalars remain readable and are dual-written
  only for those two shipped resources during the compatibility window.

## Verification

- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime.test.ts test/junction-provider.test.ts test/junction-blood-pressure-backfill.test.ts` (381 passed)
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/service.test.ts -t "Junction compact history coverage"` (1 passed)
- `pnpm exec vitest run --config vitest.config.ts --no-coverage ../../packages/importers/test/device-providers-junction.test.ts -t "compacts tier-1 timeseries resources"` (1 passed)
- `pnpm --filter @murphai/device-syncd typecheck`
- `git diff --check` and privacy scan
Completed: 2026-08-11
