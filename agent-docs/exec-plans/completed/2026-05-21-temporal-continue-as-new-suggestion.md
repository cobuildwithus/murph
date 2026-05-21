# Temporal continue-as-new suggestion

Status: completed
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Make the hosted Temporal per-user workflow Continue-As-New when Temporal
  reports history pressure through `workflowInfo().continueAsNewSuggested`, in
  addition to the existing iteration threshold.

## Success criteria

- The workflow checks both Temporal's server-side Continue-As-New suggestion and
  the configured iteration threshold before the next loop iteration.
- Carry-forward state remains compact and pointer-only.
- Focused workflow tests cover suggested Continue-As-New before the iteration
  threshold.
- Required package verification passes or any unrelated blocker is recorded.

## Scope

- In scope: `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
  and focused workflow tests.
- Out of scope: Temporal env parsing, Activity retry classification, hosted web
  demand logic, Cloudflare execution adapter behavior, or runtime business
  semantics.

## Constraints

- Preserve pointer-only Temporal workflow history.
- Keep workflow behavior deterministic.
- Preserve unrelated dirty work in active Temporal env parser files and the
  coordination ledger.

## Risks and mitigations

1. Risk: calling Temporal workflow metadata directly in unit tests makes the
   pure state machine harder to exercise. Mitigation: inject a runtime predicate
   that the entrypoint backs with `workflowInfo()`.

## Tasks

1. Register plan and ledger row.
2. Thread Temporal's Continue-As-New suggestion into the workflow runtime.
3. Add focused unit coverage for suggested Continue-As-New.
4. Run focused package verification plus required repo checks.
5. Close the plan with a scoped commit if the dirty worktree allows it.

## Decisions

- Use a runtime predicate so production code reads Temporal workflow metadata
  while state-machine tests can set the suggestion deterministically.

## Verification

- Passed:
  - `pnpm --dir packages/hosted-orchestrator-temporal test -- hosted-user-runtime-workflow.test.ts workflow-entrypoint.test.ts`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts packages/hosted-orchestrator-temporal/test/workflow-entrypoint.test.ts`
  - `pnpm test:smoke`
  - `git diff --check -- packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts packages/hosted-orchestrator-temporal/test/workflow-entrypoint.test.ts agent-docs/exec-plans/active/2026-05-21-temporal-continue-as-new-suggestion.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Completion notes

- Scoped commit is blocked by overlapping dirty work in
  `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
  and `packages/hosted-orchestrator-temporal/test/workflow-entrypoint.test.ts`
  that changes the ensure-execution timeout from 630000 to 660000 outside this
  task.
Completed: 2026-05-21
