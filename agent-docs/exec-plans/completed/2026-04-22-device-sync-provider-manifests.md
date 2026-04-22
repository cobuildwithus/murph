# Device Sync Provider Manifests

## Goal

Land the supplied `device-syncd` patch that centralizes provider assembly in one shared provider-manifest registry while keeping current provider runtime behavior unchanged.

## Success criteria

- `packages/device-syncd` adds the provider-manifest registry plus the supporting helper seams described in the supplied patch.
- Existing config/env/factory/serialization/hosted-hint seams derive from that registry instead of parallel provider switch logic.
- The new manifest helpers are exported through the public `config` and package root seams.
- Focused seam tests and the directly coupled package/runtime docs land with the code.
- Verification and required completion-workflow audits either pass or any environment blocker is documented precisely.

## Scope

- `packages/device-syncd/src/{config/{provider-manifests,provider-types,provider-env,provider-config-helpers,env-keys,provider-configs,provider-factory,serializable-provider-configs,config}.ts,hosted-hints.ts,index.ts}`
- `packages/device-syncd/test/provider-manifests.test.ts`
- directly coupled `packages/device-syncd/README.md`
- directly coupled `ARCHITECTURE.md`

## Constraints

- Treat the supplied patch as the intended behavior and keep any local reconciliation bounded to current-HEAD compatibility.
- Preserve unrelated dirty-tree edits and all active coordination-ledger rows outside this narrow lane.
- Do not widen beyond `device-syncd` config seams, the focused seam test, and the two directly coupled docs.
- Keep provider runtime behavior stable; this patch is about registry ownership and seam cleanup, not new provider features.

## Planned shape

1. Register the active lane in the coordination ledger.
2. Apply the supplied patch onto current `HEAD`.
3. Inspect the diff for scope drift and make only the smallest compatibility fixes required by the current tree.
4. Run the truthful `packages/device-syncd` verification lane.
5. Run the required completion-workflow audits, then finish and commit the scoped landing.

## Verification

- `pnpm typecheck`
- `pnpm test:diff packages/device-syncd/src packages/device-syncd/test packages/device-syncd/README.md ARCHITECTURE.md`
- If the diff-aware lane is unavailable or not truthful here, fall back to `pnpm --dir packages/device-syncd test:coverage`.
- Run required completion audits after verification:
  - `coverage-write`
  - `task-finish-review`

## Notes

- The supplied patch already includes a lightweight TypeScript parse pass; still rerun the repo-required lane in this checkout before handoff.
- If local tool availability blocks the normal verification commands, keep the landed diff scoped and report the exact blocker with command-level detail.

## Outcome

- Landed the manifest-registry refactor plus the directly coupled docs/tests, then reconciled the patch with current `HEAD` by:
  - moving provider-descriptor metadata imports onto the approved `@murphai/importers/device-providers/provider-descriptors` public entrypoint
  - simplifying an unreachable branch in `provider-factory.ts`
  - tightening the serializer helper typing without `unknown as` shims
  - freezing exported manifest shapes and deriving runtime env-key aggregation from the manifest registry so the public manifest exports are not mutable footguns
- Final verification:
  - `git diff --check -- ARCHITECTURE.md packages/device-syncd agent-docs/exec-plans/active/2026-04-22-device-sync-provider-manifests.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed
  - `pnpm --dir packages/device-syncd test:coverage` passed with 31 files and 323 tests
  - `pnpm --dir packages/device-syncd typecheck` passed
  - `pnpm typecheck` still fails for unrelated pre-existing workspace issues in `packages/vault-usecases/test/{health-cli-public-seams,helpers-public-seams}.test.ts` complaining about missing declaration files for `@murphai/vault-usecases/{vault-services,helpers}`
- Required completion audits ran:
  - `coverage-write` added one focused root-barrel re-export proof in `packages/device-syncd/test/provider-manifests.test.ts`
  - `task-finish-review` identified public manifest mutability and the env-aggregation drift; both were fixed before the final reruns above
Status: completed
Updated: 2026-04-22
Completed: 2026-04-22
