# PR 582 Invariant Repairs

## Objective

Repair three production-reachable regressions introduced by merged PR 582:

1. Preserve authorized pre-marker current-conversation automations with known
   audience directness while keeping unknown or model-authored routes fail-closed.
2. Make Stripe reconciliation converge legacy synthetic-owned Family billing
   objects instead of retrying a deterministic owner assertion to poison.
3. Keep late group inputs actor-scoped so one member's self-opt-out cannot revoke
   another member's grant.

## Constraints

- Preserve product-critical authorized automation and billing success paths.
- Do not weaken current-route, Family-owner, or self-opt-out authorization for new
  writes.
- Require runtime-owned route evidence or existing canonical ownership facts;
  legacy locator syntax alone must not grant authority.
- Keep Stripe handling idempotent and terminal for incompatible legacy objects.
- Preserve unrelated worktree and coordination-ledger changes.

## Investigation And Proof

- Trace each report through the merged production call path and first prove it
  with focused failing coverage or an equivalent exact-path reproduction.
- Inspect existing route schema/version facts, Family owner/container relations,
  Stripe stale-event ordering and receipt outcomes, and actor-aware input grouping.
- Reject any reported path that cannot exist outside the merged branch rather than
  adding speculative compatibility code.

## Implementation

- Add the smallest owner-boundary correction for every reproduced issue.
- Add focused positive and negative tests for legacy route continuity, Stripe
  convergence/stale handling, and same-actor versus different-actor late input.
- Update durable architecture or product docs only if the implemented rollout or
  authority contract changes their current claims.

## Verification And Completion

- Run the narrowest focused tests during iteration.
- Run truthful diff-aware coverage for all touched package/app owners.
- Run required security/privacy and coverage-write completion audits.
- Perform the parent final diff and call-path review.
- Commit through `scripts/finish-task`, push a dedicated branch, open a PR, run
  ReviewGPT concurrently with CI, resolve accepted findings, and prove the final
  branch merges cleanly with current `main`.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
