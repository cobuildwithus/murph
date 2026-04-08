# Cloudflare runner leaf artifact refactor

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Finish the last structural cleanup for the Cloudflare hosted runner so the deployed container artifact is a true app-owned runtime leaf rather than a packed view of the monorepo.
- Remove deploy-only code from the shipped runtime bundle.
- Replace the current bespoke workspace pack-and-install assembly with a clearer leaf artifact build contract rooted in explicit runtime and CLI artifacts.

## Success criteria

- `apps/cloudflare` no longer ships deploy-only modules in `apps/cloudflare/.deploy/runner-bundle/dist/`.
- Deploy-only code and scripts have a separate build ownership path from the worker/container runtime code.
- Runtime artifact assembly is driven by explicit artifact manifests and built package outputs, not by scanning the workspace, computing closures ad hoc, packing the app tarball, and reinstalling from that whole packed app view.
- The runner bundle is assembled from:
  - one runtime app artifact
  - one dedicated hosted CLI/runtime artifact for `vault-cli`
  - explicit production dependency manifests
- The bundle assembly script no longer needs to walk `apps/*` and `packages/*` to discover package closure dynamically at runtime.
- The GitHub deploy workflow still succeeds with the new artifact shape and still uses direct deploy.
- Durable docs and contract tests describe the new runtime/deploy split and the new artifact contract precisely.

## Why this work is needed

The current artifact path is materially improved over the old Docker build, but two structural problems remain:

1. `apps/cloudflare` is both runtime package and deploy-tooling package.
   - `tsconfig.build.json` compiles all of `src/**`
   - the bundle path packs the full app tarball
   - the runtime artifact therefore carries deploy-only compiled code such as `deploy-automation`, `deploy-preflight`, and `r2-lifecycle`

2. `assemble-runner-bundle.ts` is still monorepo-coupled and too bespoke.
   - it scans workspace manifests
   - computes workspace closure dynamically
   - topo-builds packages
   - packs tarballs
   - rewrites manifests
   - performs staged installs
   This works, but it is still a workspace packer rather than a clean leaf build.

## Constraints

- Preserve unrelated dirty worktree edits across the repo.
- Treat the active Cloudflare packaging lane in `COORDINATION_LEDGER.md` as exclusive for `apps/cloudflare` deploy/runtime surface changes.
- Keep package boundaries semantic and small; do not solve this by widening `exports` or reintroducing compatibility shims.
- Do not regress the already-working direct deploy path.
- Keep Docker thin: it should continue to copy prepared artifacts, not build the workspace.
- Avoid touching warm-container runtime behavior unless strictly required for artifact ownership or build topology.

## Current state

- Good:
  - `Dockerfile.cloudflare-hosted-runner` is already copy-only for app code.
  - `apps/cloudflare/.deploy/runner-bundle/` is already the deploy input.
  - `runner:bundle` no longer uses `pnpm deploy --legacy`.
  - bundle pruning and runtime-manifest shaping are already materially better.
- Still wrong:
  - `apps/cloudflare/package.json` is both runtime and deploy-tooling manifest.
  - `apps/cloudflare/tsconfig.build.json` builds deploy-only `src/**` alongside runtime code.
  - `assemble-runner-bundle.ts` still acts as a workspace indexer/packer.
  - the runtime bundle still contains deploy-only compiled files.

## Target architecture

### 1. Split runtime ownership from deploy-tooling ownership inside `apps/cloudflare`

Create an explicit runtime source tree and build contract for the worker/container runtime.

Target shape:

- runtime package surface
  - worker runtime entrypoint
  - container bridge/runtime helpers
  - runtime-only shared modules
  - runtime-only tests
- deploy-tooling surface
  - deploy config rendering
  - deploy env validation
  - worker version deploy helpers
  - smoke/deploy lifecycle helpers
  - R2 lifecycle helper
  - image cleanup helper

Expected implementation direction:

- move deploy-only modules out of the runtime build graph, likely into `apps/cloudflare/src-deploy/**` or a sibling package/tooling root with its own tsconfig
- keep worker runtime under a dedicated runtime source root such as `apps/cloudflare/src-runtime/**` or a similarly explicit ownership seam
- make the package build for the shipped artifact compile only runtime sources
- keep deploy scripts free to import deploy-only modules from the deploy-tooling root

Non-goal:

- splitting `apps/cloudflare` into several publishable workspace packages unless the file-level split proves insufficient

### 2. Replace workspace-closure discovery with explicit artifact manifests

The bundle assembly should stop discovering runtime closure by walking the workspace. Instead, each staged artifact should declare exactly what it is.

Target artifact model:

- runtime app artifact
  - built from runtime-only Cloudflare app sources
  - includes only runtime package metadata and runtime dependency manifest
- hosted CLI artifact
  - dedicated runner-owned CLI/programmatic surface
  - explicit small dependency manifest
- final runner bundle assembly
  - materializes runtime app artifact into staging
  - installs its pinned production deps
  - nests the hosted CLI artifact and installs its pinned production deps
  - prunes non-runtime residue
  - writes final bundle

Expected implementation direction:

