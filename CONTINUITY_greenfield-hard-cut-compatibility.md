Goal (incl. success criteria):
- Hard-cut remaining live compatibility/versioning baggage identified in the review so the repo reflects a clean greenfield/current-only posture.
- Success means legacy bridges are removed from live code, tests/docs are updated, verification passes, and the final diff does not preserve old-shape support merely for hypothetical prior deployments/data.

Constraints/Assumptions:
- User states there are no current deployments or persisted data.
- Preserve unrelated dirty worktree edits; overlapping hosted files must be integrated carefully.
- Healthy immutable `v1` schema ids and fail-closed version gates are not targets by themselves.

Key decisions:
- Use subagents only on disjoint write scopes.
- Keep local ownership for overlapping dirty hosted files: `apps/web/src/lib/hosted-wake/store.ts`, `apps/cloudflare/src/{runner-container,container-entrypoint}.ts`, `packages/hosted-execution/src/routes.ts`.
- Treat resilience/recovery logic separately from compatibility bridges; remove only if it is compatibility-only.

State:
- in_progress

Done:
- Loaded required workflow, security, reliability, verification docs.
- Completed parallel review and direct validation of the highest-signal compatibility seams.
- Registered active execution plan.
- Confirmed several originally flagged hosted hard-cut seams were already removed in the overlapping dirty tree.
- Hard-cut the assistant session-option contract to require explicit `provider` in the runtime session schema, serialization, persistence, daemon boundary, and assistant-cli session-update path.
- Removed provider inference from `inferAssistantProviderFromConfigInput()`, `mergeAssistantProviderConfigs()`, and `resolveAssistantExecutionPlan()` while preserving current normalization behavior in `normalizeAssistantProviderConfig()`.
- Hard-cut assistant cron target and assistantd daemon transport to canonical `threadId` on assistant-owned surfaces while keeping translation to canonical automation/self-delivery owners at the boundary.
- Updated directly coupled operator-config, assistant-engine, assistantd, and assistant-cli fixtures/tests to the explicit-provider shape.
- Verified:
  - `packages/operator-config` Vitest full package passed
  - `packages/assistant-engine` Vitest full package passed
  - `packages/assistantd` Vitest full package passed
  - targeted `packages/assistant-cli` daemon/session-update/runtime-service tests passed
  - focused cron/daemon cutover tests passed in `packages/{operator-config,assistant-engine,assistantd,assistant-cli}`
  - `packages/{operator-config,assistant-engine,assistantd,assistant-cli}` package-level `tsc --noEmit` passed
  - `packages/assistant-cli` full-package Vitest still reproduces only the pre-existing `test/assistant-ui-ink.test.ts` timeouts
  - `packages/cli` targeted Vitest remains blocked by pre-existing `@murphai/assistant-cli` export gaps (`./assistant/cron`, `./assistant/daemon-client`)
- Confirmed the hosted wake proof `wakeEventId` enforcement and runner route hard-cut are already represented in the overlapping hosted files, with a parallel worker validating that cleanup slice separately.

Now:
- Update the active coordination row and prepare a scoped commit for the explicit-provider plus assistant-cron `threadId` cutover slice.

Next:
- Follow up separately on the remaining non-provider greenfield seams the earlier review surfaced (`providerBinding` resume bridge, setup shell repo-root recovery, `sourceThreadId`, `murph init --vault`, and other current non-owned rows).
- Decide whether `normalizeAssistantProviderConfig()` should also lose its last provider-for-normalization helper in a later pass, or stay as a setup/config-only compatibility affordance.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the remaining dirty-tree hosted-wake/runner edits should be folded into this lane or left with their existing active rows, since the worker-confirmed hard-cut hunks are already present in overlapping files here.

Working set (files/ids/commands):
- Plan: `agent-docs/exec-plans/active/2026-04-19-greenfield-hard-cut-compatibility.md`
- Ledger: `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Key files for the landed slice: `packages/operator-config/src/{assistant-cli-contracts.ts,assistant/provider-config.ts}`, `packages/assistant-engine/src/assistant/{execution-plan,service,local-service,failover,provider-turn-runner,rich-content-routing,store,store/paths,store/persistence}.ts`, `packages/assistant-cli/src/assistant/{daemon-client,service,ui/chat-controller-models}.ts`, `packages/assistantd/src/http-protocol.ts`
- Cron transport follow-up in the same slice: `packages/assistant-engine/src/assistant/{cron.ts,cron/store.ts,cron/notification-delivery.ts}`, `packages/assistantd/src/service.ts`, `packages/assistant-cli/src/assistant-daemon-client.ts`, focused cron/daemon tests in `packages/{operator-config,assistant-engine,assistantd,assistant-cli}`
- Verification:
  - `pnpm exec vitest run --config vitest.config.ts --no-coverage` in `packages/operator-config`
  - `pnpm exec vitest run --config vitest.config.ts --no-coverage` in `packages/assistant-engine`
  - `pnpm exec vitest run --config vitest.config.ts --no-coverage` in `packages/assistantd`
  - `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-runtime-service-seams.test.ts test/assistant-daemon-client-owned-coverage.test.ts test/assistant-daemon-client-more.test.ts test/assistant-command-runtime.test.ts` in `packages/assistant-cli`
  - `pnpm exec tsc -p tsconfig.json --noEmit` in `packages/{operator-config,assistant-engine,assistantd,assistant-cli}`
