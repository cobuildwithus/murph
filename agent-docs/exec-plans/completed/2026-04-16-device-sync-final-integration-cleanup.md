## Goal

Reconcile the completed device-sync architecture cleanup lanes into one final hard-cut shape with provider-owned webhook preflight/admin config, shared provider assembly reused by hosted web, and no provider-specific webhook secrets on generic surfaces.

## Scope

- `packages/device-syncd/src/{config,http,public-ingress,types,webhook-verification}.ts`
- `packages/device-syncd/src/providers/oura.ts`
- `packages/device-syncd/test/**`
- `apps/web/src/lib/device-sync/**`
- `apps/web/app/api/device-sync/webhooks/[provider]/route.ts`
- focused docs/readmes for the final architecture wording

## Constraints

- Do not add new providers.
- Remove leftover compatibility or migration seams instead of preserving them.
- Keep shared ingress generic and provider-specific webhook logic inside provider modules.
- Preserve unrelated worktree edits.

## Verification

- `pnpm typecheck`
- focused truthful verification for touched `packages/device-syncd` and `apps/web` surfaces
- readback of updated docs for the final architecture wording
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
