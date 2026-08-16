# Plans

Execution plans are first-class artifacts in this repository.

## Locations

- Active: `agent-docs/exec-plans/active/`
- Completed: `agent-docs/exec-plans/completed/`
- Debt tracker: `agent-docs/exec-plans/tech-debt-tracker.md`

Completed plans are immutable, non-operative records of the decisions and
evidence available when a task closed. They may preserve assumptions later
superseded by review or implementation. Never use a completed plan for current
implementation, deployment, rollback, or incident response; follow the live
owner documents indexed in `agent-docs/index.md`. When they conflict, the live
owner document prevails and the completed snapshot remains unchanged.

## Lifecycle Scripts

- Create a plan: `bash scripts/open-exec-plan.sh <slug> "<title>"`
- Inspect plan-helper usage without creating a plan: `bash scripts/open-exec-plan.sh --help` or `pnpm run plan:open -- --help`
- Complete a plan: `bash scripts/close-exec-plan.sh <active-plan-path>`
- Finish a plan-bearing task and commit it: `bash scripts/finish-task <active-plan-path> "brief summary" <path> [path ...]`
- After its PR is merged or closed, retire the task worktree from another checkout: `scripts/retire-worktree <path>`

## When To Create A Plan

Create a plan when work is multi-file, high-risk, cross-cutting, or likely to span more than one turn.

Narrow user-supplied patch landings may skip a dedicated plan when all of the following are true:

- the task is primarily integrating an externally prepared patch or diff intent
- the scope stays bounded and does not introduce new architecture or process design
- the work is expected to finish in one turn

If the patch starts drifting into broader design, refactor, or multi-turn work, open a plan before continuing.

## Local Working Tree Note

The repo's large-change-set plan guard remains strict for staged comparisons and CI-style commit ranges.

Plain local working-tree verification is intentionally looser: if other agents have left many unrelated dirty files in the tree, `scripts/check-agent-docs-drift.sh` will not fail solely because the total local changed-file count exceeds the large-change threshold. The guard still enforces the usual code-versus-doc drift checks, and operators can re-enable a local threshold by setting `MURPH_WORKTREE_DRIFT_LARGE_CHANGE_THRESHOLD`.

## Completion Rule

If a task used an execution plan and the task is done or abandoned, close that plan before handoff. Prefer `bash scripts/finish-task ...` when the task is also ready to commit.
`scripts/finish-task` closes the plan and creates a scoped commit containing the closed plan plus the resolved task paths.
If overlapping dirty-tree work makes an exact scoped commit unsafe, run `bash scripts/close-exec-plan.sh <active-plan-path>` anyway; do not leave closed work stranded under `active/`.
