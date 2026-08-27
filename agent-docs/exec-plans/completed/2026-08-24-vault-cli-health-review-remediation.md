# Vault CLI health recovery review remediation

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Resolve the two accepted review findings without widening the recovery
  architecture: reject impossible local dates at the shared native boundary
  and preserve Zod union alternatives in bounded model-facing repair fields.

## Scope

- Replace the shared local-date regex with Zod's JSON-schema-representable ISO
  date primitive while retaining downstream domain validation.
- Teach the existing public Zod-issue repair helper to choose the most relevant
  union branch and collapse required alternatives into one field.
- Reuse that helper for blood-test option parsing and remove the duplicate CLI
  issue mapper.
- Add owner and built-CLI proof for impossible dates, result alternatives,
  reference-range alternatives, enum choices, non-echo, and no writes.

## Constraints

- Preserve the current reviewed head and unrelated work.
- Keep repair values bounded and schema-derived; never echo submitted health
  values.
- Regenerate only affected contract/config artifacts and finish with one scoped
  commit. Do not push, mutate the PR, or start ReviewGPT.

## Verification

- Focused operator-config, vault-usecases, and CLI tests.
- Touched-package typechecks, CLI config generation/package-shape verification,
  diff/privacy review, and a clean scoped commit.

## Outcome

- `localDateSchema` now uses `z.iso.date()`, so impossible dates fail native
  option parsing while downstream domain checks remain intact. The generated
  CLI schema now carries the date format and calendar-aware pattern.
- The existing public validation-repair helper now chooses the lowest-error
  union branch and collapses single-field branches into one bounded alternatives
  field. Blood-test options reuse that helper and delete their duplicate mapper.
- Built-CLI tests prove the impossible assertion date and all three blood-test
  recovery cases return exact non-echo envelopes and create no ledger files.
- Operator-config owner tests pass with 5 tests, focused vault-usecases tests
  pass with 45 tests, focused CLI tests pass with 61 tests, all three touched
  package typechecks pass, and CLI package-shape verification is green.

Completed: 2026-08-24
Completed: 2026-08-24
