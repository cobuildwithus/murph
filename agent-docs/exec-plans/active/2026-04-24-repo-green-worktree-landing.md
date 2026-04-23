# Get repo checks green and land the remaining worktree

Status: active
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Get the remaining dirty worktree to a truthful green repo-verification state, fix the blocking issues in the current branch, and land the remaining changes with the required plan/workflow closeout.

## Success criteria

- The current dirty worktree is either green on the required repo checks or any final blocker is proven unrelated and documented precisely.
- The current remaining tracked and intentional untracked worktree changes are committed.
- The umbrella landing does not lose any already-authored work from the current dirty tree.
- Required active plans are closed or otherwise handled consistently with the repo workflow before handoff.

## Scope

- In scope:
  - the remaining dirty worktree after commit `3963e54ac`
  - repo-wide verification and blocker triage
  - fixes required to make the current combined branch truthfully green
  - landing the remaining worktree changes and closing the associated plan artifacts
- Out of scope:
  - discarding or reverting user-authored dirty-tree changes
  - inventing new behavior outside what the current worktree already intends

## Constraints

- Technical constraints:
  - Treat the current dirty tree as the source of truth for what needs to land.
  - Preserve overlapping edits; integrate rather than resetting or pruning them away.
- Product/process constraints:
  - Use subagents for parallel repo-green investigation because the user explicitly asked for that.
  - Follow the high-risk repo completion workflow for the final landing.

## Risks and mitigations

1. Risk: the remaining worktree spans multiple active lanes, so naive cleanup could lose or overwrite already-authored changes.
   Mitigation: treat this as an umbrella integration task, inspect the live failures first, and assign subagents only to disjoint blocker areas.
2. Risk: repo-wide verification may reveal more than one blocker chain.
   Mitigation: collect the current failing checks up front, fix the shortest blocking path first, and rerun until the repo baseline is green.

## Tasks

1. Register the umbrella landing lane and capture the current repo-green blockers.
2. Fan out disjoint failing areas to subagents while fixing the integration path locally.
3. Rerun the required repo checks until the remaining worktree is green or the last blocker is proven unrelated.
4. Close the required plan artifacts and commit the remaining worktree.

## Decisions

- None yet.

## Verification

- Commands to run:
  - `pnpm verify:acceptance`
  - any narrower truthful checks needed while iterating on blockers
- Expected outcomes:
  - The repo acceptance baseline is green before landing unless a final blocker is credibly unrelated and documented.
