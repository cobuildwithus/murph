# Prevent Oura webhook duplicate pruning from crossing deployment origins

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Keep Oura webhook subscription upkeep scoped to the exact callback URL for the active deployment so preview or local connects cannot prune another deployment's webhook.

## Success criteria

- Oura webhook duplicate and stale pruning only manages subscriptions whose normalized callback URL exactly matches the requested callback URL.
- Same-origin duplicate cleanup still removes redundant subscriptions for the active callback URL.
- Cross-origin subscriptions that share the same webhook path are preserved during upkeep.
- Focused `packages/device-syncd` tests cover the regression and the required verification, audit passes, and scoped commit complete or any unrelated blocker is documented.

## Scope

- In scope:
  - `packages/device-syncd/src/providers/oura-webhooks.ts`
  - directly coupled `packages/device-syncd/test/oura-webhooks.test.ts`
  - `agent-docs/exec-plans/active/{2026-04-23-oura-webhook-prune-boundary.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - changes to hosted public-base-url resolution
  - Oura OAuth or webhook routing redesigns beyond this pruning boundary
  - other provider webhook clients unless the current Oura fix proves insufficient

## Constraints

- Technical constraints:
  - Preserve the current exact-match ensure behavior for retain/create/renew decisions.
  - Keep duplicate pruning functional for the active callback URL.
  - Work safely in the current dirty tree and avoid unrelated `apps/web` or hosted control-plane edits.
- Product/process constraints:
  - Treat this as a trust-boundary/routing fix and capture direct proof in addition to scripted checks.
  - Follow the plan-bearing repo workflow, including the required completion audits.

## Risks and mitigations

1. Risk: Tightening pruning too far could leave same-callback duplicates uncollected.
   Mitigation: Keep pruning grouped by event/data target, but restrict membership to exact callback URL matches.
2. Risk: Tests could still codify the unsafe behavior under a renamed helper.
   Mitigation: Replace the same-path cross-origin deletion expectation with an explicit preservation assertion and keep a same-origin duplicate deletion assertion.

## Tasks

1. Register the task in the active plan and coordination ledger.
2. Tighten Oura webhook pruning ownership to the normalized full callback URL.
3. Update focused Oura webhook tests to preserve same-path cross-origin subscriptions while still pruning same-origin duplicates.
4. Run scoped verification, direct proof, required completion audits, and the scoped commit flow.

## Decisions

- Treat the exact normalized callback URL as the ownership boundary for Oura webhook pruning; shared pathname alone is insufficient because preview/local deployments can legitimately share the same route suffix under different origins.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff packages/device-syncd/src/providers/oura-webhooks.ts packages/device-syncd/test/oura-webhooks.test.ts`
- Direct proof:
  - Run the focused Oura webhook regression test covering same-path different-origin preservation.
- Expected outcomes:
  - Device-syncd typecheck and focused diff-aware tests pass.
  - The regression proof shows only same-callback duplicates are deleted.
Completed: 2026-04-23
