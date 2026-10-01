# Make typed goal updates fail closed

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Make typed `vault-cli goal save --id` a true update-only operation: a
  well-formed but absent goal id returns a safe `not_found` error and cannot
  create a goal, audit row, or canonical write operation.

## Success criteria

- `goal save --id <missing-id>` exits unsuccessfully with typed code
  `not_found` and a bounded recovery hint.
- The missing-id decision happens after selector resolution while the canonical
  `bank/goals` resource lock is held, before any canonical or audit write.
- `goal save` without `--id` still creates a goal.
- `goal save --id <existing-id>` still updates that exact goal and preserves
  concurrent partial-update merging and selector-conflict behavior.
- JSON import and ordinary core upsert callers retain their existing create-or-
  update semantics.
- Focused core and CLI tests plus package typechecks pass.

## Scope

- In scope:
  - the typed goal save command;
  - goal core input semantics needed to express update-only intent;
  - safe CLI error projection and focused regression coverage.
- Out of scope:
  - other CLI families;
  - changing `goal import-json` or ordinary `upsertGoal` behavior;
  - unrelated assistant prompts, tool schemas, or replies.

## Constraints

- Technical constraints:
  - no CLI pre-read or other check-then-write race;
  - no second canonical mutation owner;
  - keep the absent-id path write-free, including audit and operation metadata.
- Product/process constraints:
  - Product UX Patch affecting agents that use the typed CLI;
  - preserve unrelated working-tree changes and do not commit, push, or open a
    PR in this delegated lane.

## Risks and mitigations

1. Risk: update-only intent accidentally changes import/upsert behavior.
   Mitigation: make the intent opt-in and exercise both no-id creation and
   existing-id update behavior.
2. Risk: mapping a raw core error leaks implementation details or produces an
   unusable code.
   Mitigation: map only the known missing-goal code to a bounded `not_found`
   envelope with an agent-actionable list/show recovery path.
3. Risk: a preflight existence read races another writer.
   Mitigation: resolve and reject the absent selector inside the existing
   canonical goal resource lock.

## Tasks

1. [completed] Add opt-in update-only semantics to the locked canonical goal
   writer and use it only for typed `goal save --id`.
2. [completed] Add core and CLI regressions for absent-id no-write, no-id create,
   existing-id update, selector conflicts, and concurrent partial updates.
3. [completed] Run focused tests and typechecks, walk the affected agent journeys,
   and inspect the final diff for secret or identifier leakage.

## Decisions

- Keep `upsertGoal` as the single canonical mutation owner; express update-only
  intent as an optional input flag rather than adding a CLI pre-read or a second
  writer.
- Do not add a real-Codex journey: this patch changes deterministic mutation and
  error semantics only; it does not change assistant prompt guidance, tool
  availability, argument selection, or reply composition.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config packages/core/vitest.config.ts --no-coverage packages/core/test/health-bank.test.ts`;
  - `pnpm exec vitest run --config packages/cli/vitest.config.ts --no-coverage packages/cli/test/health-goal-save.test.ts`;
  - `pnpm --dir packages/core typecheck`;
  - `pnpm --dir packages/cli typecheck`.
- Outcomes:
  - core focused suite passed: 33 tests;
  - CLI focused suite passed: 4 tests;
  - both package typechecks passed;
  - the missing-id regression uses a slug owned by an existing goal and proves
    the exact goal, audit shard, and write-operation list remain unchanged;
  - walkthrough confirms no-id create, exact-id update, missing-id recovery,
    selector conflict, and concurrent partial-update journeys.
Completed: 2026-08-30
