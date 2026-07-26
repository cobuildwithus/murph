# Bad-code round 3: refund pre-egress clinical request budget

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Prevent a Clinical Records access-token decrypt failure before provider egress
  from consuming the run's provider-request budget.

## Success criteria

- Releasing a claimed page before any FHIR request refunds both its byte
  reservation and provider-request reservation atomically.
- A provider-started or ambiguous request remains charged.
- The existing page-claim compare-and-set prevents duplicate refunds.
- Focused tests, canonical verification, preliminary specialist review, final
  ReviewGPT, and required PR checks pass.

## Scope

- In scope: the existing retrieval-page release transaction and focused
  clinical retrieval coverage.
- Out of scope: budget limits, schema changes, cursor state, token lifecycle
  redesign, provider retry policy, and clinical UI.

## Constraints

- Keep the existing claim/release ownership and transaction boundary.
- Do not refund after provider egress may have started.
- Add no persisted state or dependency.
- Keep this change isolated in its own stacked PR and do not merge it.

## Risks and mitigations

1. Risk: a true provider request could be undercounted.
   Mitigation: refund only while the existing provider-request-started flag is
   false.
2. Risk: a retry or concurrent release could refund twice.
   Mitigation: preserve the exact request claim compare-and-set before updating
   run counters.
3. Risk: byte and request counters could diverge.
   Mitigation: update both counters in the same existing database transaction.

## Tasks

1. Add a focused failing regression for repeated access-token decrypt failure
   before provider egress.
2. Ask the existing round-3 ReviewGPT thread for a minimal patch and compare it
   with the local proof.
3. Implement the smallest atomic counter refund and run focused plus canonical
   verification.
4. Commit, push, open a stacked PR, and complete preliminary specialist plus
   final ReviewGPT/CI gates.
5. Close the plan with the final scoped commit and leave the PR unmerged.

## Decisions

- Treat `providerRequestCount` as a reservation at claim time and refund it
  alongside `egressBytes` only when no provider request started, matching the
  durable clinical retrieval contract.

## Verification

- Pre-fix focused reproduction:
  `pnpm exec vitest run --config apps/web/vitest.config.ts
  apps/web/test/clinical-records-retrieval.test.ts --no-coverage` failed only
  the new repeated access-token decrypt regression because
  `providerRequestCount` remained `2`.
- Post-fix focused proof: the same command passed all 47 tests.
- `pnpm --dir apps/web typecheck`: passed.
- Round-3 ReviewGPT implementation follow-up: the marked response recommended
  the same one-transaction counter decrement but did not satisfy the review
  wrapper's timing attestation, and its attachment could not be recovered.
  The one-line source correction was therefore implemented and inspected
  locally rather than claiming that artifact as applied.
- Product-experience review: `NO FINDINGS`; pre-egress decrypt failures remain
  retryable without consuming the finite request budget, while the existing
  provider-started flag keeps real or ambiguous provider requests charged and
  the claim-version compare-and-set preserves one refund winner.
- Canonical `MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff
  apps/web/src/lib/clinical-records/retrieval.ts
  apps/web/test/clinical-records-retrieval.test.ts`: passed end-to-end in the
  isolated Testbox, including affected tests, typechecks, and Web verification.
- Preliminary specialist ReviewGPT, parent final review, exact-head final
  ReviewGPT, and PR CI: pending.
