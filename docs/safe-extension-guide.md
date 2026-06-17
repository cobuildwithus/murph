# Safe Extension Guide

## Purpose

This guide is the downstream integration reference for extending the Murph vault contract without drifting away from the frozen contracts in `docs/contracts/` and the package boundaries in `ARCHITECTURE.md`.

## Non-Negotiable Boundaries

- Treat `murph` as the product-facing CLI for the current active vault.
- Treat `vault-cli` as the raw explicit-vault/operator surface for development, automation, assistant/runtime integration, and the OpenClaw plugin.
- Keep canonical vault writes inside `@murphai/core` only.
- Keep human-facing truth in Markdown (`CORE.md`, `journal/`, `bank/`).
- Keep machine-facing truth in append-only JSONL ledgers (`ledger/events`, display-grade `ledger/metric-samples`, explicit raw/debug `ledger/samples`, `audit`).
- Keep imported source artifacts immutable under `raw/`.
- Keep SQLite out of canonical storage. SQLite is allowed only for explicit owners under `.runtime/projections/**` or `.runtime/operations/**`, with schema migration/versioning and owner classification documented through `@murphai/runtime-state`.
- Keep assistant or session runtime state under `vault/.runtime/operations/assistant/**`, and keep durable user-facing memory plus scheduled assistant configuration in canonical vault records rather than assistant runtime state.
- If a datum is user-facing, queryable, or something future product features will build on, make it a canonical vault record or an explicit derived materialization immediately; do not prototype it in assistant runtime first.
- Do not introduce vector storage, OCR-heavy parsing, semantic search, canonical transcript storage inside the vault, or automatic promotion of chat logs into canonical health state in the current contract.

## Package Families And Public Posture

Only five packages are published to npm: `@murphai/contracts`, `@murphai/hosted-execution`, `@murphai/gateway-core`, `@murphai/murph`, and `@murphai/openclaw-plugin`. Other workspace packages are private owner packages. Public tarballs may bundle private owners when needed, but those private packages are not standalone public API.

| Family | Public posture | Allowed to do | Must not do |
| --- | --- | --- | --- |
| Contract and shared gateway packages (`@murphai/contracts`, `@murphai/hosted-execution`, `@murphai/gateway-core`) | Published, narrow entrypoints | Define shared schemas, hosted/control-plane contracts, and transport-neutral gateway contracts | Reach into app/package internals or become canonical write owners |
| Product CLI package (`@murphai/murph`) | Published; ships both `murph` and `vault-cli` | Present the product CLI, raw vault CLI, onboarding/setup, local daemon composition, and operator formatting over owner packages | Bypass owner packages for canonical writes or expose private workspace packages as public API |
| OpenClaw bundle (`@murphai/openclaw-plugin`) | Published skill bundle | Teach OpenClaw to use the existing `vault-cli` surface against the operator's configured vault | Start a second Murph assistant runtime or invent an OpenClaw-owned storage contract |
| Vault contract and mutation owners (`@murphai/core`, `@murphai/vault-usecases`, private health/usecase owners) | Workspace-private | Validate state, perform canonical mutations, compose command-shaped usecases, and keep write paths behind owner seams | Publish ad hoc public APIs or let callers mutate canonical files directly |
| Import, inbox, parser, query, and projection owners (`@murphai/importers`, `@murphai/inboxd`, `@murphai/parsers`, `@murphai/query`, `@murphai/health-commons`) | Workspace-private | Normalize external evidence, persist raw/canonical intake through core, publish derived artifacts, and build read-only projections | Decide new canonical storage rules or mutate vault truth from read/projection paths |
| Runtime-state and local daemon owners (`@murphai/runtime-state`, `@murphai/device-syncd`, `@murphai/assistantd`) | Workspace-private | Own explicit `.runtime/operations/**` and `.runtime/projections/**` paths, daemon control planes, local projections, and runtime path/versioning policy | Hide durable state in undocumented runtime paths or store canonical product truth in runtime state |
| Assistant and hosted runtime owners (`@murphai/assistant-engine`, `@murphai/assistant-cli`, `@murphai/assistant-runtime`, `@murphai/operator-config`, hosted apps) | Workspace-private or app-local | Orchestrate assistant turns, bounded hosted workspace invocations, provider config, and hosted control/execution planes over explicit contracts | Treat assistant/session/runtime residue as canonical health or product truth |

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
2. If it creates durable product state, give it a canonical vault home or explicit derived materialization and owner before implementation.
3. If it is only runtime residue, keep it under `vault/.runtime/operations/assistant/**` with an explicit schema/schemaVersion seam.
4. Do not ship user-facing or queryable feature data in assistant runtime as a temporary shortcut.

Assistant runtime is for sessions, transcripts, receipts, outbox state, diagnostics, locks, and similar execution artifacts. It is not a product-state incubator.

### Add a new runtime projection or operation store

1. Decide whether the store is durable operational state under `.runtime/operations/**` or rebuildable projection state under `.runtime/projections/**`.
2. Document the owning package, portability class, hosted snapshot behavior, and versioning/migration seam in `@murphai/runtime-state`.
3. Use SQLite only inside those explicit runtime roots, never as canonical storage.
4. Keep rebuild inputs clear: projections must be rebuildable from canonical vault evidence plus documented durable operational state.

### Add a new device/provider connector

