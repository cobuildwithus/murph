# Healthy Bob Architecture

Last verified: 2026-03-16

## Module Map

- `packages/contracts`: canonical Zod contracts, parse helpers, TypeScript types, and generated JSON Schema artifacts
- `packages/runtime-state`: shared `.runtime` path resolution plus SQLite defaults for rebuildable local state used by query, inboxd, and CLI inbox flows
- `packages/core`: the only package allowed to mutate canonical vault data
- `packages/importers`: ingestion adapters that parse external files and delegate all writes to core
- `packages/inboxd`: inbox capture ingestion/runtime package that persists canonical raw inbox evidence while keeping inbox-only cursors, capture indexes, and attachment job state in local SQLite state
- `packages/parsers`: local-first attachment parsing, parser-service helpers, and derived artifact publication under `derived/inbox/**`
- `packages/query`: read helpers, export-pack generation, and the optional lexical search index over canonical vault data
- `packages/cli`: `vault-cli`, an incur-backed typed operator surface over core/importers/query/inboxd plus parser-toolchain queue controls, inbox model-routing helpers, and local setup commands
- `fixtures/` and `e2e/`: deterministic fixture corpus and end-to-end smoke flows

## Trust Boundaries

- Canonical vault storage is file-native under the vault root.
- Human-facing truth lives in Markdown documents such as `CORE.md`, journal pages, and experiment pages.
- Machine-facing truth lives in append-only JSONL ledgers for events, samples, and audit records.
- Raw imported artifacts are immutable once copied into `raw/`.
- Parser outputs under `derived/inbox/**` are rebuildable and never canonical health facts.
- Inbox model-routing bundles, plans, and execution results under `derived/inbox/**/assistant/*.json` are rebuildable audit artifacts and never canonical health facts.
- Inbox runtime state is local-only under `.runtime/inboxd.sqlite` plus `.runtime/inboxd/*.json` and is rebuildable from canonical vault evidence under `raw/inbox/**`.
- Query search runtime state is local-only under `.runtime/search.sqlite` and is rebuildable from canonical vault evidence.
- Any inbox-to-canonical promotion idempotency must be stored in or derivable from canonical vault evidence, not `.runtime/` alone.
- General assistant/session state belongs outside the canonical vault under `assistant-state/`; only capture-scoped rebuildable audit artifacts belong under `derived/inbox/**`.
- `vault-cli inbox model route` may send a normalized text-only inbox bundle to either the AI Gateway or an operator-specified OpenAI-compatible endpoint.

## Control Flow

1. Operators, automations, and future agent layers call `vault-cli` or package APIs.
2. CLI commands stay thin, validate input, and delegate to internal CLI use-case modules that coordinate `packages/core`, `packages/importers`, `packages/query`, `packages/inboxd`, and parser-toolchain helpers from `packages/parsers`.
3. Inbox capture persists raw evidence, indexes attachments, and enqueues parse jobs in rebuildable local runtime state.
4. Parser workers or parsed-pipeline wrappers consume those attachment jobs and publish only derived artifacts.
5. Inbox model routing can materialize a text-only bundle, call a configured model backend, and write audited bundle/plan/result artifacts before any optional apply step.
6. Importers may parse and normalize external inputs but must never write canonical vault files directly.
7. Query/export paths are read-only and must not mutate canonical vault state.

## CLI Framework Notes

- `packages/cli` is built on incur. Model nested verbs with real mounted sub-CLIs such as `search -> query` and `search -> index -> status|rebuild`; do not simulate nested commands with argv rewrites or positional action enums.
- Treat output/discovery transport such as `--format`, `--json`, `--verbose`, `--schema`, `--llms`, `skills add`, and `--mcp` as incur-owned global behavior. Healthy Bob command docs should focus on domain semantics unless the repo intentionally constrains that surface.
- Keep the root CLI default-exported from `packages/cli/src/index.ts` and keep `packages/cli/src/incur.generated.ts` aligned with command-topology changes so typed CTAs and generated skill metadata stay truthful.
- Source-only CLI checks are useful for triage, but repo acceptance still depends on the built CLI path because package tests execute `packages/cli/dist/bin.js`.

## Source Of Truth

- Routing and hard rules: `AGENTS.md`
- Durable docs index: `agent-docs/index.md`
- Detailed architecture summary: `docs/architecture.md`
- Frozen baseline contracts: `docs/contracts/*.md`

## Current Verification Posture

The repository still uses the bootstrap verification commands, but it now also has a repo-owned parser bootstrap path (`pnpm setup:inbox`) and inbox/parser package tests that exercise runtime rebuild, parser workers, parser-toolchain discovery, and parsed-pipeline flows inside the local TypeScript workspace.
