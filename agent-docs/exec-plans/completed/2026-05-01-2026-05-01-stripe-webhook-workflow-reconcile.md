# Add pointer-only Stripe webhook reconciliation workflow

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Move hosted Stripe webhook reconciliation onto a Vercel Workflow that receives only the stored Stripe event id after local signature verification and receipt recording.
- Preserve provider retry semantics: if the event receipt cannot be stored or the workflow cannot be started, the webhook remains retryable.

## Success criteria

- Stripe route/service still verifies raw Stripe input locally and does not pass raw bodies, signatures, customer metadata, or invoice payloads into Workflow input.
- Duplicate/completed Stripe receipts remain idempotent.
- Retryable reconciliation work can be retried by Workflow using the stored event id and existing receipt/reconciliation state.
- Focused tests cover pointer-only Workflow start, duplicate ack behavior, Workflow step retry/fatal behavior, and no-workflow-on-invalid-signature behavior.
- Durable architecture docs describe the Stripe event-id Workflow boundary.

## Scope

- In scope: `apps/web` hosted onboarding Stripe webhook service/workflow/test/docs slice.
- Out of scope: Cloudflare runner nudge state machine, email ingress workflow, device-sync workflow fallback, Stripe schema changes, and raw webhook archival.

## Constraints

- Technical constraints: raw Stripe request bodies and signatures stay in the route/service verification path only; Workflow inputs must be opaque pointer data only.
- Product/process constraints: preserve unrelated dirty-tree work and commit only the scoped Stripe plan files.

## Risks and mitigations

1. Risk: A duplicate Stripe event could get acknowledged without reconciliation if the receipt is stuck.
   Mitigation: Preserve the existing duplicate receipt retry preparation before starting the Workflow.
2. Risk: Workflow logs could expose sensitive billing payloads or internal member identifiers.
   Mitigation: Use only `{ eventId }` as Workflow input, keep Workflow step inputs/outputs pointer-only, and resolve any member or activation ids inside the step from web-owned Postgres and Stripe.

## Tasks

1. Inspect current Stripe receipt/reconcile status semantics and tests.
2. Add event-id Workflow types/start/step modules.
3. Split webhook receipt recording from asynchronous reconciliation start.
4. Add focused tests for pointer-only Workflow behavior.
5. Update architecture docs and run scoped verification/review.

## Decisions

- Keep Stripe signature verification and receipt recording in the synchronous route path so unauthenticated or malformed input never reaches Workflow.
- Use the existing hosted Stripe receipt table as the durable work pointer instead of adding a new data store.
- Keep the Workflow as one event-id step returning `void` so member and activation identifiers are not persisted as step outputs or step-to-step inputs.

## Done

- Added a Stripe-specific Vercel Workflow start path that receives only `{ eventId }` after local Stripe verification and `HostedStripeEvent` receipt recording.
- Moved retryable reconciliation plus activation runner nudge into one event-id Workflow step that returns `void`.
- Preserved duplicate receipt idempotency, including completed/fresh-processing ack and pending/failed retry reset behavior.
- Added focused tests for workflow start, step retry/fatal mapping, duplicate pending reset, completed receipt activation re-derivation, and invalid-signature no-workflow behavior.
- Updated architecture docs for the pointer-only Stripe Workflow boundary.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-onboarding-stripe-webhook-service.test.ts apps/web/test/hosted-onboarding-stripe-workflows.test.ts apps/web/test/hosted-onboarding-stripe-webhook-reconciliation.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts apps/web/test/hosted-onboarding-member-activation.test.ts`
  - `pnpm --dir apps/web typecheck`.
  - `pnpm --dir apps/web lint`.
  - `git diff --check`.
  - `pnpm test:diff apps/web/src/lib/hosted-onboarding/webhook-service-stripe.ts apps/web/src/lib/hosted-onboarding/stripe-webhook-reconciliation.ts apps/web/src/lib/hosted-onboarding/stripe-webhook-workflow-start.ts apps/web/src/lib/hosted-onboarding/stripe-webhook-workflow-steps.ts apps/web/src/lib/hosted-onboarding/stripe-webhook-workflows.ts apps/web/src/lib/hosted-onboarding/stripe-webhook-workflow-types.ts apps/web/test/hosted-onboarding-stripe-webhook-service.test.ts apps/web/test/hosted-onboarding-stripe-workflows.test.ts apps/web/test/hosted-onboarding-stripe-webhook-reconciliation.test.ts`
- Results: focused Vitest passed 5 files / 39 tests; app typecheck passed; app lint passed with one unrelated warning in `apps/web/src/components/experiments/experiment-detail/protocol-tab.tsx`; `git diff --check` passed; diff-aware app verification passed dependency policy, workspace boundary checks, hosted stale-name guard, raw health log guard, dev smoke, lint, 197 app test files / 1326 tests, and next build.
Completed: 2026-05-01
