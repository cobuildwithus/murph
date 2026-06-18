Goal (incl. success criteria):
- Land accepted ReviewGPT round 2 fix for PR 209 clinical import CLI surfaces.
- Success means an all-skipped idempotent social-history retry returns a schema-valid CLI result, with focused CLI/usecase tests and pushed branch ready for the next ReviewGPT round.

Constraints/Assumptions:
- Keep ReviewGPT response artifacts in `audit-packages/` uncommitted.
- Keep changes scoped to clinical import result shape and tests.
- Preserve `lookupId` for normal create/update paths; only all-skipped batch retries may omit it.

Key decisions:
- Accept the ReviewGPT round 2 finding as real: `eventIds: []` plus `lookupId: ""` violates the CLI output schema.

State:
- In progress.

Done:
- Ran ReviewGPT round 2 on the pushed PR head.
- Verified the all-skipped retry path in `toEventBatchResult` and `clinicalImportResultSchema`.
- Made `lookupId` optional at the usecase and CLI schema boundary.
- Added focused social-history retry coverage for the usecase and CLI output path.

Now:
- Regenerate CLI schema and run focused verification.

Next:
- Run focused verification, commit/push, and start ReviewGPT round 3.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/vault-usecases/src/usecases/clinical-imports.ts
- packages/vault-usecases/test/clinical-imports-real.test.ts
- packages/cli/src/commands/clinical-imports.ts
- packages/cli/test/clinical-imports.test.ts
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