1. Model the provider behind a small adapter in `@murphai/importers` that normalizes upstream payloads into shared device-batch payloads.
2. Preserve immutable provider snapshots under `raw/integrations/<provider>/**` through `@murphai/core`; do not write those files directly from importer code.
3. Attach upstream provenance with shared `externalRef` fields on canonical events and compact metrics so retries dedupe by provider resource id, version, and optional facet.
4. Keep provider secrets, OAuth tokens, and background sync state outside the vault; only immutable payload evidence and canonical normalized records belong in the vault.
5. Avoid inventing unsupported time series. If the upstream API only exposes summaries, normalize summaries into current observations or compact metric facts instead of fabricating minute-level streams.

### Add a new query or export

1. Read only from canonical Markdown and JSONL data.
2. Keep generated export artifacts outside canonical source paths.
3. Treat query modules as pure readers with deterministic output from fixture data.

If a query needs to "fix up" data while reading, move that logic into core migration or validation work instead.

### Add a new CLI command

1. Put product-facing flows under `murph` when they operate on the active vault.
2. Keep raw explicit-vault, automation, assistant/runtime, and integration flows available through `vault-cli`.
3. Validate arguments at the edge.
4. Delegate the actual operation to core, importers, or query packages.
5. Return structured output and normalized contract errors.

Do not let CLI commands write files directly, even for convenience helpers.

### Extend the health model safely

Treat the health model as a contract-first extension. Until the health updates land in `docs/contracts/01-vault-layout.md`, `docs/contracts/02-record-schemas.md`, and `docs/contracts/03-command-surface.md`, this section is downstream integration guidance rather than shipped behavior.

Storage and authority rules for this extension:

- Keep curated current state split by purpose: freeform durable memory in `bank/memory.md`, typed machine-readable defaults in `bank/preferences.json`, and the assistant-authored compiled personal wiki under `derived/knowledge/**`.
- Keep append-only machine ledgers in JSONL. Assessments, timed health events, samples, and audit records stay ledger-backed rather than becoming mutable Markdown truth.
- Keep timed health events in the existing `ledger/events` family. New health event kinds such as `encounter`, `procedure`, `test`, `adverse_effect`, and `exposure` extend that ledger instead of creating a second event timeline. Blood tests remain user-facing projected views over canonical `test` events rather than a separate storage or query family.
- Keep assessment provenance split across immutable `raw/assessments` inputs and append-only assessment ledgers. Intake projection may return typed proposals, but noun-specific upserts still own canonical writes.

CLI and package-boundary rules for this extension:

- Keep generic health nouns on the `scaffold`, explicit `import-json`, `show`, and `list` pattern. For high-value agent-facing writes, prefer typed args/options with an explicit `import-json` fallback for advanced payloads; current examples include typed event adds, `samples add`, `supplement save`, the regimen-backed `medication history add` facade, `regimen save`, and blood-test `save`. Keep private Health Commons-backed adaptations on the `protocol import-json/show/list` surface, and keep public Health Commons lookup under `commons protocol`.
- Keep canonical writes in `@murphai/core` even when health nouns originate from `@murphai/importers` or the CLI surface.
- Keep `@murphai/query` read-only. If the health read model needs repair logic, move that work into core mutation or validation paths instead.
- If this area looks duplicated, simplify selector/helper plumbing around the seam rather than collapsing the seam itself. Any cleanup has to preserve the split between canonical memory, canonical typed preferences, stable reference docs, and derived wiki pages.
- Do not introduce a generic "apply this assessment" mutation. This extension keeps assessment projection separate from noun-specific writes so operators can review proposals before they become canonical state.

Downstream follow-up stays blocked until the source lanes publish the frozen health contract:

- exact vault paths for the new health registries and ledgers
- schema names, versions, and generated artifact filenames
- canonical examples and smoke fixtures for each health noun
- final CLI grammar and response examples for the payload-first commands

## Integration Checklist

- Contract docs still describe the new behavior truthfully.
- Package ownership remains one-way, with canonical writes only through core-owned mutation seams.
- New paths under the vault root preserve Markdown truth, append-only JSONL, and immutable `raw/`, including provider snapshots under `raw/integrations/**`.
- New runtime stores live only under documented `.runtime/operations/**` or `.runtime/projections/**` owners and are registered through `@murphai/runtime-state`.
- Health-extension changes keep Markdown for curated current state and JSONL for append-only assessments, event-ledger health records, samples, and audit.
- Device/provider connectors keep upstream provenance on canonical records via shared `externalRef` metadata rather than implicit importer-only state.
- Fixtures and smoke flows cover the new behavior at the public surface, not just internals.
- Verification docs and package scripts are updated if runtime expectations change.
- Release notes explain whether the change is planning-only, contract-only, or operator-visible.

## Red Flags

- Direct canonical filesystem writes from CLI, importer, assistant, runtime, or query packages outside core-owned mutation seams
- Canonical state stored outside the documented vault layout
- Canonical state stored in SQLite
- Mutable artifacts under `raw/`
- Assistant state written into the vault root
- User-facing or queryable feature state landing in assistant runtime instead of canonical vault records
- Product flows hidden behind `vault-cli` only when they should be available through `murph`
- Raw explicit-vault/operator flows exposed only through `murph` when integrations need `vault-cli`
- Cross-package imports that let non-core packages mutate canonical state implicitly
