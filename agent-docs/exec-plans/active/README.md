# Active Execution Plans

Store active multi-step or high-risk plans here.

- Keep only currently active plans in this directory.
- For a narrow supplied patch landing, use a ledger row plus `scripts/committer` when no dedicated plan is needed.
- Narrow user-supplied patch landings may use a coordination-ledger row without a dedicated plan if the work stays bounded and single-turn.
- Move finished plans to `agent-docs/exec-plans/completed/` before handoff.
- When a plan-bearing task is ready for its final scoped commit, use `bash scripts/finish-task <active-plan-path> "brief summary" <path> [path ...]`; it clears the matching ledger row, archives the plan, and commits the closed-plan artifact with the touched files.
- Do not finish active-plan work with `scripts/committer` or raw `git commit`; that leaves stale active plans behind. Use those commit paths only for work with no active plan, or when the user explicitly asks to keep the plan active.
- If the task is done or abandoned but overlapping dirty work makes a safe scoped commit impossible, clear the matching ledger row and still archive the plan with `bash scripts/close-exec-plan.sh <path>` instead of leaving it here.
- Plan-bearing ledger rows must set `Plan` to the exact active plan path. Leave `Plan` empty for ledger-only lanes.
- Keep `COORDINATION_LEDGER.md` current while work is active.
- Ledger rows are coordination notices by default. Use the row notes to call out temporary exclusive/refactor lanes when overlap is unsafe.
