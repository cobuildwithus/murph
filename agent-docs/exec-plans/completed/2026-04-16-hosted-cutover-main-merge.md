## Goal

Merge the already-pushed hosted control-plane cutover from `origin/main` into the live `murph` worktree, restore the preserved local in-flight changes cleanly on top, and leave the repo in a truthful verified state.

## Why

- The greenfield hosted cutover is already pushed on `origin/main`, but the live `murph` checkout still needs the local merge completed.
- The preserved local worktree includes overlapping hosted Cloudflare and web changes that must survive the merge.
- The remaining task is conflict resolution and verification, not a second architecture rewrite, so the work should stay tightly scoped to the merge seams plus any proof required to validate them.

## Scope

- Resolve the remaining unmerged stash-restore files in `apps/cloudflare/**` and `apps/web/next-env.d.ts`
- Keep the pushed `origin/main` cutover intact while preserving restored local changes that still belong in the live worktree
- Run focused verification for the resolved merge seams
- Commit the merge-resolution work with the repo-standard completion path

## Constraints

- Preserve unrelated worktree edits and untracked local artifacts.
- Do not resurrect deleted broad Cloudflare control-plane routes or contracts from pre-cutover code.
- Keep secrets and personal identifiers out of diffs, logs, docs, and commit text.
- Report any required verification failures truthfully when they are pre-existing or unrelated.

## Verification

- Focused Cloudflare tests covering the resolved route and runner-outbound seams
- Focused typecheck or generated-stub proof for `apps/web/next-env.d.ts` if needed
- `git diff --check`
- Final status confirmation that the merge is clean and the live repo contains the cutover from `origin/main`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
