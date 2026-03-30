# Active Execution Plans

Store active multi-step or high-risk plans here.

- Keep only currently active plans in this directory.
- Narrow user-supplied patch landings may use a coordination-ledger row without a dedicated plan if the work stays bounded and single-turn.
- Move finished plans to `agent-docs/exec-plans/completed/` using `bash scripts/close-exec-plan.sh <path>`.
- When a task is ready to commit, prefer `bash scripts/finish-task <active-plan-path> "type(scope): summary" <file> [file ...]`.
- Keep `COORDINATION_LEDGER.md` current while work is active.
- Ledger rows are coordination notices by default. Use the row notes to call out temporary exclusive/refactor lanes when overlap is unsafe.
