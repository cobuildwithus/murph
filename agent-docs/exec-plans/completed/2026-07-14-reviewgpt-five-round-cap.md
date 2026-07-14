# ReviewGPT Five-Round Cap

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Cap the PR-lane ReviewGPT loop at five rounds instead of fifteen.

## Success criteria

- The ReviewGPT loop owner doc states a five-round hard cap.
- The docs index and workflow guard test match the owner doc.
- Scoped verification passes and no live fifteen-round cap reference remains.

## Scope

- In scope: the PR ReviewGPT loop doc, its docs index entry, and the exact-string workflow guard test.
- Out of scope: ReviewGPT runtime/tooling behavior, historical completed plans, and non-PR review workflows.

## Tasks

1. Done: Update the live cap and aligned references from fifteen rounds to five.
2. Done: Run focused readback, stale-reference checks, and scoped verification.
3. Next: Close the plan and create the required scoped commit.

## Verification

- Passed: the focused workflow guard test (34 passed, 1 skipped).
- Passed: `git diff --check` and live-doc stale-cap searches excluding immutable completed plans.
- Partial: `pnpm test:diff agent-docs/index.md agent-docs/operations/pr-reviewgpt-loop.md packages/cli/test/release-script-coverage-audit.test.ts` passed shell/Node syntax, architecture and privacy guards, dependency policy, workspace boundaries, and the affected CLI typecheck. Its broader CLI test phase was interrupted after prolonged host-wide concurrent Vitest contention; the exact changed guard test passed separately.
Completed: 2026-07-14
