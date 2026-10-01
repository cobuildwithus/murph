# Reduce Junction origin parsing cost

Status: completed

## Outcome and invariants

Reduce background import CPU by deleting repeated path splitting and discarded
identity extraction. Preserve source alias precedence, opaque source identities,
malformed-object rejection, timestamp semantics, and all normalized outputs.
The importer remains the owner; no cache, dependency, state, scheduling, or
provider contract changes are needed.

## Evidence and scope

Metadata-only runtime profiling identified origin path traversal in background
Junction normalization. Private incident records remain outside the repository.
The existing resolver splits every constant field path for every sample and
extracts identity components even when an opaque identity already wins.

Keep this patch limited to pure origin resolution and synthetic verification.
Wake timeouts and mailbox checkpoint ordering need separate causal proof before
changing recovery or durability. This patch does not claim to resolve every
source of foreground latency.

## Proof

- Compare baseline and candidate outputs across synthetic aliases and malformed
  inputs, then benchmark alternating resolver runs with identical records.
- Run Junction importer tests, package typecheck, and complexity diff.
- Parent review confirms unchanged attribution and no private data in artifacts.
- Internal refactor: no member-facing behavior or latency guarantee changes;
  no changelog entry or live model journey is warranted.
- Final external review is not routed for a small pure-function optimization
  with unchanged contracts, authority, ordering, and effects.

## Completed evidence

- Junction importer suite: 269 tests passed, including alias precedence, malformed
  nested values, literal dotted keys, null timezone offsets, opaque identifiers,
  canonical snapshot provenance and dense timeseries normalization.
- A temporary source-to-source benchmark verified identical results for ten
  combinations of five synthetic records and two fallbacks. Seven alternating
  baseline/candidate rounds of 50,000 resolutions after 10,000 warmup calls each
  measured median 696 ms before and 355 ms after (49% less resolver time).
  This microbenchmark does not establish an end-to-end production latency gain.
  Temporary baseline, benchmark and result files were removed after inspection.
- `pnpm --dir packages/importers typecheck`: passed.
- `pnpm complexity:diff`: passed; no source hotspot above 20.
- `git diff --check`: passed.
- Root `pnpm exec eslint ...` was unavailable because ESLint is Web-owned and
  this package has no lint script. Typecheck, executable importer tests and
  parent diff review provide the relevant validation for this source-only edit.
- Parent review preserved malformed object rejection, nested path traversal,
  alias ordering, hash inputs and output schema. There is no cache or new owner.
- No new reproducible repository friction required an entry; the absent ledger
  reference already has a tracked Frog entry.

## Completion boundary

Local implementation and verification are complete. No PR, merge or production
release was requested or performed. The separate checkpoint and wake recovery
opportunities remain diagnostic findings, not claimed fixes in this patch.
Updated: 2026-09-24
Completed: 2026-09-24
