# Clean up remaining dirty worktree and land it safely

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Inspect every remaining dirty tracked file, finish any incomplete cleanup, and land the rest of the worktree in a state that passes the required repo verification and coverage checks.

## Success criteria

- The remaining dirty tracked files are either intentionally retained and explained or cleaned up into a coherent shippable diff.
- Required repo verification for the touched surfaces passes, including `pnpm typecheck` and `pnpm test:coverage`.
- The required final audit pass is completed and any material findings are addressed.
- The remaining worktree changes are committed with a scoped commit that does not pull in unrelated generated/runtime residue.

## Scope

- In scope:
- The currently dirty tracked files under `apps/web`, `packages/**`, root workspace metadata, and the active build-runtime recovery plan that remain after the repo-checks-green commit.
- Finishing or trimming cleanup so the current remaining diff is internally coherent and verifiable.
- Closing the matching active plan artifacts and creating a scoped commit for the remaining tracked worktree changes.
- Out of scope:
- Untracked runtime residue under `.runtime/**`.
- New feature work beyond what is already represented in the dirty tracked diff.

## Constraints

- Preserve existing adjacent edits and do not discard user work.
- Treat dependency and workspace metadata changes as high-risk; keep them aligned with the actual code/test changes and the committed lockfile.
- Do not commit private runtime residue or other generated artifacts.
- Follow the repo completion workflow, including the audit subagent pass and post-fix verification reruns.

## Risks and mitigations

1. Risk: The remaining worktree combines multiple partially related threads and may hide incomplete changes.
   Mitigation: Inventory the diff first, group by subsystem, and trim or complete only where the current state is inconsistent.
2. Risk: Root metadata changes may mask an unnecessary dependency drift.
   Mitigation: Inspect the package and lockfile deltas directly and keep only justified dependency/workspace-script changes.
3. Risk: Broader hosted and runtime surfaces may regress despite passing the earlier checks-only task.
   Mitigation: Re-run the required full verification lane after cleanup and use the final audit pass to look for boundary regressions.

## Tasks

1. Inventory the remaining dirty worktree and classify each change by subsystem and intent.
2. Use targeted review and local inspection to identify incomplete, unsafe, or unjustified edits.
3. Apply the smallest set of cleanup changes needed to make the remaining diff coherent.
4. Run the required verification and direct scenario checks for the touched behavior.
5. Run the required final audit pass, address findings, close the active plan(s), and commit the remaining tracked changes.

## Decisions

- Use a separate cleanup plan instead of silently folding everything into the earlier repo-checks task, because the remaining dirty tree spans more than the already-landed verification fixes and now needs its own audit and commit boundary.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- Additional focused readback or direct scenario checks as needed for CLI runtime and hosted device-sync behavior
- Expected outcomes:
- Repo checks stay green after the remaining cleanup and the final diff is safe to commit.
Completed: 2026-04-07
