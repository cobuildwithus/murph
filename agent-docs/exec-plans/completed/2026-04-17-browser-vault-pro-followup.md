## Goal

Fix the Pro-reviewed browser-vault session contract so the browser can reproduce the exact hosted-storage AAD required to decrypt the latest snapshot locally.

## Scope

- `apps/cloudflare/src/index.ts`
- `apps/web/src/lib/browser-vault/context.tsx`
- `apps/web/test/browser-vault-session-route.test.ts`
- `packages/cloudflare-hosted-control/src/client.ts`
- `packages/cloudflare-hosted-control/test/client.test.ts`

## Constraints

- Preserve the landed browser-vault hard cut; keep the fix minimal and scoped to the session/decrypt seam.
- Do not weaken encryption or remove AAD from snapshot encryption.
- Preserve unrelated dirty worktree edits and active lanes.
- Avoid exposing secrets or personal identifiers in code, commits, or handoff.

## Verification

- `pnpm --dir apps/web typecheck`
- `pnpm --dir packages/cloudflare-hosted-control test:coverage`
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/browser-vault-session-route.test.ts --no-coverage`

## Current results

- `pnpm --dir apps/web typecheck`: passed.
- `pnpm --dir packages/cloudflare-hosted-control test:coverage`: passed.
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/browser-vault-session-route.test.ts --no-coverage`: passed.
- The fix keeps snapshot encryption AAD intact and extends the browser-vault session response with the exact `snapshotAad` descriptor the browser needs for local decrypt.

Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
