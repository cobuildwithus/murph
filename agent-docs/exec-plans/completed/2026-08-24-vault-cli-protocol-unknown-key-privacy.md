# Vault CLI protocol unknown-key privacy

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Prevent submitted protocol key names from becoming validation paths when the
  core schema reports `unrecognized_keys`.

## Success criteria

- Core collapses every `unrecognized_keys` issue to its fixed structural parent
  path and never appends submitted key names.
- Core and built-CLI protocol-import tests use an identifier-shaped private key
  and value, prove neither reaches error metadata or the final envelope, and
  prove the rejected mutation writes neither protocol nor audit state.
- Stored-state classification and existing food/recipe behavior remain intact.
- Focused tests, affected typechecks, package shape, runner bundle/parity,
  workspace boundaries, privacy/diff scans, and Frog inspection pass.

## Scope

- In scope: protocol validation-field normalization in the Core owner and its
  direct plus built-CLI regression proof.
- Out of scope: shared projector or `publicPath` changes, food/recipe behavior,
  new validation vocabularies, stored-state reclassification, or ReviewGPT.

## Product UX

- Effort: Patch.
- Affected journey: an assistant imports a protocol containing an unsupported
  field whose syntactically ordinary name is nevertheless private input.
- Result: the assistant receives the fixed parent path needed to correct the
  object, while the submitted key/value and vault state remain private and the
  failed import remains non-mutating.

## Tasks

1. Collapse Core `unrecognized_keys` metadata to the structural parent path.
2. Add Core no-echo/no-write proof and update stored-state expectations.
3. Add full built-CLI protocol-import envelope and no-write proof.
4. Run focused verification, inspect Frog and the diff, close the plan, commit,
   push, and refresh the Draft PR body without launching ReviewGPT.

## Verification

- Focused Core protocol and CLI built-smoke tests.
- Core and CLI typechecks; CLI package shape; workspace boundaries; canonical
  runner bundle/parity; privacy, deprecated-API, unsafe-cast, conflict-marker,
  and whitespace scans.
- Result: Core protocol tests passed (8 tests); the full built-CLI smoke suite
  passed (70 tests); protocol, food, and recipe parity passed (27 tests); Core
  and CLI typechecks, CLI package shape, workspace boundaries, Frog inspection,
  and production runner bundle/parity passed. Static scans passed before commit.

## Decisions

- The Core schema owner discards `issue.keys` entirely for
  `unrecognized_keys`; the structural `issue.path` is sufficient recovery
  guidance and cannot contain the rejected submitted key name.
- The shared projector and its future `publicPath` correction remain untouched.
- The rejected built import is proven non-mutating by byte-snapshotting every
  file in the initialized vault, which includes protocol and audit state.
Completed: 2026-08-24
