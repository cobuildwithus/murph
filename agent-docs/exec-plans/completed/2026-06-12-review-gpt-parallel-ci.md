Goal (incl. success criteria):
- Per Will: fire the external `review:gpt pr-review` loop as soon as the PR head is pushed, in parallel with PR CI, instead of gating each round on green CI. Green CI on the final head stays a merge-readiness requirement; only the round-firing order changes.

Constraints/Assumptions:
- Docs/process-only; no script or tooling change. The loop mechanics (fresh thread per round, Pro model, stop on zero accepted findings, 5-round cap, base-update exception) are unchanged.
- Keep the merge gate explicit everywhere the old "post-CI" phrasing implied it: merge-ready = zero-accepted-findings round AND green CI on the final head.

Key decisions:
- If CI fails on a head while a round is in flight, the round's findings still get triaged; the CI fix follows ordinary rules and lands in the head the next round reviews.
- Historical rationale text (e.g. the 2026-06-12 removal note describing what the "post-CI loop" caught) stays as-is; only normative rules change.

State:
- Editing in the current checkout (docs/process lane).

Done:
- Verified the three docs are clean in git; located all normative "post-CI"/"CI green" phrasings.

Now:
- Edit `pr-deep-review-loop.md` (When It Runs #3, One Round #5, base-update exception tail), `completion-workflow.md` (intro line, steps 11/15, boundaries), `agent-workflow-routing.md` (task-class audit cells, workflow default bullet).

Next:
- Readback + `grep` for stale "post-CI" normative references, finish-task commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `agent-docs/operations/pr-deep-review-loop.md`
- `agent-docs/operations/completion-workflow.md`
- `agent-docs/operations/agent-workflow-routing.md`
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
