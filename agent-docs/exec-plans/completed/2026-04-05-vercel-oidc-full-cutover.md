# Vercel OIDC Full Cutover

## Goal

Implement the supplied final Vercel OIDC full cutover patch on top of the current managed-hosted cutover tree so the web/Vercel to Cloudflare edge uses Vercel OIDC bearer identity instead of shared HMAC secrets, while preserving the narrow Cloudflare to web callback signing seam.

## Why this plan exists

- The supplied patch is a high-risk trust-boundary change across shared contracts, web, Cloudflare, deploy automation, and docs.
- The live repo already contains the managed-hosted cutover changes, so the patch may need careful porting rather than blind application.
- The branch still contains unrelated dirty edits that must stay out of scope.

## Constraints

- Preserve unrelated dirty worktree edits.
- Treat the patch as behavioral intent, not overwrite authority.
- Keep OIDC limited to the web/Vercel to Cloudflare public control edge.
- Keep Cloudflare to web internal callbacks on the narrow `HOSTED_WEB_INTERNAL_SIGNING_SECRET` HMAC seam.
- Remove the old web to Cloudflare shared-secret auth path instead of leaving compatibility lanes.
- Run required verification and required final audit review before commit.

## Workstreams

1. Inspect the supplied patch against the live tree and port any non-applying hunks.
2. Land the OIDC verifier/client/env/deploy changes across shared packages, web, Cloudflare, and docs.
3. Run focused verification plus direct scenario proof for the new bearer/OIDC path.
4. Run final review, apply follow-up fixes, and commit the scoped landing.

## Current state

- Managed-hosted cutover final integration is already merged on the branch.
- Unrelated assistant/preset edits remain dirty in the worktree and must be preserved.
- No active execution plan currently covers the OIDC cutover lane.
- Patch inspection is complete; it does not apply cleanly to the live tree because the repo already moved past the snapshot it targeted.
- The live tree already has newer device-sync/share/runtime surfaces, so this landing is porting only the OIDC edge-auth intent plus the narrow web-internal HMAC seam.
- Shared hosted-execution env/client helpers, web dispatch/control callers, and the Cloudflare worker now use Vercel OIDC bearer identity on the web-to-worker control edge.
- The narrow `HOSTED_WEB_INTERNAL_SIGNING_SECRET` HMAC seam remains only for Cloudflare-owned callbacks back into hosted web routes.
- Deploy workflow, preflight, Wrangler config, smoke tooling, and architecture/docs now require and describe the Vercel OIDC validation env plus `HOSTED_WEB_BASE_URL`.
- Verification is complete for package/app typechecks, focused hosted-execution tests, focused web OIDC tests, focused Cloudflare OIDC/deploy tests, `pnpm install --frozen-lockfile`, `pnpm deps:ignored-builds`, and `git diff --check`.
- The broader wrapper commands still surface pre-existing unrelated failures in `apps/web/test/device-sync-settings-routes.test.ts` and `apps/cloudflare/test/user-runner.test.ts`.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
