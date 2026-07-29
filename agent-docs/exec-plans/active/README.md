# Active Execution Plans

Store active multi-step or high-risk plans here.

- Keep only currently active plans in this directory.
- Narrow user-supplied patch landings may use `scripts/committer` without a dedicated plan when the work stays bounded and single-turn.
- Move finished plans to `agent-docs/exec-plans/completed/` before handoff.
- When a plan-bearing task is ready for its final scoped commit, use `bash scripts/finish-task <active-plan-path> "brief summary" <path> [path ...]`; it archives the plan and commits the closed-plan artifact with the touched files.
- Do not finish active-plan work with `scripts/committer` or raw `git commit`; that leaves stale active plans behind. Use those commit paths only for work with no active plan, or when the user explicitly asks to keep the plan active.
- If the task is done or abandoned but overlapping dirty work makes a safe scoped commit impossible, still archive the plan with `bash scripts/close-exec-plan.sh <path>` instead of leaving it here.
- Active plans are task-owned and branch-local. Use isolated worktrees, task branches, and pull requests for concurrent work rather than treating this directory as a cross-worktree lock registry.
