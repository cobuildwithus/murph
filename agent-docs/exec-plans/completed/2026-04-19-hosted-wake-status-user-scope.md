## Goal

Fail closed for hosted wake event-id lookups by requiring the bound `userId` on lifecycle/status resolution so one member's callback cannot inspect another member's wake state.

## Scope

- `apps/web/app/api/internal/hosted-wake/status/route.ts`
- `apps/web/src/lib/hosted-wake/{lifecycle,queue,store,store-data}.ts`
- `apps/web/prisma/{schema.prisma,migrations/**}` only if the Prisma owner seam needs an explicit composite key/index for user-scoped event lookups
- Focused hosted wake tests under `apps/web/test/**`

## Constraints

- Keep the fix narrow and compatible with the in-flight hosted wake event-identity work.
- Fail closed on event/user mismatch: return absent lifecycle/target data instead of another user's state.
- Do not weaken existing duplicate/coalescing protections; scope them.
- Preserve unrelated hosted wake payload/runtime edits already present in the worktree.

## Verification

- `pnpm typecheck`
- `pnpm test:diff apps/web`
- Direct proof from focused hosted wake route/store tests that a callback bound to user A querying user B's `eventId` gets no lifecycle state.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
