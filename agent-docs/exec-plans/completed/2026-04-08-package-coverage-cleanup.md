# Fix remaining package-local coverage reds and add missing coverage commands

Status: active
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Fix the current package-local `test:coverage` reds in `@murphai/contracts`, `@murphai/inboxd-imessage`, and `@murphai/murph` (`packages/cli`).
- Add explicit package-local `test:coverage` scripts for packages that already have package-local Vitest coverage wiring but still lack the command.
- Bring the package with no package-local tests at all, `packages/vault-usecases`, onto an honest initial package-local test and coverage path using the `codex-workers` helper.
- Report current package-local coverage status across the package set after the fixes land.

## Success criteria

- `pnpm --dir packages/contracts test:coverage` passes.
- `pnpm --dir packages/inboxd-imessage test:coverage` passes.
- `pnpm --dir packages/cli test:coverage` passes.
- `packages/{assistant-runtime,assistantd,core,hosted-execution,importers,parsers,query,runtime-state}/package.json` expose explicit `test:coverage` scripts.
- `packages/vault-usecases` has package-local tests plus an honest package-local coverage command path, or a precisely documented blocker if that cannot land cleanly.
- The final handoff includes the current package-local coverage posture, including any package that still lacks honest package-local coverage wiring.

## Scope

- In scope:
- `packages/contracts/**`
- `packages/inboxd-imessage/**`
- `packages/cli/**`
- `packages/{assistant-runtime,assistantd,core,hosted-execution,importers,parsers,query,runtime-state}/package.json`
- `packages/vault-usecases/**`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-package-coverage-cleanup.md}`
- Out of scope:
- broad package-wide coverage expansion for unrelated already-active packages
- forcing package-local coverage wiring into `packages/inbox-services` unless a narrow honest path is obvious
- unrelated runtime refactors

## Current state

- `packages/contracts test:coverage` currently fails on coverage thresholds in `src/memory.ts` and `src/shares.ts`.
- `packages/inboxd-imessage test:coverage` currently fails on coverage thresholds in `src/shared-runtime.ts`.
- `packages/cli test:coverage` currently fails before coverage because `scripts/build-test-runtime-prepared.mjs` expects a `@murphai/assistant-cli/run-terminal-logging` import to exist inside `packages/cli/src`.
- Several packages already define package-local Vitest coverage config but still lack a `test:coverage` script in `package.json`.
- `packages/inbox-services` and `packages/vault-usecases` do not currently have the same package-local Vitest coverage shape as the others.
- The user explicitly asked for the packages with no tests to be brought up using codex workers; that now makes `packages/vault-usecases` an in-scope worker lane.

## Risks and mitigations

1. Risk:
   Overlap with the current dirty worktree, especially the active coverage lanes and hosted-runner work.
   Mitigation:
   Keep ownership narrow, read current file state before edits, and preserve adjacent in-flight changes.
2. Risk:
   The CLI coverage blocker is a real package-boundary regression rather than a stale check.
   Mitigation:
   Fix the smallest truthful package-shape mismatch instead of weakening the check.
3. Risk:
   Adding `test:coverage` commands without honest coverage wiring creates misleading package commands.
   Mitigation:
   Add commands only where package-local Vitest coverage wiring already exists, and explicitly call out packages that still need separate coverage wiring.

## Tasks

1. Register the task and inspect the current failing package-local coverage surfaces.
2. Spawn package-owned workers for `contracts`, `inboxd-imessage`, the CLI coverage blocker, and the missing-coverage-script rollout.
3. Run a codex-workers lane for `packages/vault-usecases` to add honest initial package-local tests and coverage wiring.
4. Integrate the package-local fixes on top of the dirty shared worktree.
5. Run targeted package-local verification, then rerun the package-local coverage sweep.
6. Run the required final audit review, then finish the task with a scoped commit and a current package-coverage summary.

## Verification

- `pnpm --dir packages/contracts test:coverage`
- `pnpm --dir packages/inboxd-imessage test:coverage`
- `pnpm --dir packages/cli test:coverage`
- package-local `test:coverage` runs for any packages that receive new coverage commands
