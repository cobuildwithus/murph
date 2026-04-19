## Goal

Collapse hosted wake encrypted payload handling to one canonical full `HostedExecutionWake` shape for every wake kind.

## Scope

- `packages/hosted-execution/src/{contracts,parsers}.ts`
- `apps/web/src/lib/hosted-wake/{queue,payload,store-projections}.ts`
- Focused hosted wake tests/helpers under `packages/hosted-execution/test/**`, `apps/web/test/**`, and `apps/cloudflare/test/**`

## Constraints

- Treat this as a greenfield hard cut: no compatibility branch for already-queued partial conversation payload rows.
- Keep wake row columns as indexed projections (`kind`, `occurredAt`, `userId`, dedupe/coalescing metadata); only the encrypted payload shape is being unified.
- Preserve unrelated in-flight worktree edits, especially the existing edit in `apps/web/test/hosted-wake-queue.test.ts`.
- Do not broaden into runtime wake execution behavior beyond the payload/schema contract.

## Verification

- `pnpm typecheck`
- `pnpm test:diff packages/hosted-execution apps/web apps/cloudflare`
- Direct proof from focused hosted wake parser/queue tests covering full-wake payload round-trips
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
