# Reject unknown meal import fields before writing

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Make `vault-cli meal import-json` reject unsupported top-level payload fields
  before any canonical meal write, while preserving every documented key and
  legacy path alias.

## Success criteria

- A payload containing an unknown top-level field returns the stable
  `invalid_payload` error instead of reporting a successful meal import.
- The recovery error does not echo the submitted unknown key, its value, or an
  absolute input path.
- The rejected payload creates no meal record.
- All documented payload keys, including `photo`/`photoPath` and
  `audio`/`audioPath`, remain accepted.
- Focused CLI tests and the touched CLI owner typecheck pass.

## Scope

- In scope:
  - Strict validation at the CLI-owned structured meal payload boundary.
  - Privacy-safe recovery copy for unsupported fields.
  - One focused pre-write/non-echo regression in the existing meal parity test.
- Out of scope:
  - Tightening the internal meal importer, whose private orchestration fields
    are intentionally broader than the public CLI payload.
  - Changing meal persistence, nutrition semantics, command topology, or other
    nutrition families.

## Constraints

- Technical constraints:
  - Keep all nine documented top-level keys and both path aliases unchanged.
  - Do not project Zod's submitted unknown-key names into model-visible errors.
  - Validate before invoking the importer or writing any meal artifacts.
- Product/process constraints:
  - Product UX Patch: valid callers see no behavior change; typoed payloads get
    one actionable failure rather than false success.
  - Keep the fix local to `packages/cli` and use existing schemas/helpers.

## Risks and mitigations

1. Risk: Strictness rejects an undocumented field a caller previously included.
   Mitigation: Unknown CLI fields are currently discarded and have no effect;
   preserve every documented key and alias while rejecting only ignored data.
2. Risk: Zod's unrecognized-key issue echoes a submitted key.
   Mitigation: Render a fixed unsupported-field message and assert non-echo.
3. Risk: Validation happens after partial persistence.
   Mitigation: Exercise the real CLI command and verify a subsequent meal list
   remains empty.

## Tasks

1. Make the CLI payload schema strict and sanitize unsupported-field recovery.
2. Add a focused real-command regression proving the error, privacy boundary,
   and zero writes.
3. Run the focused CLI test and touched-owner typecheck, then inspect the diff.

## Decisions

- Keep `packages/importers/src/meal-importer.ts` flexible because internal
  callers legitimately pass `vaultRoot` and `externalRef` there.
- Treat the unknown field name itself as submitted data and omit it from the
  error envelope; enumerate the finite supported surface instead.
- No real-Codex journey is needed because this patch does not change prompts,
  tool schema/catalog, routing, or reply policy; the owned behavior is fully
  deterministic at the CLI validation boundary.

## Verification

- Commands to run:
  - `pnpm exec vitest run packages/cli/test/meal-add-typed-parity.test.ts`
  - `pnpm --filter @murphai/murph typecheck`
- Expected outcomes:
  - The focused meal suite passes, including the new non-echo/no-write case.
  - CLI TypeScript compilation passes without casts or generated drift.

## Outcome

- `meal import-json` now rejects unsupported top-level fields before calling the
  importer, while every documented field and alias remains unchanged.
- Unsupported-field recovery uses fixed copy plus the finite payload shape, so
  the submitted key, value, and file path do not appear in the error envelope.
- The focused regression proves the failed invocation leaves the meal list at
  zero records.

## Reaches

- Production code: `packages/cli/src/commands/meal.ts` only.
- Regression proof: `packages/cli/test/meal-add-typed-parity.test.ts` only.
- No command topology, generated CLI artifacts, importer contracts, persisted
  schemas, provider inputs, or deployment surfaces changed.

## Proof

- `pnpm exec vitest run packages/cli/test/meal-add-typed-parity.test.ts`
  passed: 1 file, 12 tests.
- `pnpm --filter @murphai/murph typecheck` passed.
- `git diff --check` passed.

## Progress

- 2026-08-30: Confirmed unknown CLI fields were silently discarded, while the
  internal importer intentionally accepts broader orchestration fields.
- 2026-08-30: Implemented the strict CLI boundary and privacy-safe error copy.
- 2026-08-30: Added and passed the real-command pre-write/non-echo regression.
- 2026-08-30: Passed the focused CLI suite and CLI owner typecheck; candidate is
  ready for the parent-owned review, commit, push, and PR gates.
Completed: 2026-08-30
