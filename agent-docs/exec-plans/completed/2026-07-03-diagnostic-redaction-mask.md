# Mask-in-place diagnostic redaction for provider error text

## Why

PR #366 exposed that our shared diagnostic redactor is too brittle to debug
provider failures: `sanitizeHostedRuntimeDiagnosticText` dropped the entire
string whenever any unsafe span matched (long token, identifier assignment,
token phrase, or any bracket character). In prod, Junction's Garmin
`sleep_cycle`/`electrocardiogram` 422 bodies produce a description our gate
nulls out, so `junctionSkippedResourceLastDetail` persisted as null and we
still cannot see why the endpoints 422. Provider-diagnostics extraction also
only understood array-shaped nested error containers, so object-shaped
`{"detail": {...}}` bodies yielded no description at all.

## Change

- `sanitizeHostedRuntimeDiagnosticText` now masks unsafe spans in place:
  identifier assignments keep the key and mask the value (`<redacted-id>`),
  token phrases and 32+ char opaque tokens become `<redacted-token>`. Only raw
  structured payload dumps (quoted-key colons) still fail closed, and the
  JSON-fragment gate no longer treats bare brackets as unsafe, so bracketed
  validation prose survives.
- `provider-diagnostics` nested error containers accept an array, a single
  object, or a single string (`readNestedErrorEntries`), so object-shaped
  `detail`/`errors` bodies yield a code/description.

## Invariants

- Secrets, JWTs, bearer tokens, URLs, paths, emails, phones remain redacted
  (base `sanitizeHostedRuntimeErrorString` behavior unchanged).
- Long opaque tokens and identifier values never appear in logs or metadata —
  they are masked, not dropped.
- Raw structured payload dumps still fail closed to null.
- Shared redactor semantics change applies to all consumers (device-syncd
  service/junction/shared-oauth and apps/web device-sync diagnostics).

## Verification

- `pnpm --dir packages/device-syncd typecheck` + `test` — 659 tests pass,
  including new sanitizer unit tests and two end-to-end Junction regressions
  (UUID-in-prose 422 detail masked and persisted; object-shaped detail body
  extracted).
- `pnpm test:diff` from the worktree root before handoff.
Status: completed
Updated: 2026-07-03
Completed: 2026-07-03
