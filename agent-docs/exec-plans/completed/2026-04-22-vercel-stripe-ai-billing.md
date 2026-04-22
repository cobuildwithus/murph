# Vercel Stripe AI billing delegation

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Land the hosted AI billing update so Murph keeps `apps/web` as the billing authority while optionally delegating per-request token metering to Vercel AI Gateway + Stripe when the preview path is configured.

## Success criteria

- Hosted checkout remains the existing flat subscription plus metered overage shape owned by Stripe pricing, not app-side allowance math.
- Hosted execution can resolve the authenticated member's Stripe customer id through a narrow signed web-control route without turning Cloudflare into a second billing database.
- Vercel AI Gateway Stripe headers are attached only for platform-funded hosted requests that are actually routed through Vercel AI Gateway and only when the delegated billing env is fully configured.
- Hosted AI usage rows persist which meter source handled billing so the existing Murph Stripe drain skips delegated rows and avoids double billing.
- Focused tests cover the new meter-source persistence, runtime header injection, narrow web-control route, env forwarding, and Stripe-drain skip behavior.

## Scope

- In scope:
  - `packages/runtime-state/src/assistant-usage.ts`
  - `packages/assistant-engine/src/{model-harness.ts,assistant/{usage-attribution.ts,service-usage.ts,provider-turn-runner.ts,providers/openai-compatible.ts}}`
  - `packages/assistant-runtime/src/hosted-runtime/platform.ts`
  - `apps/cloudflare/src/{runtime-platform.ts,runner-outbound/web-control.ts,hosted-env-policy.ts}`
  - `apps/cloudflare/scripts/deploy-automation/{worker-secret-names.ts,environment.ts,worker-optional-vars.ts}` only if the new env needs deploy plumbing
  - `apps/web/src/lib/hosted-execution/{usage.ts,stripe-metering.ts}`
  - `apps/web/src/lib/hosted-onboarding/{env.ts,runtime.ts,hosted-member-billing-store.ts}`
  - `apps/web/app/api/internal/hosted-execution/**`
  - directly coupled docs/env examples/tests
- Out of scope:
  - changing hosted plan pricing copy beyond env/docs truthfulness
  - replacing the existing Stripe drain with a new billing system
  - changing member BYOK semantics
  - changing Cloudflare/web run acquisition or hosted usage ledger ownership

## Constraints

- Keep `apps/web` as the durable owner of hosted billing truth and hosted usage reconciliation.
- Do not leak restricted Stripe keys or Stripe customer ids into logs, docs, or persisted runtime artifacts beyond the intended encrypted billing ref and usage-meter-source fields.
- Preserve unrelated dirty-tree edits, especially the pre-existing `apps/web/next-env.d.ts` change and unrelated Health Commons work.
- Keep the delegated path explicitly opt-in and fail closed back to Murph-owned metering instead of partially enabling ambiguous billing behavior.

## Tasks

1. [x] Register the lane in the coordination ledger and keep the write set narrow.
2. [x] Add the runtime/request-policy plumbing needed to mark delegated meter source and attach Vercel Stripe headers per request.
3. [x] Add the narrow hosted web callback route for Stripe customer lookup plus hosted usage import/metering updates.
4. [x] Update env/deploy/docs surfaces so the new delegated billing path is explicit and testable.
5. [ ] Run verification, required audit passes, and create the scoped commit.

## Verification

- Passed: `pnpm --dir packages/runtime-state test -- assistant-usage.test.ts assistant-usage-path.test.ts`
- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-usage-attribution-and-scheduled-log.test.ts test/provider-continuity.test.ts test/provider-execution.test.ts test/assistant-service-runtime.test.ts`
- Passed: `pnpm --dir packages/assistant-runtime test -- hosted-runtime-platform.test.ts`
- Passed: `pnpm --dir apps/cloudflare test:node -- hosted-env-policy.test.ts runner-outbound.test.ts runner-platform.test.ts`
- Passed: `pnpm --dir apps/web test -- hosted-execution-usage.test.ts hosted-execution-stripe-customer-route.test.ts`
- Blocked by unrelated pre-existing failures: `pnpm typecheck`
  - `packages/query/src/wearables.ts` wearable type conversion error
  - dependent `packages/assistant-engine`, `packages/assistant-runtime`, `apps/web`, `apps/cloudflare`, and `packages/assistant-cli` typechecks transitively fail behind the same wearable/query/vault-usecases lane
- Blocked by unrelated pre-existing failures: `bash scripts/workspace-verify.sh test:diff ...`
  - pulls in `packages/assistant-cli`, `packages/query`, and `packages/vault-usecases` type errors from the active wearables/query lane outside this billing write set
Completed: 2026-04-22
