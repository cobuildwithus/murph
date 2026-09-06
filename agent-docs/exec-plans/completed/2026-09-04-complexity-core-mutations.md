# Collapse device-event reconciliation bookkeeping

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

Reduce repeated state bookkeeping in the largest canonical device-event reconciliation function while preserving every public mutation result and persisted event revision.

## Success criteria

- Provider revision staging has one local implementation; no module or state owner is added.
- Canonical lock, alias repair, legacy-reference cleanup, member overlays, tombstones, duplicate counts, and append order remain unchanged.
- Focused device import tests and core typecheck pass; complexity debt decreases.
- Scoped commit and draft PR have complete evidence; parent approves candidate before Ready and final ReviewGPT runs concurrently with required CI.

## Scope

Only `packages/core/src/mutations.ts`, focused device import proof, and this plan. Provider adapters, public APIs, exact-document reconciliation, and persistence orchestration are excluded.

## Constraints

Preserve mutations.ts as the canonical facade. Use the existing write lock, event index, append lists, and receipts. No new persisted state, dependencies, asynchronous operations, or provider calls.

## Risks and mitigations

1. Staging drift could put the member overlay below its provider baseline or lose revision ordering. Prove physical ledger order and exact revisions through public import calls.
2. Retaining an existing record does not always count as a duplicate. Leave count increments and incomplete-spine decisions explicit at each existing decision branch.
3. Alias cleanup could remove another owner. Preserve both historical and current owner checks and test sequential identity migration.

## Tasks

1. Inspect existing reconciliation branches and relevant tests.
2. Collapse repeated staging and retention bookkeeping locally without changing decisions.
3. Run focused tests, typecheck, complexity and parent candidate review.
4. Commit, open draft PR, then drive final ReviewGPT and required CI after parent clearance.

## Decisions

- Parent approved a local staging helper with existing state ownership intact.
- Graft is unavailable; use precise symbol reads and the documented canonical facade guidance.
- Internal behavior-preserving change: no user-facing UX, provider-input, or changelog change.

## Verification

- `pnpm exec vitest run --config packages/core/vitest.config.ts --no-coverage packages/core/test/device-import.test.ts packages/core/test/device-import-session.test.ts packages/core/test/import-device-batch-validation.test.ts packages/core/test/canonical-mutations-boundary.test.ts`: 210 tests passed.
- Added physical ledger-order and audit-count assertions pass for member overlays, authoritative retractions, and transitive in-batch identity migration. The same three cases pass against the unchanged pinned base, proving these assertions preserve existing behavior.
- `pnpm --filter @murphai/core typecheck`: passed; no public-entrypoint or build-boundary change.
- `pnpm complexity:diff --base 603ea873bf4d0652805d0577081c43d64d6e0f61 -- packages/core/src/mutations.ts`: passed, file debt 396 to 377 and reconciler complexity 154 to 135.
- Parent preliminary review confirmed the original append/index order and unchanged prepared IDs. Final candidate review, exact-head CI, and ReviewGPT are tracked with the PR after the scoped implementation commit.
- Frog inventory inspected after the frozen install; no new repository friction was encountered.

Completed: 2026-09-04
