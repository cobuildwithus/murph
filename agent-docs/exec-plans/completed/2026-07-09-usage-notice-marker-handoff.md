# Usage Notice Marker Handoff

## Goal

Make the existing per-period usage-limit notice marker monotonic across same-period allowance normalization, limit increases, and later spend accounting so PR 465 can use it as a safe rollout handoff.

## Constraints

- Preserve the existing claimant and sender behavior on `main`, including exact-marker release after a failed send.
- Add no schema, rollout state, compatibility layer, or new abstraction.
- Keep the change limited to the allowance owner and focused proof.
- Deploy and drain this prerequisite before deploying PR 465.

## Working Set

- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/test/hosted-execution-usage-allowance.test.ts`

## Plan

1. Preserve `limitNoticeSentAt` during same-period metadata normalization and limit increases.
2. Stop spend accounting from clearing the marker.
3. Prove all three paths with focused tests and hosted-web verification.
4. Run required completion audits, close the plan, and publish a prerequisite PR.

## Verification

- Focused hosted usage-allowance tests.
- Hosted-web typecheck and targeted lint.
- `pnpm test:diff` for the touched owner.
- `git diff --check` and privacy identifier scan.

## State

Complete. The marker remains owned by the existing claim/release path while allowance normalization, limit changes, and spend accounting no longer reopen a notified period.

## Outcomes

- Production behavior changed with two additions and seven deletions; no state, schema, helper, or abstraction was added.
- Security/privacy review found no medium-or-higher finding and confirmed exact-timestamp failure release remains intact.
- Coverage review found the existing normalization, limit-increase, spend-SQL, claim, and release assertions sufficient and made no edits.
- Parent scope/shape and final reviews found no justified simplification beyond the current net-deletion diff.
- Focused tests, hosted-web typecheck, targeted lint, diff-aware hosted-web verification, production build, diff check, and privacy scan passed.
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
