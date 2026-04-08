# Align rollout package thresholds with root repo defaults

Status: active
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Raise the remaining rollout-package custom coverage thresholds to the root repo defaults in `config/vitest-coverage.ts`.
- Keep the scope limited to the same four rollout packages from the prior lane, but only change the packages that still differ from the root thresholds.

## Success criteria

- `packages/device-syncd/vitest.config.ts` and `packages/inboxd/vitest.config.ts` match the root `murphVitestCoverageThresholds` values.
- Any additional package-local tests needed to support those higher thresholds are added without widening scope into root/shared coverage plumbing.
- `packages/messaging-ingress` and `packages/openclaw-plugin` remain unchanged unless verification proves an adjustment is necessary.
- Required verification, final audit, and a scoped commit run before handoff.

## Scope

- In scope:
- `packages/device-syncd/**`
- `packages/inboxd/**`
- task plan + final scoped commit for this lane
- Out of scope:
- unrelated package coverage work already active elsewhere in the tree
- root/shared coverage config changes
- non-coverage behavior changes outside the package-local seams needed to support the higher thresholds

## Current state

- Root defaults remain `lines 85 / functions 85 / branches 80 / statements 85`.
- `packages/device-syncd/vitest.config.ts` is still at `80 / 80 / 70 / 80`.
- `packages/inboxd/vitest.config.ts` is still at `75 / 80 / 65 / 75`.
- `packages/messaging-ingress` already uses the root thresholds.
- `packages/openclaw-plugin` already inherits the root thresholds and previously verified at `100%`.

## Risks and mitigations

1. Risk: `device-syncd` still has an environment-specific hang in the full local coverage lane.
   Mitigation: keep package-local changes focused, rerun the most valuable direct proofs locally, and only rely on prior worker artifacts when the environment still refuses to flush the full run.
2. Risk: additional tests accidentally overlap unrelated in-flight branch work.
   Mitigation: isolate this lane to `device-syncd` and `inboxd` only and commit only the exact touched files.
3. Risk: branch-heavy files require brittle test scaffolding to hit `80`.
   Mitigation: favor existing seams and deterministic helpers over new harness layers, and let the package subagents own disjoint test surfaces.

## Tasks

1. Confirm the remaining threshold gaps and current package-local coverage evidence.
2. Spawn one package-scoped subagent for `device-syncd` and one for `inboxd`.
3. Integrate their package-local test/threshold changes.
4. Run package-local verification plus the required repo-level commands, document unrelated blockers if they persist.
5. Run the required audit pass and commit the scoped result.

## Verification

- Required commands:
  - `pnpm typecheck`
  - `pnpm test:coverage`
- Focused proof to add during implementation:
  - `pnpm --dir packages/device-syncd typecheck`
  - `pnpm --dir packages/device-syncd test:coverage`
  - `pnpm --dir packages/inboxd typecheck`
  - `pnpm --dir packages/inboxd test:coverage`
