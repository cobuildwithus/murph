# Collapse redundant Vitest workspace aliases

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Delete non-web package-specific Vitest alias catalogs that duplicate the root TypeScript path map.

## Success criteria

- Shared Vitest configuration derives workspace aliases from the root TypeScript configuration only.
- Package, CLI, and Cloudflare Vitest configs no longer repeat workspace source-entry maps.
- Hosted web's deliberate source-resolution/transpilation allowlist remains unchanged.
- Workspace boundary enforcement and all affected tests/typechecks stay green.

## Scope

- In scope: `config/vitest-package.ts`, package Vitest configs using `workspaceSourceEntryRelativePaths`, `apps/cloudflare/vitest.shared.ts`, `packages/cli/vitest.workspace.ts`, and focused tests.
- Out of scope: hosted-web source-resolution policy, dependency graph changes, and test-runner redesign.

## Constraints

- Delete configuration; do not replace it with another generated catalog.
- Preserve root/subpath resolution and generic boundary enforcement.
- Keep the change tooling-only and behavior-neutral.

## Risks and mitigations

1. Risk: a package import is not covered by the root paths.
   Mitigation: verify the root path-derived alias set against affected configs and run the diff-selected test lane.
2. Risk: web's explicit allowlist is removed accidentally.
   Mitigation: leave the hosted-web source-resolution module and web configs out of scope.

## Tasks

1. Inventory every caller of `workspaceSourceEntryRelativePaths` and manual CLI/Cloudflare aliases.
2. Delete the redundant option and maps.
3. Add or update focused configuration coverage if the existing suite does not prove root-path resolution.
4. Run scoped verification and the required coverage-write audit.
5. Archive this plan, commit, and publish a draft PR.

## Decisions

- The root TypeScript paths are the single current owner of workspace source aliases for non-web Vitest.

## Verification

- `pnpm test:diff config/vitest-package.ts apps/cloudflare/vitest.shared.ts packages/cli/vitest.workspace.ts` plus all changed Vitest configs.
- Required write-capable `coverage-write` audit.
- PR CI on the exact pushed head.
Completed: 2026-07-15
