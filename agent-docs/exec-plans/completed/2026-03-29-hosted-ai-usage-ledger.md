# 2026-03-29 Hosted AI usage ledger

## Goal

Land the smallest durable hosted AI usage path that still stays provider-agnostic:

1. capture one immutable usage record per successful provider attempt
2. persist it locally under `assistant-state/usage/pending/*.json`
3. export it only after the hosted runner commit succeeds
4. import it into hosted web/Postgres as the canonical hosted audit ledger
5. optionally meter total tokens to Stripe later without making Stripe the primary record

## Constraints

- Keep canonical audit truth in the hosted web DB, not Stripe.
- Keep the runtime/provider capture path provider-agnostic across Codex CLI and OpenAI-compatible providers.
- Do not couple hosted execution success to usage export or Stripe metering success.
- Preserve BYO-key runs as first-class records via `credentialSource`.
- Preserve overlapping in-flight hosted onboarding, Prisma schema, and hosted execution work already present in the worktree.

## Planned shape

- Add shared runtime-state helpers for assistant usage records and pending usage paths under `assistant-state/usage/pending`.
- Extend assistant provider execution results with normalized best-effort usage extraction for OpenAI-compatible AI SDK responses and Codex `turn.completed` events.
- Persist pending usage records immediately after a successful provider attempt in hosted runs.
- Export pending usage after commit through the existing hosted web control-plane seam, then delete only records that import successfully.
- Add a hosted web `HostedAiUsage` table plus internal import route and import helper with idempotent upsert semantics.
- Add an optional hosted web Stripe cron sink that meters total tokens later, skipping member-supplied keys and leaving billing policy downstream.

## Deliberate non-goals

- No runtime-side dollar-cost computation.
- No Stripe dependency in the hosted provider execution path.
- No new canonical billing abstraction beyond the hosted web table and optional token-meter sink.
- No widening into unrelated hosted onboarding or outbox behavior.

## Verification follow-up

- Run repo-required checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Capture direct scenario proof with focused provider/runtime/web tests that show usage extraction, pending-record export, hosted import, and Stripe meter draining behavior.

## Outcome

- Landed provider-agnostic assistant usage capture under `assistant-state/usage/pending`.
- Wired hosted post-commit export into the hosted web control plane and imported those rows into `HostedAiUsage`.
- Added optional hosted Stripe token metering on a separate cron while skipping member-supplied credentials.
- Tightened the shared assistant service seam so non-hosted CLI runs do not create hosted pending-usage rows.

## Verification status

- Focused checks passed: `pnpm --dir packages/runtime-state typecheck`, `pnpm --dir packages/hosted-execution typecheck`, `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-usage.test.ts packages/runtime-state/test/assistant-usage.test.ts packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`, and `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-execution-stripe-metering.test.ts apps/web/test/hosted-execution-routes.test.ts apps/web/test/vercel-config.test.ts --no-coverage --maxWorkers 1`.
- Direct scenario proof passed: the hosted `apps/web` typecheck/vitest/dev-smoke/build path ran successfully inside `pnpm test`, and the resulting route inventory included `/api/internal/hosted-execution/usage/record` plus `/api/internal/hosted-execution/usage/cron`.
- Repo-required wrappers remain blocked by unrelated pre-existing failures outside this lane:
  - `pnpm typecheck` fails in existing `packages/cli` test-type errors around assistant outbox idempotency and resume config expectations.
  - `pnpm test` fails in existing `apps/cloudflare/test/outbox-delivery-journal.test.ts` expectations for `idempotencyKey`.
  - `pnpm test:coverage` fails earlier in existing `packages/contracts` build/test module-resolution errors.
- Completed implementation and docs updates across runtime-state, CLI provider capture, hosted post-commit export, hosted web Prisma/routes/helpers, and optional Stripe token metering.
- Added root Vitest registration for `packages/runtime-state/test/assistant-usage.test.ts` and `packages/assistant-runtime/test/hosted-runtime-usage.test.ts` so repo verification will actually execute the new tests.
- Verification results:
  - Passed: `pnpm --dir packages/runtime-state typecheck`
  - Passed: `pnpm --dir packages/hosted-execution typecheck`
  - Passed: `pnpm exec vitest run --config vitest.config.ts packages/runtime-state/test/assistant-usage.test.ts packages/assistant-runtime/test/hosted-runtime-usage.test.ts --no-coverage --maxWorkers 1`
  - Passed: `pnpm exec vitest run packages/cli/test/assistant-provider.test.ts --no-coverage --maxWorkers 1`
  - Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-execution-stripe-metering.test.ts apps/web/test/hosted-execution-routes.test.ts apps/web/test/vercel-config.test.ts --no-coverage --maxWorkers 1`
  - `pnpm typecheck` is blocked by pre-existing `packages/cli` test-type failures outside this lane.
  - `pnpm test` is blocked by pre-existing `apps/cloudflare/test/outbox-delivery-journal.test.ts` failures outside this lane.
  - `pnpm test:coverage` is blocked by a pre-existing `packages/contracts` module-resolution failure outside this lane.
- Completion-workflow note: required audit-agent spawns were attempted, but this environment did not expose retrievable audit outputs after launch. The implementation agent therefore recorded the limitation and still applied the concrete coverage-harness fix discovered during the close-out pass.

## Status

- Landed shared pending-usage helpers under `packages/runtime-state` plus pending-directory creation in CLI assistant-state persistence.
- Landed provider usage extraction for OpenAI-compatible and Codex CLI turns plus hosted pending-record writes after successful provider attempts.
- Landed hosted post-commit usage export through the existing web control-plane seam with best-effort deletion only after successful import.
- Landed hosted web Prisma table, import route/helper, optional Stripe token-meter cron, and matching tests/docs.

## Verification evidence

- Passed: `pnpm --dir packages/runtime-state typecheck`
- Passed: `pnpm --dir packages/hosted-execution typecheck`
- Passed: targeted `pnpm exec vitest run ...` over the new ledger/runtime/web tests
- Ran: `pnpm typecheck` and hit pre-existing `packages/cli` test-type failures unrelated to this ledger path
- Ran: `pnpm test` and hit pre-existing `apps/cloudflare/test/outbox-delivery-journal.test.ts` failures unrelated to this ledger path after the hosted web app path passed
- Ran: `pnpm test:coverage` and hit a pre-existing `packages/contracts` build/test module-resolution failure unrelated to this ledger path
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
