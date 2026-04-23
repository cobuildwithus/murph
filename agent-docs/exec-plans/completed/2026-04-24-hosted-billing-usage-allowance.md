# Disable hosted AI usage billing until Stripe native LLM billing is available

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Keep hosted base subscription checkout active.
- Stop customer-facing hosted AI usage billing by default while still recording the hosted AI usage ledger.
- Use one explicit mode gate for hosted-web fallback metering and delegated Vercel AI Gateway billing.
- Preserve an explicit Stripe-meter re-enable path for a future native LLM billing rollout.

## Why

- Hosted checkout currently attaches the metered AI usage price directly to new subscriptions.
- Hosted Stripe metering can export pending usage rows whenever Stripe keys and a meter name are present.
- Stripe native LLM billing is the preferred long-term path, so the safest short-term move is to disable billable usage rather than add an app-side invoice allowance bridge.

## Scope

- `packages/hosted-execution/src/{ai-usage-billing-mode.ts,index.ts}`
- `packages/hosted-execution/test/hosted-execution.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/billing.ts`
- `apps/cloudflare/src/hosted-env-policy.ts`
- `apps/cloudflare/scripts/deploy-automation/worker-optional-vars.ts`
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/web/src/lib/hosted-onboarding/{billing-plans.ts,billing-service.ts,env.ts,invite-service.ts,runtime.ts}`
- `apps/web/src/lib/hosted-execution/{usage.ts,stripe-metering.ts}`
- `apps/web/app/api/internal/hosted-execution/billing/stripe/customer/resolve/route.ts`
- directly coupled hosted billing and hosted AI usage tests under `apps/web/test/**`
- directly coupled assistant-runtime delegated-billing tests under `packages/assistant-runtime/test/**`
- directly coupled Cloudflare env/deploy tests under `apps/cloudflare/test/**`
- `apps/web/.env.example`
- `apps/web/README.md`
- `apps/cloudflare/{README.md,DEPLOY.md}`
- `agent-docs/exec-plans/active/{2026-04-24-hosted-billing-usage-allowance.md,COORDINATION_LEDGER.md}`

## Out of scope

- changing live Stripe Dashboard price configuration directly
- migrating historical invoices or customer balances outside the in-app pending-row skip path
- redesigning the hosted AI metering ledger or checkout flow
- implementing Stripe native LLM billing before account access is available
- broad hosted onboarding copy or settings-surface work

## Constraints

- Keep the change narrow to hosted billing, usage-ledger import, and directly coupled proof.
- Default to non-billable hosted AI usage unless billing is explicitly enabled.
- Do not backbill usage rows collected while usage billing is disabled.
- Preserve existing hosted billing trust boundaries and Stripe webhook behavior.
- Avoid exposing secrets or raw Stripe credentials in code, tests, logs, or handoff.
- Follow the high-risk repo workflow: plan-bearing lane, coverage-bearing verification, required audits, and scoped commit flow if exact staging is safe.

## Risks and mitigations

1. Risk: env-only disablement leaves checkout, fallback metering, or delegated Gateway billing paths billable through stale Stripe usage price or meter settings.
   Mitigation: add an explicit hosted AI usage billing mode that defaults to disabled and gates checkout usage items, usage import status, the Stripe drain, and delegated Vercel billing.
2. Risk: pending usage rows collected before the switch are billed later when Stripe metering is re-enabled.
   Mitigation: make the disabled drain claim due pending rows and mark them skipped instead of posting meter events.
3. Risk: future Stripe native LLM rollout has no obvious re-enable seam.
   Mitigation: keep the existing Stripe-meter behavior behind an explicit `stripe_meter` mode and document that native LLM billing should reuse or extend that mode.

## Tasks

1. Register the billing lane in the coordination ledger and inspect the current checkout, readiness, usage import, and metering paths.
2. Add explicit hosted AI usage billing mode parsing with fail-closed disabled default.
3. Gate checkout usage line items, billing readiness, usage import status, Stripe meter draining, and delegated Vercel billing by the mode.
4. Update focused regression coverage and hosted billing docs.
5. Run truthful hosted-web verification, required audit passes, and scoped finish flow.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/hosted-execution/src/ai-usage-billing-mode.ts packages/hosted-execution/src/index.ts packages/hosted-execution/test/hosted-execution.test.ts packages/assistant-runtime/src/hosted-runtime/billing.ts packages/assistant-runtime/test/hosted-runtime-platform.test.ts packages/assistant-runtime/test/hosted-runtime-runner.test.ts apps/cloudflare/src/hosted-env-policy.ts apps/cloudflare/scripts/deploy-automation/worker-optional-vars.ts apps/cloudflare/test/hosted-env-policy.test.ts apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/runner-env.test.ts .github/workflows/deploy-cloudflare-hosted.yml apps/web/app/api/internal/hosted-execution/billing/stripe/customer/resolve/route.ts apps/web/src/lib/hosted-onboarding/billing-plans.ts apps/web/src/lib/hosted-onboarding/billing-service.ts apps/web/src/lib/hosted-onboarding/env.ts apps/web/src/lib/hosted-onboarding/invite-service.ts apps/web/src/lib/hosted-onboarding/runtime.ts apps/web/src/lib/hosted-execution/usage.ts apps/web/src/lib/hosted-execution/stripe-metering.ts apps/web/test/hosted-onboarding-billing-plans.test.ts apps/web/test/hosted-onboarding-billing-service.test.ts apps/web/test/hosted-onboarding-env.test.ts apps/web/test/hosted-onboarding-runtime.test.ts apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-execution-stripe-customer-route.test.ts apps/web/test/hosted-execution-stripe-metering.test.ts apps/web/.env.example apps/web/README.md apps/cloudflare/README.md apps/cloudflare/DEPLOY.md`
- Direct proof:
  - default disabled mode creates base-only checkout line items
  - disabled usage imports remain in the ledger with skipped Stripe status
  - disabled Stripe drain skips pending rows without POSTing meter events
  - disabled delegated Vercel billing does not resolve or forward a Stripe customer id
  - duplicate imports preserve the stored billing outcome across mode flips
  - checkout idempotency changes when the Stripe Checkout line items change
  - explicit `stripe_meter` mode preserves the metered usage price and Stripe drain path

## Latest results

- Implemented `HOSTED_AI_USAGE_BILLING_MODE` with default/fail-closed `disabled` and explicit `stripe_meter` re-enable mode.
- Disabled mode keeps base checkout active, omits usage checkout items, records hosted AI usage rows as skipped, drains pending/expired processing Murph-source usage rows to skipped without Stripe POSTs, gates delegated Vercel billing, and mode-gates the internal Stripe customer resolve route.
- Focused proof passed:
  - `pnpm --dir packages/hosted-execution exec vitest run test/hosted-execution.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm exec vitest run apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-execution-stripe-metering.test.ts apps/web/test/hosted-execution-stripe-customer-route.test.ts apps/web/test/hosted-onboarding-env.test.ts --config apps/web/vitest.config.ts --no-coverage`
- Full proof passed:
  - `pnpm typecheck`
  - `git diff --check -- <scoped hosted billing paths>`
  - `MURPH_VERIFY_STEP_PARALLEL=0 bash scripts/workspace-verify.sh test:diff <scoped hosted billing paths>`
- Required `coverage-write` audit completed with no file changes and found the existing direct proof sufficient.
- Required `task-finish-review` initially found two medium edge-case issues; both were fixed. The allowed rerun reported no findings remain.
Completed: 2026-04-24
