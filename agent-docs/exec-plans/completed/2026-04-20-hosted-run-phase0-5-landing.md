## Title

Land the supplied hosted-run phases 0-5 substrate patch cleanly on top of the current hosted-wake/web-control worktree.

## Goal

Merge the run-centric hosted execution substrate patch into the current repo without trampling overlapping active work, preserving the existing compatibility wake path while adding the new hosted-run schema, contracts, store, API routes, and Cloudflare web-control helpers.

## Scope

- `agent-docs/index.md`
- `agent-docs/references/hosted-run-protocol.md`
- `apps/cloudflare/src/web-control-plane.ts`
- `apps/web/app/api/internal/hosted-run/{acquire,commit,finalize,log,status}/route.ts`
- `apps/web/app/api/internal/hosted-wake/{commit,finalize}/route.ts`
- `apps/web/prisma/{schema.prisma,migrations/2026040600_init/migration.sql}`
- `apps/web/src/lib/hosted-run/store.ts`
- `apps/web/src/lib/hosted-wake/{store,store.types,store-projections}.ts`
- `packages/hosted-execution/src/{contracts,parsers}.ts`
- focused verification and completion-workflow artifacts required for this change

## Constraints

- Preserve unrelated dirty-tree edits and merge on top of overlapping hosted-wake and package-boundary lanes instead of reverting them.
- Keep the old hosted-wake route family functional as a compatibility path while adding the hosted-run path.
- Treat the supplied patch as behavioral intent, not overwrite authority; reconcile any conflicts against the current repo state.
- Keep web/Postgres as the canonical hosted coordination owner and avoid introducing new Cloudflare-owned recovery truth.

## Verification

- Pending: `pnpm typecheck`
- Pending: truthful scoped coverage/test lanes for the touched hosted execution, hosted web, and Cloudflare surfaces
- Pending: required completion-workflow audit passes

## Notes

- `git apply --check /Users/willhay/Downloads/hosted-run-phase0-5.patch` currently fails only on `packages/hosted-execution/src/parsers.ts` because the empty-import cleanup lane already changed that file.
- The supplied patch otherwise matches the current tree shape and will be merged manually where necessary.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
