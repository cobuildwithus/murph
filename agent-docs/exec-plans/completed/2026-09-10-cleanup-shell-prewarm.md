# Remove retired member shell-prewarm surfaces

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Remove the unused member-specific shell-prewarm client, HTTP, Durable Object,
and container RPC surfaces while preserving authoritative runtime wake behavior.

## Success criteria

- Current code has no member-specific shell-prewarm producer or callable receiver.
- Memberless standby preparation and normal ensure-processing remain unchanged.
- Historical prewarm observations remain readable and mergeable.
- Focused tests, relevant typechecks, and complexity diff pass.
- A scoped commit and draft PR are ready for the parent completion owner.

## Scope

- In scope: retired RPCs, client helpers, associated tests, and current owner docs.
- Out of scope: stored diagnostic cleanup, standby inventory, runtime state
  migrations, production operations, and final parent-owned review/CI gates.

## Constraints

- Preserve active ensure/signal, consent, and prior-version target cleanup.
- Keep private production evidence and identifiers out of durable artifacts.
- Coordinate dependency installation and typechecking with other cleanup work.

## Risks and mitigations

1. Older optional hint callers may receive an unknown route or RPC error.
   The producer removed in e22ee79b637ea49817edff3d9339c25f360ec53e caught
   synchronous and asynchronous hint failures; accepted work uses the durable
   mailbox signal and normal ensure path. Supported deployment and rollback
   versions are after that optional-hint cutover.
2. Historical observations could be accidentally lost during unrelated updates.
   Preserve their schema, parsers, merge rules, and latency forwarding tests.
3. Legacy target cleanup could be mistaken for obsolete hint tests.
   Retain tests that seed a prior target and verify authoritative cleanup.

## Tasks

1. Completed: traced current callers and independent mixed-version proof.
2. Completed: removed retired surfaces and updated focused tests and owner docs.
3. Completed: focused tests, four typechecks, complexity and docs checks passed.
4. Handoff: close this plan, commit the scope, and open a draft PR for parent review.

## Decisions

- Keep the exported historical source type while removing the client method.
- Keep standby and historical latency paths; no new abstraction is needed.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  --no-coverage apps/cloudflare/test/index.test.ts
  apps/cloudflare/test/index-backpressure.test.ts
  apps/cloudflare/test/runner-container.test.ts
  apps/cloudflare/test/user-runner-alarm.test.ts
  apps/cloudflare/test/standby-runner.test.ts
  apps/cloudflare/test/operational-report-contracts.test.ts`: 597 passed,
  two PostgreSQL-backed report cases skipped by their existing environment gate.
- `pnpm --dir packages/cloudflare-hosted-control test`: 88 passed.
- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts
  --no-coverage test/hosted-runtime-control.test.ts`: 45 passed.
- `pnpm --dir apps/cloudflare test:node:containers-helper`: seven passed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage
  apps/web/test/hosted-onboarding-webhook-wake-direct-ensure.test.ts
  apps/web/test/hosted-onboarding-linq-dispatch.test.ts
  apps/web/test/hosted-execution-handoff.test.ts`: 240 passed.
- `pnpm --dir <owner> typecheck` passed for `packages/cloudflare-hosted-control`,
  `packages/hosted-execution`, `apps/cloudflare`, and `apps/web`.
- `pnpm complexity:diff`: passed across ten source files. The retired route
  handler removal lowers that file's maximum from 18 to 10; all seven remaining
  hotspots are unchanged active readiness, wake, transport, or diagnostic logic.
- `pnpm docs:drift`, `pnpm docs:gardening`, and `git diff --check`: passed.
  The first drift run required an index update, which was applied and verified.
- Independent static review found no substantive issue; its empty-import
  finding was fixed before all checks above.
- Focused local proof covers the retired route and surviving runtime boundaries.
  Exact-head CI owns the hosted-local foreground journey; final parent candidate
  review, Ready admission, ReviewGPT, and CI remain with the parent completion
  owner. No production operations were performed.
Completed: 2026-09-10
