# Safe Extension Guide

## Purpose

This guide is the downstream integration reference for extending the Murph vault contract without drifting away from the frozen contracts in `docs/contracts/` and the package boundaries in `ARCHITECTURE.md`.

## Non-Negotiable Boundaries

- Keep `vault-cli` as the only public command namespace.
- Keep canonical vault writes inside `@murphai/core` only.
- Keep human-facing truth in Markdown (`CORE.md`, `journal/`, `bank/`).
- Keep machine-facing truth in append-only JSONL ledgers (`ledger/events`, `ledger/samples`, `audit`).
- Keep imported source artifacts immutable under `raw/`.
- Keep assistant or session runtime state under `vault/.runtime/operations/assistant/**`, and keep durable user-facing memory plus scheduled assistant configuration in canonical vault records rather than assistant runtime state.
- If a datum is user-facing, queryable, or something future product features will build on, make it a canonical vault noun or an explicit derived materialization immediately; do not prototype it in assistant runtime first.
- Do not introduce SQLite, vector storage, OCR-heavy parsing, semantic search, canonical transcript storage inside the vault, or automatic promotion of chat logs into canonical health state in the current contract.

## Package Roles

| Package | Allowed to do | Must not do |
| --- | --- | --- |
| `@murphai/contracts` | Define shared schemas, types, error codes, and generated contract artifacts | Reach into runtime filesystem behavior |
| `@murphai/core` | Bootstrap vaults, validate state, emit audit records, and perform canonical mutations | Expose an alternate public CLI namespace |
| `@murphai/importers` | Parse external inputs and prepare normalized payloads for core | Write canonical vault files directly |
| `@murphai/query` | Read canonical state and build derived export packs | Mutate vault state |
| `@murphai/cli` | Validate operator input, call package APIs, and format structured output | Bypass core for writes |

## Safe Extension Patterns

### Add a new record family or event kind

1. Update the contract docs first.
2. Add the shared schema/type surface in `@murphai/contracts`.
3. Add validation and canonical write handling in `@murphai/core`.
4. Add importer, query, and CLI support only after the shared contract exists.
5. Add fixtures, smoke coverage, and release-note entries in the same change set.

If a proposed record cannot be represented as Markdown truth plus append-only JSONL, it does not fit the current contract yet.

### Add a new importer

1. Copy the original artifact into `raw/` using stable relative paths.
2. Parse and normalize outside the canonical write path.
3. Call `@murphai/core` for any canonical record creation.
4. Emit enough audit context to explain provenance and failure modes.

Importers may prepare payloads, but they do not decide new canonical storage rules on their own.

### Add a new assistant-facing feature

1. Decide whether the feature creates durable product state or only runtime residue.
2. If it creates durable product state, give it a canonical vault home and owner before implementation.
3. If it is only runtime residue, keep it under `vault/.runtime/operations/assistant/**` with an explicit schema/schemaVersion seam.
4. Do not ship user-facing or queryable feature data in assistant runtime as a temporary shortcut.

Assistant runtime is for sessions, transcripts, receipts, outbox state, diagnostics, locks, and similar execution artifacts. It is not a product-state incubator.

### Add a new device/provider connector

1. Model the provider behind a small adapter in `@murphai/importers` that normalizes upstream payloads into shared device-batch payloads.
2. Preserve immutable provider snapshots under `raw/integrations/<provider>/**` through `@murphai/core`; do not write those files directly from importer code.
3. Attach upstream provenance with shared `externalRef` fields on canonical events/samples so retries dedupe by provider resource id, version, and optional facet.
4. Keep provider secrets, OAuth tokens, and background sync state outside the vault; only immutable payload evidence and canonical normalized records belong in the vault.
5. Avoid inventing unsupported time series. If the upstream API only exposes summaries, normalize summaries into current observations or samples instead of fabricating minute-level streams.

### Add a new query or export

1. Read only from canonical Markdown and JSONL data.
2. Keep generated export artifacts outside canonical source paths.
3. Treat query modules as pure readers with deterministic output from fixture data.

If a query needs to "fix up" data while reading, move that logic into core migration or validation work instead.

### Add a new CLI command

1. Keep the command under `vault-cli`.
2. Validate arguments at the edge.
3. Delegate the actual operation to core, importers, or query packages.
4. Return structured output and normalized contract errors.

