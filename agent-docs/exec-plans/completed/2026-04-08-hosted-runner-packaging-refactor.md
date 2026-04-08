# Cloudflare hosted runner packaging refactor

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Finish the Cloudflare hosted-runner packaging refactor so `apps/cloudflare` owns a clean deploy artifact contract end to end.
- Keep Docker as a thin final stage that copies a prepared runner artifact plus native binaries only.
- Remove the current workspace-repair behavior and reduce the deploy bundle to the actual runtime closure.

## Success criteria

- `apps/cloudflare` exposes one app-owned artifact assembly path that writes the deployable runner bundle into `apps/cloudflare/.deploy/runner-bundle/`.
- The bundle step no longer ends by repairing the workspace with `pnpm install --frozen-lockfile`.
- The bundle step does not treat `.deploy/runner-bundle` as a live workspace package during assembly.
- Bundle contents are intentionally runtime-shaped:
  - built JS only for the app/runtime entrypoints
  - production dependency closure only
  - no test/docs/source-control residue
  - no unnecessary package-manager/workspace state beyond what runtime install resolution actually needs
- The Docker contract remains simple: copy the prepared runner bundle and start `dist/container-entrypoint.js`.
- GitHub Actions and local deploy helpers continue to use the same prepared artifact path.
- Durable docs and focused tests describe and enforce the new artifact contract.

## Current state

- Good:
  - `Dockerfile.cloudflare-hosted-runner` already copies `apps/cloudflare/.deploy/runner-bundle/` into `/app`.
  - GitHub Actions already prepares deploy artifacts before deploy and uses direct deploy by default.
- Remaining problems:
  - `apps/cloudflare/package.json` still builds the artifact through `pnpm --filter @murphai/cloudflare-runner deploy --legacy --prod ...`.
  - `runner:bundle` still runs `pnpm --dir ../.. build:workspace:incremental`.
  - `runner:bundle` currently restores the workspace afterward with `pnpm --dir ../.. install --frozen-lockfile`.
  - The assembled bundle is still heavy: current local output is about `243M`, with about `234M` in `node_modules` and only about `1.2M` in app `dist`.
  - The current bundle root still carries the source package manifest/scripts instead of a runtime-shaped artifact manifest.

## Scope

- In scope:
  - `apps/cloudflare/package.json`
  - `apps/cloudflare/scripts/**`
  - `apps/cloudflare/test/**`
  - `apps/cloudflare/README.md`
  - `apps/cloudflare/DEPLOY.md`
  - deploy-path helpers directly coupled to artifact assembly
  - targeted package-boundary/dependency cleanup only where it materially reduces hosted runner closure
- Out of scope:
  - unrelated hosted runtime behavior changes
  - unrelated package-boundary cleanup outside the hosted-runner dependency closure
  - changing the Worker/container runtime contract beyond what artifact assembly requires

## Constraints

- Preserve unrelated worktree edits.
- Treat the Cloudflare packaging row in `COORDINATION_LEDGER.md` as exclusive for `apps/cloudflare` deploy/runtime surface changes.
- Keep package boundaries clean; do not reintroduce broad compatibility shims or deep-import surfaces.
- Prefer built-package/runtime ownership over repo-source assumptions.
- Keep Dockerfile changes minimal unless they directly support the artifact contract.

## Architecture target

1. `apps/cloudflare` owns artifact assembly.
   - Add an explicit assembly script instead of hiding the core behavior in one long package.json command.
   - The script owns staging, pruning, manifest shaping, and final bundle write.

2. Stage outside the workspace.
   - Use a temporary staging directory outside the workspace root so artifact assembly cannot perturb the live workspace install state.
   - Finalize into `apps/cloudflare/.deploy/runner-bundle/` only after assembly succeeds.

3. Separate build from assembly.
   - Build the required package/app outputs first.
   - Assemble the final runtime bundle second.
   - Avoid conflating package build, workspace install state, and final image contents.

4. Make the final bundle runtime-shaped.
   - Keep only runtime files that the container actually needs.
   - Replace the copied source package manifest at the artifact root with a small runtime-oriented manifest if needed.
   - Prune declaration files, maps, docs, scripts, and non-runtime residue from the final bundle where safe.

5. Keep deploy surfaces aligned.
   - GitHub workflow, local deploy helper, docs, and tests should all describe the same artifact contract.

## Implementation plan

### Phase 1: App-owned assembly primitive

1. Add a dedicated bundle assembly script under `apps/cloudflare/scripts/`.
2. Move `runner:bundle` package.json logic into that script.
3. Stage the bundle in a temporary directory outside the workspace, then atomically move/copy it into `.deploy/runner-bundle`.
4. Remove the trailing workspace restore step.

### Phase 2: Runtime-shaped artifact output

1. Inspect the staged output and write a small pruning pass for obvious non-runtime files.
2. Replace or rewrite the artifact-root `package.json` so it reflects the actual runtime contract instead of the full source package scripts.
3. Preserve only the runtime entrypoints and dependency metadata needed by `node dist/container-entrypoint.js`.

### Phase 3: Dependency-closure reduction

1. Inventory the biggest runtime dependencies in the staged bundle.
2. Remove any direct hosted-runner dependency edges that are only present because of legacy helper ownership.
3. Keep any dependency-surface moves narrowly scoped to the hosted runner closure and avoid broad package churn.

### Phase 4: Contract proofs

1. Extend focused tests to cover:
   - artifact-path resolution
   - absence of workspace-repair behavior
   - expected artifact-root manifest/content shape
   - Docker/image contract staying copy-only
2. Update README/DEPLOY docs to describe the new assembly contract precisely.

### Phase 5: Verification and deploy readiness

1. Run the required Cloudflare verification commands.
2. Run any focused artifact assembly checks needed to prove the bundle path.
3. Run the required completion audit pass before handoff or deploy.

## Parallel work split

- Lane A: app-owned artifact assembly implementation
  - Own `apps/cloudflare/package.json`
  - Own new/updated bundle assembly scripts
  - Own the final `.deploy/runner-bundle` assembly path behavior

- Lane B: artifact contract tests and docs
  - Own `apps/cloudflare/test/**`
  - Own `apps/cloudflare/README.md`
  - Own `apps/cloudflare/DEPLOY.md`
  - Keep Docker/image contract assertions aligned with the new assembly path

- Lane C: dependency-closure analysis and targeted reduction
  - Inventory the largest staged runtime dependencies
  - Identify hosted-runner dependency edges that can be removed cleanly
  - Only patch package ownership/import surfaces when they directly reduce hosted-runner closure and stay within clean package boundaries

## Risks and mitigations

1. Risk: artifact assembly still mutates workspace state indirectly.
   Mitigation: stage outside the workspace and verify the live install state is not part of the assembly contract.

2. Risk: pruning removes files needed at runtime.
   Mitigation: keep pruning explicit, test-backed, and limited to obvious non-runtime classes first.

3. Risk: dependency reduction causes package-boundary churn.
   Mitigation: keep package changes surgical and only where the hosted runner closure clearly benefits.

4. Risk: worker/docs/tests drift from the actual deploy contract.
   Mitigation: update contract tests and durable docs in the same change.

## Verification

- Required commands:
  - `pnpm typecheck`
  - `pnpm test:coverage`
  - `pnpm --dir apps/cloudflare verify`
- Focused proof to add during implementation:
  - run `pnpm --dir apps/cloudflare runner:bundle`
  - inspect artifact contents and size deltas directly
Completed: 2026-04-08
