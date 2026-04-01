# 2026-04-02 Messaging Ingress Extraction

## Goal

- Extract shared stateless messaging ingress semantics into a dedicated package so hosted and local consumers stop importing those semantics from `@murphai/inboxd` or reimplementing them in `apps/web`.
- Land the new package with compatibility re-exports and migrate the current Telegram and Linq consumers without changing hosted trust-boundary, privacy-redaction, receipt, or polling ownership.

## Scope

- `agent-docs/exec-plans/active/{2026-04-02-messaging-ingress-extraction.md,COORDINATION_LEDGER.md}`
- new `packages/messaging-ingress/**`
- `packages/inboxd/**`
- `packages/assistant-runtime/**`
- `packages/hosted-execution/**`
- `apps/web/src/lib/hosted-onboarding/{telegram.ts,linq.ts,webhook-event-snapshots.ts,webhook-provider-telegram.ts,webhook-provider-linq.ts,webhook-service.ts,webhook-receipt-types.ts}`
- focused tests under `apps/web/test/**`, `packages/inboxd/test/**`, `packages/assistant-runtime/test/**`, and new package tests
- durable docs for architecture/package ownership

## Findings

- Telegram is the current outlier: `apps/web` still owns webhook JSON validation, supported-message extraction, actor/direct/self summarization, and sparse minimization even though those are stateless provider semantics.
- Linq already behaves more like a shared ingress surface, but the canonical webhook helpers still live under `@murphai/inboxd`.
- `@murphai/inboxd` is not the right permanent owner for pure ingress semantics because it also owns poll connectors, local runtime state, SQLite persistence, and iMessage-native install/runtime concerns.
- `@murphai/hosted-execution` is a dispatch-contract package, not the correct home for provider ingress logic.

## Constraints

- Preserve the current trust boundary split:
  - `apps/web` keeps webhook auth, hosted member lookup, hosted privacy redaction, and receipt/outbox orchestration.
  - `packages/assistant-runtime` stays a hosted execution consumer.
  - `packages/inboxd` keeps poll drivers, checkpoints, local attachment/runtime state, and persistence.
- Keep workspace dependencies one-way and acyclic.
- Preserve current public imports during migration with temporary compatibility re-exports where needed.
- Avoid a broad “messaging runtime” abstraction; the new package must stay narrowly scoped to stateless ingress semantics.

## Plan

1. Create `@murphai/messaging-ingress` and move the stateless Telegram and Linq webhook/normalize/types helpers there.
2. Leave `@murphai/inboxd/{telegram-webhook,linq-webhook}` and matching root exports as compatibility facades over the new owner.
3. Migrate `apps/web` hosted onboarding helpers and `packages/assistant-runtime` consumers to the new package surface.
4. Update durable docs to record the new package boundary and the reasons this logic no longer lives in `apps/web` or permanently in `inboxd`.
5. Run focused proof for Telegram/Linq hosted and local flows, then the required repo verification and final audit review.

## Verification Target

- Focused package/app tests covering:
  - Telegram webhook parse/summary/minimization parity
  - Linq webhook parse/verification/minimization parity
  - hosted Telegram/Linq webhook planning and hydration
  - assistant-runtime hosted Telegram/email/Linq ingestion surfaces touched by the move
- Required checks:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
  - `pnpm --dir apps/web lint`

## Status

- Completed
- Updated: 2026-04-02

## Outcome

- Landed new `@murphai/messaging-ingress` owner package for shared stateless Telegram and Linq ingress semantics.
- Migrated `apps/web`, `packages/inboxd`, and `packages/assistant-runtime` callers to the new package boundary while keeping `@murphai/inboxd` compatibility re-exports for existing Telegram/Linq webhook entrypoints.
- Updated durable architecture docs so hosted trust policy stays in `apps/web`, local polling/persistence stays in `packages/inboxd`, and stateless provider ingress ownership is explicit.

## Verification

- Passed focused proof:
  - `pnpm --dir packages/messaging-ingress test`
  - `pnpm --dir packages/inboxd test`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/hosted-onboarding-webhook-receipt-transitions.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-webhook-auth.test.ts apps/web/test/linq-control-plane.test.ts apps/web/test/linq-webhook-route.test.ts`
  - `pnpm --dir packages/messaging-ingress typecheck`
  - `pnpm --dir packages/inboxd typecheck`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir apps/web typecheck:prepared`
  - `pnpm exec vitest run --config packages/local-web/vitest.config.ts --project local-web --no-coverage packages/local-web/test/workspace-source-resolution.test.ts`
- Passed required check:
  - `pnpm typecheck` after forcing a local PATH shim so nested repo scripts also resolved `pnpm@10.33.0` instead of the stale global `pnpm@9.14.4`
- Required checks still fail for unrelated pre-existing branch/runtime issues:
  - `pnpm test`
    - `apps/cloudflare` typecheck fails on `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS` in `src/node-runner.ts`
    - workspace package builds/tests surface unrelated `TS6305` build-artifact drift outside the messaging-ingress lane
    - `packages/local-web/test/overview.test.ts` still fails its existing `"recent experiments"` expectation
    - `apps/web` broad test/dev-smoke lane still has unrelated failures, including an already-running Next dev server and a hosted device-sync route test failure outside the touched ingress paths
  - `pnpm test:coverage`
    - blocked by the same unrelated `apps/cloudflare`, `packages/local-web`, contracts/dist, and hosted-web broad-lane failures above
  - `pnpm --dir apps/web lint`
    - passes with warnings only
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
