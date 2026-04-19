## Goal

Replace the hosted runtime's broad system-maintenance loop with explicit wake lanes so each hosted system wake only runs its own work.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/execution.ts`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- related focused `packages/assistant-runtime/test/**`

## Constraints

- Preserve the existing conversation-lane behavior.
- Do not broaden into `apps/web/**`, `apps/cloudflare/**`, or shared hosted-execution wake-contract changes in this pass.
- Keep the hosted system lane aligned with the wake-cutover guide: explicit wake kind only, with no generic parser/device-sync/assistant sweep.
- Preserve unrelated in-flight worktree edits.

## Verification

- `pnpm typecheck`
- `pnpm --dir packages/assistant-runtime test:coverage`
- focused assistant-runtime tests for execution, maintenance, and summary behavior
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
