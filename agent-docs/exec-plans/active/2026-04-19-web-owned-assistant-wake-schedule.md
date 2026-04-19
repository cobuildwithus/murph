## Title

Make hosted assistant due-work truth web-owned by persisting the next assistant wake on the canonical hosted cursor.

## Goal

Remove the remaining Durable Object ownership of assistant future due-work so `/api/internal/hosted-wake/materialize` can materialize due assistant work from web-owned state without relying on Cloudflare hint authority.

## Scope

- `apps/web/prisma/schema.prisma`
- `apps/web/src/lib/hosted-wake/{materialize,store,store.types,store-projections,store-data}.ts`
- `apps/web/app/api/internal/hosted-wake/{commit,materialize,finalize}/route.ts`
- `packages/hosted-execution/src/{contracts,parsers}.ts`
- `apps/cloudflare/src/{user-runner,web-control-plane}.ts`
- focused hosted-wake tests under `apps/web/test/**` and `apps/cloudflare/test/**`

## Constraints

- Treat web/Postgres as the canonical owner of assistant future due-work truth.
- Do not make web parse or decrypt hosted execution bundles to recover schedule state.
- Keep far-future assistant work out of `HostedWake`; queue rows remain runnable work only.
- Preserve overlapping dirty-tree hosted-wake edits outside this exact ownership cleanup.

## Verification

- Passed: `pnpm --dir ../.. exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-wake-materialize.test.ts apps/web/test/hosted-wake-routes.test.ts --no-coverage`
- Passed: `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/web-control-plane.test.ts --no-coverage`
- Passed: `pnpm --dir packages/hosted-execution typecheck`
- Blocked by unrelated pre-existing repo/worktree issues:
  - `pnpm --dir apps/web typecheck` fails in `apps/web/test/hosted-wake-store.test.ts` on an existing `AppendHostedWakeInput` test shape mismatch.
  - `pnpm --dir apps/cloudflare typecheck` fails in existing hosted-email files/tests (`route-store.ts` missing plus unrelated hosted-email type errors).
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/web-control-plane.test.ts apps/cloudflare/test/user-runner.test.ts --no-coverage` is blocked by the same missing hosted-email module import.

## Notes

- The clean end state is a web-owned `assistantNextWakeAt` projection updated transactionally with cursor commit.
- Cloudflare may still keep local alarm timing as an acceleration cache, but missing or stale DO hints must not lose due assistant work.
- The projection must represent the whole assistant lane wake, not only cron jobs, because hosted assistant retries and recovery also feed `assistantWakeAt`.
- The current runner stack also uses the finalize route/proof flow; the assistant wake projection is now forwarded through both initial commit and finalize publish paths so the canonical cursor stays authoritative after bundle finalization.
