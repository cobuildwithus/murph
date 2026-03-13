# Healthy Bob TypeScript source migration

Status: completed
Created: 2026-03-12
Updated: 2026-03-12

## Goal

- Convert repo runtime packages, tests, and development tooling from handwritten JavaScript and handwritten declaration files to TypeScript source with generated `dist/` outputs.

## Success criteria

- `packages/contracts`, `packages/core`, `packages/importers`, `packages/query`, `packages/cli`, and `e2e/smoke` build and run from TypeScript source.
- Root build wiring uses TypeScript project references and package exports point at `dist/`.
- Handwritten source `.js`, `.mjs`, and `.d.ts` files under runtime packages and `e2e/` are removed or replaced with generated output only.
- Architecture and verification docs reflect the new TypeScript-first toolchain.
- Required checks and completion-workflow audit passes are green.

## Scope

- In scope:
  - root TypeScript workspace and build plumbing
  - TypeScript migration for package source, tests, and devtools
  - package export/build script rewiring
  - runtime/verification doc updates required by the new build
- Out of scope:
  - product-behavior changes unrelated to migration
  - shell-script rewrites unless a script must move to TypeScript to support the build
  - new deployment/runtime targets

## Constraints

- Follow `AGENTS.md` hard rules and keep `COORDINATION_LEDGER.md` current for all agents.
- Do not read `.env` files or expose sensitive identifiers.
- Preserve package boundaries and avoid cross-package `src/` imports in final state.
- Keep emitted JS and declarations under `dist/`; source stays TypeScript.
- Update docs and verification scripts in the same change as build/runtime shifts.

## Worker lanes

1. `codex-main`
   - root build plumbing, coordination, docs, integration, verification, commit flow
2. `codex-worker-contracts`
   - `packages/contracts/**`
3. `codex-worker-core`
   - `packages/core/**`
4. `codex-worker-importers`
   - `packages/importers/**`
5. `codex-worker-query-cli-e2e`
   - `packages/query/**`, `packages/cli/**`, `e2e/**`

## Tasks

1. Freeze active ownership in the coordination ledger and capture the migration plan.
2. Establish root TypeScript workspace config, package references, and package export targets.
3. Convert `contracts`, `core`, `importers`, `query`, `cli`, and smoke/devtool entrypoints to TypeScript in disjoint worker lanes.
4. Reconcile package boundaries, import specifiers, build scripts, and emitted artifact rules.
5. Update architecture and verification docs to match the new toolchain.
6. Run completion workflow audit passes and required verification commands.
7. Commit the touched files once checks are green or any unrelated failures are clearly documented.

## Decisions

- Use `tsc -b` project references as the primary build mechanism.
- Treat Bash wrappers as allowed non-TypeScript infrastructure unless migration support requires a TypeScript helper.
- Keep worker write scopes disjoint; main integrates cross-package seams after worker completion.

## Verification

- Required:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Additional during migration:
  - targeted `pnpm --filter <pkg> ...` or `tsc -b <pkg>` checks as needed

## Progress

- Done:
  - root TypeScript workspace config, package references, and package-export rewiring landed
  - `contracts`, `core`, `importers`, `query`, `cli`, and smoke/devtool entrypoints were migrated to TypeScript source
  - handwritten source `.js`, `.mjs`, `.cjs`, and `.d.ts` files under `packages/` and `e2e/` were removed in favor of generated `dist/` output
  - runtime and verification docs were updated to describe the TypeScript-first toolchain
  - required verification completed with `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`
- Now:
  - snapshot the completed plan and remove active coordination ownership
- Next:
  - none
Completed: 2026-03-12
