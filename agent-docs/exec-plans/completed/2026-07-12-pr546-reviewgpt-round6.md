# PR 546 ReviewGPT round 6 remediation

Status: completed
Created: 2026-07-12
Updated: 2026-07-12

## Goal

- Close the three exact-head ReviewGPT round 6 findings without adding new
  campaign state, then repeat verification, review, CI, and merge PR 546.

## Success criteria

- Provider traversal carries each exact Stripe subscription obligation and
  never deduplicates a different live subscription merely because the member
  has a local cohort row.
- One-member mode does not depend on an unusable account-wide continuation.
- Provider-only Apply performs one authoritative provider read and at most one
  update under the member lock, using a fresh runway check and the actual
  update response for local finalization.
- Required audits, full verification, exact-head ReviewGPT, and final-head CI
  pass before merge.

## Constraints

- Keep one durable billing owner and reuse the existing auto-trial campaign
  disposition/finalization owner.
- Keep all-member provider traversal bounded and authenticated.
- Do not add persisted campaign state, a queue, or another billing writer.

## Tasks

1. Separate exact provider subscription identity from durable local billing
   identity throughout Preview, Apply, lock reread, and proof tokens.
2. Give member-scoped requests a terminal member-owned lookup path.
3. Delete the redundant provider retrieve and synthesize no final provider
   object; use fresh time and the actual update result.
4. Add production-wrapper regressions for obsolete/deduplicated subscriptions,
   member-scoped reachability, budgets, and replay.
5. Re-run required audits and full verification, commit, push, ReviewGPT, CI,
   main reconciliation, and merge.

## Decisions

- Accept all three findings after tracing the provider projection, member-mode
  cursor contract, and declared provider/transaction deadlines.
- Keep member-scoped provider traversal on the authenticated bounded cursor;
  Stripe subscription search is eventually consistent and cannot prove
  immediate post-mutation campaign closure.
- Carry provider customer/subscription identity separately from the durable
  local billing owner so stale A and current B remain distinct obligations.
- Accept the audit follow-ups: locked proof now derives current durable owner
  ids, cleanup refuses the current subscription, exact discovery includes all
  nonterminal campaign subscriptions, and recoverable mutations reject
  suspended/redeemed/non-checkout-eligible members before Stripe update.

## Verification

- Required coverage-write audit: clean after adding exact A/B production
  cleanup-and-closure, cursor-scope isolation, one-update request-option, and
  actual-update-response proofs.
- Required frontend/final-bug audit: clean after making intermediate and later
  terminal member pagination copy page-aware.
- Required security/privacy/payment audit: clean after the locked-owner,
  current-subscription cleanup defense, nonterminal discovery, and suspended
  recovery remediations.
- Focused Vitest: 4 files, 134 tests passed.
- Prepared web typecheck: passed.
- Focused ESLint: passed with zero warnings.
- `git diff --check`: passed.
- `pnpm test:diff apps/web`: passed; 380 test files passed and 1 skipped,
  4,352 tests passed and 9 skipped, lint had only unrelated existing warnings,
  dev smoke passed, and the production build passed.
- Post-commit gates remain exact-head ReviewGPT, final-head CI, and merge.
Completed: 2026-07-12
