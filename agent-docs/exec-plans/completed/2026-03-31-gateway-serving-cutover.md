# Gateway Serving Cutover

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

Land the remaining gateway go-live fixes on top of the existing serving cutover: keep hosted reply-to validation aligned with local channel-message semantics, switch hosted dispatch ids to UUIDs, make local serving-store sync conservative via full capture signatures until inbox exposes a reliable update cursor, and fix the dedicated `@murph/gateway-core` source entrypoint shim.

## Scope

- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/test/index.test.ts`
- `packages/cli/src/gateway/store.ts`
- `packages/cli/test/gateway-local-service.test.ts`
- `packages/gateway-core/src/index.ts`

## Risks

- hosted/local reply-target validation drift
- stale local gateway serving rows after capture or attachment rewrites
- broken source-resolved `@murph/gateway-core` imports in workspace consumers

## Verification

- `pnpm --dir packages/cli exec vitest run test/gateway-local-service.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/index.test.ts --no-coverage`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

Completed after landing the hosted reply-target validation fix, UUID-based hosted gateway dispatch ids, conservative serving-store capture signatures, and the direct `@murph/gateway-core` root entrypoint proof.

Completed: 2026-03-31
