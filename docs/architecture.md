# Murph Architecture

Last verified: 2026-05-13

## Purpose

Murph stores durable health records in a file-native vault and pairs them with a public Health Commons of protocol, biomarker, source, and aggregate outcome pages. Markdown remains the human-reviewable source of truth, derived machine-readable ledgers stay append-only, and all canonical writes flow through one core library.

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

  apps/
    web/
    cloudflare/

  packages/
    contracts/
    hosted-execution/
    runtime-state/
    core/
    importers/
    device-syncd/
    messaging-ingress/
    inboxd/
    inbox-services/
    parsers/
    health-metrics/
    query/
    vault-usecases/
    health-commons/
    assistant-engine/
    operator-config/
    assistant-cli/
    setup-cli/
    assistantd/
    assistant-runtime/
    gateway-core/
    cloudflare-hosted-control/
    hosted-local-harness/
    cli/
    openclaw-plugin/
  fixtures/
    minimal-vault/
    sample-imports/
    golden-outputs/

  e2e/
    smoke/
    scenarios/
```

## Package Boundaries

- Keep each package's `exports` map intentionally small and semantic. When a package starts wanting many file-shaped subpaths or compatibility wrappers, that is a signal to split ownership or add one clearer owner seam rather than turning `package.json` into a directory listing.
- Re-export another package's surface only when this package is the real owner-level API. Otherwise callers should import from the true owner package directly.
- Compatibility shims are temporary migration tools, not permanent architecture. Remove pass-through files and subpath aliases once callers have moved.
- Only `@murphai/contracts`, `@murphai/hosted-execution`, `@murphai/gateway-core`, `@murphai/murph`, and `@murphai/openclaw-plugin` are published. Other `packages/*` entries are workspace-private owner packages that may be bundled into published tarballs when needed.
- `packages/contracts` defines the shared language: canonical Zod contracts, TypeScript types, parse helpers, generated JSON Schema artifacts, and the shared vault-family registry/layout/query-source metadata consumed by core, query, and inboxd.
- `packages/hosted-execution` owns shared hosted runtime-control contracts, route builders, auth canonicalization helpers, redacted runtime-log/status codecs, and vendor-neutral hosted env names while deployed topology and auth adapters stay app-local.
- `packages/runtime-state` defines canonical local-state taxonomy and paths (`.runtime/operations/**`, `.runtime/projections/**`, `.runtime/cache/**`, `.runtime/tmp/**`), aggregates subsystem-owned operational descriptor manifests for portability policy, and provides shared JSON/SQLite versioning helpers and migration defaults.
- `packages/core` owns vault bootstrap, filesystem primitives, domain mutations, audit emission, canonical write rules, and current-format vault validation; canonical reads/writes fail closed on non-current `formatVersion` values.
- `packages/importers` parses external inputs, hosts provider-adapter normalization for direct API connectors, and delegates all canonical writes to core.
- `packages/device-syncd` owns local provider OAuth state, reconnect/disconnect control, scheduled wearable imports, and optional webhook intake while keeping provider credentials in durable local operational state under `.runtime/operations/device-sync/**` and outside the canonical vault.
- `packages/messaging-ingress` owns stateless Telegram/Linq webhook parsing, verification, target grammar, summaries, and sparse minimization without taking on polling, hosted policy, or runtime persistence.
- `packages/inboxd` owns source-agnostic inbox capture, raw attachment persistence, the append-only `ledger/inbox-captures` canonical metadata log, explicit legacy-envelope migration, inbox-local runtime cursors/source-specific checkpoints/capture indexes, and attachment-level derived-job orchestration, with its rebuildable SQLite projection under `.runtime/projections/inboxd.sqlite` and daemon/config JSON state under `.runtime/operations/inbox/**`.
- `packages/inbox-services` owns lower-level inbox runtime, read, and promotion service composition used by CLI/assistant flows without becoming the canonical inbox-capture owner.
- `packages/parsers` owns local-first multimedia parsing for inbox attachments, writes one versioned derived result bundle per attempt under `derived/inbox/**`, and owns the strict reader plus legacy-attempt compactor.
- `packages/health-metrics` owns neutral MetricPoint contracts, health metric definitions, source metadata, unit normalization, display formatting, and selection policy reused by query projections and browser-vault exports.
- `packages/query` reads canonical vault state, builds derived export packs, owns the rebuildable local query projection under `.runtime/projections/query.sqlite` that powers both canonical reads and lexical search, exposes the stable health reference graph under `bank/library/**`, exposes read helpers for the non-canonical compiled knowledge wiki under `derived/knowledge/**`, and adapts canonical/wearable evidence through `@murphai/health-metrics` MetricPoints.
- `packages/vault-usecases` owns CLI/headless vault usecase orchestration over core, importers, and query. It exposes the neutral service surface, lazy runtime loaders, command-shaped input normalization, and assistant-safe vault path helpers used by CLI and headless runtimes. It is not a canonical write owner, query-model owner, inbox/device runtime owner, assistant/session owner, or broad re-export layer.
- `packages/health-commons` owns the public Health Commons for protocol, biomarker, source, and source-person pages, plus build-time catalog generation, scoped runtime artifacts, and aggregate outcome summaries consumed by local and hosted surfaces.
- `packages/assistant-engine` owns headless assistant execution, provider-turn runtime, assistant state/outbox/status/store surfaces, automation, the assistant input spine, and assistant-specific vault/inbox/knowledge tools.
  - Canonical assistant outbox intent JSON remains the only delivery and reply-history authority. The assistant engine may publish disposable exact-key and bounded-route lookup generations under `.runtime/projections/assistant-rebuildable-lookups/**`; generic storage accepts opaque owner/kind/key tuples, while outbox dedupe, provider-message identity, and messaging-route policy remain assistant-owned pure projections. See `docs/assistant-outbox-lookups.md`.
- `packages/operator-config` owns persisted operator defaults, hosted assistant config, assistant backend target normalization, hosted provider/config helpers, setup/runtime-env helpers, device/channel readiness helpers, and shared CLI/setup contracts.
- `packages/assistant-cli` owns CLI-only assistant wrappers, assistant commands, foreground terminal logging, and the Ink chat UI.
- `packages/setup-cli` owns CLI-only onboarding, host setup, and setup-wizard flows.
- `packages/assistantd` owns the loopback-only local assistant daemon and authenticated control plane for steady-state assistant, automation, outbox, and status operations bound to one vault.
- `packages/assistant-runtime` owns the headless hosted runtime surface that runs bounded hosted inbox/bootstrap/assistant/outbox/device-sync workspace invocations behind an injected hosted platform context.
- `packages/gateway-core` owns the published transport-neutral gateway contracts, route helpers, projection/snapshot helpers, opaque ids, and event-log utilities.
- `packages/cloudflare-hosted-control` owns private Cloudflare processing/status/browser-vault control contracts shared between hosted web and Cloudflare without widening `packages/hosted-execution`.
- `packages/hosted-local-harness` owns the local hosted-development and hosted E2E harness, including profile selection, redacted state files, runner-bundle prep, diagnostics, and cleanup.
- `packages/cli` exposes the published `vault-cli` / `murph` shell, composes the command graph, consumes `packages/vault-usecases` for neutral vault usecase services, owns CLI-only device/control-plane composition, and must not bypass core for canonical writes.
- `packages/openclaw-plugin` exposes the published OpenClaw-compatible skill bundle that teaches OpenClaw to call the existing Murph CLI rather than running a second assistant runtime.
- `apps/web` owns the hosted Next.js control plane, hosted Postgres product/control facts, encrypted mailbox rows, hosted workspace checkpoint metadata, usage ledger, onboarding, billing, consent, and device-sync authority.
- `apps/cloudflare` owns the hosted execution plane: signed Temporal `ensure-processing` requests, status/browser-vault control, Durable Object coordination, encrypted runtime blobs, and the native runner-container path over `packages/assistant-runtime`.

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
  - `ledger/integration-ingests/YYYY/YYYY-MM.jsonl` with bounded inline device/provider evidence parts; closed months may use the contract-defined `.jsonl.gz` or `.jsonl.zip` representation
  - `ledger/samples/**.jsonl` for explicit raw/debug sample inspection, not default query hydration
  - `audit/*.jsonl`
- Immutable imported raw artifacts:
  - `raw/**`
  - stored under owner-scoped directories derived from the owning canonical record or import session (`kind` + `id`, with a partition only for batch families such as device/sample/workout imports)
  - each raw import directory keeps a `manifest.json` sidecar that records the same explicit owner metadata used to resolve the path
  - `raw/inbox/**` is the exception: its current inbox-capture ledger record owns metadata and the raw directory retains only stored attachment bytes
- Rebuildable parser artifacts:
  - `derived/inbox/<captureId>/attachments/<attachmentId>/attempts/<attempt>/result.json`
- Rebuildable model-authored knowledge wiki:
  - `bank/library/**/*.md` as the stable reference layer for durable health concepts and entities
  - `derived/knowledge/index.md`
  - `derived/knowledge/log.md`
  - `derived/knowledge/pages/*.md`
- Local runtime state:
  - canonical `vault.json` / markdown evolution stays in `packages/core`; non-current `formatVersion` values fail closed, `vault.json` stores only instance-owned facts plus `formatVersion`, layout and id/shard policy stay code-owned, and rebuildable `.runtime/projections/**` stores are repaired or rebuilt separately and never become canonical migration state
  - `.runtime/operations/inbox/*.json`
  - `.runtime/operations/parsers/toolchain.json`
  - `.runtime/operations/device-sync/state.sqlite`
  - `.runtime/projections/inboxd.sqlite`
  - `.runtime/projections/query.sqlite`
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

## Assistant Input Spine

Codex admission uses one local-runtime input spine for manual, channel, and
hosted conversation input:

```text
source adapter -> AssistantInputEvent -> AssistantInputSource -> scanner/active turn -> accepted-input journal -> Codex
```

Inbox remains a projection and enrichment surface for search, display,
attachment parsing, and debugging context. Source adapters may update inbox
projection after staging assistant input, but hosted callers must not use hidden
runtime-only inbox rows as the path that makes a conversation message visible
to Codex.

## Hosted Ownership

- `apps/web` and hosted Postgres own hosted control-plane truth: hosted member
  identity, routing, billing, email authorization, legal consent events/grants,
  device-sync authority, hosted AI usage reconciliation, external ingress
  ordering, hosted mailbox rows, hosted workspace checkpoints, runtime logs,
  and runtime status.
- `apps/cloudflare` owns execution coordination only: signed Temporal
  `ensure-processing` requests, status control, per-user lease and stale-result fencing, encrypted hosted workspace
  snapshots, encrypted artifact blobs, encrypted runner-secret blobs, and other
  opaque runtime blobs needed to execute one hosted runtime pass safely. Durable
  Objects keep only runner-local lease, alarm, and bundle/addressing
  coordination state; web-owned mailbox/workspace checkpoints are the durable
  progress truth.
- Hosted execution is a thin containerized runner over the same local runtime
  input spine. It restores the encrypted workspace, imports hosted mailbox rows,
  stages `AssistantInputEvent` records, runs the local scanner/active-turn
  machinery, and keeps dirty runtime state local until the runtime-owned
  idle-floor—or last-chance shutdown—`idle_shutdown` checkpoint writes the updated
  workspace checkpoint.
- Mailbox import progress is not assistant handling progress. If a deploy,
  Durable Object reset, or runner restart lands after mailbox import has
  checkpointed, the next hosted invocation must still replay assistant handling
  from assistant input plus any available raw capture evidence until terminal
  auto-reply evidence exists.
- Cloudflare is not the canonical owner of device-sync control-plane state,
  hosted legal consent, hosted usage ledgers, gateway product truth, or any
  second mailbox/recovery queue.
- The broad Cloudflare control seam is intentionally gone. There is no generic
  worker user-env CRUD route surface, no staged dispatch payload control plane
  or CRUD seam, and no Cloudflare-owned sharing or pending-usage durable
  seam.
- Narrow Cloudflare-to-web signed callbacks remain only where the execution
  runtime still needs them, such as execution-time device-sync runtime
  snapshot/apply, device connect-link starts, and direct hosted usage recording.
- Normal webhook and app paths append durable mailbox facts in web-owned storage and
  signal Temporal only. Temporal calls Cloudflare `ensure-processing`; Cloudflare
  responds with `runtime_processing_accepted` or `retry_later` and owns runner
  start, wake, active-fence alarm cleanup, and execution cleanup.

## Explicit Non-Goals

- SQLite or any other canonical database of record
- vector indexes or semantic search in the canonical layer
- OCR-heavy or lab-value extraction inside `packages/core` or baseline importer flows
- chat-log memory extraction into canonical state without an explicit promotion layer
- automatic audio/image/document understanding that writes canonical health facts directly
