# Murph Architecture

## Purpose

Murph stores durable health records in a file-native vault. Markdown remains the human-reviewable source of truth, derived machine-readable ledgers stay append-only, and all canonical writes flow through one core library.

## Repo Shape

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
- `packages/runtime-state` defines canonical local-state taxonomy and paths (`.runtime/operations/**`, `.runtime/projections/**`, `.runtime/cache/**`, `.runtime/tmp/**`), aggregates subsystem-owned operational descriptor manifests for portability policy, and provides shared JSON/SQLite versioning helpers and migration defaults.
- `packages/core` owns vault bootstrap, filesystem primitives, domain mutations, audit emission, canonical write rules, and the ordered canonical `vault upgrade` registry for live-vault evolution; current-format canonical reads/writes fail closed until an outdated vault has been upgraded.
- `packages/importers` parses external inputs, hosts provider-adapter normalization for direct API connectors, and delegates all canonical writes to core.
- `packages/device-syncd` owns local provider OAuth state, reconnect/disconnect control, scheduled wearable imports, and optional webhook intake while keeping provider credentials in durable local operational state under `.runtime/operations/device-sync/**` and outside the canonical vault.
- `packages/inboxd` owns source-agnostic inbox capture, raw evidence persistence, the append-only `ledger/inbox-captures` canonical capture log, inbox-local runtime cursors/source-specific checkpoints/capture indexes, and attachment-level derived-job orchestration, with its rebuildable SQLite projection under `.runtime/projections/inboxd.sqlite` and daemon/config JSON state under `.runtime/operations/inbox/**`.
- `packages/parsers` owns local-first multimedia parsing for inbox attachments and writes only derived artifacts under `derived/inbox/**`.
- `packages/query` reads canonical vault state, builds derived export packs, owns the rebuildable local query projection under `.runtime/projections/query.sqlite` that powers both canonical reads and lexical search, exposes the stable health reference graph under `bank/library/**`, and exposes read helpers for the non-canonical compiled knowledge wiki under `derived/knowledge/**`.
- `packages/assistant-cli` owns CLI-only assistant wrappers, assistant commands, foreground terminal logging, and the Ink chat UI.
- `packages/setup-cli` owns CLI-only onboarding, host setup, and setup-wizard flows.
- `packages/cli` exposes the published `vault-cli` / `murph` shell, composes the command graph, and must not bypass core for canonical writes.

## Storage Model

- Markdown canonical docs:
  - `CORE.md`
  - `journal/YYYY/YYYY-MM-DD.md`
  - `bank/memory.md` as one curated canonical memory document that stays small enough to read whole
  - `bank/automations/*.md`
  - `bank/experiments/<slug>.md`
  - all canonical markdown writes resolve through one shared `packages/core` document seam with three target shapes only: singleton, slugged, and dated
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
  - canonical `vault.json` / markdown evolution happens through ordered, audited `vault upgrade` steps in `packages/core`; `vault.json` stores only instance-owned facts plus `formatVersion`, while layout and id/shard policy stay code-owned; rebuildable `.runtime/projections/**` stores are repaired or rebuilt separately and never become canonical migration state
  - `.runtime/operations/inbox/*.json`
  - `.runtime/operations/parsers/toolchain.json`
  - `.runtime/operations/device-sync/state.sqlite`
  - `.runtime/projections/inboxd.sqlite`
  - `.runtime/projections/query.sqlite`
  - `.runtime/projections/gateway.sqlite`
  - `.runtime/cache/**` and `.runtime/tmp/**` for ephemeral scratch state only
- Assistant runtime state:
  - `vault/.runtime/operations/assistant/**`
  - provider-owned transcript history should remain external when the chosen chat adapter supports it
  - channel-native send history should remain external when the chosen delivery adapter supports it
  - store only runtime/session/outbox/receipt/diagnostic/continuity artifacts locally
  - durable user-facing memory belongs in `bank/memory.md`
  - durable scheduled prompt configuration belongs in `bank/automations/*.md`
  - do not use assistant runtime as a first stop for user-facing or queryable product state; product nouns must start in canonical vault records or explicit derived materializations
- Device provider credentials:
  - stay encrypted in the local device-sync runtime database under `.runtime/operations/device-sync/state.sqlite`
  - never land in canonical vault files or append-only health ledgers

## Runtime Surfaces

- Local operator surface:
  - `murph` and `vault-cli`
  - `packages/device-syncd`
  - `packages/assistantd`
- Hosted control plane:
  - `apps/web`
- Hosted execution plane:
  - `apps/cloudflare`
  - `packages/assistant-runtime`

## Explicit Non-Goals

- SQLite or any other canonical database of record
- vector indexes or semantic search in the canonical layer
- OCR-heavy or lab-value extraction inside `packages/core` or baseline importer flows
- chat-log memory extraction into canonical state without an explicit promotion layer
- automatic audio/image/document understanding that writes canonical health facts directly
