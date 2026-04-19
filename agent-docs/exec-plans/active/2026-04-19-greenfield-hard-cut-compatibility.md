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
- This pass did not complete the full plan. The lasting code change preserved current assistant-provider normalization semantics by routing `normalizeAssistantProviderConfig()` through a local provider-for-normalization helper, after validation showed assistant-engine still depends on provider-less session-option shapes.
- Narrow fixture cleanup also made hosted assistant profile/provider-option test inputs explicit where the production contract already requires it.
- Verification outcome for this slice:
  - targeted package tests passed for `packages/operator-config`, `packages/assistant-engine`, and `packages/hosted-execution`
  - `pnpm typecheck` still fails in unrelated dirty-tree `apps/web/test/hosted-wake-store.test.ts` because that test references missing `assistantNextWakeAt` properties
  - `bash scripts/workspace-verify.sh test:diff ...` advanced through reverse dependents and then surfaced unrelated `packages/cli/test/setup-cli.test.ts` failures already present in the dirty tree
