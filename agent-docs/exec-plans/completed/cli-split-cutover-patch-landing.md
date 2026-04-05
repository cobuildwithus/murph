# CLI Split Cutover Patch Landing

## Goal

Land the supplied `cli-split-cutover-full.patch` on top of the current repo state, preserving unrelated in-flight edits while extracting CLI-only assistant and setup code into new publishable packages.

## Success Criteria

- `packages/assistant-cli` and `packages/setup-cli` exist with working package metadata, build/typecheck/test wiring, and moved source.
- `packages/cli` becomes the thinner published shell expected by the patch.
- Workspace build, release, and verification wiring includes the new packages.
- Overlapping docs and package manifests are merged cleanly with the current OpenClaw-related edits.
- Required verification passes or any unrelated blocker is documented concretely.

## Constraints

- Preserve the current dirty tree, especially the uncommitted OpenClaw package landing already in progress.
- Treat the patch as behavioral intent, not overwrite authority.
- Keep package ownership boundaries and existing repo rules intact.

## Planned Steps

1. Apply the supplied patch mechanically where it does not conflict.
2. Manually merge the overlapping docs and workspace wiring files.
3. Re-run focused checks, then full repo verification.
4. Run final review, then commit only the touched paths.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
