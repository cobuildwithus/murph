# Hosted Cutover Worker Pack

## Goal

Prepare a task-local `codex-workers` prompt pack for the hosted control-plane cutover in the sibling repo clone on clean `main`, without launching implementation workers yet.

## Success Criteria

- The sibling repo clone is the intended execution workspace for the future worker batches.
- The task has an active plan plus a coordination-ledger row.
- A raw-prompt worker pack exists for Batch 1, Batch 2, and the final integration lane.
- The prompt pack includes repo-specific guardrails for owned paths, verification boundaries, and no-commit/no-push behavior.
- A launch README exists with the exact helper commands, batch order, and merged-scope audit expectations.
- No implementation workers are launched as part of this setup task.

## Constraints

- Keep this setup Markdown-only.
- Do not modify repo runtime code, tests, config, or docs outside this task-local worker pack.
- Do not launch workers, merge diffs, run repo verification, or start completion audits in this setup task.
- Treat the sibling repo clone as the future execution workspace; do not use the live dirty checkout for the worker batches.

## Planned Steps

1. Confirm the sibling repo clone is on clean `main`.
2. Create the active plan and coordination row for the setup lane.
3. Write the worker-pack README with launch commands and merge/audit sequencing.
4. Write the wrapped raw prompt files for Batch 1, Batch 2, and the final integration lane.
5. Read back the Markdown-only setup artifacts and commit the scoped setup.

## Notes

- The future implementation pass should open its own high-risk execution lane before launching Batch 1 workers from this pack.
- The final merged implementation pass should follow the repo completion workflow from the parent agent rather than letting worker lanes self-audit or self-commit.
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
