# Raise `@murphai/setup-cli` to honest package-wide coverage

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Keep package-wide `coverage.include: ["src/**/*.ts"]` in `packages/setup-cli/vitest.config.ts`.
- Add enough deterministic package-local tests for `packages/setup-cli` to pass its local `test:coverage` thresholds honestly.
- Preserve existing package worktree edits and favor existing wizard/setup-service test helpers over new helper sprawl.

## Success criteria

- `pnpm --dir packages/setup-cli typecheck` passes.
- `pnpm --dir packages/setup-cli test:coverage` passes with package-wide include scope unchanged.
- New tests stay behavior-focused, deterministic, package-local, and avoid brittle snapshot-style assertions.

## Scope

- In scope:
- `packages/setup-cli/**`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-setup-cli-packagewide-coverage.md}`
- Out of scope:
- root/shared coverage config
- other packages
- commits

## Current state

- The package already keeps honest coverage scope through `coverage.include: ["src/**/*.ts"]` in `packages/setup-cli/vitest.config.ts`.
- The live worktree already contains pre-existing edits in `packages/setup-cli/test/{setup-agentmail.test.ts,setup-assistant.test.ts,setup-surface.test.ts,setup-wizard.test.ts}` plus untracked package-local test files. Preserve and build on that state rather than replacing it.
- The current package-local `test:coverage` run fails in two ways:
  - `packages/setup-cli/test/setup-assistant-wizard.test.ts` has a stale expectation for the named OpenRouter provider selection. Live behavior now resolves `OPENROUTER_API_KEY` and updated detail text.
  - Honest package-wide coverage is still below threshold in `src/setup-services.ts`, `src/setup-services/{channels,process,shell,toolchain}.ts`, `src/setup-assistant-account.ts`, `src/setup-assistant-defaults.ts`, `src/setup-assistant-wizard.ts`, and the thin barrel `src/index.ts`.

## Seam split

1. Assistant / AgentMail worker:
   - Owns `src/setup-assistant*.ts`, `src/setup-agentmail.ts`, and assistant-focused tests only.
   - Goal: fix the stale assistant-wizard expectation and close assistant/account/defaults/wizard gaps with deterministic behavior assertions.
2. CLI / Wizard worker:
   - Owns `src/setup-cli.ts`, `src/setup-wizard*.ts`, `src/setup-wizard-ui.ts`, and wizard-focused tests only.
   - Goal: raise routing and wizard-flow coverage without snapshot-heavy assertions, reusing the existing wizard/TTY helpers where possible.
3. Services / Codex-home / error-bridge worker:
   - Owns `src/setup-services*.ts`, `src/setup-codex-home.ts`, `src/incur-error-bridge.ts`, and service/toolchain-focused tests only.
   - Goal: close the largest package-wide gaps in setup-services, channels, shell, process, and toolchain code using deterministic local tests.

## Risks and mitigations

1. Risk: helper sprawl makes the package harder to maintain.
   Mitigation: extend `packages/setup-cli/test/helpers.ts` and existing service/wizard test files before adding any new shared helper.
2. Risk: subagent edits collide with the package's in-flight test work.
   Mitigation: keep ownership disjoint, require each worker to read current file state first, and integrate centrally.
3. Risk: coverage is faked by narrowing include scope.
   Mitigation: leave package-wide include scope unchanged and raise coverage only with real tests.

## Tasks

1. Capture the current failing package test and coverage gaps, then group them into assistant, wizard/CLI, and services/toolchain seams.
2. Spawn required GPT-5.4 `medium` workers for those three seams with disjoint ownership.
3. Integrate the returned package-local tests while preserving existing dirty edits and reusing current helpers where practical.
4. Run package-local typecheck and coverage, fix residual gaps, then run the required final review workflow.

## Verification

- `pnpm --dir packages/setup-cli typecheck`
- `pnpm --dir packages/setup-cli test:coverage`
Completed: 2026-04-08
