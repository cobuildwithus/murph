# 2026-03-31 Gateway Serving Cutover

## Goal

Land the supplied gateway cutover so the local gateway read path uses rebuildable serving tables in `.runtime/gateway.sqlite`, inbox capture ingestion advances incrementally from a stored cursor, `@murph/gateway-core` owns the transport-neutral gateway contracts/routes/snapshot helpers used by assistantd and hosted adapters, and hosted/local gateway sends share retry-safe event-wait and client-request idempotency semantics.

## Scope

- `packages/cli/src/{assistant/outbox.ts,gateway/send.ts,gateway/store.ts}`
- `packages/cli/test/gateway-local-service.test.ts`
- `packages/gateway-core/{README.md,package.json,src/*}`
- `packages/hosted-execution/src/{builders,contracts,parsers}.ts`
- `apps/cloudflare/src/index.ts`
- `packages/assistantd/README.md`
- `ARCHITECTURE.md`

## Risks

- stale local gateway projections after successful sends
- cursor mistakes that skip or duplicate inbox captures
- duplicate hosted or local sends when MCP/remote callers retry the same gateway request
- package-ownership changes that break workspace source resolution or package builds

## Verification

- focused gateway regression: `pnpm --dir packages/cli exec vitest run test/gateway-local-service.test.ts`
- focused hosted gateway regression: `pnpm --dir apps/cloudflare exec vitest run test/index.test.ts`
- required repo verification: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`

## Status

In progress during this turn.
Status: completed
Updated: 2026-03-31
Completed: 2026-03-31
