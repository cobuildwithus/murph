# Runner Bundle Transitive Tarballs

Status: completed
Created: 2026-05-08
Updated: 2026-05-08

## Goal

- Fix hosted-local runner bundle dependency installation so isolated pnpm installs resolve private transitive workspace packages from the prepared sibling tarballs instead of the public registry or a nonexistent workspace.

## Success criteria

- `pnpm --dir apps/cloudflare runner:bundle:hosted-local` completes without `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` or private package registry fetch failures.
- Packed private workspace package manifests no longer contain transitive `workspace:*` specs when a sibling runner tarball exists.
- Focused regression coverage proves the packed manifest rewrite for dependencies and optional dependencies, plus the fail-closed path for a missing sibling tarball.

## Scope

- In scope: Cloudflare runner bundle assembly and package packing helpers, plus focused runner-bundle tests.
- Out of scope: release publishing, public package manifests, Docker smoke changes, and broad dependency policy changes.

## Constraints

- Preserve no-scripts package packing.
- Preserve unrelated active Cloudflare and hosted-local worktree edits.
- Do not expose local paths, user identifiers, secrets, storage keys, or contact identifiers in diagnostics/docs/tests.

## Decisions

- Rewrite packed private workspace dependency specs to relative sibling `file:` tarball specs during runner bundle assembly. Rewriting to package versions is insufficient because pnpm still attempts to fetch private transitive packages from the registry.
- Fail closed when a `workspace:*` dependency is missing from the prepared runner tarball set instead of falling back to a bare package version.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts apps/cloudflare/test/runner-bundle-dependency-install.test.ts apps/cloudflare/test/runner-bundle-process.test.ts --no-coverage` passed after the fail-closed update.
- Earlier before the fail-closed security-review follow-up, `pnpm --dir apps/cloudflare typecheck` passed and `pnpm --dir apps/cloudflare runner:bundle:hosted-local` passed and assembled `.deploy/runner-bundle`.
- Current `pnpm --dir apps/cloudflare typecheck` is blocked by unrelated active hosted workspace edits: `apps/cloudflare/src/runtime-bridge-workspace.ts` imports missing `snapshotHostedWorkspaceWorkingDelta` from `@murphai/runtime-state/node`, has implicit `any` callback parameters, and `packages/runtime-state/src/hosted-bundles.ts` references missing `collectHostedPortableWorkspaceDeltaFiles`.
- Current `pnpm --dir apps/cloudflare runner:bundle:hosted-local` is blocked before the install phase by the same unrelated runtime-state build error in `packages/runtime-state/src/hosted-bundles.ts`.
- Scoped `bash scripts/workspace-verify.sh test:diff apps/cloudflare/scripts/assemble-runner-bundle.ts apps/cloudflare/scripts/runner-bundle/workspace-artifacts.ts apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts` is blocked by unrelated active hosted workspace checkpoint test failures in `apps/cloudflare/test/runtime-bridge-workspace.test.ts`.
Completed: 2026-05-08