Do not let CLI commands write files directly, even for convenience helpers.

### Extend the health model safely

Treat the health model as a contract-first extension. Until the health updates land in `docs/contracts/01-vault-layout.md`, `docs/contracts/02-record-schemas.md`, and `docs/contracts/03-command-surface.md`, this section is downstream integration guidance rather than shipped behavior.

Storage and authority rules for this extension:

- Keep curated current state in Markdown bank docs. This extension keeps Markdown registries for profile, goals, conditions, allergies, protocols, family members, and genetics.
- Keep append-only machine history in JSONL. Assessments, profile snapshots, timed history, samples, and audit records stay ledger-backed rather than becoming mutable Markdown truth.
- Keep `bank/profile/current.md` generated from profile snapshots instead of promoting it to the only source of truth.
- Keep the current-profile seam intentionally split: the snapshot ledger is the durable historical source and rebuild anchor, `bank/profile/current.md` is the human-facing generated page owned by rebuild or repair, and query-side tolerant fallback regenerates the same view in memory when that page is stale, missing, or malformed.
- Keep timed history in the existing `ledger/events` family. New health history kinds such as `encounter`, `procedure`, `test`, `adverse_effect`, and `exposure` extend that ledger instead of creating a second event timeline.
- Keep assessment provenance split across immutable `raw/assessments` inputs and append-only assessment ledgers. Intake projection may return typed proposals, but noun-specific upserts still own canonical writes.

CLI and package-boundary rules for this extension:

- Keep the public surface payload-first. The intended noun pattern is `scaffold`, `upsert --input`, `show`, and `list`, with special cases for `intake import`, `intake project`, `profile current rebuild`, and `protocol stop`.
- Keep canonical writes in `@murphai/core` even when health nouns originate from `@murphai/importers` or `@murphai/cli`.
- Keep `@murphai/query` read-only. If the health read model needs repair logic, move that work into core mutation or validation paths instead.
- If this area looks duplicated, simplify selector/helper plumbing around the seam rather than collapsing the seam itself. Any cleanup has to preserve both human-readable current-profile Markdown and tolerant reads derived from the latest snapshot.
- Do not introduce a generic "apply this assessment" mutation. This extension keeps assessment projection separate from noun-specific writes so operators can review proposals before they become canonical state.

Downstream follow-up stays blocked until the source lanes publish the frozen health contract:

- exact vault paths for the new health registries and ledgers
- schema names, versions, and generated artifact filenames
- canonical examples and smoke fixtures for each health noun
- final CLI grammar and response examples for the payload-first commands

## Integration Checklist

- Contract docs still describe the new behavior truthfully.
- Package ownership remains one-way: `contracts` -> `core`/`importers`/`query`/`cli`, with canonical writes only through core.
- New paths under the vault root preserve Markdown truth, append-only JSONL, and immutable `raw/`, including provider snapshots under `raw/integrations/**`.
- Health-extension changes keep Markdown for curated current state and JSONL for append-only assessments, snapshots, timed history, samples, and audit.
- Device/provider connectors keep upstream provenance on canonical records via shared `externalRef` metadata rather than implicit importer-only state.
- Fixtures and smoke flows cover the new behavior at the public surface, not just internals.
- Verification docs and package scripts are updated if runtime expectations change.
- Release notes explain whether the change is planning-only, contract-only, or operator-visible.

## Red Flags

- Direct filesystem writes from `@murphai/cli`, `@murphai/importers`, or `@murphai/query`
- Canonical state stored outside the documented vault layout
- Mutable artifacts under `raw/`
- Assistant state written into the vault root
- User-facing or queryable feature state landing in assistant runtime instead of canonical vault records
- New public commands outside `vault-cli`
- Cross-package imports that let non-core packages mutate canonical state implicitly

## Current Integration Status

As of 2026-03-16, the contract fence covers canonical device/provider imports as well: `@murphai/importers` can normalize provider payloads into a shared device-batch seam, while `@murphai/core` persists immutable provider snapshots under `raw/integrations/**` plus append-only events/samples with explicit upstream provenance. The remaining integration gap is still the TypeScript CLI runtime: its source now delegates to real package functions, but this workspace still lacks the `incur` toolchain needed to execute or typecheck `vault-cli` end to end.
