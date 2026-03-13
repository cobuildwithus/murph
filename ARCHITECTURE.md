# Healthy Bob Architecture

Last verified: 2026-03-13

## Module Map

- `packages/contracts`: canonical Zod contracts, parse helpers, TypeScript types, and generated JSON Schema artifacts
- `packages/runtime-state`: shared `.runtime` path resolution plus SQLite defaults for rebuildable local state
- `packages/core`: the only package allowed to mutate canonical vault data
- `packages/importers`: ingestion adapters that parse external files and delegate all writes to core
- `packages/inboxd`: inbox capture ingestion/runtime package that persists canonical raw inbox evidence while keeping inbox-only cursors, capture indexes, and attachment job state in local SQLite state
- `packages/query`: read helpers, export-pack generation, and the optional lexical search index over canonical vault data
- `packages/cli`: `vault-cli`, a typed operator surface over core/importers/query/inboxd
- `fixtures/` and `e2e/`: deterministic fixture corpus and end-to-end smoke flows

## Trust Boundaries

- Canonical vault storage is file-native under the vault root.
- Human-facing truth lives in Markdown documents such as `CORE.md`, journal pages, and experiment pages.
- Machine-facing truth lives in append-only JSONL ledgers for events, samples, and audit records.
- Raw imported artifacts are immutable once copied into `raw/`.
- Inbox runtime state is local-only under `.runtime/inboxd.sqlite` plus `.runtime/inboxd/*.json` and is rebuildable from canonical vault evidence under `raw/inbox/**`.
- Query search runtime state is local-only under `.runtime/search.sqlite` and is rebuildable from canonical vault evidence.
- Any inbox-to-canonical promotion idempotency must be stored in or derivable from canonical vault evidence, not `.runtime/` alone.
- Assistant/session state belongs outside the canonical vault under `assistant-state/`.

## Control Flow

1. Operators, automations, and future agent layers call `vault-cli` or package APIs.
2. CLI commands perform validation and delegate to `packages/core`, `packages/importers`, `packages/query`, or `packages/inboxd`-backed service layers.
3. Importers may parse and normalize external inputs but must never write canonical vault files directly.
4. Query/export paths are read-only and must not mutate canonical vault state.

## Source Of Truth

- Routing and hard rules: `AGENTS.md`
- Durable docs index: `agent-docs/index.md`
- Detailed architecture summary: `docs/architecture.md`
- Frozen baseline contracts: `docs/contracts/*.md`

## Current Verification Posture

The repository still uses the bootstrap verification commands until implementation lanes land their first truthful runtime/tooling checks.
