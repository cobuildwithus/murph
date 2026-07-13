# PR 546 ReviewGPT round 8 remediation

Status: completed
Created: 2026-07-12
Updated: 2026-07-12

## Goal

- Close the two exact-head ReviewGPT round 8 High findings by using the
  existing locked billing disposition for every exact Pulse candidate and one
  provider-first traversal order for both operator scopes.

## Success criteria

- Active non-trial durable access with no current Stripe subscription rejects
  and cancels an exact losing Pulse candidate before any receipt completes.
- Generic subscription reconciliation cannot adopt that losing candidate.
- Auto-enrollment retry rediscovers and cleans the same loser without requiring
  a distinct Stripe winner.
- Member-scoped traversal surfaces exact provider subscriptions before any
  generic local row and transitions to the local phase after provider closure.
- Required audits, verification, exact-head ReviewGPT, CI, and merge pass.

## Constraints

- Reuse the existing member Stripe mutation lock, receipt journal, provider
  metadata, and cleanup outcome field.
- Do not add a cleanup table, queue, second billing writer, or campaign state.
- Preserve exact current subscriptions and never widen a member-scoped repair.

## Tasks

1. Define and reuse a locked exact Pulse candidate disposition covering a
   current winner, active non-trial loser, and eligible candidate.
2. Route Checkout, generic subscription reconciliation, auto-enrollment retry,
   and campaign recovery through that disposition and existing cleanup field.
3. Delete the member-only local-first traversal branches and use the shared
   provider-to-local phase machine with scope-bound continuations.
4. Add both event-order regressions, cancellation retry/current-winner races,
   multiple-exact-member traversal, and provider-empty-to-local transition.
5. Re-run required audits and verification, commit, push, exact-head ReviewGPT,
   final-head CI, reconcile main, and merge.

## Decisions

- Accept both Round 8 findings after tracing active App Review entitlement,
  generic customer/subscription lookup, exact Pulse write rejection, and the
  member-only local-first phase branches.
- Refine the suggested "any distinct subscription is a loser" rule to the
  existing durable-entitlement facts. Incomplete members with no redeemed or
  active durable trial remain eligible for a legitimate replacement.
- Require a final provider reread under the existing member mutation lock
  before destructive cleanup. The reread must prove the exact member,
  customer when known, policy, price, monthly interval, quantity, allowed item
  shape, and a complete embedded item list.
- Keep the solution within the existing disposition, lock, receipt, and
  provider traversal owners; do not add cleanup state or another worker.

## Verification

- Required simplify/task-finish, coverage, and security/privacy re-audits:
  clean after the final provider reread and complete-item-list fixes.
- Focused Vitest: 4 files, 177 tests passed.
- Hosted web typecheck: passed.
- Scoped ESLint: passed with no findings.
- `pnpm test:diff apps/web`: passed; 381 test files, 4,391 tests passed,
  9 skipped; build, typecheck, dev smoke, dependency/workspace guards passed;
  lint completed with zero errors and 10 unrelated existing warnings.
- `git diff --check`: passed.
Completed: 2026-07-12
