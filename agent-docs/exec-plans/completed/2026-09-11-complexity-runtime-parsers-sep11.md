# Reduce group runtime parser complexity

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and invariant

Reduce the group tool request/response parser hotspots while preserving every
accepted wire shape, normalization, rejected field, and diagnostic. The existing
hosted-execution parser remains the sole wire validation owner. No persistent
state, public API, assistant schema, or deployed protocol changes.

## Evidence and approach

The complexity guard identifies request complexity 83 and response complexity
149. Both functions interleave independent action families. Extract private
parsers at existing consultation, membership, disclosure, referral, and chat
boundaries; retain action-specific validation and its order. Preserve the
existing legacy normalization paths and signed authority fields.

## Risks and proof

Dispatch mistakes can widen acceptance, drop defaults, or change errors. Run
existing parser/contact-card/referral contracts plus focused dispatch coverage
for malformed actions, unknown fields, and representative legacy defaults.
Run hosted-execution typecheck and the changed-source complexity guard.

## Tasks

1. Inspect action families and existing contract coverage.
2. Extract private action-family parsers without changing wire validation.
3. Add focused contract tests and run tests, typecheck, and complexity guard.
4. Inspect the diff, close the plan, commit, push, and open a draft PR.

## Completion ownership

Parent session owns candidate review, Ready admission, exact-head CI, and
ReviewGPT. Internal refactor has no member-visible changelog or Product UX
change. Deployment skew is unchanged because accepted and emitted shapes stay
identical; no database/provider calls or first-provider input changes.

## Verification results

- Focused Vitest: parser, generated-contact-card, signup-referral-link, and
  group-tool-dispatch-parser suites passed: 4 files, 176 tests, one worker.
- `pnpm --filter @murphai/hosted-execution typecheck`: passed.
- `pnpm complexity:diff`: passed; source debt 194 -> 9; maximum 149 -> 27.
  Public request parser 83 -> 10; response parser 149 -> 17. The current-group
  response helper remains 27 because its group normalization and unavailable
  fallback form one contract; existing shared-projection helper remains 22.
- Full diff reviewed for branch validation order, defaults, legacy acceptance,
  unknown field/status rejection, API stability, and identifier privacy.
- Frog list reviewed after ordinary frozen installation; no new repository
  workaround or task-owned friction entry was needed.
- Parent owns candidate/final review, CI and ReviewGPT on the pushed head.
Completed: 2026-09-11
