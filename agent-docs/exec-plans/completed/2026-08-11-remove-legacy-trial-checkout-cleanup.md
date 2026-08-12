# remove-legacy-trial-checkout-cleanup

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Remove the completed legacy Pulse-trial migration from hosted checkout so a
  new Checkout request no longer performs legacy Stripe retrieval or
  cancellation while holding the member billing lock.

## Success criteria

- The checkout service no longer imports or invokes the one-time retirement
  helper.
- The obsolete helper and its dedicated tests are deleted while delayed-event,
  Family, account-deletion, and loser-subscription guards remain intact.
- Durable Starter/Web documentation describes the contracted runtime surface.
- Focused tests, Web typecheck, exact-head CI, both required ReviewGPT stages,
  and the current-base merge-tree proof pass on the open PR.

## Scope

- In scope: hosted checkout service, the obsolete per-member retirement export,
  directly coupled tests/mocks, and the durable docs that name the checkout
  cleanup owner.
- Out of scope: legacy Price recognition, delayed Stripe-event reconciliation,
  Family conversion safeguards, account-deletion cleanup, and any replacement
  job, queue, claim, or compatibility owner.

## Constraints

- Technical constraints: preserve paid-state fail-closed behavior and the
  remaining exact-provider cleanup/classification helpers.
- Product/process constraints: ReviewGPT authors the first implementation patch;
  the parent integrates it deliberately, verifies it, and does not reintroduce
  already-completed migration machinery.

## Risks and mitigations

1. Risk: broad deletion could remove delayed-event or privacy cleanup authority.
   Mitigation: prove every remaining export/reference and delete only code that
   is exclusive to request-time checkout migration.
2. Risk: documentation could overstate removal of all legacy compatibility.
   Mitigation: distinguish the removed checkout owner from retained delayed-event
   and Family cleanup guards.

## Tasks

1. [x] Obtain and inspect a ReviewGPT-authored patch artifact.
2. [x] Integrate the scoped deletion and update directly affected durable docs.
3. [x] Run focused tests, typecheck, static checks, and parent diff/privacy review.
4. [x] Commit and push a candidate, open the PR with its full intent contract, and
   run preliminary specialists plus the final ReviewGPT gate on the exact head.
5. [x] Resolve findings, require green exact-head CI, archive this plan in the final
   task commit, and prove current-base mergeability without merging.

## Progress

- ReviewGPT returned a four-file implementation patch; its source/test hunks
  were inspected, privacy-scanned, apply-checked, and integrated deliberately.
- Durable Starter and Web documentation now distinguishes the removed checkout
  owner from retained event, Family, and account-deletion guards.
- Focused billing/cleanup tests pass 132 tests; Web typecheck, targeted ESLint,
  docs drift, and diff/privacy checks pass.
- The first specialist pass found one test-only gap in service-level proof for
  a persisted subscription. Its inspected coverage patch was accepted, and the
  corrected-head specialist pass returned PASS with no findings.
- Final ReviewGPT full-snapshot review returned PASS with no findings on the
  corrected pushed head. All exact-head PR checks pass, including the hosted
  Stripe boundary and repository-wide assistant coverage shards.
- The pull request remains unmerged. Final plan archival and current-base
  merge-tree proof complete the handoff.

## Decisions

- Treat the completed production drain and explicit user authorization as the
  removal gate for synchronous checkout cleanup; retain the independently used
  event and account-deletion compatibility helpers.
- Add no replacement state owner or background process.
- Preserve the initial reviewed-head provenance and record the isolated
  test-only remediation as a separate current-head change shape.

## Verification

- Commands to run: focused Vitest files for billing checkout and remaining
  cleanup helpers; `pnpm --dir apps/web typecheck`; applicable docs/static
  checks; exact-head GitHub Actions; `git merge-tree --write-tree` against the
  latest `origin/main`.
- Expected outcomes: zero references to the removed checkout helper, all focused
  proof passing, ReviewGPT specialist/final PASS, green required CI, and a clean
  merge-tree.
- Observed outcomes before plan archival: zero references remain; 132 focused
  tests, Web typecheck, exact-head CI, corrected-head specialist review, and
  final full-snapshot review all pass. The merge-tree proof is rerun after the
  doc-only plan-closure commit so it covers the final pushed head.
Completed: 2026-08-11
