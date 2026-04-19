## Title

Hard-cut the remaining hosted-wake compatibility surfaces after the cursor correctness fixes.

## Why Now

The hosted wake cutover is already on the greenfield path:

- no deployed environments need historical migration replay
- web owns canonical `HostedWake` and `HostedExecutionCursor`
- runtime resume/finalize compatibility is now limited to a small pre-CAS seam

That makes the remaining cleanup safer to land as a direct hard cut instead of carrying legacy names and result branches forward.

## Scope

1. Remove the unused `includeCommittedCompatibility` branch from hosted runtime completion and tighten the completed-result type to the final shape only.
2. Move the `apps/web` wake lifecycle wrapper under `src/lib/hosted-wake/` ownership and update imports/tests off the old `hosted-execution/` path.
3. Replace the staged hosted-wake Prisma migration pair with one schema-matching greenfield baseline and update the migration guard test accordingly.

## Constraints

- Do not break the committed-result resume path used by Cloudflare before the final cursor CAS.
- Do not overlap the active Cloudflare cursor/CAS work beyond the shared runtime result contract.
- Keep the Prisma baseline faithful to `apps/web/prisma/schema.prisma`; do not drop hosted-wake constraints or payload storage seams.
- Preserve unrelated dirty worktree edits.

## Verification Plan

- `pnpm typecheck`
- coverage-bearing focused verification for `packages/assistant-runtime` and `apps/web`
- Prisma baseline/schema diff check from empty schema to current `apps/web/prisma/schema.prisma`

## Expected Result

The hosted runtime returns only the final completed payload shape, the wake lifecycle seam lives with hosted-wake ownership instead of under hosted-execution naming, and hosted-wake schema history is represented by a single greenfield baseline migration.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
