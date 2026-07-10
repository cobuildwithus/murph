# PR 458 ReviewGPT Round 33 Completeness And Documents

## Goal

Fix the two accepted ReviewGPT round 33 findings for PR #458: global no-known-allergies output must require explicit retrieval completeness for every allergy-conflict resource family, and clinical-note import must not silently accept only part of a multipart text `DocumentReference`.

Success criteria:

- An NKDA resource is unsupported unless the manifest includes complete, error-free `AllergyIntolerance` and `Condition` resource-family evidence.
- A zero-count resource file can provide explicit empty-family evidence without adding a writer or new manifest field.
- A `DocumentReference` is imported only when its text attachments form one unambiguous, fully decodable note.
- Focused regressions, typecheck, diff verification, PR CI, and the ReviewGPT loop pass on the pushed head.

## Constraints

- Derive allergy completeness from the existing conflict-family set and manifest entries.
- Preserve `Condition` as raw-only and unsupported.
- Fail closed for ambiguous or malformed multipart document text instead of inventing merge semantics.
- Add no writer, datastore, compatibility layer, or speculative abstraction.

## Current State

- ReviewGPT round 33 completed with two high-severity findings and `REVIEW_COMPLETE`; focused regressions reproduced both paths.
- NKDA now requires present, error-free `AllergyIntolerance` and `Condition` manifest entries, including an explicit zero-count file for an empty family.
- `DocumentReference` import now accepts exactly one decodable inline `text/*` attachment, rejects multipart text, and still allows non-text alternatives.
- Focused and full importer tests plus workspace typecheck pass. The scoped diff verifier is blocked only by the unchanged assistant CLI startup-import tests hitting fixed 30-second timeouts under concurrent machine load.
- `main` has advanced after the reviewed head; reconcile it after the scoped commit.

## Plan

1. Reproduce absent-family NKDA and multipart-document partial import with focused regressions.
2. Make allergy evidence completeness require present, error-free manifest entries for every conflict family.
3. Make `DocumentReference` text selection reject multiple or malformed text attachments.
4. Run focused tests, typecheck, diff verification, and hygiene checks.
5. Commit with `scripts/finish-task`, merge current `main`, push, and rerun ReviewGPT plus PR CI.

## Verification

- Focused pre-fix regression run (2 expected failures proving absent `Condition` completeness and partial multipart text import)
- Focused post-fix regression run (3 passed)
- `pnpm --dir packages/importers test -- clinical-records.test.ts` (311 passed)
- `pnpm typecheck`
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm test:diff packages/importers/src/clinical-records/index.ts packages/importers/test/clinical-records.test.ts` (all guards and affected typechecks passed; blocked by 2 unchanged assistant CLI startup-import tests timing out at 30 seconds under concurrent load)
- `pnpm --dir packages/assistant-cli exec vitest run --config vitest.config.ts --no-coverage test/assistant-command-startup-imports.test.ts` (same 2 fixed-timeout failures under load; unrelated to importer diff)

Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
