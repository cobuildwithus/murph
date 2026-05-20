# Cloudflare Direct R2 Smoke Egress

## Goal

Fix the hosted deploy smoke loop where the direct R2 presigned PUT smoke enters `ContainerProxy` and fails while proxying a large request stream.

## Constraints

- Preserve unrelated active hosted runner and package hygiene work.
- Do not expose account IDs, object keys, credentials, local paths, user IDs, or full presigned URLs in logs, docs, tests, or handoff.
- Keep provider/internal outbound interception for known hosts.
- Keep direct R2 uploads off the Worker body path.

## Plan

1. Verify the observed failure mode from GitHub Actions and Cloudflare logs.
2. Adjust runner container outbound registration so generic HTTPS destinations are not catch-all intercepted.
3. Update focused tests for the egress registration invariant.
4. Run focused Cloudflare verification and inspect the diff.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/smoke-hosted-deploy.test.ts` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-egress-intercept.test.ts apps/cloudflare/test/direct-r2-hard-cut-guard.test.ts` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `git diff --check -- apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts agent-docs/exec-plans/active/2026-05-20-cloudflare-direct-r2-smoke-egress.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
