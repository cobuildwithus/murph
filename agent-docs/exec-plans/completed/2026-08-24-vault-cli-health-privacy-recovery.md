# Vault CLI health privacy recovery

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Keep health-validation recovery field-specific without exposing submitted
  measurement qualifier keys or values in the model-facing CLI envelope.
- Give typed supplement ingredient failures the same structured, value-free
  field recovery as the fixed health payload schemas.

## Product UX Patch

- Outcome: invalid health inputs identify the stable field the model should
  repair without echoing submitted health data.
- Reaches: `vitals import-json` and typed supplement ingredient save failures.
- Proof: built/full-envelope assertions show stable field paths, sentinel
  absence, and no canonical write after validation rejection.

## Scope

- Sanitize vitals Zod issues at the clinical-import schema owner by truncating
  measurement qualifier paths at the `qualifiers` record parent.
- Retain the encounter-local sanitizer and leave the shared error projector to
  its parent-owned remediation.
- Replace supplement ingredient string validation errors with raw structured
  Zod issues from its fixed strict schema while retaining bounded user guidance.
- Add focused usecase and built-CLI recovery/non-echo/no-write proof.

## Constraints

- Work only on PR #2209 and preserve unrelated work.
- Do not move health schema knowledge into operator-config.
- Do not launch ReviewGPT; keep the PR Draft.
- Stop if a new substantive review result is reported.

## Verification

- Focused vault-usecases and CLI tests for clinical imports and supplement
  save.
- Touched-package typechecks, diff/privacy review, scoped commit, push, and PR
  body refresh.

## Outcome

- Vitals import validation now truncates any issue below the dynamic
  `qualifiers` record to the stable `measurements.<index>.qualifiers` owner
  path before the error reaches the shared CLI envelope.
- Typed supplement ingredient validation now supplies structured Zod issues,
  preserving field-specific recovery for the fixed schema without parsing
  human-readable validation strings.
- Focused usecase and built-CLI tests prove stable repair fields, absence of
  submitted sentinel keys and values from the full error envelope, and no
  canonical health write after rejection.
- Both touched packages pass typecheck; the three focused suites pass 20 tests.
Completed: 2026-08-24
