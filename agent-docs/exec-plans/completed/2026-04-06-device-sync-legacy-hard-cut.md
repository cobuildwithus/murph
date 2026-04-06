# Hard-cut local device-sync store to the split schema only

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Remove the remaining local `device-syncd` legacy schema/bootstrap path so greenfield installs support only the split authority records:
  - `device_connection`
  - `device_credential_state`
  - `device_observation_state`

## Success criteria

- `packages/device-syncd` no longer defines or migrates the legacy hybrid `device_account` table.
- Local SQLite bootstrap creates only the split-schema tables plus shared job/webhook/oauth tables.
- Tests cover the current split-schema behavior only; the legacy migration proof is removed.
- Docs stay aligned with the split-only local authority model.

## Scope

- In scope:
  - `packages/device-syncd/src/store.ts`
  - `packages/device-syncd/test/service.test.ts`
  - any narrowly required docs tied to this local storage contract
- Out of scope:
  - hosted device-sync request-shape cleanup already tracked in another active lane
  - unrelated assistant-state and hosted storage refactors

## Constraints

- Hard cut only; no read fallback or migration support for prior local hybrid rows.
- Preserve unrelated dirty worktree edits.
- Keep the caller-facing reconstructed account shape stable unless removal is required by the greenfield hard cut.

## Risks and mitigations

1. Risk: Removing versioned migration hooks could accidentally weaken fresh-db bootstrap.
   Mitigation: Keep one explicit current-schema initializer and prove it with focused tests plus a direct table-read scenario.
2. Risk: Legacy-specific tests may still be the only coverage for joined account reads.
   Mitigation: Retain and tighten fresh-schema tests that assert the split tables and reconstructed reads.

## Verification

- Planned commands:
  - `pnpm exec tsc -p packages/device-syncd/tsconfig.json --pretty false`
  - `pnpm exec vitest run packages/device-syncd/test/service.test.ts --maxWorkers 1 --no-coverage`
  - direct fresh-db scenario reading the split tables after store bootstrap
- Outcomes:
  - `pnpm exec tsc -p packages/device-syncd/tsconfig.json --pretty false` passed after each code and post-review update.
  - `pnpm exec vitest run packages/device-syncd/test/service.test.ts --maxWorkers 1 --no-coverage` passed with 17 tests after the final review fixes.
  - Direct `pnpm exec tsx --eval ...` fresh-db bootstrap proof showed only `device_connection`, `device_credential_state`, `device_job`, `device_observation_state`, `oauth_state`, and `webhook_trace`.
  - `pnpm typecheck` failed for unrelated workspace-boundary violations in the active assistant-state/memory hard-cut lane under `packages/cli`, `packages/core`, and `packages/query`.
  - `pnpm test:coverage` failed for the same unrelated workspace-boundary violations before package tests ran.

## Review

- Required `simplify` audit pass completed with two low findings; both were fixed locally.
- Required final review completed with two low findings about proof gaps; both were fixed locally without reopening the audit loop because the follow-up diff stayed narrow and test-only.
Completed: 2026-04-06
