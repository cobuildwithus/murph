# Supplement Batch Search Plan

Created: 2026-06-05

## Goal

Let hosted Murph search several supplement label queries in one server-side call.

Success criteria:

- `POST /api/supplements` accepts a small JSON batch of query strings and returns
  per-query search results.
- The batch path reuses the existing supplements API auth, no-cache response
  helper, limit parsing, and `searchSupplements()` query primitive.
- Cloudflare hosted runner egress interception injects `MURPH_DATA_API_KEY` for
  the exact hosted web supplements `POST` path as well as the existing `GET`
  path.
- `vault-cli supplement search-labels-batch` calls the hosted API without local
  key access, so hosted runtime interception can inject the key.
- Tests cover the web route, Cloudflare intercept, and CLI client/command
  surfaces.

## Constraints

- Keep the architecture boring: one route, one shared API key, no new service,
  no new dependency, no new database shape.
- Do not expose secrets or local environment values.
- Preserve existing single-query `GET` behavior.
- Batch search is search-only in v1; exact detail lookup by DSLD id, external
  id, or UPC stays on the existing single-query command.
- Bound request fan-out so one hosted agent call cannot produce unbounded DB
  work.
- Bound POST body size and per-query text length so batch search does not
  widen the old GET path's practical request-size ceiling.

## Implementation Shape

1. Add a `POST` handler beside the existing `GET` handler in
   `apps/web/app/api/supplements/route.ts`.
2. Add CLI client support and a nested Incur command under
   `supplement search-labels-batch`.
3. Allow exact `/api/supplements` `POST` interception in
   `apps/cloudflare/src/runner-egress-intercept.ts`.
4. Update the existing architecture note from exact `GET` to exact `GET`/`POST`.
5. Run focused tests plus required review passes before closing this plan.

## Non-Goals

- Do not add a second API route file.
- Do not add batch id or UPC lookup until there is a concrete caller.
- Do not add rate limiting, queueing, background jobs, or external search.
- Do not expose the data API key to the hosted runtime or CLI process.

## Verification

Completed checks:

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/supplements-route.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-egress-intercept.test.ts`
- `pnpm --dir packages/cli exec vitest run test/supplement-labels.test.ts test/supplement-wearables-coverage.test.ts test/incur-smoke.test.ts`
- `pnpm --dir apps/cloudflare verify`
- `pnpm --dir apps/web verify`
- `pnpm --dir packages/cli verify`
- `pnpm typecheck`
- `git diff --check`
- Secret/local-path diff scan

`pnpm typecheck` exited zero and the package/app typechecks passed, but still
prints an unrelated pre-existing workspace-boundary violation in
`apps/cloudflare/test/hosted-local-member-reset-smoke-e2e.test.ts`.

## Progress

- Created plan and ledger row.
- Implemented web batch route, Cloudflare POST egress intercept, CLI batch
  helper/command, generated Incur artifacts, and focused tests.
- Security/deep-review found an unbounded POST body/query-length risk; accepted
  and fixed with web, Worker, and CLI caps.
- Security rerun found no medium-or-higher findings.
- Deep-review rerun found no remaining production-breaking bugs and noted the
  deployment order: web route first, then Cloudflare intercept, then CLI use.
- Final task-finish-review is in progress.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
