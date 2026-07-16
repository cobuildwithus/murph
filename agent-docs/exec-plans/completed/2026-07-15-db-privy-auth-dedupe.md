# Deduplicate fresh Privy auth database reads

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Remove two proven duplicate database reads from the fresh-Privy request-authentication path without weakening or reordering any independent authentication, identity-binding, membership, or hosted-access checks.

## Success criteria

- Fresh Privy authentication reuses the member already returned with the verified identity lookup instead of rereading the same member row.
- After fresh Privy and app-session member ids match, hosted access is evaluated once and that single decision is used for both proofs.
- Independent Privy token verification, app-session verification, identity/member equality, suspended/billing/sponsored/container access semantics, fail-closed ordering, and error behavior remain unchanged.
- Focused tests prove database call counts plus denial/failure ordering for the changed path.
- Required hosted-web verification, coverage audit, parent final review, PR CI, ReviewGPT, and mergeability gates pass.

## Scope

- In scope: `apps/web/src/lib/hosted-onboarding/request-auth.ts`, focused request-auth tests, and task plan/ledger lifecycle artifacts.
- Out of scope: combining the app-session token/session-row lookup with the app-session member lookup; changing Privy verification, cookie/session formats, access policy, error types/statuses, database schema, or deploy contracts.

## Constraints

- Technical constraints: preserve the current authority boundaries and exact fail-closed ordering; prefer deletion and returned data already owned by the existing lookup; add no cache, new owner, or state.
- Product/process constraints: isolated worktree and PR; full auth/high-risk verification; ReviewGPT is the sole cross-cutting gate; no local deep review.

## Risks and mitigations

1. Risk: Reusing a relation-loaded member could accidentally weaken a later membership existence or state check.
   Mitigation: prove the selected member fields and compare the existing branch/error behavior in focused tests.
2. Risk: Collapsing two access checks could change denial order or evaluate different member ids.
   Mitigation: retain the identity/member equality check before the single access read and add call-order tests for mismatch and inactive-access cases.

## Tasks

1. Trace the fresh-Privy and app-session authentication path and record the exact duplicate reads and current failure order.
2. Add or tighten focused tests that fail on duplicate row/access reads and prove authority/failure ordering.
3. Delete the redundant reads with the smallest production change.
4. Run focused and required hosted-web verification; complete the coverage-write pass and resolve findings.
5. Perform the parent final review, close the plan with a scoped commit, push/open the PR, and complete CI plus ReviewGPT and mergeability proof.

## Decisions

- Keep the app-session session-row and member lookup as separate validation boundaries; the accepted audit finding explicitly excludes combining them.
- Reuse only the member already loaded through the Privy principal relation. The verified principal remains the authority, and a stale custom-metadata member id never selects a different member.
- Run one unchanged hosted-access decision only after the fresh Privy member id and independently verified app-session member id match.

## Verification

- Commands to run: focused request-auth Vitest; `pnpm verify:acceptance`; `git diff --check`; required coverage-write audit; PR CI; ReviewGPT; merge-tree/preflight checks.
- Expected outcomes: all checks pass; focused tests prove one fresh-Privy identity/member read, one app-session member read, and one active-access read after member equality with unchanged denial order.

## Local evidence

- The focused request-auth suite passed 22 tests. The new regression assertions produced four failures against the previous production implementation before the redundant reads were deleted.
- Hosted web typecheck and lint passed; lint reported only twelve pre-existing warnings outside the changed paths.
- The full hosted web verifier passed 5,213 tests with expected skips, the development smoke check, and the production Next.js build. Cloudflare app verification passed 1,833 tests.
- The workspace acceptance command passed all task-relevant app and package lanes. Assistant-engine coverage in an untouched package exhausted the default four-gigabyte heap under parallel load; an isolated eight-gigabyte rerun completed and exposed two unrelated process-lifecycle test failures while 2,259 other tests passed.
- The required coverage-write audit reran the focused suite with coverage: 22 tests passed, every changed statement and branch executed, and no additional high-value proof or actionable coverage finding remained.
Completed: 2026-07-15
