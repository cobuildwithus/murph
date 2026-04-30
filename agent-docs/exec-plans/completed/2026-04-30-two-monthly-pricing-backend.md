# Two Monthly Pricing Backend

## Goal

Wire hosted onboarding billing to the new pricing shape: two monthly paid plans and no annual plan, so `/join/mock-pricing-preview?preview=checkout` can select the right Stripe Checkout price IDs.

## Scope

- Update hosted billing plan definitions and env-key mapping.
- Preserve subscription-only Stripe Checkout behavior and existing metered-usage optional line-item behavior.
- Update focused hosted-web billing tests/docs that describe required price IDs.

## Constraints

- Treat Stripe/billing as a high-risk hosted-web change.
- Do not edit `.env` or expose secrets.
- Preserve unrelated dirty `apps/web` frontend/copy edits.
- Keep Stripe Checkout on Billing/Prices APIs.

## State

- Backend now exposes `launch_monthly` for Pulse and `launch_edge_monthly` for Edge.
- Annual plan/env keys are removed from the hosted billing plan registry.
- Checkout section passes the clicked plan code through to checkout so Edge does not depend on a React state update race.
- Local preview route renders Pulse and Edge monthly pricing with no annual copy.

## Verification

- `pnpm exec vitest run apps/web/test/hosted-onboarding-billing-plans.test.ts apps/web/test/hosted-onboarding-env.test.ts apps/web/test/hosted-onboarding-runtime.test.ts apps/web/test/hosted-onboarding-billing-service.test.ts apps/web/test/join-invite-client.test.ts --config apps/web/vitest.config.ts --no-coverage` passed.
- `pnpm exec vitest run apps/web/test/hosted-onboarding-csrf.test.ts apps/web/test/hosted-onboarding-invite-send-code.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-webhook-auth.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-privy-invite-status.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts --config apps/web/vitest.config.ts --no-coverage` passed.
- `pnpm --dir apps/web typecheck` passed.
- `git diff --check -- <pricing paths>` passed.
- `curl 'http://localhost:3000/join/mock-pricing-preview?preview=checkout'` returned 200 with Pulse/Edge monthly markup and no annual copy.
- `pnpm --dir apps/web exec playwright screenshot --full-page 'http://localhost:3000/join/mock-pricing-preview?preview=checkout' /tmp/murph-pricing-preview.png` passed.
- `pnpm --dir apps/web exec playwright screenshot --full-page --viewport-size=390,844 'http://localhost:3000/join/mock-pricing-preview?preview=checkout' /tmp/murph-pricing-preview-mobile.png` passed.
- Security/privacy review: no findings.
- Frontend review: no findings.
- Coverage-write: no changes needed; focused slice passed.
- Task-finish review: no findings.
- Scoped `bash scripts/workspace-verify.sh test:diff <pricing paths>` reached `apps/web verify` but remains blocked by unrelated dirty footer/layout files outside this pricing task.
Status: completed
Updated: 2026-04-30
Completed: 2026-04-30
