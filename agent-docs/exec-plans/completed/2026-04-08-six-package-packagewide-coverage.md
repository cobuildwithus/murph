# Raise the six standalone packages to honest package-wide coverage gates

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Remove curated package-local coverage include lists from the six standalone packages and keep package-wide coverage patterns.
- Add enough real package-local tests so `@murphai/assistant-cli`, `@murphai/cloudflare-hosted-control`, `@murphai/gateway-core`, `@murphai/gateway-local`, `@murphai/operator-config`, and `@murphai/setup-cli` pass the shared repo thresholds with honest package-wide `src/**/*.ts` coverage.
- Use one Codex worker per package in the shared worktree, and require each worker to spawn GPT-5.4 `medium` subagents for disjoint package seams.

## Success criteria

- The six target package configs keep package-wide `coverage.include: ["src/**/*.ts"]` rather than curated file lists.
- Each package has enough real tests to pass `test:coverage` with the shared coverage helper and default thresholds.
- Workers stay package-local, reuse package-local shared helpers where possible, and do not duplicate harness stacks unnecessarily.
- Parent lane runs verification, required audit, and a scoped commit after worker integration.

## Scope

- In scope:
- `packages/assistant-cli/**`
- `packages/cloudflare-hosted-control/**`
- `packages/gateway-core/**`
- `packages/gateway-local/**`
- `packages/operator-config/**`
- `packages/setup-cli/**`
- prompt artifacts for this worker batch under `agent-docs/exec-plans/active/package-coverage-workers/**`
- this active plan and coordination bookkeeping
- Out of scope:
- root `vitest.config.ts`
- `config/**`
- other package coverage rollout lanes already in flight
- unrelated runtime or product changes outside the six owned packages

## Current state

- The live worktree already has package-wide `coverage.include: ["src/**/*.ts"]` in the six target package configs.
- `@murphai/cloudflare-hosted-control` already passes package-wide `test:coverage`.
- `@murphai/assistant-cli`, `@murphai/gateway-core`, `@murphai/gateway-local`, `@murphai/operator-config`, and `@murphai/setup-cli` still fail package-wide `test:coverage` by a wide margin, with the largest gaps concentrated in UI/controller surfaces, route/snapshot helpers, store flows, runtime/config helpers, and setup wizard/service paths.

## Risks and mitigations

1. Risk: multiple workers collide in the shared worktree.
   Mitigation: one worker owns one package only, with subagents split further by disjoint files inside that package.
2. Risk: workers try to “solve” thresholds by reintroducing curated coverage includes.
   Mitigation: prompts explicitly forbid curated include lists and require package-wide `src/**/*.ts` coverage.
3. Risk: workers duplicate bespoke harness code instead of extending the helpers already in each package.
   Mitigation: prompts explicitly require reuse of package-local helpers first and only allow new shared helpers when they reduce duplication immediately.

## Tasks

1. Capture package-wide coverage baselines for the six target packages.
2. Generate one package-owned worker prompt per package with required GPT-5.4 `medium` subagent fan-out.
3. Launch the six workers in the shared worktree with the `codex-workers` helper.
4. Poll, integrate, and run focused package-local verification across the six packages.
5. Run the required final audit pass, fix findings, and create a scoped commit.

## Decisions

- Keep the worker batch in the current shared worktree rather than isolated worktrees.
- Treat package-wide `src/**/*.ts` coverage as non-negotiable for this lane.
- Keep root/shared coverage config parent-owned and out of the worker write scope.

## Verification

- Required commands:
  - `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/cloudflare-hosted-control typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/gateway-core typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/gateway-local typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/operator-config typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/setup-cli typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli test:coverage`
  - `pnpm --config.verify-deps-before-run=false --dir packages/cloudflare-hosted-control test:coverage`
  - `pnpm --config.verify-deps-before-run=false --dir packages/gateway-core test:coverage`
  - `pnpm --config.verify-deps-before-run=false --dir packages/gateway-local test:coverage`
  - `pnpm --config.verify-deps-before-run=false --dir packages/operator-config test:coverage`
  - `pnpm --config.verify-deps-before-run=false --dir packages/setup-cli test:coverage`
Completed: 2026-04-08
