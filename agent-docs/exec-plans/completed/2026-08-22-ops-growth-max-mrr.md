# Include Max in ops growth individual MRR breakdown

Status: completed
Created: 2026-08-22
Updated: 2026-08-22

## Goal

- Make the `/ops/growth` daily subscription split include direct Max-plan MRR,
  so individual plus Family MRR reconciles exactly to total subscription MRR.

## Success criteria

- Snapshot create and update paths derive all direct MRR from total minus Family.
- The focused growth-metrics test covers a paid Max member in the snapshot split.
- Focused tests and Web typecheck pass, and required PR review/CI gates resolve.

## Scope

- In scope: the existing daily growth snapshot derivation and focused regression.
- Out of scope: historical snapshot repair, plan pricing changes, Stripe behavior,
  and changes to the live total-MRR calculation.

## Constraints

- Technical constraints: derive the split from existing total and Family metrics;
  add no new state, query, dependency, or billing owner.
- Product/process constraints: internal ops reporting only; preserve the exact
  total-MRR and monthly-series fallback behavior.

## Risks and mitigations

1. Risk: the split could double-count or omit another direct tier.
   Mitigation: derive the split from total minus Family rather than enumerating
   direct tiers, and assert exact create/update values with Pulse, Edge, Max,
   and Family fixtures.

## Tasks

1. Update the daily snapshot individual-MRR derivation to include Max.
2. Extend the focused snapshot regression with a direct Max member.
3. Run focused proof, inspect the diff, commit/push, and complete PR review gates.

## Decisions

- Keep `mrrUsdCents` unchanged; derive individual MRR as total minus Family so
  future direct tiers cannot be omitted from the persisted split.
- Do not backfill historical rows in this patch. Existing inconsistent rows
  already fail safely to the unsplit total in the monthly revenue series.

## Verification

- Passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-ops-growth.test.ts`
    (51 tests)
  - `pnpm --dir apps/web typecheck`
  - `git diff --check`
- Direct proof: the snapshot fixture records direct individual MRR including
  Max and reconciles individual plus Family MRR to total on create and update.

## Completion evidence

- Preliminary completion-specialists ReviewGPT: PASS with no findings.
- Final cross-cutting ReviewGPT round 1: PASS with no findings on the exact
  pushed candidate head.
- Parent review: the two snapshot write branches use the same total-minus-Family
  derivation; no query, schema, runtime boundary, or historical rewrite changed.
- Current-base merge proof: `git merge-tree --write-tree origin/main HEAD`
  completed cleanly after the reviewed candidate's base advanced.
Completed: 2026-08-22
