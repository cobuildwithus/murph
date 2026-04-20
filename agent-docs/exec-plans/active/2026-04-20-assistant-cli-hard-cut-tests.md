# Assistant-cli hard-cut test/config cleanup

Status: in_progress
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Make the assistant-cli hard cut real in workspace config and test surfaces by removing the deprecated `@murphai/assistant-cli/assistant/*` tolerance without widening package exports again.

## Success criteria

- `tsconfig.base.json` no longer aliases `@murphai/assistant-cli/assistant/*`.
- `scripts/workspace-boundaries/import-policy-rules.mjs` no longer permits deep `@murphai/assistant-cli/assistant/*` imports from tests.
- `packages/cli/test/**` no longer imports deprecated deep assistant-cli paths.
- Remaining CLI tests either use the real owner packages or are removed from `packages/cli/test` because the assistant-cli owner suite already covers those surfaces.

## Scope

- `tsconfig.base.json`
- `scripts/workspace-boundaries/import-policy-rules.mjs`
- affected `packages/cli/test/**`
- `packages/assistant-cli/test/**` only if a narrow owner-side follow-up becomes necessary

## Constraints

- Do not widen `packages/assistant-cli/package.json` exports.
- Do not import sibling package `src/` or `dist/` paths directly from `packages/cli/test`.
- Preserve unrelated dirty-tree edits.
- Do not commit.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff tsconfig.base.json scripts/workspace-boundaries/import-policy-rules.mjs packages/cli/test packages/assistant-cli/test`
- planned: `git diff --check`

## Notes

- The expected minimal path is to remove workspace/test-only assistant-cli deep-import allowances, rewrite mixed-owner CLI tests to their real owner packages, and drop mislocated assistant-cli-owned CLI tests from `packages/cli/test` if the owner package already covers those seams.
