# Get repo fully green and cut the next patch release

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Get the repository back to a fully green state across typecheck, package coverage, app verification, and full acceptance, then prepare the next patch release with an accurate changelog covering everything that has landed since the previous patch.

## Success criteria

- `pnpm typecheck` passes on the current tree.
- `pnpm test:packages:coverage` passes on the current tree.
- `pnpm test:apps` passes on the current tree.
- `pnpm verify:acceptance` passes on the current tree.
- Any required durable docs or verification docs stay aligned with behavioral or workflow changes.
- A patch-version release update is prepared with a truthful changelog summarizing all shipped changes since the last released patch.

## Scope

- In scope:
- Fix remaining package and app failures exposed by the current in-progress tree.
- Prefer long-term fixes in runtime code, tests, or verification tooling over one-off local workarounds.
- Release-surface updates needed for the next patch, including version/changelog artifacts and release verification.
- Out of scope:
- Unrelated speculative refactors that do not contribute to getting the repo green or making the release truthful.

## Constraints

- Technical constraints:
- Preserve unrelated in-flight worktree edits and port changes carefully onto the live tree.
- Keep package boundaries intact; no sibling internal cross-imports or compatibility shims that violate `ARCHITECTURE.md`.
- Do not use shortcuts that only mask failures locally.
- Product/process constraints:
- Follow the repo completion workflow, including required coverage and final-review audit passes before handoff.
- Use scoped commit helpers for any final commits.

## Risks and mitigations

1. Risk:
   The tree is already broadly dirty with overlapping changes, so a naive fix could overwrite adjacent work.
   Mitigation:
   Keep diffs minimal, inspect file-level context before edits, and commit only scoped changes for this lane.
2. Risk:
   Some red checks may reflect multiple interacting regressions across packages and apps.
   Mitigation:
   Reproduce the top-level gates separately first, then fix in the narrowest truthful verification loop before rerunning full acceptance.
3. Risk:
   Release/changelog updates can drift from the real landed scope if prepared too early.
   Mitigation:
   Defer final changelog/version edits until the tree is green and the final landed diff is known.

## Tasks

1. Reproduce the current red state with the repo gates split into `pnpm typecheck`, `pnpm test:packages:coverage`, and `pnpm test:apps`.
2. Fix remaining failures in the narrowest owner-level loop while preserving long-term architecture and test shape.
3. Run `pnpm verify:acceptance` and keep iterating until the full repo is green.
4. Prepare the patch release artifacts and changelog once the final landed scope is stable.
5. Run the required completion-workflow audit passes, close the plan, and cut the scoped release commit(s).

## Decisions

- Prefer shared or owner-level fixes over test-local environment hacks when source-resolution or verification tooling is involved.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:packages:coverage`
- `pnpm test:apps`
- `pnpm verify:acceptance`
- Expected outcomes:
- All commands above pass on the final tree.
- Release/changelog artifacts remain consistent with the final verified diff.
Completed: 2026-04-09
