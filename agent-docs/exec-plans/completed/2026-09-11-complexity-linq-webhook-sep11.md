# Simplify Linq webhook event dispatch and delivery outcomes

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Reduce the complexity of the Linq webhook request owner without changing authenticated ingress, durable planning, delivery outcomes, or request cleanup.

## Success criteria

- Reduce measured handler maximum and file complexity debt.
- Preserve reaction, provider-event, message-edit, signup and group-recovery responses and side-effect order.
- Pass focused composed Web tests, Web typecheck, and complexity guard; open a scoped draft PR for parent review.

## Scope

- In scope: private phase helpers in webhook-service.ts and focused proof.
- Out of scope: provider planner, schemas, prompts, runtime protocols, product policy, merging and deployment.

## Constraints

The existing Web owners retain state and authority. Verification precedes dispatch; provider ingestion precedes reaction handling; route preparation and transaction retry boundaries stay intact. Activation wake and typing cleanup remain request-local and retain their existing failure behavior. No new database/provider calls, concurrency, retry, persistence, or dependency.

## Risks and mitigations

1. Moving branches may alter terminal response precedence or timing. Preserve expressions and ordering, exercise composed service suites, and inspect the complete diff.
2. New helpers might merely hide complexity. Extract independently understandable event and delivery phases; keep request lifecycle visible and inspect per-function guard output.

## Tasks

1. Trace current source and relevant owner contracts; measure baseline.
2. Extract event dispatch and delivery result phases with explicit typed inputs/results.
3. Run focused tests, typecheck and complexity guard; review privacy and complete diff.
4. Commit through finish-task, push, open draft PR, hand off exact-head evidence to parent.

## Decisions

- Internal behavior-preserving refactor: no member-facing changelog or provider-input measurement needed.
- Existing composed tests exercise the actual service boundary; no exported helper-only API or new state owner.
- Parent owns candidate review, Ready admission, final ReviewGPT and exact-head CI.

## Verification

- PASS: `MURPH_VITEST_MAX_WORKERS=1 pnpm --dir apps/web test test/hosted-onboarding-webhook-idempotency.test.ts test/hosted-onboarding-linq-home-route-recovery-service.test.ts test/hosted-onboarding-linq-webhook-auth.test.ts` — 43 tests across three files.
- PASS: `MURPH_VITEST_MAX_WORKERS=1 pnpm --dir apps/web test:prepared test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-linq-thread-route.test.ts test/hosted-onboarding-linq-mailbox-root-prewarm.test.ts test/hosted-onboarding-linq-read-receipt-authority.test.ts` — 401 tests across four files.
- PASS: `pnpm --dir apps/web typecheck`.
- PASS: `pnpm complexity:diff --base HEAD` against the starting checkout — handler 147 to 93, file debt 151 to 97. All five new private helpers are at or below 20. Existing unrelated hotspots are unchanged.
- PASS: `git diff --check` and full source/test diff review; no private identifiers or generated files included.
- Existing Frog entries inspected after frozen install; no new repository friction entry needed.
- Draft PR publication follows the scoped commit. Parent owns candidate review, Ready, final ReviewGPT and required exact-head CI; these are separate completion gates, not local proof claims.
Completed: 2026-09-11
