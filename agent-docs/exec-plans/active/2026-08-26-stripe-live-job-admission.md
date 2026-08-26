# Restore main-push Stripe live-job admission

Status: active
Updated: 2026-08-26

## Goal

Ensure every trusted `main` push whose hermetic Stripe proof succeeds enters the
protected live Stripe sandbox job, even though the pull-request-only scope
classifier is skipped on push events.

Success means:

- the live job runs after a successful hermetic job on `main` pushes;
- pull requests continue to keep the secret-bearing live job skipped;
- failed or canceled hermetic proof cannot grant live Stripe authority; and
- focused workflow guards, exact-head CI, specialist review, and final
  ReviewGPT complete without unresolved findings.

## Scope

- In scope: the hosted Stripe workflow job condition and its repository-owned
  workflow mutation guards.
- Out of scope: Stripe product behavior, sandbox credentials, billing logic,
  deploy sequencing, and rerunning historical failed workflows.

## Invariants

- Writable Stripe authority remains confined to the protected `main`-push job.
- The live job requires an explicit successful hermetic result.
- Pull-request code never receives the sandbox secret.
- The stable required Stripe context continues to fail closed on missing,
  failed, canceled, or skipped applicable proof.

## Implementation

1. Encode an explicit `always()` main-push condition that checks the direct
   hermetic result before admitting the live job.
2. Extend the hosted Stripe workflow guard and mutation tests to reject loss or
   weakening of that condition.
3. Run the focused workflow and policy tests, inspect the final diff, and
   complete the exact-head PR review gates.

## Verification

- `pnpm hosted-billing:ci-guard`
- Focused Vitest for `scripts/check-hosted-stripe-billing-ci.test.ts`
- Focused Node policy test for `scripts/pull-request-ci-policy.test.mjs`
- Exact-head required CI, preliminary coverage specialist, final sensitive
  ReviewGPT, and current-base merge-tree proof.

## Progress

- [x] Prove the repeated `main` failure from live run job receipts.
- [x] Confirm GitHub's skipped-dependency propagation contract.
- [x] Implement the workflow condition and regression guard.
- [x] Pass the hosted billing CI guard, all 24 focused workflow mutation tests,
  and all 21 dependency-free pull-request CI policy tests.
- [ ] Complete exact-head review gates, required CI, final review, and plan
  closure. The broader diff-aware lane reached unrelated pre-existing failures
  in `scripts/frog-autofix.test.ts` after its syntax, architecture, provider,
  TypeScript tooling, and dependency-policy phases passed.
