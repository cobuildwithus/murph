# Finish task wrapper and plan cleanup

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

- Add a single explicit end-of-task wrapper that closes an execution plan before commit, then clean stale completed plans out of `agent-docs/exec-plans/active/`.

## Success criteria

- `scripts/finish-task` closes one active execution plan and then delegates to `scripts/committer` with the completed-plan path included in the commit.
- `AGENTS.md` and plan workflow docs tell agents to use `scripts/finish-task` when a task used an execution plan.
- Stale completed plans currently sitting under `agent-docs/exec-plans/active/` are moved to `agent-docs/exec-plans/completed/`.
- Required repo checks run and the exact outcomes are recorded truthfully.

## Scope

- In scope:
- `scripts/finish-task`
- process-doc updates for plan closure and commit handoff
- targeted `package.json` script wiring if helpful for discoverability
- manual cleanup of stale completed plans in `agent-docs/exec-plans/active/`
- Out of scope:
- changing `scripts/committer` behavior
- adding a hard-fail verifier for stale plans
- rewriting historical completed plans

## Constraints

- Technical constraints:
- preserve genuinely active or in-progress plans in `agent-docs/exec-plans/active/`
- keep `scripts/committer` as the narrow commit primitive
- Product/process constraints:
- use the existing `scripts/close-exec-plan.sh` behavior instead of duplicating plan-closing logic
- do not rewrite immutable snapshots already under `agent-docs/exec-plans/completed/`

## Risks and mitigations

1. Risk:
   moving a still-active plan would erase useful coordination context
   Mitigation: only sweep plans that already declare a completed status or are clearly stale/completed from their contents; leave ambiguous active/in-progress plans in place.

## Tasks

1. Add `scripts/finish-task` as a thin wrapper around `scripts/close-exec-plan.sh` and `scripts/committer`.
2. Update commit/completion/plan docs so plan-bearing tasks close via the wrapper before handoff.
3. Sweep stale completed plans from `agent-docs/exec-plans/active/` into `agent-docs/exec-plans/completed/`.
4. Run the required repo checks and commit the scoped process/tooling changes.

## Decisions

- Prefer an explicit wrapper over hidden `scripts/committer` behavior.
- Do not add a blocking stale-plan verifier in this change.

## Outcome

- Added `scripts/finish-task` as the canonical close-plan-then-commit wrapper for plan-bearing tasks.
- Updated the main repo process docs to tell agents to use the wrapper before handoff when a task used an execution plan.
- Swept the completed backlog out of `agent-docs/exec-plans/active/`, including a preserved duplicate completed snapshot copy for the stale current-profile plan that already had an immutable completed counterpart.
- Reduced `agent-docs/exec-plans/active/` from 96 plan files to 37, leaving only active, in-progress, or still-ambiguous plans in place.

## Verification

- Required commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- repo checks may still fail on unrelated pre-existing worktree issues outside this process/tooling lane; record exact failures if so

## Verification results

- `pnpm typecheck` failed outside this lane in `apps/web/test/hosted-execution-outbox.test.ts` because `HostedExecutionUserStatus` no longer accepts the `activated` property.
- `pnpm test` failed at the same hosted-web typecheck boundary for `apps/web/test/hosted-execution-outbox.test.ts`.
- `pnpm test:coverage` failed at the same hosted-web typecheck boundary for `apps/web/test/hosted-execution-outbox.test.ts`.
- The first parallel verification attempt also triggered a transient `packages/web` build collision (`Another next build process is already running`), but a sequential rerun removed that contention and confirmed the hosted-web typecheck error as the real blocker.

## Verification

- Commands to run:
- Expected outcomes:
Completed: 2026-03-28
