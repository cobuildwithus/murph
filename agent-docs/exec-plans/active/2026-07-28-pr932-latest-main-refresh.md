# PR 932 latest-main refresh

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Reconcile the final PR #932 head with newly advanced `origin/main` while
  preserving both current line-capacity behavior and the certified group-join
  outreach limits.

## Scope

- `apps/web/src/lib/hosted-onboarding/linq-line-store.ts`
- directly affected tests and current-main merge-generated updates
- exact-head verification, CI, PR metadata, and ReviewGPT

## Constraints

- Resolve the one observed production conflict from both owners; do not choose
  either side wholesale.
- Add no capacity owner, queue, retry lifecycle, or compatibility path.
- Leave PR #932 open and unmerged.

## Verification

- Pending.
