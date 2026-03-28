# Break up hosted Stripe webhook dispatch and RevNet issuance flow

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

- Refactor hosted Stripe webhook handling so event dispatch is registry-driven and the RevNet invoice issuance path reads as explicit state transitions without changing webhook or issuance behavior.

## Success criteria

- `apps/web/src/lib/hosted-onboarding/webhook-provider-stripe.ts` no longer relies on one growing event-type switch.
- `apps/web/src/lib/hosted-onboarding/stripe-revnet-issuance.ts` expresses invoice issuance as named transition helpers while preserving current duplicate-event and concurrency behavior.
- Existing hosted onboarding webhook idempotency tests, especially the Stripe + RevNet anchors called out in the task, pass unchanged.

## Scope

- In scope:
- Behavior-preserving internal refactor of the hosted Stripe dispatcher.
- Behavior-preserving internal refactor of the hosted RevNet issuance flow.
- Narrow test updates only if required to preserve or clarify existing proof.
- Out of scope:
- Business-rule changes for billing, activation, refunds, or RevNet submission.
- Schema changes or Prisma model changes.
- Broader hosted onboarding or webhook receipt refactors outside the touched path.

## Constraints

- Technical constraints:
- Preserve optimistic claim and re-read semantics around issuance submission.
- Preserve duplicate Stripe reference handling and broadcast-status-unknown behavior.
- Keep the public service API unchanged.
- Product/process constraints:
- Multi-file repo work requires an active execution plan and coordination-ledger row.
- Required audit passes must run via spawned subagents before handoff.

## Risks and mitigations

1. Risk: Refactoring the issuance flow could subtly change exact-once or duplicate-event handling.
   Mitigation: Keep each current branch as a named helper/state transition and prove behavior against the existing webhook idempotency tests.
2. Risk: Dispatcher cleanup could accidentally drop an event type or side-effect return path.
   Mitigation: Encode the registry from the current handled event set and keep the default no-op path explicit.

## Tasks

1. Register plan and coordination scope for the hosted Stripe/RevNet refactor.
2. Replace the Stripe webhook switch with an explicit handler registry keyed by event type.
3. Decompose RevNet invoice issuance into explicit transition helpers for eligibility, issuance load/create, Stripe reference patching, submission gating, claim, submit/persist, and failure persistence.
4. Run targeted hosted onboarding tests, then broader required checks as feasible.
5. Run required simplify, coverage, and final review audit passes; integrate any behavior-preserving follow-ups.

## Decisions

- Keep this refactor inside the existing Stripe provider and RevNet issuance modules instead of introducing a broader new service boundary unless the diff proves that necessary.

## Verification

- Commands to run:
- `pnpm --dir apps/web test -- --run hosted-onboarding-webhook-idempotency.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- The targeted hosted onboarding webhook idempotency suite passes with unchanged behavioral assertions.
- Repo-required checks pass, or any failures are documented as credibly unrelated pre-existing red state.
- Actual outcomes:
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts --no-coverage --maxWorkers 1` passed.
- `pnpm --dir apps/web test -- --run hosted-onboarding-webhook-idempotency.test.ts` failed before app tests on unrelated existing `packages/core/src/operations/write-batch.ts` type errors.
- `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` all failed in the same pre-existing `packages/core/src/operations/write-batch.ts` lane, outside this hosted-onboarding refactor.
Completed: 2026-03-28
