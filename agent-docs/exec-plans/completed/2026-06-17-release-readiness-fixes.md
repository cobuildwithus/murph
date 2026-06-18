# Release Readiness Fixes

## Goal

Make the package release gate green enough to cut the next minor release and
prove the generated Murph package installs from local tarballs before publish.

Success means:

- Fresh-worktree `pnpm release:check` no longer fails on the known release
  blockers.
- Generated publishable tarballs install in a fresh consumer project.
- The `murph`/`vault-cli` global install path works from the generated tarball
  set, matching the public install posture.

## Constraints

- Do not publish to npm or push a release tag without explicit approval.
- Keep fixes narrowly scoped to release tooling, package payload shape, and
  the failing tests.
- Preserve the five-package public release set and the existing shared-version
  release flow.
- Do not weaken CLI startup/import guards or device control-plane behavior just
  to make tests pass.

## Working Set

- `scripts/pack-publishables.mjs`
- `packages/assistant-engine/test/assistant-cli-surface-bootstrap.test.ts`
- `packages/assistant-cli/test/assistant-command-startup-imports.test.ts`
- `packages/cli/test/device-cli.test.ts`
- release/package smoke commands against generated tarballs

## Verification Plan

- Focused package tests for the three failing tests.
- Package-shape or packer tests proving bundled external dependency metadata
  does not break installed payloads.
- `pnpm release:check` from a clean/fresh checkout when focused checks are
  green.
- Local tarball install smoke for both fresh consumer project and isolated
  global prefix.

## Progress

- Fixed the three known release-check test blockers and verified each focused
  test.
- Updated publishable packing so the bundled external `incur` package does not
  retain dependency metadata that can break isolated global installs.
- Verified the generated five-tarball set installs in both an isolated global
  prefix and a blank consumer project.
- `pnpm typecheck` passed.
- `pnpm release:check` passed end to end after the timeout and packaging fixes.
- Re-ran the five-tarball smoke after the green release check; isolated global
  install and blank consumer project install both passed.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
