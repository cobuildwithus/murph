# Hosted-Onboarding Follow-Up Simplification

## Goal

Do one final structural cleanup pass on the hosted-onboarding transaction-ownership refactor and implement any safe simplifications that improve composability without changing behavior.

## Why

- The hard cut is functionally in place, but the best long-term shape also wants the shared seams to stay minimal and consistent.
- The repo coordination state still references the completed hard-cut plan from `active`, which is now stale routing metadata.
- A few type seams still duplicate the same “root or transaction Prisma client” concept under multiple names.

## Scope

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-15-hosted-onboarding-followup-simplify.md`
- targeted hosted-onboarding modules and tests if a safe simplification is warranted

## Constraints

- Favor only safe, local simplifications with no product-behavior change.
- Do not broaden the refactor into unrelated hosted-onboarding copy or UX work already in flight.
- Preserve unrelated dirty worktree edits.

## Plan

1. Fix the stale coordination metadata for the completed hard-cut plan and inspect the hosted-onboarding call graph for remaining structural cleanup targets.
2. Implement only simplifications that clearly reduce seam duplication or improve composition without changing behavior.
3. Re-run focused verification for the touched hosted-onboarding slice and commit only the follow-up files.

## Verification Target

- `pnpm --dir apps/web typecheck`
- focused hosted-onboarding tests for any touched modules
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
