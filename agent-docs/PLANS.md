# Plans

Execution plans are first-class artifacts in this repository.

## Locations

- Active: `agent-docs/exec-plans/active/`
- Completed: `agent-docs/exec-plans/completed/`
- Debt tracker: `agent-docs/exec-plans/tech-debt-tracker.md`

## Lifecycle Scripts

- Create a plan: `bash scripts/open-exec-plan.sh <slug> "<title>"`
- Complete a plan: `bash scripts/close-exec-plan.sh <active-plan-path>`
- Finish a plan-bearing task and commit it: `bash scripts/finish-task <active-plan-path> "type(scope): summary" <file> [file ...]`

## When To Create A Plan

Create a plan when work is multi-file, high-risk, cross-cutting, or likely to span more than one turn.

## Completion Rule

If a task used an execution plan and the task is done or abandoned, close that plan before handoff. Prefer `bash scripts/finish-task ...` when the task is also ready to commit.
