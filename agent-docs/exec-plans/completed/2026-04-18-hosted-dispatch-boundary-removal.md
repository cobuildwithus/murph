# Hosted dispatch-boundary removal

Status: completed
Created: 2026-04-18
Updated: 2026-04-18

## Goal

- Remove the remaining shared dispatch-shaped hosted execution compatibility
  boundary so hosted execution is wake-first across shared contracts and the
  runtime entrypoint.
- Keep the change scoped to the dispatch compatibility seam rather than
  reopening unrelated hosted cleanup or release-manifest work.

## Success criteria

- `HostedExecutionDispatchRequest` is no longer the live boundary between
  `packages/hosted-execution` and `packages/assistant-runtime`.
- Hosted runtime execution accepts wake-first request shapes directly and keeps
  the conversation-vs-system split intact.
- Compatibility residue is deleted or pushed fully behind test-only adapters.
- Verification and required audit passes are green for the touched owner
  packages.

## Scope

- In scope:
  - `packages/hosted-execution/src/{contracts,builders,parsers}.ts`
  - `packages/assistant-runtime/src/hosted-runtime/**`
  - directly affected hosted runtime / hosted execution tests
  - durable docs only if the boundary contract materially changes
- Out of scope unless required by the seam:
  - unrelated release-fix work in `package.json`, `pnpm-lock.yaml`,
    `pnpm-workspace.yaml`
  - Cloudflare e2e stabilization already tracked separately
  - broad webhook-receipt or Cloudflare storage cleanup outside this contract

## Constraints

- Preserve unrelated dirty-tree edits and active ledger rows.
- Coordinate carefully with the active release lane already touching
  `packages/hosted-execution/**`.
- Prefer deletion of compatibility layers over adding another shim.

## Tasks

1. Inspect the remaining dispatch boundary and map all live callers.
2. Use parallel subagents to split analysis across hosted-execution contracts
   and assistant-runtime execution/tests.
3. Land the wake-first contract/runtime cleanup with the smallest safe diff.
4. Run truthful verification plus required audit passes, then commit the scoped
   batch.

## Verification

- Prefer truthful owner-level verification via `pnpm test:diff <changed paths>`
  if it resolves to the touched hosted packages.
- Otherwise run the touched package coverage-bearing commands directly plus
  `pnpm typecheck`.
- Completed:
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-entry-execution.test.ts test/hosted-runtime-execution.test.ts test/hosted-runtime-maintenance.test.ts test/hosted-runtime-callbacks.test.ts test/hosted-runtime-summary.test.ts test/hosted-runtime-typing.test.ts test/hosted-device-sync-runtime.test.ts test/hosted-runtime-parsers.test.ts test/hosted-email-subject.test.ts --no-coverage`
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-execution.test.ts test/hosted-runtime-maintenance.test.ts --no-coverage`
  - `pnpm --dir packages/assistant-runtime test:coverage`
  - `pnpm --dir packages/hosted-execution typecheck`
  - `pnpm --dir apps/web typecheck`
  - `pnpm typecheck` still fails only in pre-existing unrelated `scripts/dev-hosted-local/runtime.ts` lines 406 and 413
Completed: 2026-04-18
