# Diff-Aware Verification

## Goal

Add a repo-owned `pnpm test:diff` command for agent and local iteration that scopes verification to changed workspace owners plus relevant workspace dependents, while keeping `pnpm test:coverage` as the full acceptance lane.

## Why

- Full repo acceptance is too heavy for the normal agent loop.
- The repo already has enough package/app structure to route a narrower verification lane from changed files instead of always paying for whole-repo coverage plus app verification.
- Agent docs should explicitly steer local iteration toward the diff-aware lane and reserve `pnpm test:coverage` for durable acceptance.

## Scope

- `scripts/workspace-verify.sh`
- `scripts/workspace-diff-scope.mjs`
- root `package.json`
- verification/testing workflow docs that describe agent and repo verification commands
- coordination artifacts for this task

## Constraints

- Keep `pnpm test:coverage` as the durable full acceptance command.
- Do not assume every workspace member has a package-local test command; typecheck-only packages still need a sensible path.
- Preserve the existing repo-internal fast path for docs/process/tooling-only diffs.
- Keep behavior explainable: the diff lane should print what scopes it chose and what commands it ran.

## Verification

- `pnpm typecheck`
- `pnpm test:diff`

## Notes

- Start with repo worktree diff against `HEAD`; do not invent remote-base inference in the first version.
- Prefer existing package/app-local `typecheck`, `test`, `verify`, and `lint` scripts over bespoke per-package command branches.
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
