# PR 249 ReviewGPT Round 6 Follow-Up

## Goal

Resolve accepted ReviewGPT round 6 findings on PR 249.

Success criteria:

- Exported core `importDeviceBatch` accepts the legacy `rawArtifacts` alias without silently dropping evidence, rejects ambiguous payloads with both evidence fields, and preserves normal `evidenceParts` behavior.
- Device evidence filenames are normalized once to the same schema-compatible value used by path, manifest, journal, and returned result.
- The manifest-only evidence-catalog suggestion is either rejected with code-path evidence or implemented only if inspection proves it is smaller and safe.
- Focused and diff-wide verification pass before committing and rerunning ReviewGPT.

## Scope

- `packages/core/src/mutations.ts`
- Focused core/importer tests for legacy raw artifact compatibility and evidence filename normalization
- Importer snapshot compatibility only if direct inspection shows a caller-side gap remains after the core boundary fix
- Review artifacts under `audit-packages/`

## Notes

- Preserve existing vault data and existing direct callers.
- Avoid broad schema churn in the ReviewGPT loop unless a concrete failing path requires it.

## Progress

- Added focused regressions for legacy `rawArtifacts`, ambiguous dual evidence fields, and schema-safe evidence filenames.
- Implemented the core boundary fix in `importDeviceBatch` normalization; importer snapshot mapping already converts adapter `rawArtifacts` to `evidenceParts`.
- Rejected broad manifest-only catalog churn for this PR: `parts` remains the compact durable lookup/index, while the raw manifest remains the byte catalog.

## Verification

- Failing proof before fix: `pnpm --filter @murphai/core exec vitest run --config vitest.config.ts --no-coverage test/device-import.test.ts` failed only the three new regressions.
- Passing focused proof after fix: `pnpm --filter @murphai/core exec vitest run --config vitest.config.ts --no-coverage test/device-import.test.ts` passed 69 tests.
- Passing repo gates: `pnpm typecheck`; `pnpm test:smoke`; `bash scripts/workspace-verify.sh test:diff agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-06-22-pr249-reviewgpt-round6.md packages/core/src/mutations.ts packages/core/test/device-import.test.ts`.
- Passing hygiene: `git diff --check`; touched-file privacy scan.
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
