# 2026-03-28 Hosted Onboarding Webhook Split

## Goal

Split the hosted onboarding webhook stack by concern without changing hosted-versus-canonical trust boundaries, receipt/idempotency behavior, or Postgres-backed operational ownership.

## Constraints

- Preserve the current hosted onboarding receipt claim/reclaim/update semantics and JSON payload shape compatibility while the refactor is in flight.
- Keep canonical health and inbox state out of the hosted tier.
- Keep hosted operational state in Postgres only; do not introduce a second store.
- Avoid rewrites. Extract existing behavior into narrower modules first, then tighten internal seams.
- Work on top of already-dirty hosted onboarding and hosted execution files without reverting adjacent changes.
- Preserve the current receipt-side dispatch minimization and hosted execution hydration contract.

## Planned Shape

1. Extract provider-specific planners into dedicated hosted onboarding modules for Linq, Telegram, and Stripe.
2. Narrow `webhook-service.ts` to verification/parsing/orchestration plus receipt handler assembly.
3. Move Stripe event routing and billing/reversal policy appliers behind dedicated internal modules while preserving write order and side effects.
4. Split receipt internals into a smaller engine/store/codec/transport layout with one shared receipt serialization contract.
5. Point hosted execution hydration and receipt dispatch rehydration at the shared receipt contract helpers instead of duplicated JSON readers.
6. Keep existing idempotency-focused tests as contract tests through each extraction and add only narrow characterization tests if a new seam needs direct proof.

## Verification Target

- Focused hosted onboarding webhook/revnet tests under `apps/web/test/`.
- Repo-required commands after integration: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Required completion workflow audit passes: `simplify`, `test-coverage-audit`, `task-finish-review`.

## Status

- Implemented provider-specific planners for Linq, Telegram, and Stripe while keeping `webhook-service.ts` as ingress orchestration only.
- Split Stripe internals into billing/reversal policy and RevNet issuance modules without changing member state transitions or RevNet issuance semantics.
- Split receipt internals into types/codec/store/engine/transport modules while preserving the receipt JSON contract and minimized dispatch hydration behavior.
- Required audit passes completed:
  - `simplify`: no-op wrappers removed; transaction fallback kept because the existing malformed-receipt contract test still exercises that path.
  - `test-coverage-audit`: no additional test changes required; existing Telegram dispatch coverage was validated separately.
  - `task-finish-review`: no actionable findings in the scoped webhook split.
- Focused verification passed:
  - `pnpm --dir apps/web typecheck`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-execution-hydration.test.ts apps/web/test/hosted-execution-contract-parity.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-revnet.test.ts apps/web/test/hosted-onboarding-revnet-repair-service.test.ts`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-onboarding-telegram-dispatch.test.ts`
  - direct scenario check: minimized `linq.message.received` receipt payload rehydrated correctly via `readHostedWebhookReceiptDispatchByEventId`
- Repo-wide checks remain blocked outside this slice:
  - `pnpm typecheck` fails in `packages/contracts/scripts/*`
  - `pnpm test` fails on the repo doc-index guard for current `agent-docs` drift
  - `pnpm test:coverage` fails in `packages/cli/src/assistant-codex.ts` (`NormalizedCodexEvent` missing)

## Risks

1. Durable dispatch or Linq side effects could replay twice if receipt merge/minimize behavior changes.
   Mitigation: keep the existing side-effect state machine and effect ids intact; preserve the contract tests unchanged.
2. Stripe refund/dispute suspension could drift if reversal policy extraction changes member lookup or revoke ordering.
   Mitigation: move the logic with its current callers and keep focused refund/dispute tests in place.
3. Invoice-driven activation ordering could regress around RevNet-enabled subscriptions.
   Mitigation: keep Stripe planner routing and policy helpers behavior-identical during the extraction, with existing `invoice.paid` and subscription tests unchanged.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