- add an explicit runtime-artifact manifest builder for the Cloudflare app
- stop packing the Cloudflare app tarball as the basis for the final bundle
- use explicit artifact staging directories built from checked-in ownership contracts instead of scanning all workspace packages
- keep explicit dependency lists in a small contract file rather than computing them from workspace traversal in the assembly script

### 3. Make the build graph leaf-oriented

The deploy artifact should be built in layers:

1. build runtime packages needed by the Cloudflare runtime
2. build the Cloudflare runtime artifact
3. build the hosted runner CLI artifact
4. assemble the final bundle from those two artifacts plus native image assets

The assembly step itself should not need to inspect the whole workspace topology.

## Concrete implementation plan

### Phase 1: runtime/deploy ownership split

1. Inventory `apps/cloudflare/src/**` into:
   - runtime-owned modules
   - deploy-only modules
   - shared helpers used by both
2. Introduce dedicated roots/tsconfigs so runtime build excludes deploy-only code.
3. Move deploy-only modules and update imports:
   - `deploy-automation/**`
   - `deploy-automation.ts`
   - `deploy-preflight.ts`
   - `r2-lifecycle.ts`
   - any deploy-only helpers imported only by `apps/cloudflare/scripts/**`
4. Update app package build/export metadata so the runtime artifact builds only the runtime tree.
5. Update contract tests to assert deploy-only compiled files do not appear in the runner bundle.

### Phase 2: explicit artifact contracts

1. Define a Cloudflare runtime artifact contract file that lists:
   - runtime root package name
   - runtime dependency names
   - artifact-root manifest shape
   - runtime entrypoints allowed in the final bundle
2. Keep the hosted CLI contract separate and explicit.
3. Refactor `assemble-runner-bundle.ts` to consume those contracts directly instead of loading workspace indexes and computing closure from `workspace:*` dependencies.

### Phase 3: replace bespoke packing flow

1. Add an app-local runtime artifact staging step:
   - copy built runtime `dist`
   - copy runtime README if intended
   - write runtime `package.json`
2. Replace “pack app tarball then extract” with “stage runtime artifact directly”.
3. Keep tarball-based staging only for the external workspace package artifacts that still need packaging, or replace that too with direct built-output staging where practical.
4. Limit closure knowledge to checked-in explicit lists/contracts.

### Phase 4: workflow/documentation alignment

1. Update GitHub Actions docs and package scripts if names/flow change.
2. Update `apps/cloudflare/README.md`, `apps/cloudflare/DEPLOY.md`, and `ARCHITECTURE.md` so they describe:
   - runtime vs deploy-tooling ownership
   - explicit artifact assembly
   - Docker copy-only contract

### Phase 5: verification

Required:

- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/cloudflare runner:bundle`
- `pnpm --dir apps/cloudflare verify`

Focused proof:

- inspect `apps/cloudflare/.deploy/runner-bundle/dist/` for absence of deploy-only files
- confirm bundle assembly code no longer scans workspace package directories dynamically
- rerun the Cloudflare container image contract test

## Parallel work split

### Lane A: runtime/deploy ownership split

Own:

- `apps/cloudflare/package.json`
- `apps/cloudflare/tsconfig*.json`
- `apps/cloudflare/src/**`
- `apps/cloudflare/scripts/**` only where imports must move to the new deploy/runtime roots
- runtime/deploy contract tests

Goal:

- split runtime build ownership cleanly so deploy-only modules are not shipped

### Lane B: leaf artifact assembly cleanup

Own:

- `apps/cloudflare/scripts/assemble-runner-bundle.ts`
- `apps/cloudflare/scripts/runner-bundle-contract.ts`
- related focused tests/docs if the artifact contract changes

Goal:

- replace dynamic workspace closure discovery and app tarball packing with explicit artifact contracts and staging

### Lane C: integration and verification

Own:

- plan integration
- doc alignment
- verification
- final conflict resolution across lanes

Goal:

- land a coherent artifact contract without regressing deploy behavior

## Risks and mitigations

1. Risk: moving files breaks relative imports or test expectations.
   Mitigation: split by import graph evidence first, keep shared helpers in explicit shared roots, and add focused contract tests.

2. Risk: explicit dependency lists drift from actual runtime needs.
   Mitigation: keep the contracts small, test them, and prefer owner-level artifact manifests over dynamic workspace scanning.

3. Risk: the artifact build still smuggles deploy-only files through package `files` or broad copy logic.
   Mitigation: stage runtime artifacts explicitly from selected paths rather than from packed whole-app tarballs.

4. Risk: verification becomes slower or more fragile.
   Mitigation: preserve existing `runner:bundle` and `verify` entrypoints even if their internals change.

## Open decisions

- Whether the cleanest runtime/deploy split stays inside `apps/cloudflare` with dual source roots or becomes two sibling workspace packages.
  - Default plan: stay inside `apps/cloudflare` unless verification shows the dual-root shape is still awkward.
- Whether remaining workspace package artifacts should continue to use tarballs or move to direct built-output staging.
  - Default plan: remove dynamic workspace discovery first; only replace tarball staging where it materially simplifies the flow in this pass.
Completed: 2026-04-08
