# Error Code Hard Cutover

Status: completed
Created: 2026-03-27
Completed: 2026-03-27

## Goal

Rename the remaining branded `HB_*` error/status-code namespace to unbranded codes and remove dead compatibility leftovers discovered during that cutover.

## Success criteria

- Replace the canonical `HB_*` code strings exported from `packages/contracts/src/constants.ts` with unbranded equivalents.
- Update downstream emitters, validators, generated artifacts, and tests to use the new code strings consistently.
- Keep the cutover scoped to the error/status-code contract surface instead of reopening the completed env/runtime rename.
- Remove truly dead branded leftovers that only existed to preserve the old error-code namespace.

## Constraints

- Backward compatibility was intentionally out of scope; old `HB_*` error codes should stop working.
- Adjacent in-flight edits in `packages/core`, `packages/cli`, and neighboring packages were preserved.
- Repo-wide verification remained noisy from unrelated lanes and had to be separated from focused lane-local checks.

## Done

- Renamed the shared contract error-code constants and updated the docs in `docs/contracts/04-error-codes.md`.
- Propagated the unbranded codes through core emitters, validators, mutations, and targeted CLI mappings.
- Updated generated contract artifacts and focused test coverage for the renamed codes.
- Fixed the generic `upsertEvent` boundary so malformed specialized event payloads fail with `EVENT_KIND_INVALID` before falling into schema validation.
- Removed the last active `HB_*` compatibility branch from CLI vault-like error detection.
- Restored the CLI vault-path resolver to the shared core implementation and added focused path-safety coverage for empty paths, drive-prefixed paths, and missing vault roots.

## Verification

- Passed: `pnpm --dir packages/core typecheck`
- Passed: `pnpm --dir packages/core test`
- Passed: `pnpm exec vitest run packages/cli/test/vault-usecase-helpers.test.ts packages/cli/test/canonical-write-lock.test.ts --no-coverage --maxWorkers 1`
- Failed outside this lane: `pnpm typecheck`
  - `packages/cli/src/assistant-codex.ts`: missing `extractCodexItemType`
- Failed outside this lane: `pnpm test`
  - `packages/cli/src/setup-wizard.ts`: `SetupWizardPublicUrlReview` no longer matches `options`
- Failed outside this lane: `pnpm test:coverage`
  - `apps/cloudflare/src/index.ts`: `runner` property type errors and one `string | null` assignment error

## Audit passes

- `simplify`: completed clean after the public specialized-kind guard fix.
- `test-coverage-audit`: completed with findings; added focused coverage for provider, journal, write-batch, vault-summary, and CLI mapping boundaries.
- `task-finish-review`: initial pass found the malformed specialized-kind regression in generic `upsertEvent`, and a later review found the CLI vault-path helper drift from core path-safety semantics. Both fixes landed, focused checks passed afterward, and the final narrowed finish-review returned no actionable findings.
