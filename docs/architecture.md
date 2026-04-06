# Murph Baseline Architecture

## Purpose

Murph stores durable health records in a file-native vault. Markdown remains the human-reviewable source of truth, derived machine-readable ledgers stay append-only, and all canonical writes flow through one core library.

## Target Repo Shape

```text
repo/
  docs/
    architecture.md
    contracts/
      00-invariants.md
      01-vault-layout.md
      02-record-schemas.md
      03-command-surface.md
      04-error-codes.md
      05-fixtures.md

  packages/
    contracts/
    runtime-state/
    core/
    assistant-cli/
    setup-cli/
    cli/
    importers/
    device-syncd/
    inboxd/
    parsers/
    query/
  fixtures/
    minimal-vault/
    sample-imports/
    golden-outputs/

  e2e/
    smoke/
    scenarios/
```

## Package Boundaries

- `packages/contracts` defines the shared language: canonical Zod contracts, TypeScript types, parse helpers, and generated JSON Schema artifacts.
- `packages/runtime-state` defines canonical local-state taxonomy and paths (`.runtime/operations/**`, `.runtime/projections/**`, `.runtime/cache/**`, `.runtime/tmp/**`) plus shared JSON/SQLite versioning helpers and migration defaults.
- `packages/core` owns vault bootstrap, filesystem primitives, domain mutations, audit emission, and canonical write rules.
- `packages/importers` parses external inputs, hosts provider-adapter normalization for direct API connectors, and delegates all canonical writes to core.
- `packages/device-syncd` owns local provider OAuth state, reconnect/disconnect control, scheduled wearable imports, and optional webhook intake while keeping provider credentials in durable local operational state under `.runtime/operations/device-sync/**` and outside the canonical vault.
- `packages/inboxd` owns source-agnostic inbox capture, raw evidence persistence, the append-only `ledger/inbox-captures` canonical capture log, inbox-local runtime cursors/source-specific checkpoints/capture indexes, and attachment-level derived-job orchestration, with its rebuildable SQLite projection under `.runtime/projections/inboxd.sqlite` and daemon/config JSON state under `.runtime/operations/inbox/**`.
- `packages/parsers` owns local-first multimedia parsing for inbox attachments and writes only derived artifacts under `derived/inbox/**`.
- `packages/query` reads canonical vault state, builds derived export packs, owns the optional lexical search index under `.runtime/projections/search.sqlite`, exposes the stable health reference graph under `bank/library/**`, and exposes read helpers for the non-canonical compiled knowledge wiki under `derived/knowledge/**`.
- `packages/assistant-cli` owns CLI-only assistant wrappers, assistant commands, foreground terminal logging, and the Ink chat UI.
- `packages/setup-cli` owns CLI-only onboarding, host setup, and setup-wizard flows.
- `packages/cli` exposes the published `vault-cli` / `murph` shell, composes the command graph, and must not bypass core for canonical writes.

## Storage Model

- Markdown canonical docs:
  - `CORE.md`
  - `journal/YYYY/YYYY-MM-DD.md`
  - `bank/memory.md`
  - `bank/automations/*.md`
  - `bank/experiments/<slug>.md`
- Append-only JSONL ledgers:
  - `ledger/inbox-captures/*.jsonl`
  - `ledger/events/*.jsonl`
  - `ledger/samples/**.jsonl`
  - `audit/*.jsonl`
- Immutable imported raw artifacts:
  - `raw/**`
  - including provider/device snapshots under `raw/integrations/**`
- Rebuildable parser artifacts:
  - `derived/inbox/**`
- Rebuildable model-authored knowledge wiki:
  - `bank/library/**/*.md` as the stable reference layer for durable health concepts and entities
  - `derived/knowledge/index.md`
  - `derived/knowledge/log.md`
  - `derived/knowledge/pages/*.md`
- Local runtime state:
  - `.runtime/operations/inbox/*.json`
  - `.runtime/operations/parsers/toolchain.json`
  - `.runtime/operations/device-sync/state.sqlite`
  - `.runtime/projections/inboxd.sqlite`
  - `.runtime/projections/search.sqlite`
  - `.runtime/projections/gateway.sqlite`
  - `.runtime/cache/**` and `.runtime/tmp/**` for ephemeral scratch state only
- Assistant runtime state:
  - `vault/.runtime/operations/assistant/**`
  - provider-owned transcript history should remain external when the chosen chat adapter supports it
  - channel-native send history should remain external when the chosen delivery adapter supports it
  - store only runtime/session/outbox/receipt/diagnostic/continuity artifacts locally
  - durable user-facing memory belongs in `bank/memory.md`
  - durable scheduled prompt configuration belongs in `bank/automations/*.md`
- Device provider credentials:
  - stay encrypted in the local device-sync runtime database under `.runtime/operations/device-sync/state.sqlite`
  - never land in canonical vault files or append-only health ledgers

## First Release Scope

- `vault-cli init`
- `vault-cli validate`
- `vault-cli document import`
- `vault-cli meal add`
- `vault-cli workout add`
- `vault-cli intervention add`
- `vault-cli samples import-csv`
- `vault-cli experiment create`
- `vault-cli journal ensure`
- `vault-cli show`
- `vault-cli list`
- `vault-cli export pack`

## Explicit Non-Goals

- SQLite or any other canonical database of record
- vector indexes or semantic search in the canonical layer
- OCR-heavy or lab-value extraction inside `packages/core` or baseline importer flows
- chat-log memory extraction into canonical state without an explicit promotion layer
- automatic audio/image/document understanding that writes canonical health facts directly
