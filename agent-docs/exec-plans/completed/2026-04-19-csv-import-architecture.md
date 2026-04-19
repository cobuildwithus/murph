# Redesign CSV sample import to support multi-column best-effort imports and stronger summaries

Status: completed
Created: 2026-04-19
Updated: 2026-04-19

## Goal

- Redesign `samples import-csv` so one CSV can import all recognizable sample columns in a single command, while surfacing a clear aggregate summary of what was inferred, imported, and skipped.
- Replace the current importer’s monolithic single-stream logic with a planner/parser architecture that is easier to extend for additional messy device exports.

## Success criteria

- One CSV import can write multiple canonical sample batches when the file contains multiple recognizable metrics such as `spo2` and `heart_rate`.
- The CLI result surface returns a structured summary per imported stream, including inferred columns, timezone used, imported/skipped counts, and skip reasons.
- Common numeric export formats such as `98%`, `72 bpm`, and `1,234` import without manual cleanup when they are still unambiguous.
- The importer code is split into clearer planning/parsing seams instead of continuing to accumulate behavior inside one giant function.

## Scope

- In scope:
- `packages/importers/**` CSV planning/parsing/write orchestration
- CLI helper and operator contract/result schema updates directly required by the new aggregate import result
- Focused docs/tests coupled to the import redesign
- Out of scope:
- New interactive `--dry-run` / `--explain` command surface
- Device-provider snapshot ingestion changes outside direct CSV sample import support

## Constraints

- Technical constraints:
- Preserve canonical sample ownership in `packages/core`; the importer should orchestrate multiple normal `core.importSamples` writes rather than inventing a parallel storage path.
- Preserve raw manifests and row provenance per batch while adding the aggregate summary surface above them.
- Product/process constraints:
- Prefer automatic best-effort imports over more required flags.
- Keep strict failure only for true ambiguity, such as multiple plausible timestamp columns or multiple columns mapping to the same stream.
- Preserve unrelated dirty-tree work and avoid broad hosted/app changes.

## Risks and mitigations

1. Risk: a multi-column import redesign breaks existing callers that expect one stream result.
   Mitigation: update the CLI helper, result schema, docs, and focused tests together in one change.
2. Risk: shared timestamp inference becomes too loose and silently chooses the wrong time column.
   Mitigation: require one unambiguous timestamp column, otherwise fail with a clear error.
3. Risk: broader numeric parsing starts accepting junk values.
   Mitigation: only strip obvious formatting and unit suffixes, keep non-coercible values as skipped provenance rows.

## Tasks

1. Define the new aggregate import/result contract and register the active work lane.
2. Split CSV import logic into planning/parsing helpers and support multi-column stream detection plus per-stream prepared payloads.
3. Orchestrate multi-batch writes through the importer runtime and return a structured aggregate summary for the CLI.
4. Expand numeric normalization and keep ambiguity checks only where the planner cannot choose safely.
5. Update docs and focused tests, then run scoped verification and required completion workflow steps.

## Decisions

- Prefer multi-stream auto-import over forcing repeated one-stream CLI invocations for device exports that already contain multiple recognizable metrics.
- Keep the core write seam unchanged: the importer should plan multiple canonical payloads rather than broaden `core.importSamples` itself into a multi-stream API.
- Keep `prepareCsvSampleImport` available as an importer-library helper, but stop requiring it from the generic CLI runtime-module seam now that command execution derives its inference summary from the aggregate import result.

## Verification

- Commands to run:
- `pnpm --dir packages/importers test -- importers.test.ts importers-factory-core-coverage.test.ts`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/sample-helper-coverage.test.ts packages/cli/test/export-sample-helper-coverage.test.ts packages/cli/test/cli-expansion-samples-audit.test.ts packages/cli/test/document-meal-intervention-coverage.test.ts`
- `pnpm --dir packages/importers typecheck`
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/vault-usecases typecheck`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/importers/src/csv-sample-importer.ts packages/importers/src/csv-sample-import-planner.ts packages/importers/src/index.ts packages/importers/test/importers.test.ts packages/importers/test/importers-factory-core-coverage.test.ts packages/importers/test/test-helpers.ts packages/cli/src/commands/sample-import-command-helpers.ts packages/cli/src/commands/samples.ts packages/cli/test/sample-helper-coverage.test.ts packages/cli/test/export-sample-helper-coverage.test.ts packages/cli/test/cli-expansion-samples-audit.test.ts packages/cli/test/runtime.test.ts packages/cli/test/document-meal-intervention-coverage.test.ts packages/operator-config/src/vault-cli-contracts.ts packages/vault-usecases/src/usecases/types.ts packages/vault-usecases/src/usecases/integrated-services.ts docs/contracts/03-command-surface.md`
- Expected outcomes:
- Multi-stream CSV imports are covered in importer and CLI tests.
- Contracts/docs stay in sync with the new result shape and `spo2`-inclusive sample schema artifacts.
- Actual outcomes:
- Passed: importer tests; focused CLI helper/audit/coverage tests; direct typechecks for `packages/importers`, `packages/cli`, `packages/operator-config`, and `packages/vault-usecases`.
- Passed after the final seam cleanup: refreshed prepared runtime artifacts via `pnpm build:test-runtime:prepared`, then re-ran `packages/cli` typecheck to confirm the importer runtime loader now only depends on `createImporters()`.
- Known unrelated blockers from the dirty tree: `pnpm typecheck` and diff-scoped `workspace-verify` fail in untouched `packages/assistant-engine` / `packages/assistantd` boundary/typecheck work. `packages/cli/test/runtime.test.ts` also still fails in an unrelated built-runtime path under `packages/operator-config/src/operator-config/cli-vault-defaults.ts`.
Completed: 2026-04-19
