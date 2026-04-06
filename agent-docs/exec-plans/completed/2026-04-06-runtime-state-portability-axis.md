# Add runtime-state portability axis

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Make runtime-state portability explicit so hosted snapshot inclusion is driven by a positive portability classification instead of exclusion of known-local paths.

## Success criteria

- Runtime-state helpers expose an explicit `portable` vs `machine_local` classification alongside the existing durability/rebuildability taxonomy.
- Hosted bundle snapshot selection includes only runtime-state paths marked portable and fails closed for unclassified operational paths.
- Durable docs describe the portability axis and the hosted snapshot contract consistently.
- Required verification passes for the touched surface.

## Scope

- In scope:
  - `packages/runtime-state/**`
  - Durable docs that define the runtime taxonomy and hosted snapshot contract
- Out of scope:
  - Reclassifying unrelated assistant-state or operator-home storage
  - Broader hosted-runner behavior changes outside snapshot path selection

## Constraints

- Preserve unrelated in-flight edits in the dirty worktree.
- Default unknown `.runtime/operations/**` paths to `machine_local` so new operational state must be classified explicitly before it can ride in hosted snapshots.
- Keep the change narrow: classification metadata plus snapshot policy and matching docs/tests.

## Risks and mitigations

1. Risk: Marking an existing operational path `machine_local` breaks hosted behavior that quietly depended on it.
   Mitigation: Classify only the currently understood paths, keep write-operation receipts portable, and extend hosted-bundle tests around included/excluded files.
2. Risk: The docs keep describing hosted inclusion as a broad `.runtime/**` rule after the code tightens to an allowlist.
   Mitigation: Update the architecture and runtime-state docs in the same change.

## Tasks

1. Add explicit runtime-state portability types/helpers in `packages/runtime-state`.
2. Switch hosted snapshot selection to portability-based inclusion.
3. Update focused tests to prove portable vs machine-local snapshot behavior.
4. Update durable docs and complete verification/audit/commit.

## Decisions

- Use `portable` and `machine_local` as the explicit portability axis names.
- Treat `.runtime/operations/**` as `machine_local` by default unless a more specific portable classification exists.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm --filter @murphai/runtime-state test`
- Expected outcomes:
  - Typecheck passes.
  - Focused runtime-state tests prove the new snapshot inclusion contract.
- Outcomes:
  - `pnpm typecheck` failed for a credibly unrelated pre-existing reason in `packages/gateway-local/src/store.ts` and `packages/gateway-local/src/store/snapshot-state.ts`.
  - `pnpm --filter @murphai/runtime-state exec vitest run --config vitest.config.ts --no-coverage test/hosted-bundle.test.ts -t 'hosted execution snapshots collapse into one workspace bundle and externalize raw artifacts|runtime-state portability defaults operational paths to machine-local unless explicitly marked portable'` passed.
  - `pnpm exec tsx --eval '...'` direct snapshot scenario passed and confirmed portable runtime-state paths were restored while machine-local and legacy flat `.runtime/*` paths were excluded.
  - Required `simplify` audit found one medium issue: unclassified legacy `.runtime/*` paths were still admitted by a null-descriptor fallback. The snapshot filter now default-denies `.runtime/**` unless the path is explicitly portable or a narrow traversal container.
  - Required final review found no remaining issues.
Completed: 2026-04-06
