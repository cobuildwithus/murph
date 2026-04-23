# Archive stranded active plans and clarify finish-task usage

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Reduce stranded active plans by archiving only the clearly closed/orphaned plan files, clarifying the repo instructions around `scripts/finish-task` vs `scripts/close-exec-plan.sh`, and adding automated proof that `scripts/finish-task` closes and archives the active plan.

## Success criteria

- The active-plan directory no longer contains plans that are clearly closed because they either have a completed implementation status, a completed ledger row, or no matching ledger row at all.
- `AGENTS.md` and the durable plan/workflow docs explicitly tell agents to use `scripts/finish-task` for plan-bearing commits and to still close/archive plans when a commit is blocked.
- Automated proof covers the `scripts/finish-task` happy path: remove the matching ledger row, call the plan-close helper, move the active plan into `completed/`, and pass the closed-plan artifact into the commit helper.
- Required low-risk workflow verification passes or any unrelated blockers are recorded precisely.

## Scope

- In scope:
  - `AGENTS.md`
  - `agent-docs/PLANS.md`
  - `agent-docs/operations/agent-workflow-routing.md`
  - `agent-docs/exec-plans/active/README.md`
  - `scripts/finish-task`
  - repo-owned workflow/tooling tests for the finish-task close/archive flow
  - archiving the clearly stranded plan files already sitting under `agent-docs/exec-plans/active/`
- Out of scope:
  - changing runtime/product code outside repo workflow tooling
  - rewriting the underlying `@cobuild/repo-tools` close-plan helper
  - archiving plans that still have an in-progress ledger row and no clear completed/blocked state

## Constraints

- Technical constraints:
  - Preserve unrelated dirty-tree plan files and ledger rows owned by other active lanes.
  - Do not archive any plan that still appears genuinely active.
- Product/process constraints:
  - Make the workflow clearer without bloating `AGENTS.md`.
  - Keep the archive rule aligned with the existing "done or abandoned plans must be closed" policy.

## Risks and mitigations

1. Risk: archiving a plan that another agent still treats as active could erase live coordination context.
   Mitigation: archive only plans that are orphaned from the ledger or clearly marked done/implementation-complete, and leave in-progress rows untouched.
2. Risk: the docs could overstate `scripts/finish-task` behavior without mechanical proof.
   Mitigation: add a repo test harness that exercises the finish-task close/archive path with stubbed repo-tool helpers.

## Tasks

1. Completed: register this cleanup in the coordination ledger and confirm which active plans are clearly stranded.
2. Completed: archive the stranded plans and remove the corresponding completed ledger rows.
3. Completed: clarify the repo instructions for `scripts/finish-task` and `scripts/close-exec-plan.sh`.
4. Completed: add automated proof for the finish-task close/archive flow.
5. Completed: run low-risk workflow verification and prepare the scoped cleanup for `scripts/finish-task`.

## Decisions

- Treat plans with no matching ledger row as stranded rather than active, because the repo plan workflow already requires exactly one matching ledger row for plan-bearing work.
- Treat plans marked `completed` or `implementation complete` as closeable even when a scoped commit was blocked, because the durable rule already says done or abandoned plans must be closed before handoff.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/release-script-coverage-audit.test.ts`
  - `bash -n scripts/finish-task`
  - `git diff --check -- AGENTS.md agent-docs/PLANS.md agent-docs/operations/agent-workflow-routing.md agent-docs/exec-plans/active/README.md scripts/finish-task packages/cli/test/release-script-coverage-audit.test.ts agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-04-24-exec-plan-archive-cleanup.md agent-docs/exec-plans/active agent-docs/exec-plans/completed`
- Results:
  - PASS: focused workflow proof reports `23` passing tests, including the new stranded-plan guard and the finish-task close/archive harness.
  - PASS: `bash -n scripts/finish-task`
  - PASS: `git diff --check -- ...`
  - PASS: direct active-plan readback now reports `25` active plans and `0` stranded plans.
  - FAIL, unrelated pre-existing repo blocker: `pnpm typecheck` stops in `packages/assistantd/test/{http,http-coverage}.test.ts` because the live tree still expects legacy `executionDriver: "codex-cli"` and `resumeKind: "codex-session"` values that no longer satisfy the current assistant metadata types.

## Outcome

- Archived `23` clearly stranded plan files out of `agent-docs/exec-plans/active/` and removed their stale coordination-ledger rows.
- Tightened the durable workflow docs so agents are told to use `scripts/finish-task` for plan-bearing commits and to still archive plans when exact staging is unsafe.
- Added a repo-owned regression test that mechanically proves the active-plan directory stays aligned with the ledger and that `scripts/finish-task` archives the plan before invoking the commit helper.
Completed: 2026-04-24
