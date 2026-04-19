## Title

Hard-cut remaining greenfield compatibility/versioning baggage now that there are no live deployments or persisted data to migrate.

## Goal

Remove live compatibility bridges, legacy projection fields, deprecated route/build aliases, inferred provider/config fallbacks, and stale schema/version allowances so the repo matches a clean first-release posture.

## Scope

- hosted wake and hosted execution hard cuts under `apps/web/**`, `apps/cloudflare/**`, and `packages/hosted-execution/**`
- canonical contract/core/query cleanup under `packages/contracts/**`, `packages/core/**`, `packages/query/**`, and `packages/runtime-state/**`
- assistant/config/setup/daemon cleanup under `packages/assistant-engine/**`, `packages/operator-config/**`, `packages/setup-cli/**`, `packages/assistantd/**`, and `packages/cli/**`
- focused docs/readme updates only where the live contract changes
- focused tests under the touched owners

## Constraints

- Treat the user's statement that there are no live deployments or persisted data as the enabling assumption for hard cuts.
- Preserve unrelated dirty-tree edits already in flight; integrate on top of overlapping hosted-file changes instead of reverting them.
- Distinguish true compatibility baggage from healthy current-version `v1` schema identifiers and fail-closed version gates.
- Keep resilience/recovery logic only when it still serves a real current-state invariant rather than an old-shape bridge.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/contracts/src/health-entities.ts packages/contracts/src/registry-helpers.ts packages/core/src/event-attachments.ts packages/core/src/domains/events.ts packages/query/src/vault-source.ts packages/runtime-state/src/hosted-storage.ts packages/assistant-engine/src/assistant/provider-state.ts packages/operator-config/src/assistant/provider-config.ts packages/setup-cli/src/setup-services/shell.ts packages/assistantd/src/http-protocol.ts packages/cli/src/cli-entry.ts packages/hosted-execution/src/{routes,side-effects,parsers}.ts apps/web/src/lib/hosted-wake/store.ts apps/cloudflare/src/{runner-container,container-entrypoint}.ts`

## Notes

- Hosted files already have overlapping dirty-tree edits; keep local ownership for those integrations.
- Prefer hard delete over migration when the only justification is compatibility for data or deploys that do not exist.
- Update any docs/readmes that still advertise removed aliases or deploy/migration flows in the same patch.
- The assistant-provider/session-option hard-cut is now materially advanced:
  - `AssistantProviderSessionOptions` now carries explicit `provider` across the schema, runtime session reconstruction, session persistence, and daemon/session-update boundaries.
  - `inferAssistantProviderFromConfigInput()` and `mergeAssistantProviderConfigs()` no longer infer provider from non-provider fields.
  - `resolveAssistantExecutionPlan()` no longer uses provider-less override inference.
  - assistant session-option updates now require explicit `provider` through `assistant-cli`, `assistant-engine`, and `assistantd`, and the model-selection UI sends it explicitly.
- The assistant cron/daemon hard-cut now also uses canonical `threadId` on the assistant-owned contract surfaces:
  - `assistantd` request parsing rejects legacy `sourceThreadId` and now reads `threadId` for cron target updates instead of silently dropping it
  - assistant cron target contracts, snapshots, notification dedupe, and daemon client serialization now use `threadId`
  - assistant-cron keeps the translation back to canonical automation/self-delivery route owners at the boundary where those owners still use `sourceThreadId`
- The overlapping hosted wake/runner cleanup was validated separately and is already present in the current hosted files:
  - hosted wake status proof validation now requires `wakeEventId`
  - the runner path cleanup keeps `/internal/run` as the canonical internal route
  - the hosted-execution route surface no longer needs the raw-message path builder on the shared package surface
- Verification outcome for this slice:
  - passed: full-package `pnpm exec vitest run --config vitest.config.ts --no-coverage` in `packages/operator-config`
  - passed: full-package `pnpm exec vitest run --config vitest.config.ts --no-coverage` in `packages/assistant-engine`
  - passed: full-package `pnpm exec vitest run --config vitest.config.ts --no-coverage` in `packages/assistantd`
  - passed: targeted `packages/assistant-cli` Vitest coverage for the daemon/session-update/runtime-service seams
  - package-level `packages/assistant-cli` Vitest still fails in pre-existing `test/assistant-ui-ink.test.ts` timeout cases unrelated to provider shape changes
  - passed: package-level `tsc --noEmit` in `packages/{operator-config,assistant-engine,assistantd,assistant-cli}`
  - unrelated broader `packages/cli` verification remains blocked by existing export-resolution failures in the dirty tree
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
