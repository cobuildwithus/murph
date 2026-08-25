# Vault CLI diagnostic preservation

Status: active
Created: 2026-08-24
Updated: 2026-08-24

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
  CLI/setup/provider regression tests.
- Out of scope: command-specific provider taxonomies, persisted error logs,
  retry supervisors, or new recovery state.

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
