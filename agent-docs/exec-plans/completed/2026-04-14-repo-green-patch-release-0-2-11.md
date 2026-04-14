# Get repo green and cut patch release 0.2.11

Status: completed
Created: 2026-04-14
Updated: 2026-04-14

## Goal

- Verify the current dirty repo state, land the remaining web footer tweak cleanly, and cut the next patch release with changelog and release notes that accurately cover everything shipped since `v0.2.10`.

## Success criteria

- The current dirty worktree changes are verified, committed, and the repo is back to a clean green state.
- `pnpm release:check` passes from the final pre-release tree.
- The shared release version is bumped from `0.2.10` to `0.2.11`.
- `packages/cli/CHANGELOG.md` and `packages/cli/release-notes/v0.2.11.md` accurately summarize the `v0.2.10..HEAD` range.
- The release commit and `v0.2.11` tag are created by the repo release flow.

## Scope

- In scope:
- Verify and, if needed, fix the current dirty web footer/test changes.
- Run repo verification required to declare the tree green enough for release.
- Prepare and review the patch release artifacts for `0.2.11`.
- Run the patch release flow and leave the worktree clean.
- Out of scope:
- New product work unrelated to getting the current tree green and released.

## Constraints

- Keep the changelog truthful to the landed diff since `v0.2.10`.
- Do not rewrite historical changelog or release-notes entries.
- Preserve any unrelated work if it appears during verification.

## Risks and mitigations

1. Risk:
   Full release verification may uncover unrelated breakage outside the visible dirty files.
   Mitigation:
   Run the truthful repo release gate first and fix only the blockers needed to restore green status.
2. Risk:
   The generated changelog/release notes may be noisy or overly commit-shaped.
   Mitigation:
   Review the newly generated `0.2.11` entry and release note before final handoff.

## Tasks

1. Register the release lane and inspect the current dirty worktree plus release range.
2. Run release-grade verification and fix any blockers until the repo is green.
3. Commit the current dirty worktree cleanly.
4. Prepare and review the `0.2.11` release artifacts.
5. Run `pnpm release:patch` and verify the resulting release commit/tag state.

## Decisions

- Commit the current dirty worktree before invoking the release helper so the patch release includes that final landed change in its generated changelog range.

## Verification

- Commands to run:
- `pnpm release:check`
- `pnpm release:patch`
- Expected outcomes:
- Release verification passes before the release helper runs, and the release helper finishes with a clean worktree and a new `v0.2.11` tag.
Completed: 2026-04-14
