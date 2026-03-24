# Web Source Package Resolution

Status: completed
Created: 2026-03-24
Updated: 2026-03-24

## Goal

- Make `packages/web` and `apps/web` consume workspace packages from source during in-repo dev, test, and build.
- Remove the custom `dist` alias/build gating that was compensating for built-output resolution.
- Add a durable repo rule so agents do not reintroduce internal `dist` imports/aliases.

## Success criteria

- `packages/web` and `apps/web` resolve workspace package imports through package names plus shared source-oriented config, not manual `dist/index.js` aliases.
- `packages/web/scripts/next-local.ts` no longer rebuilds workspace package `dist` trees just to boot the local app.
- Web-focused tests are updated to assert the new source-package contract.
- `AGENTS.md` explicitly forbids using workspace `dist` outputs as in-repo app dependencies.

## Scope

- In scope:
  - `packages/web` and `apps/web` package scripts/config/tests for source-package resolution
  - one repo-level agent rule covering internal workspace imports vs publish artifacts
- Out of scope:
  - package publish/export contracts for external consumers
  - env-variable renames already in flight in overlapping web files
  - unrelated hosted device-sync feature behavior

## Constraints

- Preserve current runtime behavior of the web apps aside from how workspace code is resolved.
- Keep env-variable naming untouched while the env-prefix refactor lane is active.
- Prefer deleting complexity over adding another alias layer.

## Tasks

1. Switch Next/Vitest/TypeScript config in both web apps to source-package resolution.
2. Remove `dist`-only local runtime bootstrap logic from `packages/web/scripts/next-local.ts`.
3. Update focused tests/docs to reflect the new contract.
4. Run targeted web/app checks, then broader verification if not blocked by unrelated active work.

## Outcome

- `packages/web` and `apps/web` now resolve internal workspace packages from source during dev, test, and build.
- The local `packages/web` launcher no longer rebuilds workspace `dist/` trees before starting Next.
- Focused web/app checks passed, along with repo-wide `pnpm typecheck` and `pnpm test`.
- `pnpm test:coverage` still fails for an unrelated smoke-manifest gap covering documented `vault-cli supplement ...` commands.
