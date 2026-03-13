# Healthy Bob Architecture

Last verified: 2026-03-12

## Module Map

- `packages/contracts`: canonical Zod contracts, parse helpers, TypeScript types, and generated JSON Schema artifacts
- `packages/core`: the only package allowed to mutate canonical vault data
- `packages/importers`: ingestion adapters that parse external files and delegate all writes to core
- `packages/query`: read helpers and export-pack generation over canonical vault data
- `packages/cli`: `vault-cli`, a typed operator surface over core/importers/query
- `fixtures/` and `e2e/`: deterministic fixture corpus and end-to-end smoke flows

## Trust Boundaries

- Canonical vault storage is file-native under the vault root.
- Human-facing truth lives in Markdown documents such as `CORE.md`, journal pages, and experiment pages.
- Machine-facing truth lives in append-only JSONL ledgers for events, samples, and audit records.
- Raw imported artifacts are immutable once copied into `raw/`.
- Assistant/session state belongs outside the canonical vault under `assistant-state/`.

## Control Flow

1. Operators, automations, and future agent layers call `vault-cli` or package APIs.
2. CLI commands perform validation and delegate to `packages/core`, `packages/importers`, or `packages/query`.
3. Importers may parse and normalize external inputs but must never write canonical vault files directly.
4. Query/export paths are read-only and must not mutate canonical vault state.

## Source Of Truth

- Routing and hard rules: `AGENTS.md`
- Durable docs index: `agent-docs/index.md`
- Detailed architecture summary: `docs/architecture.md`
- Frozen baseline contracts: `docs/contracts/*.md`

## Current Verification Posture

The repository still uses the bootstrap verification commands until implementation lanes land their first truthful runtime/tooling checks.
