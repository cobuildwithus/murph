## Goal

Hard-cut Oura-specific webhook-admin secret plumbing out of generic device-sync config, env, and upkeep surfaces while preserving existing Oura webhook verification/admin behavior through provider-owned assembly.

## Scope

- `packages/device-syncd/src/types.ts`
- `packages/device-syncd/src/config.ts`
- `packages/device-syncd/src/http.ts`
- `packages/device-syncd/src/providers/oura.ts`
- `apps/web/src/lib/device-sync/env.ts`
- `apps/web/src/lib/device-sync/webhook-admin-service.ts`
- `apps/web/app/api/device-sync/webhooks/[provider]/route.ts`
- focused tests and docs for touched device-sync surfaces

## Constraints

- Keep generic hosted/local device-sync surfaces provider-agnostic.
- Do not add new provider-specific fields to shared config or env types.
- Keep the change focused on architecture cleanup, not new provider support.
- Preserve unrelated in-flight work elsewhere in the tree.

## Verification

- `pnpm typecheck`
- focused `pnpm test:diff` or owner-scoped device-syncd/apps-web verification for the touched paths
- readback of updated docs for the provider-owned webhook-admin config seam
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
