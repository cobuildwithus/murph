# Get all packages green under coverage and simplify package tests where the live tree is already green

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Make the current checkout green for package-local coverage and the repo-required coverage lane.
- If package-local coverage is already green for a package seam, use parallel package-owned workers to simplify brittle or duplicated tests without weakening coverage or changing behavior.

## Success criteria

- The live failing package set from the initial sweep is resolved or reduced only to blockers that are credibly unrelated to this lane.
- Any touched package keeps or improves its package-local `test:coverage` result.
- Test cleanup work stays package-local, reduces duplication or hacky setup, and does not lower coverage thresholds.
- Final verification includes `pnpm typecheck` and `pnpm test:coverage`, unless a remaining failure is demonstrably unrelated and documented.

## Scope

- In scope:
- package-local coverage failures or test-cleanup opportunities discovered by the live sweep
- package-local `src/**`, `test/**`, `package.json`, and `vitest*.ts` files for the owned package seams
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-09-package-coverage-green-and-test-cleanup.md}`
- Out of scope:
- unrelated hosted-web or Cloudflare app work already in progress
- weakening shared/root coverage policy
- refactors outside the minimum package-local surface needed to get coverage green or simplify tests honestly

## Current state

- The worktree is already dirty, with multiple active package-local coverage and test-cleanup lanes.
- The live `pnpm test:packages:coverage` sweep first failed in the root package Vitest lane because `packages/assistant-cli/test/assistant-ui-ink.test.ts` still had a PTY-sensitive duplicate raw-mode rejection case; removing that duplicate preserved package-local coverage and cleared the root blocker.
- The next live package-local blocker was `packages/runtime-state`, which failed broad per-file coverage thresholds across hosted-bundle, hosted-identity, assistant/runtime-utility, local-state/versioned-json, and locking/sqlite/process seams.
- Four disjoint worker seams landed package-local runtime-state coverage tests; `pnpm --dir packages/runtime-state test:coverage` and `pnpm --dir packages/runtime-state typecheck` now pass on the live tree.
- A worker left `packages/runtime-state/coverage-hosted-seam/**` generated artifacts behind during focused verification; those artifacts were removed after the hygiene guard flagged them.
- The rerun `pnpm test:packages:coverage` lane now passes end-to-end.
- `pnpm typecheck` now passes end-to-end.
- `pnpm test:coverage` still fails outside this task in `packages/setup-cli/test/setup-assistant-wizard-flow.test.ts`, where the existing `assistant wizard can switch to a named compatible provider and finish the flow` test times out after 5 seconds; this task did not touch `packages/setup-cli/**`.

## Risks and mitigations

1. Risk:
   Root coverage failures may come from packages already owned by another active lane.
   Mitigation:
   Treat this lane as integration-first, avoid editing packages with an active owner row unless the live blocker clearly falls outside that row or the package is otherwise clean to touch.
2. Risk:
   Test cleanup can sprawl into behavior changes or speculative harness abstractions.
   Mitigation:
   Keep cleanup package-local, prefer deleting duplication over introducing shared helpers, and require the same or better direct coverage proof afterward.
3. Risk:
   Repo-wide coverage may still fail because of unrelated in-flight worktree changes.
   Mitigation:
   Preserve the dirty tree, run focused package proof for touched seams, and document any remaining unrelated blocker precisely.

## Tasks

1. Run a live package coverage sweep and identify the actual failing package seams.
2. Partition failing seams and already-green cleanup seams into disjoint worker packages.
3. Integrate the minimum package-local fixes or simplifications needed.
4. Re-run focused package-local verification for touched packages.
5. Re-run package-wide coverage to catch any later package blockers beyond the first failure.
6. Run repo-required verification, then the required final audit and scoped commit.

## Verification

- Initial discovery:
  - `pnpm test:packages:coverage`
- Final required:
  - `pnpm typecheck`
  - `pnpm test:coverage`
- Focused rechecks:
  - `pnpm --dir <package> test:coverage` for each touched package
Completed: 2026-04-09
