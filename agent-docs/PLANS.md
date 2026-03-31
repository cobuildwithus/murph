# Plans

Execution plans are first-class artifacts in this repository.

## Locations

- Active: `agent-docs/exec-plans/active/`
- Completed: `agent-docs/exec-plans/completed/`
- Debt tracker: `agent-docs/exec-plans/tech-debt-tracker.md`

## Lifecycle Scripts

- Create a plan: `bash scripts/open-exec-plan.sh <slug> "<title>"`
- Complete a plan: `bash scripts/close-exec-plan.sh <active-plan-path>`
- Finish a plan-bearing task and commit it: `bash scripts/finish-task <active-plan-path> "type(scope): summary" <path> [path ...]`

## When To Create A Plan

Create a plan when work is multi-file, high-risk, cross-cutting, or likely to span more than one turn.

Narrow user-supplied patch landings may skip a dedicated plan when all of the following are true:

- the task is primarily integrating an externally prepared patch or diff intent
- the scope stays bounded and does not introduce new architecture or process design
- the work is expected to finish in one turn
- a coordination-ledger row still captures the active scope

If the patch starts drifting into broader design, refactor, or multi-turn work, open a plan before continuing.

## Local Working Tree Note

The repo's large-change-set plan guard remains strict for staged comparisons and CI-style commit ranges.

Plain local working-tree verification is intentionally looser: if other agents have left many unrelated dirty files in the tree, `scripts/check-agent-docs-drift.sh` will not fail solely because the total local changed-file count exceeds the large-change threshold. The guard still enforces the usual code-versus-doc drift checks, and operators can re-enable a local threshold by setting `MURPH_WORKTREE_DRIFT_LARGE_CHANGE_THRESHOLD`.

## Completion Rule

If a task used an execution plan and the task is done or abandoned, close that plan before handoff. Prefer `bash scripts/finish-task ...` when the task is also ready to commit.
