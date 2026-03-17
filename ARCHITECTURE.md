# Healthy Bob Architecture

Last verified: 2026-03-17

## Module Map

- `packages/contracts`: canonical Zod contracts, parse helpers, TypeScript types, and generated JSON Schema artifacts
- `packages/runtime-state`: shared `.runtime` path resolution plus SQLite defaults for rebuildable local state used by query, inboxd, and CLI inbox flows
- `packages/core`: the only package allowed to mutate canonical vault data
- `packages/importers`: ingestion adapters that parse external files or provider API snapshots, normalize them behind registry-based adapters, and delegate all writes to core
- `packages/inboxd`: inbox capture ingestion/runtime package that persists canonical raw inbox evidence while keeping inbox-only cursors, source-specific checkpoints, capture indexes, and attachment job state in local SQLite state
- `packages/parsers`: local-first attachment parsing, parser-service helpers, and derived artifact publication under `derived/inbox/**`
- `packages/query`: read helpers, export-pack generation, and the optional lexical search index over canonical vault data
- `packages/web`: local-only Next.js observability app that reads vault data on the server through the query package
- `packages/cli`: `vault-cli`, an incur-backed typed operator surface over core/importers/query/inboxd plus parser-toolchain queue controls, inbox model-routing helpers, provider-backed assistant session orchestration, outbound channel adapters, and local setup commands
- `fixtures/` and `e2e/`: deterministic fixture corpus and end-to-end smoke flows

## Trust Boundaries

- Canonical vault storage is file-native under the vault root.
- Human-facing truth lives in Markdown documents such as `CORE.md`, journal pages, and experiment pages.
- Machine-facing truth lives in append-only JSONL ledgers for events, samples, and audit records.
- Raw imported artifacts are immutable once copied into `raw/`, including normalized device/provider API snapshots under `raw/integrations/**`.
- Parser outputs under `derived/inbox/**` are rebuildable and never canonical health facts.
- Inbox model-routing bundles, plans, and execution results under `derived/inbox/**/assistant/*.json` are rebuildable audit artifacts and never canonical health facts.
- Inbox runtime state is local-only under `.runtime/inboxd.sqlite` plus `.runtime/inboxd/*.json` and is rebuildable from canonical vault evidence under `raw/inbox/**`.
- Query search runtime state is local-only under `.runtime/search.sqlite` and is rebuildable from canonical vault evidence.
- The local web surface must remain read-only, local-only, and must not expose raw vault paths, home-directory paths, or write capabilities in its rendered payloads. Its launcher must bind to localhost and block framework `.env*` reads.
- Any inbox-to-canonical promotion idempotency must be stored in or derivable from canonical vault evidence, not `.runtime/` alone.
- General assistant/session state belongs outside the canonical vault under `assistant-state/`; only capture-scoped rebuildable audit artifacts belong under `derived/inbox/**`.
- Provider transcript history and channel-native delivery history should stay with upstream adapters when possible; Healthy Bob stores only minimal alias/thread/session metadata plus provider session references under `assistant-state/`.
- `vault-cli inbox model route` may send a normalized text-only inbox bundle to either the AI Gateway or an operator-specified OpenAI-compatible endpoint.

## Control Flow

1. Operators, automations, and future agent layers call `vault-cli` or package APIs.
2. CLI commands stay thin, validate input, and delegate to internal CLI use-case modules that coordinate `packages/core`, `packages/importers`, `packages/query`, `packages/inboxd`, and parser-toolchain helpers from `packages/parsers`.
3. Inbox capture persists raw evidence, indexes attachments, and enqueues parse jobs in rebuildable local runtime state.
4. Parser workers or parsed-pipeline wrappers consume those attachment jobs and publish only derived artifacts.
5. Inbox model routing can materialize a text-only bundle, call a configured model backend, and write audited bundle/plan/result artifacts before any optional apply step.
6. Importers may parse and normalize external inputs but must never write canonical vault files directly. Provider connectors normalize upstream payloads into shared device-batch payloads and still rely on `packages/core` for canonical persistence.
7. Provider-backed assistant chat and outbound channel flows may persist local session metadata outside the vault, but they must never bypass canonical write boundaries for health data.
8. Query/export paths are read-only and must not mutate canonical vault state.
9. The local web app reads vault data only on the server through query helpers, constrains search to safe record fields, and renders a read-only surface for localhost use.

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

The repository still uses the bootstrap verification commands, but it now also has a repo-owned parser bootstrap path (`pnpm setup:inbox`), a local web package that builds under Next.js webpack mode, and inbox/parser package tests that exercise runtime rebuild, parser workers, parser-toolchain discovery, and parsed-pipeline flows inside the local TypeScript workspace.
