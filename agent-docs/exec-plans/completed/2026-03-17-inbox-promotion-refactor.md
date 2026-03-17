# Inbox promotion refactor

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Replace duplicated inbox promotion helper branches in `packages/cli/src/inbox-services.ts` with a small target-spec-driven layer while preserving current CLI behavior.

## Success criteria

- Meal and document canonical-promotion lookup share the same manifest-scan/match flow with target-specific rules injected by spec.
- Promotion-store upserts share one helper across meal, document, journal, and experiment-note targets.
- Journal and experiment-note markdown insertion share one bounded-section helper and one shared capture-block builder with target-specific headings or extra lines injected by spec.
- Existing section headings, marker comments, duplicate-match errors, and CLI result payloads remain unchanged.
- Focused tests keep proving idempotency and canonical-promotion behavior after the refactor.

## Scope

- In scope:
  - `packages/cli/src/inbox-services.ts` promotion helper refactor
  - focused inbox promotion regression coverage in existing CLI tests
- Out of scope:
  - new inbox promotion targets
  - changes to public command schemas or output shapes
  - non-promotion inbox/runtime behavior

## Constraints

- Preserve behavior exactly for current targets unless existing tests explicitly require otherwise.
- Keep duplicate canonical match detection and invalid local-state failures intact.
- Avoid broad churn outside the promotion helper layer.
- Run required repo verification and completion-workflow audit passes before handoff.

## Tasks

1. Introduce shared promotion target specs and generic helpers for canonical lookup, store upsert, markdown section insertion, and block construction.
2. Rewire meal, document, journal, and experiment-note promotion flows to use the shared promotion helpers without changing return shapes or write ordering.
3. Add or adjust focused tests only where needed to prove output parity and idempotency.
4. Run required checks and audit passes, then commit only the touched files.
Completed: 2026-03-17
