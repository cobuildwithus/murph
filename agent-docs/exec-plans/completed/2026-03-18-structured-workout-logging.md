# structured workout logging

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Improve `workout add` and `activity_session` records so explicit strength-training notes can retain machine-readable exercise structure in addition to the preserved freeform note.

## Success criteria

- `activity_session` contract allows optional structured strength exercise data without changing existing required fields.
- `vault-cli workout add` still preserves the original note and existing cardio behavior, but now emits structured exercise details when the note contains explicit strength-set information.
- `event show` exposes the stored structured strength data through the normal read path.
- Contracts, docs, fixtures, and focused tests all reflect the new shape.

## Scope

- In scope:
  - extend the `activity_session` contract with optional strength-session exercise fields
  - infer structured exercise data from explicit freeform strength notes in `workout add`
  - update result schemas, examples, docs, and workout tests
- Out of scope:
  - broad NLP for arbitrary workout prose
  - introducing a new standalone workout record family
  - changing device-provider workout normalization beyond keeping compatibility with the expanded contract

## Risks and mitigations

1. Risk: overfitting the contract to one note pattern.
   Mitigation: keep the new structure optional and narrowly scoped to clear strength-set semantics while preserving `note` as the source-of-truth fallback.
2. Risk: breaking existing activity-session imports or query reads.
   Mitigation: do not change existing required fields or ids; add only optional fields and cover the write/read path with focused tests.
3. Risk: doc drift from the contract change.
   Mitigation: update the command-surface and record-schema docs in the same change and regenerate the schema artifact.

## Tasks

1. Add the optional strength exercise shape to the `activity_session` contract and example payloads.
2. Update workout quick-capture to infer structured exercise details from explicit strength notes.
3. Extend CLI result contracts/tests and docs to surface the new data.
4. Run the required verification flow and commit the scoped files.

## Verification

- Required: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Focused: `pnpm --dir packages/contracts generate`, `pnpm --dir packages/cli test -- --run cli-expansion-workout`
Completed: 2026-03-18
