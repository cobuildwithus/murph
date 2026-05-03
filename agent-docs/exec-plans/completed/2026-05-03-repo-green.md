# Get repo tests and coverage green

Status: completed
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Get the current checkout through the repo's canonical typecheck, test, and coverage/acceptance lanes, fixing only the failures that can be safely attributed in this shared dirty tree.

## Success criteria

- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm test:coverage` or `pnpm verify:acceptance` passes, with coverage thresholds green.
- Any necessary fixes preserve unrelated active work and do not overwrite existing dirty edits.

## Scope

- In scope: failing tests, type errors, coverage failures, and direct minimal source/test fixes needed to make the repo green.
- Out of scope: unrelated product refactors, broad architecture changes, and resolving active work rows except where their current diff is directly breaking verification.

## Constraints

- Technical constraints: preserve workspace package boundaries, avoid unsafe casts, keep fixes scoped to proven failures, and avoid generated/private artifact leakage.
- Product/process constraints: use the active coordination ledger, preserve unrelated dirty work, and redact personal identifiers from generated files and handoff text.

## Risks and mitigations

1. Risk: existing in-flight dirty work causes failures outside this task's ownership.
   Mitigation: identify the exact failing target before editing, avoid reverting other work, and report blockers if a safe fix would require taking over another active row.
2. Risk: full acceptance is expensive and may fail late on app or coverage lanes.
   Mitigation: start with canonical commands, then use focused package/app commands to iterate before rerunning the full lane.

## Tasks

1. Run canonical typecheck/test/coverage checks and summarize the failing targets.
2. Inspect the responsible code/tests and active ledger overlap before editing.
3. Apply narrow fixes for attributable failures.
4. Rerun focused checks, then canonical checks.
5. Complete required audits and close the plan/commit if safely scoped.

## Decisions

- Repair missing active-plan ledger rows directly when the repo audit fails on coordination state; do not modify the underlying active plan scope unless its implementation files are proven to be the verification blocker.

## Verification

- Commands to run: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage` or `pnpm verify:acceptance`, plus focused package/app checks for any edited owners.
- Expected outcomes: all required commands exit 0, or any remaining failures are documented as pre-existing/unrelated with exact targets.
- Current evidence:
  - `pnpm typecheck` passed.
  - `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts --project cli-schemas-smoke test/release-script-coverage-audit.test.ts --no-coverage` passed after the ledger repair.
  - `pnpm test` passed after the ledger repair.
  - `pnpm verify:acceptance` passed package coverage and failed in app verification on stale Cloudflare runner bundle expectations, hosted-web stale assertions, and one hosted auth dialog lint rule.
  - Focused hosted-web tests for auth button, phone auth, layout, page, settings, experiment projections, and HTTP helpers passed.
  - `pnpm --dir apps/web lint` passed.
  - Focused Cloudflare runner bundle contract tests passed.
  - `pnpm --dir apps/cloudflare verify` passed.
  - `pnpm --dir apps/web verify` passed.
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/prisma-store-client.test.ts test/settings-phone-sync-route.test.ts --no-coverage` passed after preserving generated Prisma enum exports in the Prisma client mock.
  - `pnpm --dir packages/core build && pnpm --dir packages/vault-usecases typecheck` passed after forcing the core build to re-emit `dist` after cleanup.
  - `pnpm verify:acceptance` passed end to end.
Completed: 2026-05-03
