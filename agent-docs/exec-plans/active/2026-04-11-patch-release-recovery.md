# Goal (incl. success criteria):
- Restore the failed `pnpm release:patch` path to green and complete a patch release from the current clean tree.
- Success means the release acceptance checks pass, the patch-release workflow completes without local residue, and `git status --short` is empty afterward.

# Constraints/Assumptions:
- Preserve the already-landed cleanup commit and avoid unrelated churn.
- Fix the smallest truthful set of coverage or release blockers needed for the release path.
- If the release flow leaves tracked changes, commit only the intended release artifacts produced by the script.

# Key decisions:
- Start from the clean post-failure tree and isolate the exact `verify:acceptance` coverage failures before editing anything.
- Prefer targeted tests for diagnosis, but rerun the required repo-level verification before retrying the release.

# State:
- in_progress

# Done:
- Confirmed the failed `pnpm release:patch` attempt did not leave tracked worktree changes behind.

# Now:
- Register the lane, identify the failing package coverage thresholds, and patch the minimum missing coverage.

# Next:
- Re-run the patch release once acceptance verification is green.

# Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether `packages/assistant-engine/src/assistant/auto-reply-channels.ts` is the only package-level coverage blocker under `pnpm test:coverage`.

# Working set (files/ids/commands):
- Commands: `git status --short`, `pnpm --dir packages/assistant-engine test:coverage`, `pnpm test:coverage`, `pnpm release:patch`
- Files: targeted assistant-engine sources/tests, any additional failing owner tests, this plan, and the coordination ledger
Status: in_progress
Updated: 2026-04-11
