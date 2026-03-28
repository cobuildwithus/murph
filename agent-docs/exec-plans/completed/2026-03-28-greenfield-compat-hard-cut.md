## Goal

Remove the remaining greenfield-only compatibility shims across assistant state, cron/outbox, experiment status handling, importer/core meal naming, importer vault-root aliases, and family/genetics/history alias fields so current code accepts only canonical shapes.

## Success Criteria

- Assistant outbox/session/cron code no longer silently normalizes or skips legacy record shapes.
- Experiment creation no longer coerces unknown statuses to `active`.
- Importer/core seams use canonical `importMeal` and `vaultRoot` names only.
- Family/genetics/history write and projection paths only accept/read canonical field names.
- Focused tests cover the stricter behavior, and required verification is run with unrelated failures called out if present.

## Scope

- `packages/cli/src/{assistant/outbox.ts,assistant/store/persistence.ts,assistant/cron.ts}`
- Targeted CLI assistant tests
- `packages/core/src/{domains/experiments.ts,public-mutations.ts,storage-spine.ts,family/{types.ts,api.ts},genetics/{types.ts,api.ts},history/{types.ts,api.ts}}`
- `packages/importers/src/{shared.ts,core-port.ts,create-importers.ts}`
- `packages/contracts/src/health-entities.ts`
- `packages/query/src/health/registries.ts`
- Targeted core/importers/query tests covering the removed aliases

## Risks / Notes

- This intentionally hard-cuts compatibility behavior; tests and fixtures that still rely on alias-heavy payloads must move to canonical fields rather than preserving fallback reads.
- The assistant files overlap active assistant cleanup lanes, so live file state must be preserved carefully.
- The repo already has unrelated dirty worktree changes, so repo-wide verification may still fail outside this lane.

## Status

- Implemented the greenfield hard-cut across assistant, core, importer, contracts, and query surfaces in scope.
- Updated focused regression tests to assert canonical-only behavior and rejection of removed aliases.
- Scoped completion-workflow audits completed:
  - `simplify`: no additional scoped fixes required beyond the implemented diff.
  - `test-coverage-audit`: no actionable scoped coverage gaps found.
  - `task-finish-review`: no actionable scoped findings.

## Verification

- `pnpm typecheck`
  - Passed.
- `pnpm exec vitest run --coverage.enabled=false apps/web/test/hosted-execution-outbox.test.ts packages/cli/test/assistant-observability.test.ts packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-cron.test.ts packages/core/test/core.test.ts packages/core/test/canonical-mutations-boundary.test.ts packages/core/test/health-history-family.test.ts packages/importers/test/importers.test.ts packages/importers/test/input-validation.test.ts packages/importers/test/device-providers.test.ts packages/query/test/query.test.ts`
  - Passed (`9` files, `207` tests).
- `pnpm test`
  - Failed in unrelated pre-existing baseline areas outside this lane, including `packages/cli/test/canonical-write-source-audit.test.ts`, `packages/cli/test/runtime.test.ts`, `packages/cli/test/search-runtime.test.ts`, `packages/cli/test/release-script-coverage-audit.test.ts`, `packages/core/test/device-import.test.ts`, and environment-dependent CLI flows.
- `pnpm test:coverage`
  - Failed in the same unrelated baseline areas outside this lane.

## Status

- Implementation complete.
- `pnpm typecheck` passed.
- Focused scoped verification passed:
  `pnpm exec vitest run --coverage.enabled=false apps/web/test/hosted-execution-outbox.test.ts packages/cli/test/assistant-observability.test.ts packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-cron.test.ts packages/core/test/core.test.ts packages/core/test/canonical-mutations-boundary.test.ts packages/core/test/health-history-family.test.ts packages/importers/test/importers.test.ts packages/importers/test/input-validation.test.ts packages/importers/test/device-providers.test.ts packages/query/test/query.test.ts`
- Required repo-wide verification was executed:
  - `pnpm test`
  - `pnpm test:coverage`
- Repo-wide test wrappers remain red on broader baseline failures outside this cleanup scope, including:
  - `packages/cli/test/canonical-write-source-audit.test.ts`
  - `packages/cli/test/runtime.test.ts`
  - `packages/cli/test/search-runtime.test.ts`
  - `packages/cli/test/release-script-coverage-audit.test.ts`
  - `packages/core/test/device-import.test.ts`
  - intermittent root-wrapper-only noise around importer package tests, while the importer-focused Vitest run passes in isolation
- Pending: final spawned audit pass completion and scoped commit via `scripts/finish-task`.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
