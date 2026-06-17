# Workout payload schema

## Goal

Expose the `workout import-json --input @file.json|-` file-body contract through
the new Murph `payload-schema` discovery surface so agents can use the compact
structured workout JSON path instead of verbose repeated shell flags.

Success criteria:

- `vault-cli workout payload-schema --format json` returns the exact workout
  import payload JSON Schema envelope.
- `workout import-json` validates payloads through the same Zod schema used by
  the schema command.
- The schema exposes `strengthExercises[]` as the compact repeated-set input
  DTO and the existing `workout` canonical nested session payload.
- Focused CLI tests and direct built-CLI scenario checks pass.

## Scope

- In: workout import payload schema, workout payload-schema command, workout CLI
  discovery/tests/docs.
- Out: canonical nullable workout duration migration, broad health noun
  payload-schema rollout, Incur framework changes.

## Constraints

- Keep the change small and composable; reuse existing workout schema and
  expansion primitives.
- Preserve existing `workout import-json --input @file.json|-` compatibility.
- Do not add another workout mini-language or another note field.
- Do not expose local identifiers, secrets, or user personal identifiers in
  files, logs, docs, or commits.

## Plan

1. Add a shared strict workout import payload Zod schema.
2. Validate workout import payloads through that schema before normalization.
3. Add a `workout payload-schema` command that emits the Murph payload-schema
   envelope.
4. Update focused tests, generated CLI metadata, and command docs.
5. Run focused CLI verification, required completion review, and commit through
   `scripts/finish-task`.

## Current State

- Schema, usecase validation, CLI command registration, manifest discovery,
  focused tests, generated artifacts, and docs are edited.
- Verification passed: root `pnpm typecheck`, contracts tests/artifacts,
  focused CLI tests, vault-usecases workout coverage, and a built-CLI compact
  stdin import smoke.
- Broad `pnpm test:diff ...` was attempted; after the initial current-change
  failure was fixed, the rerun hit an unrelated assistant-cli startup timeout
  that passed on immediate package rerun.
- Required `coverage-write` audit found one proof gap for top-level canonical
  `WorkoutSession` import payloads; it added focused vault-usecases test proof.
- Next: final checks and commit through `scripts/finish-task`.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
