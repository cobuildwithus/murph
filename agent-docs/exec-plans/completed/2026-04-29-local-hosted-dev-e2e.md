# Local Hosted Dev E2E

## Goal

Make repo-root `pnpm dev` intentionally start the hosted web, local Cloudflare Worker/Containers lane, and local database-backed Prisma setup end to end.

## Scope

- `scripts/dev-hosted-local/**`
- Direct hosted-local launcher tests
- `README.md` developer-flow wording

## Constraints

- Preserve unrelated dirty-tree edits.
- Do not print secrets or generated env contents.
- Keep local database as the default startup target while preserving an explicit escape hatch for remote/Vercel development database usage.
- Runner container readiness must be an active smoke proof, not just Worker `/health`.

## Verification

- Focused hosted-local script tests passed.
- Cloudflare hosted-local harness test wrapper passed.
- Manual `pnpm dev` smoke with alternate ports used the local Postgres target, started hosted web and Wrangler, built the runner image, and passed runner-container deploy smoke.
- Fresh root `pnpm dev` smoke reached the ready marker, returned 200 from hosted web and Cloudflare worker health endpoints, and passed `/internal/deploy/container-smoke` with an actual runner container listening on port 8080.
- Repo-wide `pnpm typecheck` currently fails in `apps/web/test/health-commons-bryan-johnson-protocol.test.ts` because `protocol.commons` is possibly undefined.
- Repo-wide `pnpm test` was attempted; package prerequisites, contracts, OpenClaw, and fixture smoke passed before repo Vitest opened an interactive CLI prompt and had to be terminated.
