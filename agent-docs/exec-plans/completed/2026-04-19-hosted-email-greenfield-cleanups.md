## Title

Greenfield hosted-email seam cleanup after the alias-ownership cutover.

## Goal

Tighten the hosted-email architecture so the long-term seam reads cleanly:

- rename the callback principal so it describes route resolution instead of the removed public-route path
- centralize the reply-alias registration and route-resolution callback contract in `packages/hosted-execution`
- remove `replyAliasAddress` from serialized hosted email thread targets so thread targets keep only canonical conversation state, not execution residue

## Scope

- `packages/hosted-execution/src/hosted-email.ts`
- `packages/runtime-state/src/hosted-email.ts`
- `apps/cloudflare/src/hosted-email/{routes,transport}.ts`
- `apps/web/app/api/internal/hosted-execution/email/resolve-route/route.ts`
- focused hosted-email tests under `packages/runtime-state/test/**`, `packages/hosted-execution/test/**`, `apps/cloudflare/test/**`, `apps/web/test/**`
- direct thread-target consumers under `packages/inboxd/**` and `packages/cli/test/**` if needed

## Constraints

- Keep the web/Postgres ownership split intact.
- Do not reintroduce any compatibility reader for the removed thread-target alias field.
- Preserve unrelated dirty-tree hosted-wake, onboarding, and runner work.

## Verification

- `pnpm --filter @murphai/hosted-execution typecheck`
- `pnpm --filter @murphai/runtime-state typecheck`
- `pnpm --filter ./packages/inboxd typecheck`
- `pnpm --filter ./packages/cli typecheck`
- `pnpm --filter ./apps/web typecheck`
- `pnpm --filter ./apps/cloudflare typecheck`
- `pnpm exec vitest run test/hosted-email.test.ts --config vitest.config.ts --no-coverage` in `packages/runtime-state`
- `pnpm exec vitest run test/hosted-execution-builders-hosted-email.test.ts --config vitest.config.ts --no-coverage` in `packages/hosted-execution`
- `pnpm exec vitest run test/email-connector.test.ts --config vitest.config.ts --no-coverage` in `packages/inboxd`
- `pnpm exec vitest run test/assistant-channel.test.ts --config vitest.workspace.ts --no-coverage` in `packages/cli`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-execution-email-callback-routes.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-email.test.ts apps/cloudflare/test/hosted-email-routes.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/cloudflare/test/hosted-email-subject.test.ts --no-coverage`

## Notes

- This is a naming and contract hard cut, not a behavior expansion.
- The new callback contract should be imported by both Cloudflare and web rather than duplicated as string literals and ad hoc payload parsing.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
