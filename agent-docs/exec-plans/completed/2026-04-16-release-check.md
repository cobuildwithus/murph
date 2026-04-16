## Goal

Get `pnpm release:check` passing end to end on the current branch.

## Scope

- release-owned scripts and metadata under `scripts/**`, root manifests, and any directly implicated package/app files surfaced by the failing release lane
- the narrowest supporting tests or docs updates required to keep the release contract truthful

## Constraints

- Preserve unrelated active work already present in the worktree.
- Avoid speculative refactors; fix only the blockers required for the release lane to pass.
- Prefer release-lane ownership fixes over bypasses or scoped-verification exceptions.

## Verification

- `pnpm release:check`
- any narrower focused iteration checks needed while fixing the failing step
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
