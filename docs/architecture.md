# Healthy Bob Baseline Architecture

## Purpose

Healthy Bob stores durable health records in a file-native vault. Markdown remains the human-reviewable source of truth, derived machine-readable ledgers stay append-only, and all canonical writes flow through one core library.

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
    core/
    cli/
    importers/
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

  assistant-state/
```

## Package Boundaries

- `packages/contracts` defines the shared language: canonical Zod contracts, TypeScript types, parse helpers, and generated JSON Schema artifacts.
- `packages/core` owns vault bootstrap, filesystem primitives, domain mutations, audit emission, and canonical write rules.
- `packages/importers` parses external inputs but delegates all canonical writes to core.
- `packages/inboxd` owns source-agnostic inbox capture, raw evidence persistence, runtime cursors/dedupe/search, and attachment-level derived-job orchestration.
- `packages/parsers` owns local-first multimedia parsing for inbox attachments and writes only derived artifacts under `derived/inbox/**`.
- `packages/query` reads canonical vault state and builds derived export packs.
- `packages/cli` exposes the `vault-cli` command surface and must not bypass core for writes.

## Storage Model

- Markdown canonical docs:
  - `CORE.md`
  - `journal/YYYY/YYYY-MM-DD.md`
  - `bank/experiments/<slug>.md`
- Append-only JSONL ledgers:
  - `ledger/events/*.jsonl`
  - `ledger/samples/**.jsonl`
  - `audit/*.jsonl`
- Immutable imported raw artifacts:
  - `raw/**`
- Rebuildable parser artifacts:
  - `derived/inbox/**`
- Local runtime state:
  - `.runtime/**`
- Out-of-vault assistant/session state:
  - `assistant-state/`

## First Release Scope

- `vault-cli init`
- `vault-cli validate`
- `vault-cli document import`
- `vault-cli meal add`
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
