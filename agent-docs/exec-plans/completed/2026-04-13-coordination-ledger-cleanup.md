# Goal (incl. success criteria):
- Remove stale rows from `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` so it reflects no live work.
- Close the remaining stale active execution plan into `agent-docs/exec-plans/completed/`.
- Finish this cleanup through `scripts/finish-task` so the new `Plan`-column ledger cleanup runs on a real repo task.

# Constraints/Assumptions:
- The user confirmed there are no live agents at the moment.
- Preserve the just-landed `finish-task` and workflow-doc changes; do not revert unrelated repo edits outside this cleanup/tooling slice.
- Keep the cleanup mechanical and narrow: no behavioral repo changes beyond the new `finish-task` contract and the stale coordination artifacts.

# Key decisions:
- Treat every current ledger row other than this cleanup lane as stale residue.
- Treat `agent-docs/exec-plans/active/2026-04-11-patch-release-recovery.md` as stale and archive it into `completed/` with a brief closure note instead of leaving it active.

# State:
- in_progress

# Done:
- Confirmed the active directory still contains one stale plan file beyond `README.md` and `COORDINATION_LEDGER.md`.
- Confirmed the coordination ledger still contains many stale `in_progress` and `completed` rows even though no live agents remain.
- Cleared the stale ledger rows and left only this cleanup lane while the task is active.
- Archived the stale `2026-04-11-patch-release-recovery.md` plan into `agent-docs/exec-plans/completed/` with a closure note.
- Re-ran `bash -n scripts/finish-task`, `pnpm typecheck`, and `git diff --check` successfully.

# Now:
- Finish this cleanup through `scripts/finish-task` so the matching ledger row is removed automatically.

# Next:
- After the commit, confirm `agent-docs/exec-plans/active/` is back to only `README.md` and `COORDINATION_LEDGER.md`.

# Open questions (UNCONFIRMED if needed):
- None.

# Working set (files/ids/commands):
- Files: `agent-docs/exec-plans/active/{2026-04-13-coordination-ledger-cleanup.md,COORDINATION_LEDGER.md,README.md}`, `agent-docs/exec-plans/completed/2026-04-11-patch-release-recovery.md`, `agent-docs/PLANS.md`, `agent-docs/operations/agent-workflow-routing.md`, `scripts/finish-task`
- Commands: `find agent-docs/exec-plans/active -maxdepth 1 -name '*.md' -print`, `bash scripts/close-exec-plan.sh agent-docs/exec-plans/active/2026-04-11-patch-release-recovery.md`, `bash -n scripts/finish-task`, `pnpm typecheck`, `bash scripts/finish-task agent-docs/exec-plans/active/2026-04-13-coordination-ledger-cleanup.md "..."`
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
