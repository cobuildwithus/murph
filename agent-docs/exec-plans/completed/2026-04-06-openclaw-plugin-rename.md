# OpenClaw plugin rename

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Rename the unpublished OpenClaw package from `@murphai/openclaw` to `@murphai/openclaw-plugin`.
- Keep the package publishable through the existing release tooling and keep install/docs/tests aligned with the new name.

## Success criteria

- The workspace package directory and manifest use `openclaw-plugin` consistently.
- Release/test/build tooling resolves the renamed package path and package name without stale `openclaw` references.
- User-facing install docs point to `@murphai/openclaw-plugin`.
- Required verification for the touched surface passes.

## Scope

- In scope:
  - `packages/openclaw-plugin/**`
  - release/build/test wiring that references the package path or npm name
  - durable repo docs and package docs that mention the install command
- Out of scope:
  - changing the underlying skill behavior or bundle format
  - altering the broader release/versioning model

## Constraints

- Preserve unrelated worktree edits.
- Treat the package as unpublished, so a hard rename is acceptable.
- Keep manual local publish guidance aligned with the manifest-driven pack/publish helpers.

## Risks and mitigations

1. Risk: stale path references leave the package out of verification or release automation.
   Mitigation: update the directory path, release manifest, workspace scripts, and release-coverage test together.
2. Risk: docs/install snippets diverge from the package metadata.
   Mitigation: update README/package README/source metadata in the same change and verify the package-local tests.

## Tasks

1. Rename `packages/openclaw` to `packages/openclaw-plugin`.
2. Update package metadata, source exports, tests, release manifest, and workspace tooling references.
3. Update user-facing and durable docs to the new npm package/install path.
4. Run required verification.

## Decisions

- Rename the package before first publish rather than carrying a legacy alias package.
- Keep the exported runtime symbol names as-is unless the rename makes them misleading after the package name update.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:packages`
  - `pnpm test:smoke`
- Expected outcomes:
  - All required commands pass for the current branch state, or any unrelated pre-existing failure is clearly identified and scoped.
- Results:
  - `pnpm install --frozen-lockfile`: passed
  - `pnpm typecheck`: passed
  - `pnpm test:packages`: passed
  - `pnpm test:smoke`: passed
  - `node scripts/verify-release-target.mjs`: passed
  - `node scripts/pack-publishables.mjs --expect-version 0.1.16 --clean --out-dir <tmpdir> --pack-output <tmpdir>/pack-output.json`: passed
Completed: 2026-04-06
