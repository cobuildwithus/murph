# Remove the completed Garmin credential migration transport

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Remove the temporary credential transport after the completion owner confirmed
all five target Environment imports and deletion of the encrypted artifact.

## Success criteria

- Remove the four temporary workflow, sealer, and synthetic-proof files.
- Remove only their temporary security exception, operator procedure, and index
  clause; preserve the original completed plan and unrelated auth documentation.
- Prove surviving Garmin controller behavior, workflow syntax, documentation
  consistency, privacy, and exact deletion scope.

## Scope and ownership

This is repository cleanup only. The parent owns review, merge, controller
restoration, actual private canary verification, and eventual source-secret
retirement. No provider, GitHub Environment, workflow-state, or artifact mutation
belongs to this task.

## Risks and mitigations

- Removing live canary behavior: delete only the four exact temporary paths and
  run the existing controller and workflow boundary tests.
- Damaging unrelated documentation: remove exact delimited migration sections;
  compare every other byte against the task base.
- Losing historical evidence: keep the original completed migration plan
  unchanged and close this cleanup plan through the standard task wrapper.

## Tasks

1. Create an isolated checkout from current main and inspect the explicit removal scope.
2. Delete the completed transport and temporary operating guidance.
3. Verify surviving behavior, docs, privacy, and scoped diff.
4. Commit and open a draft PR for the completion owner.

## Verification

- Existing public controller tests: 11 passed. Existing wearable workflow boundary
  tests: 6 passed. Surviving canary actionlint passed.
- Docs drift, doc gardening, and whitespace checks passed. Exact removal and
  historical-plan preservation checks passed; no operating references to the
  removed transport remain. Scoped privacy checks passed.
- Typecheck and JS/TS complexity are not applicable: this task deletes complete
  temporary Python/CI owners and changes no surviving executable source.
- No product behavior changes; no member-facing UX or changelog entry.
Completed: 2026-09-10
