# Long-Term Hosted Architecture Cleanup

## Goal

Land the supplied final hosted trust-boundary cleanup patch against the current repo snapshot without overwriting unrelated worktree edits.

## Scope

- Split privileged Cloudflare control signing from normal dispatch signing so `/internal/users/**` control routes no longer share the same HMAC authority as `/internal/dispatch`.
- Keep the final Cloudflare-to-web device connect-link path on the same signed control-plane model instead of any bearer-token seam.
- Update the hosted env/config/docs surface and focused regression tests so the current repo shape documents the new signing-secret precedence clearly.

## Constraints

- Treat this as a high-risk auth/trust-boundary landing across `apps/cloudflare`, `apps/web`, and `packages/hosted-execution`.
- Preserve unrelated dirty-tree edits already present in the repo.
- Port the patch intent onto the current split-file structure instead of forcing the historical patch snapshot, and do not reintroduce already removed one-shot runner cleanup reversals.

## Verification

- Focused proof around signed control-route auth, signed connect-link forwarding, and control-secret precedence.
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- Completed on 2026-04-05.
- Final audit follow-up fixed the Cloudflare smoke helper so `/internal/users/**` smoke calls use control-secret precedence, and it removed direct bearer-only resolution for non-proxy device connect-link clients.
- Verification:
  - Focused hosted auth proof passed: `pnpm vitest run --coverage.enabled=false apps/web/test/hosted-execution-internal.test.ts apps/web/test/device-sync-internal-connect-route.test.ts apps/cloudflare/test/env.test.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/deploy-automation.test.ts packages/hosted-execution/test/hosted-execution.test.ts`
  - Audit follow-up proofs passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/smoke-hosted-deploy.test.ts --no-coverage` and `pnpm --dir packages/hosted-execution exec vitest run test/hosted-execution.test.ts --coverage.enabled=false`
  - `pnpm typecheck` passed.
  - `pnpm test` still fails on the pre-existing hosted-web settings assertion mismatch in `apps/web/test/device-sync-settings-routes.test.ts` (`headline` expected `Connected and syncing normally`, actual `Connected`).
  - `pnpm test:coverage` still fails on that same pre-existing hosted-web test and on the pre-existing coverage thresholds in `packages/hosted-execution/src/client.ts`, `env.ts`, and `routes.ts`.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
