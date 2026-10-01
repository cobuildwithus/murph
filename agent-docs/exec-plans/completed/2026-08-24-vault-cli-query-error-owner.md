# Collapse Query recovery into the final CLI projector

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Make the final Vault CLI projector the only owner of model-facing Query-source
  recovery so every service-backed and direct Query entry preserves one truthful,
  privacy-safe disposition without changing the Query runtime module or function
  identities.

## Success criteria

- Raw safe `QUERY_SOURCE_INVALID` details reach exact final envelope codes,
  fields, stages, and guidance through the final projector.
- `unsupported_format` is terminal and directs the model to a compatible runtime
  or supported migration path, never manual `vault.json` editing.
- Malformed Markdown/JSON remains safely repairable with bounded relative
  diagnostics and no private-data echo.
- Representative service-backed and direct-import preflights prove exact final
  envelopes and no mutation after failure.
- Query runtime loaders return the owner module and functions unchanged.
- Generic CLI startup no longer imports the Health Commons runtime graph; its
  fixed safe public artifact-error shape is recognized structurally.
- Focused tests, package typechecks/build, import-surface proof, and production
  bundle assembly pass before any size ratchet is considered.

## Scope

- In scope: final Query and Commons artifact projection, removal of the Query
  proxy/mapping owner, final-envelope regression coverage, import/bundle proof,
  the required anomaly retrospective, and a local scoped commit.
- Out of scope: retries, compatibility state, automatic migration, manual
  metadata repair, alternate protocol authority, deployment, push, PR metadata,
  or another ReviewGPT round.

## Constraints

- Technical constraints: keep privacy-safe structural recognition narrow; do not
  add another wrapper or owner; preserve existing strict/tolerant reader
  contracts and no-write preflights.
- Product/process constraints: preserve the immutable first-reviewed baseline;
  re-measure before changing any ratchet; commit locally but do not push or edit
  PR metadata until the parent reviews exact evidence and diff.

## Risks and mitigations

1. Risk: Central structural projection accepts unsafe or spoofed details.
   Mitigation: require the fixed code and allowlist issue, relative path, line,
   field, category, and artifact values before emitting them.
2. Risk: Deleting the proxy loses recovery on one caller family.
   Mitigation: test both service-backed and direct-import final envelopes through
   the existing CLI projector/bridge.
3. Risk: A local platform size measurement invites an incorrect production cap.
   Mitigation: measure first, preserve the Linux cap unless authoritative Linux
   evidence later proves a deliberate remaining increase.

## Tasks

1. [x] Record the retrospective decision and inspect Frog before any workaround.
2. [x] Delete the Vault Usecases Query proxy/mapping owner and restore exact runtime
   identity.
3. [x] Add narrow Query-source and Commons artifact recognition to the final CLI
   projector with truthful unsupported-format guidance.
4. [x] Add final-envelope/no-write/non-echo coverage across service and direct paths.
5. [x] Run focused tests/typechecks/build, import-surface proof, and bundle assembly;
   remediate only proven failures and re-measure before a ratchet.
6. [x] Inspect the final diff/privacy boundary and create a local scoped commit.

## Decisions

- Anomaly retrospective:
  - Original requirement: replace generic Vault CLI failures with one truthful,
    privacy-safe model disposition that survives every supported production
    entry without unsafe retries, writes, or private-data echo.
  - First-reviewed shape: Query owned a safe taxonomy, Vault Usecases added a
    125-line proxy/mapper, and the CLI retained a separate final projector.
  - Current reviewed shape: remediation added 207 source lines and removed 93,
    fixed reader ownership and Commons classification, but added
    `unsupported_format` below the unchanged Query proxy. The proxy collapsed it
    into generic `query_source_invalid`, while direct Query imports bypassed the
    mapper and could reach `UNKNOWN`. This repeated the prior Commons mechanism:
    a lower-layer category did not survive the authoritative final envelope.
  - Decision: delete the intermediate proxy/mapping concept and reuse the
    existing final CLI projector as the sole Query-source disposition owner.
    Keep the owner Query module unchanged; use narrow structural recognition at
    the final boundary. Likewise remove the eager Commons runtime import and
    recognize only its fixed safe public error shape. This is deletion and
    ownership collapse, not another tactical guard or compatibility mechanism.
  - Continuation is justified because the direction removes one production
    owner/concept, restores existing identity/import contracts, and supplies
    final-envelope proof for every materially different entry family.
- Frog inspection found no qualifying new repository friction: the release
  import, identity, and bundle gates correctly exposed missing local proof. The
  existing package typecheck/build Frog entry remains the applicable tooling
  record.
- The corrected foundation disposition removed the PR-authored repair object,
  its helper, and the fourth `VaultCliError` constructor argument instead of
  renaming that channel. Stable errors and bounded `context.issues` now feed the
  final projector directly. Query, Commons, and filesystem failures construct
  their final envelopes at that boundary; the one ambiguity-critical memory
  instruction lives in its stable error message.
- Re-measurement rejected a temporary static stable-error guidance table: it
  left the production CLI 1,222 bytes over budget and duplicated information
  already carried by stable codes, messages, and retryability. Deleting the
  table reduced concepts and brought the exact bundle 1,042 bytes below the
  unchanged cap.

## Verification

- Commands to run: focused CLI/Vault Usecases/Query tests, affected package
  typechecks and Vault Usecases build, built CLI import-surface contract, runner
  bundle boundary tests, and production runner assembly/parity.
- Expected outcomes: exact actionable final envelopes, no mutation or private
  echo, preserved runtime identity, scoped import surface at or below its
  existing ceiling, and bundle totals measured before any ratchet decision.
- Results:
  - CLI affected journeys: 8 files and 159 tests passed; final focused rerun:
    4 files and 52 tests passed.
  - Vault Usecases identity/helper proof: 4 files and 32 tests passed; full
    coverage: 44 files and 369 tests passed.
  - CLI, Vault Usecases, and operator-config typechecks passed; affected package
    builds passed.
  - Built import-surface contract passed; `condition list --format json`
    resolved exactly 288 modules against a 289-module ceiling.
  - Runner CLI bundle boundary passed 14 tests. Full production assembly passed
    with 9,481,450 bytes against the unchanged 9,482,492-byte budget, and every
    bundle parity probe passed.
Completed: 2026-08-24
