# Hard-cut vault-owned attachments to one canonical event shape

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Replace the forked vault attachment paths with one canonical attachment shape plus one shared core staging/helper seam for any event record that owns files.

## Success criteria

- Event records that own files carry one canonical `attachments[]` collection as the write-time truth.
- Core mutations and assistant-engine workout/measurement writers use the same core-owned attachment staging/helper flow and raw-manifest contract.
- Vault layout and raw roots explicitly cover workouts and measurements instead of leaving those families implicit under assistant-engine.
- Legacy fields such as `rawRefs`, `documentPath`, `photoPaths`, `audioPaths`, `media`, and `workout.media` remain only as derived compatibility projections where still needed.
- Focused tests and docs reflect the hard cut with no second attachment-owner path left in assistant-engine.

## Scope

- In scope:
- Contracts/core/query/assistant-engine attachment seams for document, meal, workout, and body-measurement events
- Vault layout/constants/docs updates for canonical raw workout and measurement roots
- Focused tests and direct manifest/record scenario proof
- Out of scope:
- Broad inbox/gateway attachment contracts
- Non-event attachment families beyond the current vault-owned record types

## Constraints

- Treat this as greenfield and prefer a hard cut over preserving parallel write-time truths.
- Keep canonical vault writes owned by `packages/core`.
- Preserve unrelated dirty-tree edits outside this attachment/storage lane.

## Risks and mitigations

1. Risk: Contract changes could break generic event upsert and query normalization.
   Mitigation: Change contracts/core/query together and keep compatibility projections explicit.
2. Risk: Workout and measurement staging could remain partially owned by assistant-engine.
   Mitigation: Move staging helpers into core and delete the assistant-engine-specific raw/media writer path.
3. Risk: Manifest resolution and delete/read flows could miss some retained files during the hard cut.
   Mitigation: Update retained-path extraction and manifest readers to resolve from canonical `attachments[]` first, then keep old fields as fallback only where necessary.

## Tasks

1. Add the canonical attachment contract plus explicit workout/measurement raw roots in contracts/core/docs.
2. Build the shared core attachment staging/helper seam and move document/meal/workout/measurement writers onto it.
3. Update readers, retained-path logic, query normalization, and focused tests to treat legacy file fields as compatibility projections.
4. Run required verification, required review, and a scoped commit.

## Decisions

- Use one event-level `attachments[]` collection as the canonical write-time truth.
- Keep `manifest.json` and raw directories; do not replace the file-native vault model.
- Keep legacy file-specific event fields only as derived compatibility outputs during this cut.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
- Focused Vitest runs for touched attachment/storage suites as needed
- Expected outcomes:
- Contracts/core/query/assistant-engine attachment flows pass package verification and the direct attachment-manifest scenario proof.
- Actual outcomes:
- `pnpm typecheck` still fails in unrelated dirty-tree work under `packages/contracts/src/relation-links.ts`.
- `pnpm exec vitest run packages/core/test/core.test.ts -t 'copyRawArtifact enforces raw immutability and importDocument appends contract-shaped events|photo-only meals preserve an empty audioPaths array in the stored event|note-only meals stay first-class meal events without raw artifacts|meal, journal, experiment, and samples mutations write expected contract data|validateVault accepts workout and measurement raw manifest directories' --no-coverage` passed.
- `pnpm exec vitest run packages/query/test/query.test.ts -t 'readVault preserves canonical event attachments for downstream readers' --no-coverage` passed.
- `pnpm exec vitest run packages/cli/test/cli-expansion-workout.test.ts -t 'workout add rejects structured payload attachments that bypass canonical staging|workout measurements reject structured payload attachments that bypass canonical staging' --no-coverage` passed.
- Direct module-level `tsx` scenario proof passed for structured workout input plus workout/measurement media staging and canonical attachment persistence.
Completed: 2026-04-07
