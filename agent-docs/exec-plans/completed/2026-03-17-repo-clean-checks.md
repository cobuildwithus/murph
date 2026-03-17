# 2026-03-17 Repo Clean Checks

## Goal

Return the repository to a clean tracked worktree and restore the required repo checks to green.

## Scope

- `packages/contracts` typecheck/build verification path
- generated cleanup for tracked doc inventory and lockfile residue
- untracked local assistant-state residue if it is purely generated

## Constraints

- Preserve unrelated active work in assistant/setup/web lanes.
- Do not revert user-authored or in-flight feature changes outside generated residue.
- Run the required repo checks sequentially to avoid false failures from concurrent Next.js builds.

## Plan

1. Fix the contracts package self-resolution/typecheck issue with the smallest behavior-preserving patch.
2. Remove or normalize remaining generated residue so the tracked worktree is clean.
3. Run completion audits, then `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` sequentially.
Status: completed
Updated: 2026-03-17
Completed: 2026-03-17
