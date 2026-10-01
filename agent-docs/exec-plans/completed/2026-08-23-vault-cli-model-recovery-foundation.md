# Vault CLI Model-Recovery Error Foundation

Status: completed
Created: 2026-08-23
Updated: 2026-08-24

## Goal

Give every Vault CLI command one privacy-safe error transport that preserves a
stable domain code, retryability, and bounded repair details through the final
machine-readable envelope.

## Root Cause

- Domain owners often compute exact validation issues, but the CLI-to-Incur
  bridge retains only the code, message, retryability, and exit status.
- Raw exceptions can cross the root boundary as `UNKNOWN` errors with absolute
  local paths or unsafe cause text.
- Invocation-planning failures happen before Incur serves the command, so the
  requested machine format is not honored.

## Architecture

- `@murphai/operator-config` remains the owner of the shared `VaultCliError`
  contract and exposes one explicit, bounded repair-detail shape. Arbitrary
  error context is never serialized.
- The CLI bridge maps that allowlisted shape onto the Incur machine envelope
  while retaining the domain error code.
- One root classifier/redactor handles only exceptions that escaped domain
  mapping. Expected filesystem categories receive stable codes and actions;
  other ordinary errors retain bounded, path-redacted messages so existing
  actionable failures do not regress, while credential/provider-shaped text
  receives a fixed safe fallback.
- The outer CLI entrypoint uses the same error projection for pre-serve
  failures so machine callers receive one transport contract.
- No queue, telemetry service, second error hierarchy, or broad context
  serializer is added.

## Product UX Patch

- Outcome: a model can correct a failed Vault CLI call or choose a truthful
  retry without guessing from a generic error.
- Reaches: existing local and hosted assistant shell calls through `murph` and
  `vault-cli`, including failures before command dispatch.
- Proof: built-CLI JSON/full-output scenarios preserve stable codes and bounded
  field details while non-echo tests exclude submitted values, raw causes,
  provider bodies, and absolute paths.

## Verification

- Unit tests cover repair-detail normalization, deterministic caps, omitted
  counts, and unsafe-text rejection.
- CLI bridge and terminal-envelope tests cover domain code plus field details,
  native Incur validation preservation, and root exception classification.
- Built CLI scenarios cover both ordinary command failures and pre-serve
  invocation-planning failures in the requested machine format.
- Package typechecks and the focused CLI coverage lane run after the final edit.

## Progress

- The exhaustive audit identified the shared bridge, root exception boundary,
  and pre-serve renderer as the two systemic P0 defects and one transport gap.
- `VaultCliError` now owns an explicit bounded repair contract; arbitrary
  context remains private.
- The existing Incur patch now retains domain-coded field errors, hints, and
  operation stages through CLI and HTTP machine envelopes.
- The shared projection classifies expected filesystem failures, converts
  escaped validation failures without raw issue messages, preserves bounded
  path-redacted ordinary failures, and replaces credential/provider-shaped
  exception text with one fixed safe fallback.
- The outer entrypoint now honors explicit formats before `serve()` and defaults
  non-interactive callers to a machine-readable TOON envelope.
- Operator-config and CLI typechecks pass. Operator-config coverage passes with
  354 tests; the full CLI coverage and package-shape lane passes with 1,197
  tests. A built-CLI pre-serve failure honors explicit JSON output and returns a
  stable `invalid_option` envelope without echoing submitted paths.
- Dependency policy and ignored-build checks pass. The dependency audit reports
  the repository's existing vulnerable transitive versions; this change keeps
  the same Incur version and changes only its checked-in patch hash.
Completed: 2026-08-24
