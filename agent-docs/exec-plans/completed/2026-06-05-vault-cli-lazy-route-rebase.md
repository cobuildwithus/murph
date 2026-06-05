# Vault CLI Lazy Route Rebase Fixes

## Goal

Keep PR #45 clean after PR #47 by preserving the lazy Health Commons experiment import boundary and tightening lazy route coverage without adding another parser, cache, daemon, or fallback layer.

## Success Criteria

- `experiment.ts` resolves Health Commons protocol-backed experiment data through the compact protocol run-spec reader behind a dynamic import.
- Common assistant root aliases route through the existing assistant command registration path instead of falling back to the full CLI graph.
- A drift test proves each full-manifest root is either scoped lazy or explicitly full-only.
- Built CLI smoke and package verification pass after the rebase.

## Constraints

- Do not reintroduce eager Health Commons runtime imports on `experiment list`.
- Do not parse nested command paths before Incur.
- Do not rewrite argv.
- Keep Incur responsible for command parsing, validation, help, schema, and execution.

## Plan

1. Rebase PR #45 on current `main` after PR #47.
2. Resolve `experiment.ts` to lazy import `getGeneratedHealthCommonsProtocolRunSpecReader`.
3. Add assistant shorthand roots to the assistant scoped route.
4. Add route-table drift coverage for scoped vs intentionally full-only roots.
5. Run focused and built CLI verification.

## Result

- PR #47 was merged and PR #45 was rebased on the updated `main`.
- `experiment.ts` keeps the dynamic compact protocol run-spec reader import from `@murphai/health-commons/runtime`.
- `chat`, `run`, `status`, `doctor`, and `stop` now route through the assistant scoped command family.
- Route drift coverage now compares the full manifest root set against scoped roots plus explicit full-only roots.
- CLI package verification now generates Health Commons artifacts before prepared built-runtime verification.

## Verification

- `pnpm --dir packages/cli exec vitest run test/vault-cli-routing.test.ts test/vault-cli-command-routing.test.ts test/experiment-imports.test.ts test/cli-entry.test.ts test/cli-entry-program-name.test.ts test/commons-command-coverage.test.ts`
- `pnpm --dir packages/cli verify:coverage`
- `pnpm --dir packages/setup-cli test`
- `pnpm --dir packages/setup-cli typecheck`
- `pnpm typecheck`
- `git diff --check`
- Built CLI smoke: `--version`, `--help`, `device --help`, `device account list`, `experiment list`, `commons protocol show`, and assistant alias help for `chat`, `run`, `status`, `doctor`, and `stop`.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
