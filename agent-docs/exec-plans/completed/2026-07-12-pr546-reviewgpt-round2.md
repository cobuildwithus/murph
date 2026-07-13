# PR 546 ReviewGPT round 2 remediation

Status: completed
Created: 2026-07-12
Updated: 2026-07-12

## Goal

- Make the fixed Pulse Trial extension campaign operate over one immutable,
  fully pageable cohort and align the trial-end runway with the configured
  one-attempt Stripe update boundary.

## Success criteria

- Campaign membership derives from immutable Pulse Trial redemption state and
  a fixed end-exclusive campaign cutoff.
- Numbered pages select the immutable cohort directly, without replaying prior
  mutable pages or imposing an operational 404-candidate ceiling.
- Current local and Stripe eligibility is still rechecked before mutation and
  under the existing member Stripe mutation lock.
- The minimum update runway is derived from the actual Stripe request timeout
  and retry contract.
- Production-faithful regressions cover post-cutoff insertion, prior-member
  state changes, candidates beyond 404, and both runway boundaries.
- Required audits, final ReviewGPT, and PR checks pass on the pushed head.

## Scope

- In scope: Pulse Trial extension candidate ownership/pagination, route page
  validation, provider runway derivation, Ops entry/action copy, focused tests,
  operator docs, and PR intent/deployment text.
- Out of scope: persisted preview lifecycle, queues, recurring campaigns, a new
  database model, or changing the default Pulse Trial policy.

## Constraints

- Reuse `pulseTrialRedeemedAt` as the existing immutable redemption fact.
- Preserve aggregate-only responses, preview proof, Stripe idempotency, and the
  shared hosted-member Stripe mutation lock.
- Post-cutoff trial enrollments are deliberately outside this fixed campaign.

## Risks and mitigations

1. Risk: a mutable eligibility scan shifts pages and hides a cohort member.
   Mitigation: page the fixed redemption cohort directly by stable member ID.
2. Risk: an arbitrary page ceiling makes remaining work unreachable.
   Mitigation: accept every mathematically safe page offset and issue one
   bounded direct page query.
3. Risk: historical runway rejects a trial that can survive the configured
   update attempt.
   Mitigation: derive the boundary from the 80-second request timeout plus one
   second and cover both sides.
4. Risk: broadening the scan mutates converted or expired members.
   Mitigation: retain current local classification, locked re-read, and Stripe
   authority checks; cohort membership only stabilizes traversal.

## Tasks

1. Define and document the immutable campaign cohort cutoff.
2. Replace prior-page replay with direct stable cohort page selection.
3. Remove the arbitrary route page ceiling while retaining safe numeric input.
4. Derive and test the provider update runway.
5. Run focused/full verification and required audits.
6. Commit, push, rerun ReviewGPT and CI, and merge only at zero accepted findings.

## Decisions

- Accept both ReviewGPT round-2 findings after validating them against the
  immutable redemption field, automatic enrollment path, route ceiling, and
  one-attempt Stripe request configuration.
- Use `2026-07-10T00:00:00.000Z` as the end-exclusive campaign cutoff: it is
  the first UTC boundary after the fixed campaign was authored on July 9.

## Verification

- Focused Pulse Trial service, route, and client Vitest suites: 54 passed.
- Hosted-web prepared typecheck, focused ESLint, and `git diff --check`: passed.
- `pnpm test:diff apps/web`: passed, including dependency/boundary/security
  guards, dev smoke, production build, lint with 10 pre-existing warnings,
  and 4,292 tests passed with 9 skipped.
- Coverage-write audit pinned the literal fixed cutoff and confirmed direct
  page/candidate-405 and 81/82-second runway proof.
- Security/privacy and frontend re-audits found no medium-or-higher issue; the
  minor Ops-entry copy drift was corrected before final review.
- Parent final diff review: passed.
- Pushed-head ReviewGPT round 3 and final PR CI remain post-commit merge gates.
Completed: 2026-07-12
