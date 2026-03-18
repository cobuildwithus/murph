# Workout quick-capture CLI

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Add a `vault-cli workout add <text>` quick-capture command.
- Keep workout writes on the existing canonical `activity_session` event kind.
- Align tests, docs, and smoke metadata with the new command surface.

## Success criteria

- `workout add` accepts one freeform text argument plus the documented override options.
- The command writes through the existing `upsertEventRecord` path and returns the queryable `evt_*` lookup id.
- Runtime tests, command-surface docs, fixture corpus metadata, and smoke scenario coverage all reflect the new command.

## Scope

- In scope:
  - new workout command and workout use case under `packages/cli`
  - contract/typegen updates needed for the command surface
  - focused CLI runtime/expansion coverage
  - matching README, architecture, contract, fixture, and smoke-manifest updates
- Out of scope:
  - a dedicated `workout show|list` read surface
  - new canonical record families or ledgers for workouts
  - unrelated CLI cleanup or assistant/device-sync work already in progress

## Constraints

- Preserve the existing canonical event write boundary.
- Keep the structured inference intentionally small and fail with actionable errors when duration text is ambiguous.
- Do not revert unrelated dirty worktree edits.

## Verification

- Required commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Additional focused checks are allowed during implementation if they speed iteration.
Completed: 2026-03-18
