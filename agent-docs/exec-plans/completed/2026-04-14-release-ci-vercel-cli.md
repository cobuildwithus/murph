# Restore green patch publishing after the 0.2.9 release lane failure

Status: completed
Created: 2026-04-14
Updated: 2026-04-14

## Goal

- Fix the release-path regression that left `v0.2.9` with a failed publish workflow, then cut and verify a clean follow-up patch release from a fully green state.

## Success criteria

- `pnpm release:check` passes locally after the fix.
- The release and host-support GitHub workflows both pass for the final release SHA.
- The hosted-web verify path no longer relies on an undeclared global `vercel` binary.
- A new patch tag is pushed with truthful changelog and release-note coverage for the fix.

## Scope

- In scope:
- Declare the Vercel CLI dependency required by `apps/web` scripts.
- Update release artifacts for the follow-up patch version.
- Re-run release verification, commit, tag, push, and watch workflows.
- Out of scope:
- Unrelated hosted runtime, CLI surface, or provider work already active in other lanes.

## Constraints

- Keep the fix minimal and architectural: make the dependency explicit rather than adding workflow-only hacks.
- Preserve unrelated in-flight worktree edits.
- Use the repo release flow and keep the changelog truthful to the actual shipped diff.

## Risks and mitigations

1. Risk:
   Adding a new dependency can trip supply-chain or lockfile policy.
   Mitigation:
   Use the public npm package, update the committed lockfile, and verify with `pnpm release:check`.
2. Risk:
   The failed `v0.2.9` tag already exists remotely.
   Mitigation:
   Leave historical tags untouched and cut a clean follow-up patch release.

## Tasks

1. Patch the hosted-web dependency declaration and lockfile.
2. Re-run release verification and required audits.
3. Prepare the follow-up patch changelog and release notes.
4. Commit, tag, push, and watch the resulting workflows to completion.

## Decisions

- Prefer an explicit `apps/web` devDependency over workflow-specific global installs so every environment executes the same truthful script contract.

## Verification

- Commands to run:
- `pnpm release:check`
- `gh run list` / `gh run view` for the final release SHA
- Expected outcomes:
- Release verification passes locally and the final remote release workflows complete successfully.
Completed: 2026-04-14
