# PR 495 ReviewGPT Round 1

## Goal

Collapse usage-limit notice marker ownership so allowance bookkeeping never reads or writes `limitNoticeSentAt`; only the existing claim and exact-release protocol owns it.

## Constraints

- Preserve all behavior and rollout invariants from the phase-one prerequisite.
- Add no state, schema, helper layer, or compatibility machinery.
- Keep the change within the allowance owner and focused tests.

## Working Set

- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/test/hosted-execution-usage-allowance.test.ts`

## Plan

1. Delete marker reads and pass-through writes from allowance-period normalization and limit changes.
2. Update focused assertions to prove those updates omit the marker.
3. Run focused verification and the affected coverage audit.
4. Close the plan, push, and rerun ReviewGPT against the new PR head.

## Verification

- Focused hosted usage-allowance tests.
- Hosted-web typecheck and targeted lint.
- `pnpm test:diff` for the touched owner.
- `git diff --check` and privacy identifier scan.

## State

Complete. ReviewGPT's single complexity-collapse finding was accepted and implemented.

## Outcomes

- Allowance maintenance no longer selects, compares, threads, or writes the notice marker.
- The existing atomic claim and exact-timestamp release are the only production marker writers.
- The obsolete one-property metadata object was reduced to a scalar `blockedAt` resolver.
- Coverage audit found the existing behavioral assertions sufficient and made no edits; a projection-shape assertion was rejected because it would add coupling without protecting user behavior.
- Focused tests passed (109 across the allowance owner and send/release path), hosted-web typecheck and targeted lint passed, and diff-aware verification passed (4,026 tests passed, 9 skipped, with dev smoke and production build).
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
