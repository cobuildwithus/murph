# Get `packages/contracts` green and above package-local coverage thresholds

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Make `packages/contracts` package-local checks pass honestly.
- Keep `packages/contracts` above its package-local coverage thresholds without weakening shared/root coverage policy.
- Prefer deterministic package-local tests over source refactors unless a tiny source fix is the more truthful repair.

## Success criteria

- `pnpm --dir packages/contracts typecheck` passes.
- `pnpm --dir packages/contracts test` passes.
- `pnpm --dir packages/contracts test:coverage` passes.
- Required repo verification for `packages/contracts` work is recorded before handoff.

## Scope

- In scope:
  - `packages/contracts/src/**`
  - `packages/contracts/test/**`
  - `packages/contracts/package.json`
  - `packages/contracts/vitest.config.ts`
  - `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-contracts-green-coverage.md}`
- Out of scope:
  - root/shared coverage threshold changes
  - unrelated package coverage cleanup outside `packages/contracts/**`
  - broad runtime refactors in sibling packages

## Current state

- `packages/contracts` already has package-local `typecheck`, `test`, and `test:coverage` scripts.
- There are existing untracked `packages/contracts/test/**` files in the worktree that appear to be the current package-local coverage push and must be preserved.
- The exact remaining package-local failures and coverage gaps still need to be measured against the live tree before deciding whether any source edits are necessary.

## Risks and mitigations

1. Risk:
   Overlap with the broader package-coverage cleanup lane and the existing dirty worktree.
   Mitigation:
   Keep edits inside `packages/contracts/**` plus this plan and ledger, read current file state first, and preserve adjacent edits.
2. Risk:
   Coverage gaps may tempt threshold reductions.
   Mitigation:
   Add focused deterministic tests first and only touch source when tests cannot truthfully reach the missing branches.
3. Risk:
   Package-local green may still leave repo-required verification red for unrelated reasons.
   Mitigation:
   Run the required commands for `packages/contracts` work, isolate unrelated failures, and record precise evidence.

## Tasks

1. Capture the exact package-local test and coverage failures for `packages/contracts`.
2. Split coverage/test-gap analysis into parallel worker lanes.
3. Integrate the smallest truthful fixes on top of the shared dirty worktree.
4. Run package-local and repo-required verification.
5. Run the required final audit review, then finish with a scoped commit.

## Verification

- `pnpm --dir packages/contracts typecheck`
- `pnpm --dir packages/contracts test`
- `pnpm --dir packages/contracts test:coverage`
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
Completed: 2026-04-08
