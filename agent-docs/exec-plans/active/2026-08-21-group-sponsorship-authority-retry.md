# Keep automatic sponsorship refills retryable

Status: active
Created: 2026-08-21
Updated: 2026-08-21

## Goal

- Keep valid automatic group sponsorship refills automatic when the
  transaction-scoped runtime-access check encounters retryable database
  contention. Preserve fail-closed behavior for a genuinely inactive group.

## Success criteria

- The transaction-scoped boolean access helper returns `false` only for the
  canonical non-retryable inactive-access error.
- Retryable authority drift and unexpected database errors escape the
  transaction, leaving the exact purchase and Stripe idempotency key available
  to the existing refill sweep retry owner.
- Focused tests prove inactive access still fails closed and retryable or
  unexpected failures are not misclassified as revoked authority.
- The Web typecheck, required exact-head CI, preliminary specialist review,
  final billing/security review, and public changelog checks pass.

## Scope

- In scope:
  - Correct error classification in the shared transaction-scoped runtime
    access helper.
  - Regression coverage at that owning boundary and the automatic refill path.
  - A privacy-safe changelog item describing the member-visible recovery.
- Out of scope:
  - Changing sponsorship caps, payment-method selection, Stripe confirmation,
    or the beneficiary-first sponsorship serialization contract.
  - Redesigning the funding drawer; that is a separate UI concern from the
    automatic-payment failure reported here.
  - Adding a queue, retry table, or a second payment recovery owner.

## Constraints

- Technical constraints:
  - Reuse the refill dispatcher's existing exact-purchase retry behavior and
    Stripe idempotency key.
  - Preserve the canonical inactive-access error as the only boolean denial.
  - Keep Stripe and other provider calls outside database transactions.
- Product/process constraints:
  - Product UX Patch: a valid automatic sponsor should see no interruption;
    revoked or inactive authority must still stop payment safely.
  - Keep private production identifiers and incident details out of source,
    tests, changelog copy, commits, and PR text.

## Risks and mitigations

1. Risk: Treating a real authority revocation as retryable could charge after
   access ends.
   Mitigation: Match only the canonical non-retryable inactive-access error as
   `false`; preserve the existing authority recheck before bind and confirm.
2. Risk: A transient failure could create duplicate payment work.
   Mitigation: The dispatcher retains the same purchase identity and Stripe
   idempotency key; the transaction aborts before binding or canceling.
3. Risk: Shared-helper behavior could affect initial group funding admission.
   Mitigation: Cover both inactive and transient classifications at the shared
   owner and run the focused hosted billing suite plus Web typecheck.

## Tasks

1. Add a narrow inactive-error classifier to the transaction-scoped boolean
   helper and rethrow every other error.
2. Add shared-owner and automatic-refill regression coverage.
3. Add the public changelog fragment and generate its ignored registry.
4. Run focused tests, Web typecheck, diff/privacy review, and Product UX
   walkthrough.
5. Commit and push the candidate, open the PR, and run preliminary and final
   ReviewGPT concurrently with exact-head CI.
6. Resolve findings, close the plan with the final scoped commit, merge after
   gates pass, verify the production deployment, and retire the worktree.

## Decisions

- Keep the current sponsorship lock order. Database contention is expected to
  abort and retry; it must not be translated into revoked payment authority.
- Fix the shared error-classification owner instead of adding billing-specific
  retry state or catching database errors in the Stripe layer.
- Reuse `isHostedRuntimeInactiveAccessError`, which already expresses the
  exact non-retryable denial contract used by other transactional callers.

## Verification

- Commands to run:
  - Focused Vitest for runtime access and sponsorship refill dispatch.
  - Local PostgreSQL concurrency proof when the repository test database is
    available.
  - `pnpm --filter @murphai/web typecheck`.
  - Changelog generation and focused changelog tests.
  - Required GitHub Actions and exact-head ReviewGPT gates.
- Expected outcomes:
  - Valid authority plus a retryable/unknown access-check failure leaves the
    automatic purchase retryable and does not cancel the untouched intent.
  - Canonical inactive access still returns `false` and preserves the safe
    no-charge path.
  - No provider-input, hot reply-path, schema, or cross-deploy contract change.
