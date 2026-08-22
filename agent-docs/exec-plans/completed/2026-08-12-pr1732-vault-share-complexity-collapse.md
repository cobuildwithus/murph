# PR 1732 vault-share complexity collapse

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Resolve the final ReviewGPT finding by making the existing 25-share
  grantor/scope product limit atomic at the sole production grant owner.
- Collapse delivery to one bounded, fail-closed read and remove the unneeded
  continuation and unmerged index-migration machinery.

## Success criteria

- Every production create and regrant path converges on one transaction-scoped
  grantor/scope advisory lock and cannot admit a 26th active share.
- Delivery reads at most 26 rows, rejects an invalid 26th row, and serially
  attempts every legal share without a continuation protocol.
- Pre-transaction crypto preparation, prepared-root fencing, exact-generation
  compare-and-set, and globally ordered runtime/owner member locks remain intact.
- Focused Web, Cloudflare, shared-route, and real-PostgreSQL proof passes on a
  fresh migration deployment; required CI and exact-head ReviewGPT are terminal.

## Scope

- Hosted vault-share grant and delivery owners in Web.
- The Cloudflare delivery port and shared hosted-execution route surface.
- Focused unit/concurrency tests plus current reliability and verification docs.
- Deletion of the two unmerged continuation-specific migrations and their tests.

## Constraints

- Keep draft PR #1732 draft; do not merge, rebase onto `main`, or broaden into
  sibling database collection lanes.
- Add no persisted state, queue, cursor, service, dependency, or provider work.
- Preserve deployment compatibility for the currently valid at-most-25 cohort.

## Tasks

1. [x] Trace every production grant/regrant caller and prove one owner boundary.
2. [x] Centralize atomic cap admission and collapse delivery to one 26-row read.
3. [x] Delete continuation/index machinery and replace it with focused proofs.
4. [x] Complete local verification and exact diff/privacy review.
5. [x] Commit and push the corrected head, correct the PR body, and run exact-head CI and ReviewGPT.
6. [x] Resolve any new actionable finding, close this plan, and leave the PR draft.

## Verification log

- Focused Web unit tests: 118 passed.
- Focused Cloudflare delivery-port tests: 2 passed.
- Focused hosted-execution route tests: 9 passed.
- Fresh migration deploy: 178 migrations applied successfully.
- Real PostgreSQL grant-limit proof: 1 passed after correcting the advisory-lock
  key to a PostgreSQL-safe unambiguous tuple.
- Real PostgreSQL reciprocal runtime-access proof: 1 passed.
- Web, Cloudflare, and hosted-execution typechecks passed after the current edits.
- Final focused units: Web 165, Cloudflare 2, and hosted-execution 9 passed.
- Scoped Web ESLint, docs drift, dependency policy, diff check, and direct
  identifier privacy scan passed.
- The corrected behavior head was pushed to draft PR #1732 with an updated
  intent contract and no schema rollout.
- Exact behavior-head CI completed with 13 passing checks, one expected skip,
  and no failures.
- Exact behavior-head ReviewGPT round 2 reverified every accepted correction,
  returned `ROUND_OUTCOME: PASS`, and reported no actionable finding.
Completed: 2026-08-12
