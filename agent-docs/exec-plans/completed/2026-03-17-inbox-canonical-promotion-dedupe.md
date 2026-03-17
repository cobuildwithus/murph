# Inbox canonical promotion dedupe

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Remove duplicated meal/document inbox promotion control flow in `packages/cli/src/inbox-services.ts` without changing promotion-state validation, canonical-match reuse, retry idempotency, or CLI result semantics.

## Success criteria

- `promoteMeal()` and `promoteDocument()` delegate to one small file-local helper for the shared flow.
- The helper only parameterizes target-specific attachment selection, missing-attachment errors, canonical match context/spec, and canonical record creation.
- Existing error codes/messages, especially missing-attachment and corrupted local promotion-state failures, remain unchanged.
- Existing `created`, `lookupId`, `relatedId`, and target field semantics remain unchanged.
- Focused inbox promotion tests and required repo checks pass.

## Scope

- In scope:
  - `packages/cli/src/inbox-services.ts`
  - focused inbox CLI/model-route tests only if the refactor requires adjustment
- Out of scope:
  - `promoteJournal()` and `promoteExperimentNote()` behavior changes
  - public schema/command/output changes
  - new promotion targets

## Constraints

- Preserve `reconcileCanonicalImportPromotion()` behavior and ordering.
- Preserve canonical-match lookup through `mealCanonicalPromotionSpec` and `documentCanonicalPromotionSpec`.
- Avoid broad refactors outside the meal/document promotion slice.
- Run inbox-focused coverage validation plus required repo checks and completion-workflow audits.

## Tasks

1. Introduce one small helper above `withPromotionScope()` and `reconcileCanonicalImportPromotion()` for canonical attachment promotion.
2. Reimplement `promoteMeal()` and `promoteDocument()` on top of that helper with unchanged result envelopes.
3. Run the requested focused inbox tests/coverage and required repo checks.
4. Run simplify, test-coverage-audit, and task-finish-review passes, then close the lane and commit scoped files.
Completed: 2026-03-17

## Verification

- Focused inbox behavior checks passed:
  - `packages/cli/test/inbox-cli.test.ts` named promotion-idempotency/write-failure/safeguard cases
  - `packages/cli/test/inbox-model-route.test.ts`
- Focused inbox coverage was exercised, but the ad-hoc coverage run hit a workspace/importers dist-path issue while loading document-importer coverage.
- Required repo checks did not complete cleanly due unrelated pre-existing workspace failures outside this refactor:
  - `pnpm typecheck`: root script/module-resolution failures in `scripts/{generate-json-schema,verify}.ts`
  - `pnpm test`: unrelated build errors in `packages/cli/src/usecases/integrated-services.ts`
  - `pnpm test:coverage`: unrelated `packages/contracts` dist resolution failure during `packages/contracts test`
