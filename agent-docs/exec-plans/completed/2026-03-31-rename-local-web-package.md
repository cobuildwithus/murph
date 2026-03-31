# Rename local web package for clarity

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Rename the local web package from `packages/local-web` to `packages/local-web` so it is clearly distinct from hosted `apps/web`.

## Success criteria

- The local Next.js app lives at `packages/local-web`.
- Repo scripts, docs, tests, and path-sensitive helpers reference `packages/local-web` instead of `packages/local-web`.
- The local app package name is `@murph/local-web`, while hosted `apps/web` remains unchanged.
- Required verification passes for the touched repo surfaces, or any unrelated failures are documented clearly.

## Scope

- In scope:
  - Renaming the local web package directory and its package identity
  - Root script names and local-app command suggestions that currently use `web:*`
  - Durable docs, tests, and path-sensitive guards that reference the local package path
- Out of scope:
  - Renaming hosted `apps/web`
  - Changing local or hosted web behavior beyond naming/paths
  - Redesigning either web surface

## Constraints

- Technical constraints:
  - Preserve the existing local app behavior and hosted app behavior.
  - Update path-sensitive tests and verification docs together so repo guidance stays aligned.
- Product/process constraints:
  - Preserve unrelated worktree edits.
  - Use the standard repo change workflow, including verification and final audit passes.

## Risks and mitigations

1. Risk: Path-sensitive tests, scripts, or docs may silently keep the old package path.
   Mitigation: Rename the directory once, then sweep all `packages/local-web` references and rerun required checks.
2. Risk: Root script renames may leave stale `pnpm web:*` guidance in user-facing messages.
   Mitigation: Update command suggestions and docs alongside the script rename.

## Tasks

1. Register the coordination lane and capture the rename plan.
2. Rename `packages/local-web` to `packages/local-web`.
3. Update package identity, root scripts, tests, docs, and path-sensitive helpers to the new name.
4. Run required verification and inspect the diff for accidental identifier leakage.
5. Run the required completion audits, resolve findings, then finish and commit the scoped change.

## Decisions

- Keep hosted `apps/web` as the stable hosted control-plane path.
- Rename the local private package name to `@murph/local-web` and the root helper scripts to `local-web:*` to keep the local/hosted distinction consistent.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Green repo-required verification for the naming/path cleanup, or clearly documented unrelated blockers.
Completed: 2026-03-31
