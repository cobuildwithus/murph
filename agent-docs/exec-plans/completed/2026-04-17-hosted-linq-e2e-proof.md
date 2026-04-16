## Goal

Prove the hosted rapid-turn continuity fix end to end by making the Cloudflare hosted-local E2E lane runnable in CI and by keeping the Linq/Telegram rapid-turn regressions green under that path.

## Constraints

- Preserve the production Vercel OIDC trust contract by default.
- Keep any auth override scoped to local dev / CI-style hosted-local verification.
- Do not revert or interfere with unrelated in-flight work in `apps/web`, Strava, or other active ledger rows.

## Plan

1. Inspect the hosted-local auth path and identify the smallest CI-compatible seam.
2. Implement the seam and thread it through the local hosted harness.
3. Add regression coverage and rerun the hosted-local E2E lanes.
4. Re-trigger the dedicated Cloudflare hosted E2E workflow and verify the Linq lane exercises the real scenario.

## Progress

- Added a development-only `HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL` override, restricted to local loopback/bridge hosts, while preserving the production Vercel OIDC trust contract.
- Added a local JWKS/token fixture for hosted-local Linq and Telegram E2E so CI no longer depends on live Vercel OIDC minting.
- Updated the duplicate-commit hosted-local E2E to prove the real finalize-retry alarm path instead of assuming immediate completion.
- Added the Telegram hosted-local E2E job to `.github/workflows/cloudflare-hosted-e2e.yml` and updated the durable verification docs to match.

## Verification

- `pnpm --dir apps/cloudflare typecheck`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/auth-adapter.test.ts scripts/dev-hosted-local/environment.test.ts --no-coverage`
- `pnpm exec vitest -c apps/cloudflare/vitest.config.ts run apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts --no-coverage`
- `pnpm exec vitest -c apps/cloudflare/vitest.config.ts run apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts --no-coverage`
- `pnpm exec vitest -c apps/cloudflare/vitest.config.ts run apps/cloudflare/test/hosted-local-duplicate-commit-e2e.test.ts --no-coverage`
- `bash scripts/workspace-verify.sh test:diff .github/workflows/cloudflare-hosted-e2e.yml agent-docs/operations/verification-and-runtime.md agent-docs/references/testing-ci-map.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-04-17-hosted-linq-e2e-proof.md apps/cloudflare/src/auth-adapter.ts apps/cloudflare/src/hosted-execution-process-env.ts apps/cloudflare/src/worker-contracts.ts apps/cloudflare/test/auth-adapter.test.ts apps/cloudflare/test/helpers/hosted-local-oidc-support.ts apps/cloudflare/test/helpers/hosted-local-test-worker-fixture.ts apps/cloudflare/test/hosted-local-duplicate-commit-e2e.test.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts apps/cloudflare/test/workers/worker-entry.ts scripts/dev-hosted-local/constants.ts scripts/dev-hosted-local/environment.test.ts`
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
