# Device Syncd Root-Threshold Alignment Worker

Package owner: `@murphai/device-syncd`
Path: `packages/device-syncd`

Goal

- Raise real package-local coverage so `packages/device-syncd/vitest.config.ts` can use the shared root thresholds from `config/vitest-coverage.ts` with no package-local override.
- The target thresholds are the root defaults: `lines 85 / functions 85 / branches 80 / statements 85`.

Ownership

- You own only `packages/device-syncd/**`.
- Preserve unrelated worktree edits and do not revert or reformat files you do not need.
- Do not edit root/shared coverage config, other packages, or plan/ledger files.

Current state

- `packages/device-syncd/vitest.config.ts` now uses `createMurphVitestCoverage(...)` without a local `thresholds` override.
- The package already has recent coverage-oriented work in `src/http.ts`, `test/http.test.ts`, `test/garmin-provider.test.ts`, `test/service.test.ts`, and `test/store.test.ts`.
- `pnpm --dir packages/device-syncd typecheck` currently passes.
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/http.test.ts --no-coverage` currently passes.
- The full local coverage lane still appears to hang after startup in this environment; if that persists, gather the strongest direct proof you can and explain the exact blocker.

Workflow

1. Inspect the current package-local coverage gaps against the shared root thresholds.
2. Add only package-local tests or the smallest supporting package-local refactors needed to raise real coverage above the shared gate.
3. Prefer existing seams and deterministic helpers over new harness layers.
4. Run package-local verification with normal `pnpm` commands. If `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` appears, report the blocker instead of bypassing it.
5. Report:
   - files changed
   - commands run
   - final coverage numbers or the exact blocker if the environment still refuses to flush the full run
