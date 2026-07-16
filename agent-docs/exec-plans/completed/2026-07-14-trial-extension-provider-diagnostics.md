# Pulse Trial provider diagnostics

Status: completed
Created: 2026-07-14
Updated: 2026-07-15

## Goal

- Make a failed single-member Pulse Trial Stripe lookup diagnosable from
  production logs without exposing member or provider identifiers, then use
  that evidence to fix and verify the production failure.

## Success criteria

- Stripe retrieve and update failures emit one bounded structured error log with
  the operation and safe provider metadata only.
- Logs never include member, customer, subscription, request, credential, or
  provider-message values.
- Focused tests prove the safe field projection and both failure call paths.
- The exact pushed head passes routed verification, required audits,
  ReviewGPT, and CI before production deployment.
- A production Preview for the affected member either succeeds or yields the
  safe diagnostic needed for a follow-up root-cause fix.

## Scope

- In scope: `apps/web` Pulse Trial extension provider-error projection,
  structured error logging, focused tests, PR/deploy proof, and the smallest
  evidence-backed follow-up fix if the new log identifies one.
- Out of scope: changing trial eligibility, bulk campaign behavior, billing
  schema, Stripe credentials, or unrelated hosted billing flows.

## Constraints

- Stripe remains authoritative and member billing behavior must not change in
  the diagnostics-only patch.
- Keep logs content-free and identifier-free; provider messages and raw errors
  are forbidden.
- Reuse the existing single-member extension owner and add no dependency,
  persisted state, queue, retry loop, or compatibility path.

## Risks and mitigations

1. Risk: provider errors can contain billing identifiers or request context.
   Mitigation: project only bounded allowlisted type/code, numeric HTTP status,
   and request-id presence; never log the raw error or message.
2. Risk: logging changes accidentally alter failure behavior.
   Mitigation: retain the existing typed provider error and assert the same
   caller-visible result in focused tests.
3. Risk: deployment backlog obscures which code handled the retry.
   Mitigation: record and verify the production alias deployment SHA before
   interpreting the post-deploy log.

## Tasks

1. Add the narrow safe Stripe error projector and error logs at retrieve/update.
2. Add focused regression coverage for allowed and forbidden log fields.
3. Run scoped verification, coverage audit, and parent final review.
4. Finish the plan-bearing commit, open the PR, start ReviewGPT concurrently
   with CI, and resolve all findings.
5. Merge/deploy, verify the production alias head, retry Preview, and use the
   resulting evidence for the smallest root-cause fix if needed.

## Verification

- Focused provider and route tests pass with 23 tests.
- Focused ESLint and TypeScript checks pass.
- `pnpm test:diff` passes, including 5,098 hosted-web tests and the production
  Next.js build; its 13 lint warnings are unrelated pre-existing warnings.
- The required `coverage-write` audit and parent final review found no
  unresolved actionable gaps.

## State

The diagnostics-only implementation, focused verification, required coverage
audit, full routed verification, and parent final review are complete. Exact-head
PR CI, ReviewGPT, deployment, and the production Preview remain.
Completed: 2026-07-15
