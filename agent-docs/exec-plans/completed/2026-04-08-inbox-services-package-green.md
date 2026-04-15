# Get packages/inbox-services fully green

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Get `packages/inbox-services` to pass its package-local tests and canonical package-local coverage gate honestly.
- Use 5 GPT-5.4 worker agents on disjoint seams while preserving the existing dirty worktree in `src/inbox-app/environment.ts`.

## Success criteria

- `pnpm --dir packages/inbox-services test:coverage` passes.
- Coverage remains on `src/**/*.ts` with the canonical repo thresholds from `config/vitest-coverage.ts`.
- Changes stay inside `packages/inbox-services/**` unless a minimal package-local dependency seam forces a broader change.

## Current state

- Package-local coverage is extremely low with only one existing test file.
- `src/inbox-app/environment.ts` already has uncommitted edits from another lane and must be preserved.
- The package already uses the shared Vitest coverage config, so this lane should focus on package-local tests and only the smallest required source fixes.

## Worker split

1. Inbox-services service layer:
   `src/{index.ts,linq-endpoint.ts,process-kill.ts,vault-paths.ts,inbox-services/{connectors.ts,daemon.ts,query.ts,state.ts}}`
2. Inbox-services parser/shared/promotions layer:
   `src/inbox-services/{parser.ts,promotions.ts,shared.ts}`
3. Inbox app bootstrap layer:
   `src/inbox-app/{bootstrap-doctor-strategies.ts,bootstrap-doctor.ts,service.ts,linq-endpoint.ts}`
4. Inbox app read/runtime layer:
   `src/inbox-app/{reads.ts,runtime.ts,sources.ts,promotions.ts}`
5. Inbox app type/environment layer:
   `src/inbox-app/{types.ts,environment.ts}` with explicit instruction to preserve the existing dirty edits in `environment.ts`

## Verification

- `pnpm --dir packages/inbox-services test:coverage`
- `pnpm --dir packages/inbox-services typecheck`
- `pnpm typecheck`
Completed: 2026-04-08
