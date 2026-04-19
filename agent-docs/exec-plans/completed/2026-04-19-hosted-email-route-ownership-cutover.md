## Title

Hard-cut hosted email reply-alias ownership away from Cloudflare storage.

## Goal

Remove the Cloudflare R2 hosted-email route store so reply aliases no longer persist durable `aliasKey -> userId` routing truth in the execution plane. Cloudflare should only parse alias tokens, ask `apps/web` to resolve and authorize ingress, and persist raw email plus wake hints only after the web-owned control plane returns an authorized member.

## Scope

- `apps/cloudflare/src/hosted-email/{routes,route-crypto,worker-ingress}.ts`
- `apps/cloudflare/src/{hosted-email,web-control-plane}.ts`
- `apps/cloudflare/test/hosted-email*.test.ts`
- `apps/web/app/api/internal/hosted-execution/email/**`
- `apps/web/src/lib/hosted-onboarding/{hosted-member-store,hosted-member-routing-store,hosted-member-routing-state}.ts`
- `apps/web/test/hosted-execution-email-callback-routes.test.ts`
- `apps/web/prisma/schema.prisma`

## Constraints

- `apps/web` remains the canonical owner of hosted routing facts and sender authorization.
- Cloudflare-hosted email aliases stay routing hints only, never authority.
- Keep the reply alias stable per user.
- Preserve unrelated dirty-tree edits in hosted wake, runner, and onboarding files.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/hosted-email/routes.ts apps/cloudflare/src/hosted-email/route-crypto.ts apps/cloudflare/src/hosted-email/worker-ingress.ts apps/cloudflare/src/web-control-plane.ts apps/cloudflare/test/hosted-email-routes.test.ts apps/cloudflare/test/hosted-email.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/web/app/api/internal/hosted-execution/email/resolve-route/route.ts apps/web/app/api/internal/hosted-execution/email/register-reply-alias/route.ts apps/web/src/lib/hosted-onboarding/hosted-member-store.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-state.ts apps/web/prisma/schema.prisma apps/web/test/hosted-execution-email-callback-routes.test.ts`
- Targeted proof:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-execution-email-callback-routes.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-email-routes.test.ts apps/cloudflare/test/hosted-email.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/cloudflare/test/hosted-email-subject.test.ts --no-coverage`

## Notes

- Prefer hard deletion over compatibility shims for the Cloudflare route-store seam.
- Direct proof should show alias ingress succeeds only when web resolves the alias key and sender together, while public-sender misses still accept-and-drop.
- Full typecheck remains blocked by unrelated dirty-tree failures in hosted-wake files outside this seam:
  - `apps/cloudflare/src/user-runner.ts`
  - `apps/cloudflare/src/user-runner/runner-wake-state.ts`
  - `apps/cloudflare/test/runner-wake-state.test.ts`
  - `apps/cloudflare/test/workers/test-hosted-wake-control.ts`
  - `apps/web/test/hosted-wake-store.test.ts`
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
