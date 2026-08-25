# Vault CLI diagnostic preservation

Status: active
Created: 2026-08-24
Updated: 2026-08-25

## Goal

Preserve bounded, actionable Vault CLI error detail through the model-facing
envelope so a caller can correct a failed command instead of receiving a
generic error.

## Success criteria

- Known owner hints and finite validation paths reach the final envelope.
- Stable core error codes and useful bounded messages survive projection.
- Concrete home-directory and credential shapes remain masked.
- Ordinary diagnostic prose and harmless absolute paths are not erased.
- Assistant guidance treats a precise bounded message as correction evidence.
- Source, built-runtime, type, docs, boundary, bundle, and review gates pass.

## Scope

- In scope: the shared operator-config projector and path masking helper,
  assistant CLI recovery guidance, matching architecture guidance, and focused
  CLI/setup/provider regression tests. The exact-head review also proved that
  the existing read-only Mapbox and hosted-label owners need bounded transport
  and HTTP retry classification before their failures reach that projector.
- Out of scope: persisted error logs, retry supervisors, internal retry loops,
  or new recovery state.

## Evidence

- The reviewed projector replaced every unrecognized exception with the same
  `UNKNOWN` sentence, dropped `VaultCliError.context.hint`, ignored ordinary
  owner-wrapped schema paths, and masked every absolute filesystem path.
- Core `VAULT_INVALID_INPUT` failures already carry precise correction text,
  but the projector discarded both that stable code and its message.

## Design

- Keep one projector and one structured metadata owner.
- Bound messages, hints, codes, field counts, and paths at the projector.
- Let explicit `publicPath` override an ordinary finite owner issue path.
- Preserve exact diagnostic messages after narrow home-directory and
  credential-shape masking.
- Infer `validation` only from accepted owner issues or the stable core invalid
  input code.
- Classify read-only provider transport and HTTP failures at the Mapbox and
  hosted-label owners. Treat timeouts, ordinary transport failures, rate limits,
  and 5xx responses as retryable; treat cancellation, credentials, and other
  4xx responses as terminal.
- Permit at most one unchanged retry of a read-only command in assistant
  guidance. Never retry an unchanged write.

## Tasks

1. Update the projector, masking helper, and assistant recovery guidance.
2. Update focused source and bridge regressions plus durable architecture docs.
3. Run focused tests, affected typechecks, docs and workspace gates.
4. Run prepared-runtime, bundle, and parity proof.
5. Commit, push, update the PR evidence, and run exact-head review with CI.

## Progress

- Implemented bounded message, hint, stable-code, and owner-path projection.
- Narrowed path masking to home-directory shapes and retained credential-shape
  masking at the model-facing projector.
- Updated assistant recovery guidance and architecture ownership docs.
- Focused source and bridge suites pass 114 tests; affected package typechecks
  pass.
- Prepared-runtime construction and five release-shaped CLI suites pass 116
  tests; CLI package-shape verification passes.
- Docs drift/gardening and workspace boundary/cycle checks pass.
- Production bundle assembly and all eight parity probes pass. Vault CLI is
  9,454,722 of 9,467,648 bytes; the runner is 11,271,765 of 11,393,617
  bytes.
- ReviewGPT round 2 found that untyped Mapbox failures and label failures with
  no retry context were incorrectly projected as terminal. The finding was
  accepted and remediated at the read-only owners. Timeouts, ordinary transport
  failures, and 5xx responses are retryable; cancellation, credentials, and
  non-transient 4xx responses are terminal. Assistant guidance permits at most
  one unchanged read retry and forbids unchanged write retries.
- Focused source proof passes 80 CLI tests and 15 assistant guidance tests;
  affected CLI and assistant-engine typechecks pass.
- Prepared-runtime proof passes 106 focused release-shaped CLI tests. An
  additional compiled `dist/bin.js` battery passes all 21 route, food-label,
  and supplement-label transport/status scenarios and proves they leave no
  files behind.
- Docs drift/gardening, workspace boundary/cycle checks, and CLI package shape
  pass.
- Production bundle assembly and all eight parity probes pass after the review
  fix. Vault CLI is 9,457,933 of 9,467,648 bytes; the runner is 11,271,843 of
  11,393,617 bytes.
- ReviewGPT round 3 found that hosted-label ownership stopped after HTTP status
  classification, so successful-response body and schema failures fell back to
  generic projection. The finding was accepted and remediated by replacing the
  raw `Response` handoff and separate parsers with one typed request owner that
  fetches, checks status, reads the body, and validates the provider schema.
  Response-body transport failures are retryable; malformed or schema-invalid
  successful responses are explicit terminal provider-response failures and do
  not masquerade as model-correctable field errors.
- Focused source proof now passes 60 active food, supplement, and shared
  provider-recovery tests (29 prepared-runtime cases skipped), plus seven
  assistant guidance tests; affected CLI and assistant-engine typechecks pass.
- Prepared-runtime construction, the 60-case compiled provider battery, CLI
  package shape, docs, workspace boundaries, and package-cycle checks pass.
  Production bundle assembly and all eight parity probes pass; Vault CLI is
  9,459,361 of 9,467,648 bytes and the runner is 11,271,843 of 11,393,617
  bytes.
