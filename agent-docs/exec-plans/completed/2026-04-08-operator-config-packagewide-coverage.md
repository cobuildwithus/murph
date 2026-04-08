# Raise `@murphai/operator-config` to honest package-wide coverage

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Keep package-wide `coverage.include: ["src/**/*.ts"]` in `packages/operator-config/vitest.config.ts`.
- Add enough real package-local tests and helpers for `packages/operator-config` to pass its local `test:coverage` thresholds honestly.
- Reuse package-local shared fixtures aggressively and preserve existing behavior plus unrelated dirty edits in the package.

## Success criteria

- `pnpm --config.verify-deps-before-run=false --dir packages/operator-config typecheck` passes.
- `pnpm --config.verify-deps-before-run=false --dir packages/operator-config test:coverage` passes with package-wide include scope.
- New tests stay deterministic, package-local, and avoid widening public API.

## Scope

- In scope:
- `packages/operator-config/**`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-operator-config-packagewide-coverage.md}`
- Out of scope:
- root/shared coverage config
- other packages
- commits

## Current state

- Completed.
- The package still keeps package-wide `coverage.include: ["src/**/*.ts"]`.
- The live worktree still contains pre-existing unrelated edits in `packages/operator-config/package.json`, `packages/operator-config/src/index.ts`, and a deletion of `packages/operator-config/src/runtime-errors.ts`; the coverage work preserved those adjacent changes.
- Package-local verification is green:
  - `pnpm --config.verify-deps-before-run=false --dir packages/operator-config typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/operator-config test:coverage`
- Final package-local coverage result:
  - `14` test files passed
  - `61` tests passed
  - `src/device-daemon/process.ts` raised to `97.7%` statements / `87.5%` branches / `100%` funcs / `97.7%` lines
  - `src/device-daemon.ts` raised to `96%` statements / `91.57%` branches / `89.47%` funcs / `96%` lines

## Seam split

1. Assistant seam worker:
   - Owns `src/assistant/**`, `src/assistant-backend.ts`, `src/hosted-assistant-config.ts`, and assistant-focused tests only.
   - Goal: preserve the strong existing assistant coverage and close any residual package-wide gaps without editing runtime/setup/device files.
2. Runtime/http/device-sync seam worker:
   - Owns `src/{device-sync-client,http-json-retry,http-retry,linq-runtime,telegram-runtime,imessage-readiness}.ts` and runtime-focused tests only.
   - Goal: raise branch coverage in the retry/runtime helpers and fix the runtime-focused tests so they assert the live behavior instead of stale expectations.
3. Setup/operator/contracts seam worker:
   - Owns `src/{command-helpers,setup-runtime-env,operator-config,setup-prompt-io,text/shared,index,assistant-cli-contracts,vault-cli-contracts}.ts` and setup/operator/contracts tests only.
   - Goal: close the remaining setup/operator branch gaps and add representative contract/barrel coverage without widening the public API.
4. Device-daemon/AgentMail seam worker:
   - Owns `src/device-daemon.ts`, `src/device-daemon/**`, `src/agentmail-runtime.ts`, `src/device-cli-contracts.ts`, and device-daemon/AgentMail tests only.
   - Goal: add deterministic coverage for the largest currently-uncovered runtime-management seams.

## Risks and mitigations

1. Risk: package-local helpers sprawl into bespoke per-file stubs.
   Mitigation: centralize env/process/module fixtures under `packages/operator-config/test/**` and reuse them across seam groups.
2. Risk: subagent edits collide with the package’s in-flight changes.
   Mitigation: keep seam ownership disjoint, read current file state before patching, and integrate centrally.
3. Risk: thresholds tempt fake coverage via curated include lists.
   Mitigation: keep package-wide include scope unchanged and raise coverage only with real tests.

## Tasks

1. Capture the current package-local coverage failures and cluster them into disjoint seam groups.
2. Spawn required GPT-5.4 `medium` subagents for assistant, runtime/device, setup/operator/contracts, and device-daemon/AgentMail seams.
3. Integrate shared test helpers plus the returned package-local tests while preserving the existing package worktree edits.
4. Run package-local typecheck and coverage, fix gaps, then run the required final audit review.

## Verification

- `pnpm --config.verify-deps-before-run=false --dir packages/operator-config typecheck`
- `pnpm --config.verify-deps-before-run=false --dir packages/operator-config test:coverage`
