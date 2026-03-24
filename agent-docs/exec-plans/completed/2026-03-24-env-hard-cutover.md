# Env Hard Cutover

## Goal

Remove the remaining `HEALTHYBOB_*` environment-variable contract so the repo only accepts and documents unprefixed env names.

## Scope

- Remove legacy `HEALTHYBOB_*` env lookup aliases from the hosted app, local web surface, CLI/setup flows, device-sync daemon/runtime helpers, and parser toolchain adapters.
- Update operator-facing docs, examples, and error/help text to only mention unprefixed names.
- Rewrite focused tests so they validate the hard-cut contract instead of alias compatibility.

## Constraints

- Keep the cut limited to environment-variable contracts; do not rename unrelated branded strings or markers that are not env vars.
- Preserve current precedence and behavior for the unprefixed names.
- Preserve unrelated in-flight edits already present in overlapping files.

## Verification Plan

- Run `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
- Run the completion-workflow audit passes: `simplify`, `test-coverage-audit`, `task-finish-review`.
- If broader failures remain, record whether they are unrelated repo-wide issues or caused by this hard-cut lane.

## Status

Completed. All mutable `HEALTHYBOB_*` environment-variable aliases were removed from the active code/docs/scripts touched by this lane, leaving only immutable completed-plan snapshots plus the non-env PATH block marker strings.

## Outcome

- Hosted web, local web, CLI/runtime helpers, parser adapters, `.env.example`, and repo shell wrappers now use only unprefixed env names.
- Focused tests were rewritten to validate the hard-cut contract instead of alias fallback behavior.
- A repo-wide `rg` sweep confirmed no remaining mutable `HEALTHYBOB_*` env references outside completed plan docs and non-env marker constants.

## Verification Results

- `pnpm typecheck` passed.
- `pnpm test` failed in an unrelated active lane: `packages/cli/test/runtime.test.ts` still expects `meal add` to require `photo`, but the current schema only requires `vault`.
- `pnpm test:coverage` failed after hitting the same unrelated CLI test area and then aborting in Vitest coverage temp-file handling with `ENOENT` for `coverage/.tmp/coverage-0.json`.
- Focused verification passed for the touched env surfaces:
  - `pnpm exec vitest run apps/web/test/env.test.ts packages/runtime-state/test/ulid.test.ts packages/device-syncd/test/config.test.ts packages/web/test/overview.test.ts packages/parsers/test/parsers.test.ts packages/cli/test/assistant-harness.test.ts --no-coverage --maxWorkers 1`
- Completion-workflow audit wrappers were executed in dry-run mode:
  - `pnpm review:gpt --preset simplify --dry-run`
  - `pnpm review:gpt --preset test-coverage-audit --dry-run --no-zip`
  - `pnpm review:gpt --preset task-finish-review --dry-run --no-zip`
Status: completed
Updated: 2026-03-24
Completed: 2026-03-24
