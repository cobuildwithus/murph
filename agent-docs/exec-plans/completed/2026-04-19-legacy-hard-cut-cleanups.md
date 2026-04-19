## Title

Hard-cut legacy compatibility shims across measurement, assistant outbox, device-sync local state, hosted wake append, and supplement compounds.

## Goal

Remove legacy compatibility code that only preserves old local/runtime shapes or deprecated command/route aliases, while keeping the current canonical measurement, assistant outbox, device-sync SQLite bootstrap, hosted email-ingress wake path, and structured supplement ingredient model intact.

## Scope

- `packages/cli/src/commands/workout.ts`
- `packages/cli/src/incur.generated.ts`
- `packages/cli/config.schema.json`
- `packages/cli/src/vault-cli-command-manifest.ts`
- `packages/vault-usecases/src/usecases/workout-measurement.ts`
- focused CLI and vault-usecases tests for workout-measurement alias removal
- `packages/assistant-engine/src/assistant/outbox/store.ts`
- focused assistant-engine outbox tests if the tolerated legacy field is currently asserted
- `packages/device-syncd/src/store/{schema,store}.ts`
- focused device-syncd tests that currently assert the legacy `device_account` rejection
- stale hosted-wake append tests/docs references now that the generic append route is deleted
- `packages/query/src/health/supplements.ts`
- focused query supplement tests/fixtures that still rely on simple `substance` fallback derivation

## Constraints

- Preserve the canonical `measurement add` path and open metric/unit write contract.
- Do not remove current `body_measurement` event support or generic measurement read paths in this lane.
- Preserve overlapping hosted-wake dirty-tree work outside the deleted `append` route and stale references.
- Preserve the current SQLite migration/bootstrap path for device-sync local state.
- Treat stale local assistant outbox intents and old local device-sync DBs as disposable runtime state rather than migration targets.

## Verification

- `pnpm typecheck`
- `pnpm exec vitest run packages/cli/test/assistant-observability.test.ts --config packages/cli/vitest.workspace.ts --no-coverage`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/outbox/store.ts packages/assistant-engine/src/assistant/outbox.ts packages/assistant-engine/src/assistant/outbox/dispatch-state.ts packages/assistant-engine/test/assistant-outbox-runtime.test.ts packages/device-syncd/src/store/schema.ts packages/device-syncd/src/store.ts packages/device-syncd/test/store.test.ts packages/device-syncd/test/service.test.ts packages/query/src/health/supplements.ts packages/query/test/health-internals-coverage.test.ts packages/query/test/health-registries-supplements-final.test.ts packages/cli/src/commands/workout.ts packages/cli/src/incur.generated.ts packages/cli/config.schema.json packages/cli/src/vault-cli-command-manifest.ts packages/vault-usecases/src/usecases/workout-measurement.ts packages/cli/test/workout-command-coverage.test.ts packages/cli/test/cli-expansion-workout.test.ts packages/cli/test/health-tail.test.ts packages/cli/test/incur-smoke.test.ts packages/cli/test/assistant-observability.test.ts packages/vault-usecases/test/workout-coverage.test.ts apps/web/test/hosted-email-ingress-route.test.ts`
- targeted package Vitest commands if the diff-aware lane leaves direct proof gaps or is blocked by unrelated dirty-tree failures

## Notes

- Issue 1 overlaps the broader active measurement-primitive lane; keep this pass limited to removing the explicit `workout measurement` compatibility alias and legacy payload conversion helpers without reopening the canonical measurement design.
- Issue 4 overlaps existing hosted-wake work; this pass should only delete the dead `append` route and stale tests/docs references, not reshape the live email-ingress or nudge paths.

## Current status

- Hosted-wake cleanup is landed locally: the dead generic append route is deleted, the rejection-only append test is removed, and the stale active append-hardening plan reference is retired.
- The measurement alias cleanup, assistant/device-sync runtime cleanup, and supplement fallback cleanup are landed through scoped worker commits.
- Follow-up fixes from final review are also landed locally:
  - direct outbox reads now quarantine malformed intent files when a vault context is available instead of throwing outside inventory scans
  - CLI manifest coverage now explicitly proves the removed `workout measurement` alias does not appear in descriptor leaf paths
- Verification is green:
  - `pnpm typecheck`
  - `pnpm exec vitest run packages/cli/test/assistant-observability.test.ts --config packages/cli/vitest.workspace.ts --no-coverage`
  - `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/outbox/store.ts packages/assistant-engine/src/assistant/outbox.ts packages/assistant-engine/src/assistant/outbox/dispatch-state.ts packages/assistant-engine/test/assistant-outbox-runtime.test.ts packages/device-syncd/src/store/schema.ts packages/device-syncd/src/store.ts packages/device-syncd/test/store.test.ts packages/device-syncd/test/service.test.ts packages/query/src/health/supplements.ts packages/query/test/health-internals-coverage.test.ts packages/query/test/health-registries-supplements-final.test.ts packages/cli/src/commands/workout.ts packages/cli/src/incur.generated.ts packages/cli/config.schema.json packages/cli/src/vault-cli-command-manifest.ts packages/vault-usecases/src/usecases/workout-measurement.ts packages/cli/test/workout-command-coverage.test.ts packages/cli/test/cli-expansion-workout.test.ts packages/cli/test/health-tail.test.ts packages/cli/test/incur-smoke.test.ts packages/cli/test/assistant-observability.test.ts packages/vault-usecases/test/workout-coverage.test.ts apps/web/test/hosted-email-ingress-route.test.ts`
- Required completion-workflow audit passes are complete.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
