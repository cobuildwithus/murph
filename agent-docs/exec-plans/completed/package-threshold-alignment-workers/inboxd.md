# Inboxd Root-Threshold Alignment Worker

Package owner: `@murphai/inboxd`
Path: `packages/inboxd`

Goal

- Raise real package-local coverage so `packages/inboxd/vitest.config.ts` can use the shared root thresholds from `config/vitest-coverage.ts` with no package-local override.
- The target thresholds are the root defaults: `lines 85 / functions 85 / branches 80 / statements 85`.

Ownership

- You own only `packages/inboxd/**`.
- Preserve unrelated worktree edits and do not revert or reformat files you do not need.
- Do not edit root/shared coverage config, other packages, or plan/ledger files.

Current state

- `packages/inboxd/vitest.config.ts` now uses `createMurphVitestCoverage(...)` without a local `thresholds` override.
- `pnpm --dir packages/inboxd typecheck` currently passes.
- The current shared-threshold failure map from `pnpm --dir packages/inboxd test:coverage` is:
  - `src/connectors/email/connector.ts`: functions `80.95`, branches `72.6`
  - `src/connectors/email/normalize.ts`: branches `75.3`
  - `src/connectors/email/parsed.ts`: branches `76.5`
  - `src/connectors/email/normalize-parsed.ts`: branches `71.66`
  - `src/connectors/imessage/connector.ts`: statements `83.82`, lines `83.7`, branches `73.94`
  - `src/connectors/telegram/connector.ts`: statements `75.13`, lines `75.13`, branches `66.87`
  - `src/indexing/persist.ts`: statements `84.73`, lines `84.55`, branches `71.91`

Workflow

1. Use the current failure map to target the weakest files first.
2. Add only package-local deterministic tests or the smallest supporting package-local refactors needed to raise real coverage above the shared gate.
3. Prefer existing connector/runtime/indexing helpers over new harness layers.
4. Run package-local verification with normal `pnpm` commands. If `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` appears, report the blocker instead of bypassing it.
5. Report:
   - files changed
   - commands run
   - final coverage numbers
