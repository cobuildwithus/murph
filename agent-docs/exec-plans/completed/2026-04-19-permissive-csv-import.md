# Make sample CSV import more permissive for real-world device exports

Status: completed
Created: 2026-04-19
Updated: 2026-04-19

## Goal

- Make `samples import-csv` resilient to real-world device exports so CSV imports stop failing on stream aliases such as SpO2, common timestamp formats such as O2Ring's `00:55:47 Apr 17 2026`, and trailing placeholder rows such as `--`.
- Keep the import surface simple: prefer best-effort parsing, alias resolution, and clear provenance over strict exact-name requirements.

## Success criteria

- `samples import-csv` can import O2Ring-style oxygen and pulse columns without pre-normalizing the CSV by hand.
- CSV imports accept best-effort timestamp parsing for common non-ISO export formats and skip malformed rows instead of aborting the whole import when valid rows remain.
- Baseline sample support includes `spo2` so oxygen data can be stored as structured samples.
- Focused importer/core/query/CLI verification covers the new permissive behavior and remains green.

## Scope

- In scope:
- CSV sample import resolution and parsing behavior in `packages/importers/**`
- Baseline sample-stream support needed for structured SpO2 imports in contracts/core/query
- CLI/docs updates directly tied to the import behavior change
- Out of scope:
- Multi-stream one-command import redesign beyond the current single-stream command shape
- Unrelated assistant/importer/runtime cleanup outside the CSV import path

## Constraints

- Technical constraints:
- Preserve canonical sample-record ownership in contracts/core; importer permissiveness must still normalize into canonical sample records.
- Preserve existing raw/batch provenance while extending it for skipped-row visibility when needed.
- Product/process constraints:
- Keep the user-facing import path best-effort and low-friction rather than adding more required flags.
- Avoid touching unrelated dirty-tree work.

## Risks and mitigations

1. Risk: silent auto-detection picks the wrong column in multi-metric CSVs.
   Mitigation: only auto-select when the match is unambiguous; otherwise require explicit `--stream` or `--value-column`.
2. Risk: adding `spo2` ripples across contracts/query/generated schema artifacts.
   Mitigation: keep the stream addition narrow, update the affected generated artifacts, and cover query mapping with focused tests.
3. Risk: best-effort row skipping could hide data quality issues.
   Mitigation: record skipped-row provenance and fail only when no importable sample rows remain.

## Tasks

1. Register the active lane and inspect the current CSV importer, CLI contract, core sample validation, and local assistant/runtime evidence.
2. Implement permissive CSV config resolution: stream aliases, header alias matching, timestamp-column detection, value-column inference, and default unit resolution.
3. Implement best-effort row parsing with flexible timestamp parsing and skipped-row provenance.
4. Add `spo2` baseline sample support across contracts/core/query and update directly affected docs/artifacts.
5. Run scoped verification, required audit passes, and commit with the active plan.

## Decisions

- Keep the command single-stream per invocation for now; improve robustness and detection inside that shape instead of redesigning the CLI grammar in this turn.
- Prefer explicit ambiguity errors over silent multi-column guesses when a CSV exposes more than one plausible sample stream.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/importers/src/csv-sample-importer.ts packages/importers/src/shared.ts packages/importers/test/importers.test.ts packages/importers/test/importers-factory-core-coverage.test.ts packages/contracts/src/constants.ts packages/contracts/src/zod.ts packages/query/src/wearables/candidates.ts packages/core/src/mutations.ts packages/cli/src/commands/samples.ts docs/contracts/03-command-surface.md`
- `pnpm --dir packages/contracts generate`
- `pnpm --dir packages/cli gen:config-schema` if CLI schema/help text changes require it
- Expected outcomes:
- Focused importer/core/query/CLI tests pass and prove permissive CSV handling plus `spo2` support.
- Generated contract/CLI artifacts stay in sync with source changes.

## Outcome

- Landed best-effort CSV sample import behavior:
- stream alias resolution now accepts common labels such as `SpO2`
- timestamp/value columns can be inferred from recognizable headers when unambiguous
- common naive timestamps such as `00:55:47 Apr 17 2026` normalize using the vault timezone
- malformed rows such as trailing `--` placeholders are skipped with explicit batch provenance instead of aborting the import
- Added baseline `spo2` sample support across contracts, core unit normalization, and query wearable mapping.
- Updated CLI/help docs to describe the more permissive import behavior.

## Verification outcome

- Passed:
- `pnpm --dir packages/importers test -- importers.test.ts importers-factory-core-coverage.test.ts`
- `pnpm --dir packages/core test -- core.test.ts`
- `pnpm --dir packages/query test -- wearables-candidates-final.test.ts`
- `pnpm --dir packages/contracts exec vitest run --config vitest.config.ts test/schema-catalog-examples.test.ts`
- `pnpm --dir packages/contracts generate`
- `pnpm --dir packages/contracts test:artifacts`
- `pnpm test:smoke`
- `pnpm --dir packages/importers typecheck`
- `pnpm --dir packages/core typecheck`
- `pnpm --dir packages/query typecheck`
- `pnpm --dir packages/contracts typecheck`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/cli-expansion-samples-audit.test.ts packages/cli/test/sample-helper-coverage.test.ts`

- Blocked by unrelated pre-existing branch failures:
- `pnpm typecheck`
  - failed in untouched `packages/assistant-engine/test/assistant-product-small-seams.test.ts`, `packages/assistant-engine/test/assistant-session-resolution.test.ts`, and `apps/web/test/hosted-wake-store.test.ts`
- `pnpm test:diff ...`
  - failed while expanding into reverse-dependent untouched owners, including `packages/assistant-engine`
- `pnpm --dir packages/cli gen:config-schema`
  - blocked by existing CLI build/type issues in untouched files such as `packages/cli/src/commands/health-entity-command-registry.ts` plus workspace resolution failures during that build
- Focused coverage invocations on individual packages also tripped whole-package untouched coverage thresholds, so they were not a truthful signal for this narrow diff.
Completed: 2026-04-19
