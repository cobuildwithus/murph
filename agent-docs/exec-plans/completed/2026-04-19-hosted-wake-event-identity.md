## Goal

Preserve immutable hosted wake event identity even when coalescing work rewrites the runnable wake payload in place.

## Scope

- `apps/web/prisma/{schema.prisma,migrations/**}`
- `apps/web/src/lib/hosted-wake/{queue,lifecycle,store,store-append,store-data,store-projections,store.types}.ts`
- Focused hosted wake tests under `apps/web/test/**`
- Minimal shared contract/parser updates under `packages/hosted-execution/src/{contracts,parsers}.ts` and focused tests if the status contract changes

## Constraints

- Treat event identity and runnable wake intent as separate seams.
- Do not rewrite a coalesced wake row's `dedupeKey` in place once the row exists.
- Preserve unrelated in-flight hosted wake payload/runtime edits already present in the worktree.
- Keep the change narrow: no broader queue-behavior refactor beyond the identity/replacement seam needed to fix lookup, auditability, and idempotency.

## Verification

- `pnpm typecheck`
- `pnpm test:diff apps/web packages/hosted-execution`
- Direct proof from focused hosted wake store/status tests covering coalesced replacement lookups
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
