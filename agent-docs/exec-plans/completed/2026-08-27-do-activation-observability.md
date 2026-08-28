# Durable Object activation observability

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Make the Web-to-UserRunner Durable Object latency boundary attributable across
  platform dispatch/module activation, Durable Object construction, and the
  first runtime-processing RPC instruction without adding request-path I/O.

## Success criteria

- Existing ingress latency traces persist metadata-only activation start and
  finish timestamps from the UserRunner Durable Object instance that handled
  the request.
- Operators can distinguish a current cold activation from reuse of an older
  in-memory instance and can derive constructor duration with chronology guards.
- The identifier-free cold-start report includes the new activation phases.
- Focused parser, Durable Object, report, and typecheck proof passes.
- The exact pushed PR head clears required specialist/final ReviewGPT gates and
  required GitHub checks before merge.

## Scope

- In scope:
  - UserRunner Durable Object construction timing.
  - Existing hosted orchestration latency diagnostics and parsers.
  - Identifier-free aggregate SQL report and focused tests/docs.
- Out of scope:
  - Runtime behavior, retries, queues, new log destinations, or payload logging.
  - Changes to the runner container boot graph or schema migration behavior.

## Constraints

- Technical constraints:
  - Use only in-process epoch-millisecond reads and the existing latency callback.
  - Keep diagnostics optional and rolling-deploy compatible.
  - Never include member, mailbox, prompt, message, or provider content.
- Product/process constraints:
  - ReviewGPT implements the production/test patch; the parent verifies and
    lands it through the normal PR lane.
  - Preserve the foreground reply critical path and add no awaited work.

## Risks and mitigations

1. Risk: stale instance timestamps are mistaken for current-request activation.
   Mitigation: name the fields as instance activation facts and add chronology
   guards/tests that distinguish activation before versus during the route.
2. Risk: telemetry adds latency or content exposure.
   Mitigation: use bounded numeric timestamps on the existing response path only.

## Tasks

1. Completed: asked ReviewGPT to implement the scoped diagnostics and focused
   proof.
2. Completed: inspected the artifact hash, paths, content, and applied the exact
   returned patch.
3. Completed: ran focused local tests, both affected package typechecks, and the
   real PostgreSQL SQL-report fixture.
4. In progress: commit, push, open the PR, and complete required ReviewGPT/CI
   gates.
5. Merge the exact reviewed head and retire the task worktree.

## Decisions

- Keep the observability PR behavior-neutral and independently deployable before
  the schema fast-path PR.
- Persist constructor timestamps through the existing orchestration phase shape
  instead of adding a second logging system.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/index-backpressure.test.ts apps/cloudflare/test/operational-report-contracts.test.ts`
  - `pnpm exec vitest run --config packages/hosted-execution/vitest.config.ts --no-coverage packages/hosted-execution/test/hosted-runtime-control.test.ts`
  - `DATABASE_URL=<LOCAL_DATABASE_URL> MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/operational-report-contracts.test.ts`
  - `pnpm --dir packages/hosted-execution typecheck`
  - `pnpm --dir apps/cloudflare typecheck`
  - `git diff --check`
- Expected outcomes:
  - All focused checks pass and the diff adds no request-path I/O or private data.
- Results:
  - Cloudflare: 7 passed, 2 skipped in the non-PostgreSQL lane.
  - Hosted execution: 33 passed.
  - PostgreSQL report fixture: 4 passed.
  - Both affected package typechecks and `git diff --check` passed.
Completed: 2026-08-27
