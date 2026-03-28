# Simplify hosted webhook receipt compare-and-swap retries

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

- Remove duplicated compare-and-swap retry envelopes from the hosted onboarding webhook receipt path without changing claim, retry, or side-effect behavior.

## Success criteria

- `apps/web/src/lib/hosted-onboarding/webhook-receipt-store.ts` owns one shared internal receipt CAS/reload helper for the repeated optimistic-concurrency loop.
- Reclaim, generic receipt updates, and hosted-execution dispatch queueing all use that helper while preserving the current retry count (`3`), `payloadJson.equals` guard, stale-write behavior, and error codes/messages.
- Focused hosted onboarding verification passes, then the required repo checks run and any failures are either fixed or documented as unrelated.
- Required `simplify`, `test-coverage-audit`, and `task-finish-review` subagent passes run before handoff.

## Scope

- In scope:
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-store.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-engine.ts`
- Focused `apps/web` hosted-onboarding tests only if needed for regression proof
- Out of scope:
- Prisma schema changes
- Transaction-boundary changes
- Hosted execution outbox semantics
- Behavior changes to receipt status transitions or side-effect payload minimization

## Constraints

- Technical constraints:
- Keep the CAS guard on `payloadJson.equals`.
- Keep retry attempts at `3`.
- Keep current JSON codec helpers and current error codes/messages.
- Do not widen transaction scope or move the dispatch enqueue into a different boundary.
- Product/process constraints:
- Preserve adjacent dirty `apps/web` work and avoid overlapping tests unless required.
- Close the plan with `scripts/finish-task` if the work lands this turn.

## Risks and mitigations

1. Risk: A shared helper could accidentally move the enqueue side effect inside the wrong retry or serialization boundary.
   Mitigation: Keep the helper narrowly scoped to “derive next claim + attempt compare-and-swap + reload on miss”, and keep the actual enqueue callback owned by the dispatch-specific caller.
2. Risk: Existing duplicate-response or reclaim semantics could drift if completed/processing receipts are reprocessed.
   Mitigation: Keep the create-if-missing branch local to reclaim and only route the existing-receipt CAS path through the helper.

## Tasks

1. Register the lane in `COORDINATION_LEDGER.md`.
2. Extract a shared internal CAS/reload helper in `webhook-receipt-store.ts`.
3. Route `updateHostedWebhookReceiptClaim`, reclaim-on-existing, and dispatch-queue updates through the helper.
4. Add focused regression proof only if the touched paths are not already covered.
5. Run required checks and mandatory audit subagents, then integrate any findings.

## Decisions

- Keep the public barrel `webhook-receipts.ts` unchanged; only the internal store/engine split changes.
- Prefer moving the dispatch-specific retry loop into the store module rather than introducing a broader cross-module utility.

## Verification

- Commands to run:
- Focused `apps/web` hosted-onboarding tests if touched.
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- The receipt CAS paths remain behaviorally identical and verification is green, or unrelated pre-existing failures are documented with causal separation.
Completed: 2026-03-28
