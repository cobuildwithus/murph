# Healthy Bob Architecture

Last verified: 2026-03-18

## Module Map

- `packages/contracts`: canonical Zod contracts, parse helpers, TypeScript types, and generated JSON Schema artifacts
- `packages/runtime-state`: shared `.runtime` path resolution plus SQLite defaults for rebuildable local state used by query, inboxd, and CLI inbox flows
- `packages/core`: the only package allowed to mutate canonical vault data
- `packages/importers`: ingestion adapters that parse external files or provider API snapshots, normalize them behind registry-based adapters, and delegate all writes to core
- `packages/device-syncd`: published local device OAuth/webhook/reconcile runtime with an authenticated localhost control plane, optional separate public callback/webhook ingress, encrypted provider credentials outside the vault, and normalized provider snapshot imports through importers/core
- `packages/inboxd`: inbox capture ingestion/runtime package that persists canonical raw inbox evidence while keeping inbox-only cursors, source-specific checkpoints, capture indexes, and attachment job state in local SQLite state
- `packages/parsers`: local-first attachment parsing, parser-service helpers, and derived artifact publication under `derived/inbox/**`
- `packages/query`: read helpers, export-pack generation, and the optional lexical search index over canonical vault data
- `packages/web`: local-only Next.js observability app that reads vault data on the server through the query package and may initiate device-auth control-plane actions against `packages/device-syncd`
- `packages/cli`: the published `healthybob` package plus `vault-cli`, an incur-backed typed operator surface over core/importers/query/inboxd plus parser-toolchain queue controls, quick workout capture atop canonical `activity_session` events, inbox model-routing helpers, provider-backed assistant session orchestration, CLI-owned `device-syncd` launcher/status/stop control for the selected vault, out-of-vault assistant memory docs plus turn-bound Codex MCP memory tools, outbound channel adapters, an onboarding/setup wizard, and local setup commands
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
- Device sync runtime state is local-only under `.runtime/device-syncd.sqlite`, and Healthy Bob's daemon launcher state/logs live under `.runtime/device-syncd/`; encrypted provider tokens, OAuth sessions, and webhook/reconcile cursors never belong in the canonical vault.
- The local web surface is for local operator use and must not expose raw vault paths, home-directory paths, or canonical write capabilities in its rendered payloads. It may initiate device auth and account-control requests only through the local `device-syncd` control plane and its bearer-token contract, whether that daemon was started manually or by Healthy Bob's CLI-managed launcher. Its launcher must block framework `.env*` reads.
- Any inbox-to-canonical promotion idempotency must be stored in or derivable from canonical vault evidence, not `.runtime/` alone.
- General assistant/session state belongs outside the canonical vault under `assistant-state/`, including local transcript files plus non-canonical Markdown memory for naming, response preferences, standing instructions, selected health context, and recent project context; only capture-scoped rebuildable audit artifacts belong under `derived/inbox/**`.
- Provider transcript history and channel-native delivery history should stay with upstream adapters when possible; Healthy Bob stores local assistant transcript copies, minimal manual aliases, explicit conversation bindings, automation cursors, enabled auto-reply channel state, timestamps/turn counts, provider session references, and Markdown assistant memory under `assistant-state/`. Fresh sessions inject only a small core block by default, recent/project memory is retrieved on demand through typed `assistant memory search|get|forget` calls, assistant-written memory is committed only through host-bound writes that attach session/turn provenance, and canonical vault records remain authoritative on conflicts.
- `vault-cli inbox model route` may send a normalized inbox bundle, with raw routing images attached when eligible, to either the AI Gateway or an operator-specified OpenAI-compatible endpoint.

## Control Flow

1. Operators, automations, and future agent layers call `vault-cli` or package APIs.
2. CLI commands stay thin, validate input, and delegate to internal CLI use-case modules that coordinate `packages/core`, `packages/importers`, `packages/query`, `packages/inboxd`, and parser-toolchain helpers from `packages/parsers`. Canonical mutation flows for experiments, journal pages, providers, events, vault summary updates, and inbox journal/experiment-note promotions must route through typed `packages/core` mutation ports; CLI may keep read-side lookup/orchestration, but it must not parse/stringify canonical frontmatter or assemble canonical write batches for those write paths.
3. Inbox capture persists raw evidence, indexes attachments, and enqueues parse jobs in rebuildable local runtime state.
4. Parser workers or parsed-pipeline wrappers consume those attachment jobs and publish only derived artifacts.
5. Inbox model routing can materialize a normalized bundle, attach supported stored images for multimodal routing when available, and write audited bundle/plan/result artifacts before any optional apply step.
6. Importers may parse and normalize external inputs but must never write canonical vault files directly. Provider connectors normalize upstream payloads into shared device-batch payloads and still rely on `packages/core` for canonical persistence.
7. `packages/device-syncd` owns provider OAuth state, reconnect/disconnect control, scheduled device backfills, and optional webhook fan-in; its control routes must stay loopback-only plus bearer-authenticated, any public callback/webhook ingress should stay isolated from `/accounts/*` and `/providers/*`, polling-first providers remain first-class citizens, provider credentials stay outside the vault, per-account jobs should be serialized to avoid rotating-refresh-token races, and canonical health writes still flow through `packages/importers` and `packages/core`. `packages/cli` may start, reuse, and stop that daemon for the active vault, but it should treat the localhost HTTP control plane as the stable boundary rather than reaching through to provider state in-process.
8. Provider-backed assistant chat and outbound channel flows may persist local session metadata, local transcript files, explicit delivery bindings, typed conversational memory docs, and auto-reply cursors/channel state outside the vault, including selected non-canonical health context for continuity, but they must not treat that state as canonical health truth or bypass canonical write boundaries for health data. Provider turns now bind the real current user prompt, session id, and turn id on the host side, expose `assistant memory search|get|upsert|forget` through a bounded Codex MCP tool surface when available, and serialize assistant-memory commits with vault-scoped locks plus minimal provenance metadata so the model can request memory writes without gaining arbitrary file-edit authority.
9. Query/export paths are read-only and must not mutate canonical vault state.
10. The local web app reads vault data only on the server through query helpers, constrains search to safe record fields, and may redirect to the local authenticated device control plane for auth/account actions without gaining direct canonical write access.

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

The repository still uses the bootstrap verification commands, but it now also has a repo-owned parser bootstrap path (`pnpm setup:inbox`), a fixed-version monorepo release manifest that packs and publishes the direct CLI runtime package chain under one tag, a local web package that builds under Next.js webpack mode, a local device-sync runtime with service/http tests, and inbox/parser package tests that exercise runtime rebuild, parser workers, parser-toolchain discovery, and parsed-pipeline flows inside the local TypeScript workspace.
