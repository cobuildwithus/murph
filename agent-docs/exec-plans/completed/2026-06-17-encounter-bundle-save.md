# Encounter bundle save

## Goal

Add a clean encounter-centered save surface for imported clinical records so assessment text, plan text, visit diagnoses, vitals, and ordered procedures can be preserved without flattening everything into notes.

Success criteria:

- Encounter events can persist bounded clinician, facility, assessment, plan, reason, follow-up, instructions, and visit diagnosis fields.
- A single `encounter save --input @file.json|-` command can save an encounter plus linked measurement/procedure/test events.
- Linked child events use canonical `links[]` and shared raw evidence references.
- Existing low-level `event encounter add` behavior remains compatible.
- Focused contract/core/CLI tests and required verification pass.

## Scope

- In: contracts, core history normalization, vault-usecase composition, CLI command, command docs, focused tests.
- Out: OCR/PDF parsing, a new clinical database, broad problem-list reconciliation, hosted UI.

## Constraints

- Preserve canonical write ownership in `packages/core`.
- Keep CLI thin and importer/agent friendly through JSON input.
- Do not introduce a parallel relation model; use `links[]`.
- Keep visit-scoped diagnoses on the encounter unless a later explicit condition write path promotes them.
- Do not expose secrets, raw signed URLs, local identifiers, or direct personal identifiers in code, docs, tests, logs, or commit text.

## Plan

1. Register the active task in the coordination ledger.
2. Extend encounter/procedure contracts and core normalization with the smallest visit-context fields.
3. Add a vault-usecase `saveEncounterBundle` composition over core writes.
4. Add top-level `encounter save --input` CLI wiring and docs.
5. Add focused tests and regenerate CLI metadata if needed.
6. Run verification, required audits, and finish through `scripts/finish-task`.

## State

- Core, contract, usecase, CLI, docs, generated contract schema, and generated CLI metadata are implemented.
- Focused core and CLI tests cover linked child facts, compact CLI output, stdin input, duplicate explicit IDs without partial writes, long generated child titles, and explicit empty child `rawRefs`.
- Required security/privacy, coverage-write, and deep-review passes completed. Accepted findings were fixed: generated child titles are bounded, bundle ID collision checks scan event ledger shards once per bundle, and explicit empty child `rawRefs` no longer inherit encounter refs.
- Final typechecks, focused tests, workspace build, whitespace check, and diff privacy scan passed.
- Now: close plan and commit through `scripts/finish-task`.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
