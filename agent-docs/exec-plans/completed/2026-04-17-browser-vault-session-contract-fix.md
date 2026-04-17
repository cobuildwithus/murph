## Goal

Align the shared `@murphai/cloudflare-hosted-control` browser-vault session contract with the worker and browser all-or-none snapshot triad semantics.

## Scope

- `packages/cloudflare-hosted-control/src/client.ts`
- `packages/cloudflare-hosted-control/test/client.test.ts`
- `apps/web/app/api/browser-vault/session/route.ts`
- `apps/web/test/browser-vault-session-route.test.ts`

## Constraints

- Keep the change scoped to the supplied ChatGPT patch intent only.
- Preserve existing request wiring and unrelated hosted-control behavior.
- Reject partial browser-vault snapshot payloads instead of normalizing them through the shared client.
- Surface upstream browser-vault session contract failures as server-side route errors instead of browser request errors.

## Verification

- `pnpm typecheck`
- `pnpm test:diff packages/cloudflare-hosted-control/src/client.ts packages/cloudflare-hosted-control/test/client.test.ts`
- `pnpm --dir packages/cloudflare-hosted-control test:coverage`
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/browser-vault-session-route.test.ts --no-coverage`
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
