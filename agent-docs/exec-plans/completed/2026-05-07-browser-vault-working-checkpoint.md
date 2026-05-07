# Browser Vault Working Checkpoint

## Goal

Fix the hosted working-checkpoint regression where canonical device-sync commits can persist the vault delta while leaving the dashboard without a usable browser-vault replica pointer.

Success criteria:

- Working checkpoints publish a fresh browser-vault replica when replica generation and storage succeed.
- Working checkpoint browser-vault refs are validated against the working delta hash instead of being rejected categorically.
- Checkpoint requests that omit `browserVaultReplicaRef` preserve the existing pointer rather than clearing it.
- Focused Cloudflare E2E and web store tests cover the regression.

## Scope

- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts`
- `apps/cloudflare/test/runtime-bridge-workspace.test.ts`
- `apps/web/src/lib/hosted-workspace/store.ts`
- `apps/web/src/lib/browser-vault/session-handler.ts`
- `apps/web/test/hosted-workspace-store.test.ts`
- Durable docs if the source-of-truth architecture wording changes

## Invariants

- Browser-vault replicas remain derived dashboard sidecars, not canonical health truth.
- A stale browser-vault pointer may remain stored as cache metadata, but read paths must not serve it if it does not match the current workspace snapshot identity.
- Full/base and layered refs keep using the base bundle hash as the browser-vault source hash.
- Working refs use the delta bundle hash as the browser-vault source hash because the delta bundle is bound to the base snapshot hash and effective portable manifest.
- Optional sidecar failures should not erase an existing usable pointer.

## Verification

- Focused failing proof target:
  `pnpm exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts -t "publishes a browser-vault replica for canonical device-sync checkpoint commits" --no-coverage`
- Focused store/runtime tests after implementation.
- Required repo checks per verification policy.

## Progress

- 2026-05-07: Plan opened from production diagnosis. A proof-only E2E already demonstrates that working canonical commits do not publish a browser-vault replica.
- 2026-05-07: Implemented working-checkpoint browser-vault publication using the working delta hash as sidecar source identity.
- 2026-05-07: Updated web checkpoint persistence to preserve omitted `browserVaultReplicaRef` fields and validate working sidecars against the delta hash.
- 2026-05-07: Updated browser-vault session freshness checks to treat working delta hash as the current workspace source identity.
- 2026-05-07: Updated docs and focused tests for canonical device-sync checkpoint publication, store preservation, working-sidecar validation, and session-route matching.
- 2026-05-07: Audit follow-up: sidecar ref hash mismatches now degrade and omit the sidecar instead of aborting checkpoint creation; size diagnostic logs use the actual snapshot mode.

## Verification Results

- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts -t "publishes a browser-vault replica for canonical device-sync checkpoint commits" --no-coverage`
- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-workspace-store.test.ts apps/web/test/browser-vault-session-route.test.ts --no-coverage`
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts --no-coverage`
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts --no-coverage`
- Passed: `pnpm --dir apps/cloudflare typecheck`
- Passed: `pnpm --dir apps/web typecheck`
- Passed: `pnpm typecheck`
- Attempted: `pnpm test`; stopped after it opened an interactive setup prompt in the CLI setup lane.
- Attempted: `pnpm verify:acceptance`; failed in unrelated hosted-web settings tests (`hosted-billing-settings.test.tsx`, `hosted-account-settings-cards.test.tsx`) from dirty settings UI/copy changes outside this task scope. Cloudflare verify completed inside the acceptance lane.

## Audit Notes

- `security-privacy-review`: no findings. Residual risk is intentional stale pointer metadata in Postgres, guarded by browser-vault session hash validation.
- `coverage-write`: no changes needed; coverage judged sufficient.
- `task-finish-review`: fixed sidecar mismatch degradation and size diagnostic mode labeling. Materialized artifact deletion tracking remains a broader hosted artifact/materialization follow-up outside this browser-vault fix.
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
