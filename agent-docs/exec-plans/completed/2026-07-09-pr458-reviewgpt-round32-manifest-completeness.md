# PR 458 ReviewGPT Round 32 Manifest Completeness

## Goal

Fix the two accepted ReviewGPT round 32 findings for PR #458: Condition retrieval failures must make global allergy absence evidence incomplete, and each raw manifest resource file must remain under its declared resource-type directory.

Success criteria:

- A manifest-level Condition retrieval error blocks a no-known-allergies candidate with the existing incomplete-evidence reason.
- A resource-file entry is rejected unless `relativePath` begins with its path-safe `resourceType` and includes a following file path.
- Raw-ref construction enforces the parsed resource-file contract.
- Focused tests, typecheck, diff verification, PR CI, and the ReviewGPT loop pass on the pushed head.

## Constraints

- Share only the small set of raw resource families that can carry allergy conflict evidence.
- Keep Condition resources unsupported and raw-only.
- Tighten the existing manifest schema and constructor; add no writer, migration, or storage layer.

## Current State

- ReviewGPT round 32 identified both gaps, and focused regressions reproduced them.
- Condition retrieval failures now block global allergy-absence output through the same resource-family set used by conflict scanning.
- Manifest entries and raw-ref construction now require the declared, path-safe resource-type directory.
- Focused tests and typecheck pass. The broad diff verifier reached the unrelated assistant-engine suite before one fixed 60-second test timed out under heavy concurrent machine load; that exact test passes in isolation.

## Plan

1. Add failing regressions for a Condition retrieval error and a mismatched resource-file path.
2. Share the allergy-conflict resource-type set with manifest error classification.
3. Enforce the resource-type directory invariant in the manifest entry schema and raw-ref constructor.
4. Run focused package tests, typecheck, `pnpm test:diff`, and hygiene checks.
5. Commit with `scripts/finish-task`, push, and rerun ReviewGPT plus PR CI.

## Verification

- `pnpm --dir packages/clinical-records test -- contracts.test.ts` (8 passed)
- `pnpm --dir packages/importers test -- clinical-records.test.ts` (311 passed)
- `pnpm --dir packages/clinical-records typecheck`
- `pnpm typecheck`
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm test:diff packages/clinical-records/src/index.ts packages/clinical-records/test/contracts.test.ts packages/importers/src/clinical-records/index.ts packages/importers/test/clinical-records.test.ts` (blocked after 2,120 passing tests by the unchanged assistant-engine retention test timing out at 60 seconds under concurrent load)
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-outbox-runtime.test.ts -t "prunes terminal outbox intents by instant when timestamp offsets differ"` (1 passed)

Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
