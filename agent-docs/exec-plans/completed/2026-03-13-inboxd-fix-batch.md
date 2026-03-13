Goal (incl. success criteria):
- Land the inboxd static-review follow-up batch across durability, connector composability, CLI ops, and package/docs hardening using four parallel Codex worker lanes with non-overlapping file ownership.
- Success means the live repo addresses the real remaining gaps in `packages/inboxd` and `packages/cli`, passes required verification, and leaves the coordination ledger clean.

Constraints/Assumptions:
- Source-of-truth repo is `healthybob`; no cross-repo edits are expected.
- Use `workspace-docs/bin/codex-workers --profile 1` with one prompt per worker as requested.
- Existing inbox CLI wiring and root verification already exist in the live repo; workers must refine the live state rather than assume the static review snapshot is current.
- Workers must honor `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` and stay inside their claimed file sets.

Key decisions:
- Split the inboxd test surface so durability and connector/daemon work do not compete for `packages/inboxd/test/inboxd.test.ts`.
- Keep prompt 4 focused on metadata/docs/runtime expectation hardening because root scripts and root TS configs are already present in the live repo.
- Main agent owns coordination, integration, verification, and commit/handoff.

State:
- in_progress

Done:
- Routed the task via workspace docs to `healthybob`.
- Read repo-local AGENTS, verification docs, completion workflow, and the active coordination ledger.
- Inspected live inboxd/CLI/package state to compare against the static review notes.

Now:
- Add coordination-ledger ownership rows for the four worker lanes.
- Generate prompt files and launch local Codex workers with profile 1.

Next:
- Review worker outputs, integrate any remaining fixes, run required verification and completion audits, then commit.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether prompt 3 requires code changes beyond tests/docs because the live repo already contains inbox CLI command/service files.
- UNCONFIRMED whether prompt 4 will touch any workflow/docs files beyond `packages/inboxd/package.json` and `packages/inboxd/README.md`.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-13-inboxd-fix-batch.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `workspace-docs/bin/codex-workers --profile 1`
- Worker lanes: durability, connectors, CLI, package/docs
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
