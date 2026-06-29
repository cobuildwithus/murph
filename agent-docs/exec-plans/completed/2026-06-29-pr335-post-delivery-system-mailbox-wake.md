# PR335 Post-Delivery System Mailbox Wake

Status: completed
Created: 2026-06-29
Updated: 2026-06-29

## Goal

- Fix the remaining PR 335 CI failure where the Linq scheduled reminder hosted E2E
  keeps an already-past assistant wake after post-checkpoint delivery drains.

## Success criteria

- The stale post-delivery wake is dropped when the echoed workspace assistant wake
  is due/past, including fresh system-mailbox invocations.
- Focused assistant-runtime tests and required scoped verification pass.
- The PR branch is pushed and the failing GitHub check is monitored again.

## Scope

- In scope: `workspace-assistant-phase` wake selection and focused regression tests.
- Out of scope: warm runner/app-server lifecycle changes and broader hosted architecture changes.

## Constraints

- Technical constraints: keep the fix local to the post-delivery wake invariant.
- Product/process constraints: preserve simple, composable wake-selection primitives.

## Risks and mitigations

1. Risk: Dropping a legitimate future wake.
   Mitigation: only drop an assistant candidate that exactly equals the workspace
   wake and is due/past at post-delivery time.

## Tasks

1. Diagnose the fresh CI artifact.
2. Patch the stale wake predicate.
3. Add a regression test for fresh system-mailbox post-delivery delivery.
4. Run focused and scoped verification.
5. Commit, push, and monitor CI.

## Decisions

- Do not touch warm app-server or runner lifecycle code; the failure is a stale
  assistant-runtime wake candidate after delivery.

## Verification

- Commands to run:
  - Focused assistant-runtime test for post-delivery wake cases.
  - `pnpm --dir packages/assistant-runtime typecheck`
  - Scoped workspace verification for touched assistant-runtime files.
- Expected outcomes: all pass.
Completed: 2026-06-29
