# Add pointer-only Stripe webhook reconciliation workflow

Status: active
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
2. Risk: Workflow logs could expose sensitive billing payloads.
   Mitigation: Use only `{ eventId }` as Workflow input and resolve all data from the database inside the step.

## Tasks

1. Inspect current Stripe receipt/reconcile status semantics and tests.
2. Add event-id Workflow types/start/step modules.
3. Split webhook receipt recording from asynchronous reconciliation start.
4. Add focused tests for pointer-only Workflow behavior.
5. Update architecture docs and run scoped verification/review.

## Decisions

- Keep Stripe signature verification and receipt recording in the synchronous route path so unauthenticated or malformed input never reaches Workflow.
- Use the existing hosted Stripe receipt table as the durable work pointer instead of adding a new data store.

## Verification

- Commands to run:
  - Focused hosted onboarding Stripe workflow/service Vitest.
  - `pnpm --dir apps/web typecheck`.
  - `pnpm --dir apps/web lint`.
  - `git diff --check`.
- Expected outcomes: focused tests/typecheck/lint/diff check pass or any unrelated pre-existing failure is documented with evidence.
