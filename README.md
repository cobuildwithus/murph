# Healthy Bob

Healthy Bob is a file-native health vault. It keeps human-reviewable truth in Markdown, machine-readable truth in append-only JSONL ledgers, and exposes a typed `vault-cli` surface over a shared TypeScript workspace.

The workspace includes buildable packages for contracts, shared runtime-state helpers, core mutations, importer adapters, inbox capture/runtime indexing, local-first parser workers, query/export helpers, a local-only Next.js web surface, and the CLI, along with deterministic fixtures and repo-level verification.

## Install (recommended)

Runtime: Node >= 22.16.0. One-command setup is currently macOS-only.

Healthy Bob is not publishable to npm yet because `@healthybob/cli` still depends on workspace packages. Today the recommended install path is from this repo root:

```bash
pnpm onboard --vault ./vault
# or, if pnpm is not available yet:
./scripts/setup-macos.sh --vault ./vault
```

`pnpm onboard` is the repo-local installer entrypoint. It runs the macOS setup wrapper, provisions or reuses the local parser/runtime dependencies, builds the workspace, initializes the target vault, saves that vault as the default CLI vault, installs `healthybob` and `vault-cli` shims for future shells, and then launches the interactive Healthy Bob onboarding wizard. iMessage is enabled by default there, and if you keep it enabled the command will drop into `assistant run` so new iMessages can create or continue an assistant conversation automatically.

Plain `pnpm setup` is not available here because `pnpm` reserves `setup` as its own built-in command. Use `pnpm onboard` or `pnpm run setup` instead.

After setup, `pnpm chat` is the shortest repo-local way to reopen the assistant chat from a checkout, and installed shims can use `healthybob chat` or `vault-cli chat`.

## Quick Start (TL;DR)

Runtime: Node >= 22.16.0.

```bash
pnpm onboard --vault ./vault

HEALTHYBOB_VAULT=./vault pnpm web:dev

pnpm chat
healthybob chat
vault-cli inbox doctor
vault-cli vault stats
```

For a quick web-only demo against the included fixture vault:

```bash
HEALTHYBOB_VAULT=fixtures/demo-web-vault pnpm web:dev
```

## What Healthy Bob Is

Healthy Bob is built around a few hard rules:

- Markdown is the human-facing source of truth for durable documents such as `CORE.md`, journal pages, experiments, profile state, and health registries.
- JSONL ledgers are the machine-facing source of truth for append-only records such as events, samples, audit entries, assessments, and profile snapshots.
- Imported source artifacts are copied into `raw/` and treated as immutable.
- Only `packages/core` is allowed to mutate canonical vault data.
- `packages/importers` may parse external inputs, but they must delegate all writes to `packages/core`.
- `packages/cli` validates input and formats output, but it must never write vault files directly.
- Query and export paths are read-only.

The result is a vault that stays inspectable with normal filesystem tools while still giving code a stable contract surface.

## Current Status

The current repo implements:

- the frozen baseline vault contracts under `packages/contracts`
- shared `.runtime` path and SQLite helpers under `packages/runtime-state`
- canonical write flows in `packages/core`
- importer adapters for documents, meals, CSV samples, and intake assessments in `packages/importers`
- source-agnostic inbox ingestion plus runtime indexing in `packages/inboxd`
- local-first multimedia parsing and derived artifact publication in `packages/parsers`
- a read model and export-pack builder in `packages/query`
- a local-only Next.js observability app in `packages/web`
- a typed `vault-cli` command surface in `packages/cli`, including provider-backed assistant chat/session commands plus an always-on inbox triage loop
- deterministic fixtures and smoke manifests under `fixtures/` and `e2e/`

The repo does not define a deployment target yet. It is currently a local TypeScript workspace with truthful package/runtime verification and fixture-based smoke coverage.

## Mental Model

Healthy Bob splits the overall system into seven kinds of state:

1. Human-readable canonical docs
   `CORE.md`, journal pages, experiments, current profile, goals, conditions, allergies, regimens, family records, and genetics records.
2. Append-only machine ledgers
   `ledger/events`, `ledger/samples`, `ledger/assessments`, `ledger/profile-snapshots`, and `audit`.
3. Immutable imported artifacts
   copied originals under `raw/documents`, `raw/meals`, `raw/samples`, `raw/assessments`, and `raw/inbox`.
4. Rebuildable parser artifacts
   normalized outputs under `derived/inbox`.
5. Local runtime state
   rebuildable machine-local indexes and config under `.runtime`.
6. Assistant session transcripts, metadata, and memory
   provider-backed session aliases, minimal thread metadata, local chat transcripts, and Markdown assistant memory outside the vault under `assistant-state/`.
7. Derived exports
   read-only packs under `exports/packs`.

That means a typical record is not hidden in a database. You can inspect the vault directly, and the package boundaries are designed to keep writes disciplined.

## How A Command Flows Through The System

Every CLI command follows the same shape:

1. `vault-cli` validates arguments and shared options using Incur.
2. Root middleware normalizes `vault`, `format`, and optional `requestId`.
3. The handler delegates exactly one boundary call into `core`, `importers`, `inboxd`, or `query`, with parser-toolchain queue control layered through the inbox CLI services.
4. Write commands copy raw artifacts first; inbox ingestion flows persist capture evidence under `raw/inbox/...` and enqueue attachment parse jobs in `.runtime/`.
5. Parser-capable product flows may use `@healthybob/parsers` to drain those jobs and publish only derived artifacts under `derived/inbox/...`.
6. Provider-backed assistant chat flows may reuse external transcript/session storage while also persisting local alias/session metadata, local chat transcripts, and distilled Markdown memory under `assistant-state/`.
7. For `--format json`, successful commands return the command-specific payload directly and failures return a direct error object.

Shared options:

- `--vault <path>` is required unless setup has already saved a default vault for this machine-local CLI.
- `--format json|md` controls whether the response includes a human-oriented markdown rendering. JSON is the canonical machine format.
- `--request-id <id>` is optional and reserved for correlation/audit flows.

Success payload shape:

```json
{
  "vault": "<path>",
  "entity": {}
}
```

Failure payload shape:

```json
{
  "code": "command_failed",
  "message": "Document import failed.",
  "retryable": false
}
```

## Vault Layout

The current vault layout is file-native and contract-driven:

```text
vault/
  vault.json
  CORE.md
  journal/YYYY/YYYY-MM-DD.md
  bank/experiments/<slug>.md
  bank/providers/<provider-slug>.md
  bank/profile/current.md
  bank/goals/<slug>.md
  bank/conditions/<slug>.md
  bank/allergies/<slug>.md
  bank/regimens/<group>/<slug>.md
  bank/family/<slug>.md
  bank/genetics/<slug>.md
  raw/documents/YYYY/MM/<documentId>/<filename>
  raw/documents/YYYY/MM/<documentId>/manifest.json
  raw/assessments/YYYY/MM/<assessmentId>/source.json
  raw/assessments/YYYY/MM/<assessmentId>/manifest.json
  raw/meals/YYYY/MM/<mealId>/<slot>-<filename>
  raw/meals/YYYY/MM/<mealId>/manifest.json
  raw/samples/<stream>/YYYY/MM/<transformId>/<filename>.csv
  raw/samples/<stream>/YYYY/MM/<transformId>/manifest.json
  raw/inbox/<source>/...
  derived/inbox/<captureId>/attachments/<attachmentId>/...
  ledger/assessments/YYYY/YYYY-MM.jsonl
  ledger/events/YYYY/YYYY-MM.jsonl
  ledger/profile-snapshots/YYYY/YYYY-MM.jsonl
  ledger/samples/<stream>/YYYY/YYYY-MM.jsonl
  audit/YYYY/YYYY-MM.jsonl
  .runtime/inboxd.sqlite
  .runtime/inboxd/
  .runtime/search.sqlite
  exports/packs/<packId>/
```

Sibling local assistant state lives outside the vault at `assistant-state/<vault-name>-<hash>/`, including `sessions/<sessionId>.json`, `MEMORY.md`, and `memory/YYYY-MM-DD.md`.

Important storage rules:

- stored paths are always relative to the vault root
- raw imports are immutable once written
- each raw import directory gets an immutable `manifest.json` sidecar with checksums and import provenance
- JSONL ledgers are append-only
- `bank/profile/current.md` is derived from profile snapshots
- inbox parser outputs under `derived/inbox/**` are rebuildable and non-canonical
- `.runtime/**` is local runtime state and may be rebuilt from durable vault files
- `assistant-state/**` is local assistant/session metadata outside the vault and is never canonical health truth
- `assistant-state/**` stores minimal session metadata, local assistant transcript files, and distilled Markdown memory such as aliases, bindings, timestamps, turn counts, provider session references, naming/preferences/instructions, recent project context, and selected health context; the vault remains authoritative on conflicts
- export packs are derived outputs, not canonical records

Schema version policy:

- every canonical record family and raw-manifest sidecar carries an explicit `schemaVersion`
- existing version strings are immutable once published
- new versions must be additive at the vault level: introduce a new version string, keep old data readable, and document the compatibility rule before emitting the new version in writes
- migration logic belongs in `packages/core`; query and CLI code may validate or branch on versions but must not silently rewrite stored records during reads

Canonical ids use one policy: `<prefix>_<ULID>`. Examples include `vault_*`, `evt_*`, `smp_*`, `aud_*`, `asmt_*`, `psnap_*`, `goal_*`, `cond_*`, `alg_*`, `reg_*`, `fam_*`, and `var_*`.

## Package Layout

| Package | Responsibility |
| --- | --- |
| `packages/contracts` | Runtime schemas, TypeScript types, examples, and generated JSON Schema artifacts. |
| `packages/runtime-state` | Canonical `.runtime` path resolution and shared SQLite defaults for rebuildable local state. |
| `packages/core` | Canonical vault initialization, filesystem rules, audit emission, raw-copy rules, and all write mutations. |
| `packages/importers` | Adapters that normalize external inputs and then call `core`. |
| `packages/inboxd` | Source-agnostic inbox capture, raw evidence persistence, runtime indexing, and attachment parse-job orchestration. |
| `packages/parsers` | Local-first attachment parsing, provider selection, and derived artifact publication under `derived/inbox/**`. |
| `packages/query` | Read model assembly, lookups, list filters, summaries, and export-pack generation. |
| `packages/web` | Local-only Next.js app that reads the vault on the server through `packages/query` and exposes a read-only observability surface. |
| `packages/cli` | The `vault-cli` operator surface, input validation, assistant session orchestration, middleware, and output envelopes. |

## Local Web Observatory

The repo now includes a local-only web app under `packages/web`.

- It is read-only and uses the query layer on the server.
- It requires an explicit `HEALTHYBOB_VAULT` environment variable.
- Its wrapper scripts bind to `127.0.0.1` and block framework `.env*` reads.
- Its search surface only indexes safe record fields and does not expose path-derived matches.

Convenience scripts:

- `pnpm web:dev`
- `pnpm web:build`
- `pnpm web:start`

Example local run:

```bash
cd packages/web
HEALTHYBOB_VAULT=../../fixtures/demo-web-vault pnpm dev
```

## Implemented Command Surface

### Baseline Vault Commands

| Command | What it does |
| --- | --- |
| `vault-cli init` | Bootstraps a new vault with `vault.json`, `CORE.md`, directory structure, and an audit entry. |
| `vault-cli validate` | Validates vault metadata, frontmatter, and contract-shaped records. |
| `vault-cli vault show|paths|stats|update` | Exposes explicit vault metadata, layout, record-count summaries, and stable metadata updates. |
| `vault-cli audit show|list|tail` | Exposes first-class audit inspection and filtering over canonical audit shards. |
| `vault-cli provider scaffold|upsert|show|list` | Gives `bank/providers/*.md` a first-class noun with stable `prov_*` ids and slug-based follow-up reads. |
| `vault-cli event scaffold|upsert|show|list` | Covers the non-specialized canonical event kinds without requiring a separate noun per kind. |
| `vault-cli document import <file>` | Copies a source document into `raw/documents/...`, writes an immutable raw manifest, and appends a document event. |
| `vault-cli document show|list|manifest` | Lets operators follow `doc_*`/`evt_*` ids back to the event record and immutable raw manifest. |
| `vault-cli meal add` | Copies meal attachments into `raw/meals/...`, writes an immutable raw manifest, and appends a meal event. |
| `vault-cli meal show|list|manifest` | Lets operators follow `meal_*`/`evt_*` ids back to the event record and immutable raw manifest. |
| `vault-cli workout add <text>` | Captures a freeform workout note as a canonical `activity_session` event with minimal structured inference plus optional overrides. |
| `vault-cli samples add` | Appends one or more manually curated sample records from a JSON payload without going through CSV import. |
| `vault-cli samples import-csv <file>` | Copies a CSV into `raw/samples/...`, writes an immutable batch manifest, and appends sample records into sharded sample ledgers. |
| `vault-cli samples show|list|batch show|batch list` | Adds first-class sample follow-up reads plus `xfm_*` import-batch inspection. |
| `vault-cli experiment create|show|list|update|checkpoint|stop` | Creates or reuses experiment pages, then supports direct lifecycle mutations and follow-up reads by id or slug. |
| `vault-cli journal ensure|show|list|append|link-event|unlink-event|link-stream|unlink-stream` | Creates journal pages, exposes first-class day reads, and adds focused day-level mutation helpers without arbitrary markdown editing. |
| `vault-cli show <id>` | Resolves one queryable record or document view. |
| `vault-cli list` | Lists records through the read model with `recordType`, `kind`, `status`, `stream`, `tag`, experiment, and date filters. |
| `vault-cli export pack|show|list|materialize|prune` | Builds, inspects, copies, and removes derived export packs under `exports/packs/`. |

### Inbox + Parser Commands

The repo also includes local-first inbox parser controls:

- `vault-cli inbox bootstrap --vault <path> [--strict]` initializes `.runtime/inboxd`, writes parser toolchain config, runs doctor, and can fail when explicitly configured parser tools are still unavailable
- `vault-cli inbox setup --vault <path>` writes parser toolchain config under `.runtime/parsers/toolchain.json`
- `vault-cli inbox doctor --vault <path>` reports connector readiness plus discovered parser-toolchain availability
- `vault-cli inbox parse --vault <path> [--captureId <captureId>] [--limit <n>]` drains queued attachment parse jobs
- `vault-cli inbox backfill --vault <path> --source <id> [--parse]` stays queue-first by default and only drains parser work during historical imports when you opt in
- `vault-cli inbox run --vault <path>` runs the foreground daemon and auto-drains parser jobs for new captures
- `vault-cli inbox requeue --vault <path> [--captureId <captureId>] [--attachmentId <attachmentId>] [--state failed|running]` resets failed or interrupted jobs back to pending
- `vault-cli inbox attachment list|show|show-status|parse|reparse` exposes attachment-level inspection plus single-attachment parser control
- `vault-cli inbox promote meal|document|journal|experiment-note` exposes implemented promotion flows for deterministic meal, document, journal, and experiment-note follow-ups
- `vault-cli inbox model bundle <captureId>` materializes the normalized text-only routing bundle for one inbox capture
- `vault-cli inbox model route <captureId> --model <model> [--baseUrl <url>] [--apply]` uses the shared Vercel AI SDK harness to preview or apply canonical CLI actions

### Assistant Commands

The repo also includes a Healthy Bob-native assistant layer:

- `vault-cli chat [prompt]` is a root-level shorthand for `vault-cli assistant chat [prompt]`
- `vault-cli assistant ask <prompt>` sends one local assistant turn through the selected provider adapter, stores session metadata plus local transcript entries outside the canonical vault, and can optionally deliver the generated reply back over a mapped channel
- `vault-cli assistant chat [prompt]` opens an Ink terminal chat UI with `/exit` and `/session` helpers
- `vault-cli assistant deliver <message>` sends one outbound assistant message over the mapped channel without invoking the chat provider
- `vault-cli assistant memory search|get|upsert` searches cited assistant memory snippets, fetches one memory item by id, and commits typed non-canonical memory updates under `assistant-state/`
- `vault-cli assistant run [--model <model>] [--baseUrl <url>]` runs the always-on assistant loop; with a model it also performs canonical inbox triage, and without one it can still handle channel auto-reply such as iMessage
- `vault-cli assistant session list|show` inspects local assistant session metadata under `assistant-state/`; local transcript replay is reserved for the chat UI rather than those metadata commands

Fresh assistant sessions bootstrap from a small core block in `assistant-state/<vault-bucket>/MEMORY.md`. Recent `assistant-state/<vault-bucket>/memory/YYYY-MM-DD.md` notes are now retrieved on demand through `assistant memory search|get` rather than injected wholesale into every fresh session. That continuity layer stays non-canonical, health memory only loads in private assistant contexts, and explicit `assistant memory upsert` writes still never override canonical vault records.

The first installed chat provider adapter is Codex CLI, but the assistant runtime is intentionally provider-backed rather than Codex-shaped. Outbound channel delivery is also adapter-backed, with iMessage as the first send path. Inbox triage remains separate and uses the existing AI SDK routing harness, so chat and ingestion can target different backends.

### Health Extension Commands

The repo also includes a larger health-record surface:

- `vault-cli intake import|show|list|manifest|raw|project`
- `vault-cli profile scaffold`
- `vault-cli profile upsert --input @file.json`
- `vault-cli profile show <id|current>`
- `vault-cli profile list`
- `vault-cli profile current rebuild`
- `vault-cli goal scaffold|upsert|show|list`
- `vault-cli condition scaffold|upsert|show|list`
- `vault-cli allergy scaffold|upsert|show|list`
- `vault-cli regimen scaffold|upsert|show|list|stop`
- `vault-cli family scaffold|upsert|show|list`
- `vault-cli genetics scaffold|upsert|show|list`
- `vault-cli history scaffold|upsert|show|list`

The noun-oriented surface is organized around capability bundles:

- `readable`: `show | list`
- `payloadCrud`: `scaffold | upsert | show | list`
- `artifactImport`: `import | show | list | manifest`
- `batchInspection`: `batch show | batch list`
- `lifecycle`: `create | show | list | update | checkpoint | stop`
- `dateAddressedDoc`: `ensure | show | list | append | link | unlink`
- `derivedAdmin`: `stats | paths | rebuild | materialize | prune | validate`
- `runtimeControl`: `bootstrap | setup | doctor | parse | requeue | attachment list/show/show-status/parse/reparse | promote`

Nouns are grouped by those bundles rather than a shared grammar plus exceptions:

- `goal`, `condition`, `allergy`, `family`, `genetics`, `history`, `provider`, and `event` are payload-CRUD nouns
- `profile` is payload CRUD plus `rebuild`
- `regimen` is payload CRUD plus `stop`
- `document` and `meal` are artifact-import nouns
- `intake` is artifact import plus `raw` and `project`
- `samples` is artifact import plus batch inspection
- `experiment` is lifecycle
- `journal` is date-addressed doc
- `vault` is readable plus derived/admin, with `update` as metadata mutation
- `export` is readable plus derived/admin
- `audit` is readable plus `tail`
- `inbox` is runtime control

Noun-specific filters still exist where the underlying records justify them: `history list` adds `--kind`, `--from`, and `--to`; `profile list` exposes `--from` and `--to`; registry-backed nouns may also expose `--status`.

## One-Command macOS Setup

Healthy Bob now has a dedicated macOS setup surface for the local parser/runtime stack:

```bash
healthybob onboard
# or:
healthybob setup
```

That setup entrypoint is intentionally separate from the main `vault-cli` manifest so it can act more like an installer than a data-plane command. The built CLI shape already includes a setup-first `healthybob` alias: `healthybob`, `healthybob --help`, `healthybob onboard ...`, and `healthybob setup ...` route to that setup surface, while other commands continue through the main operator surface. On macOS it will:

- install or reuse Homebrew
- install or reuse `ffmpeg`, `poppler`/`pdftotext`, and `whisper-cpp`
- download a local whisper.cpp model into `~/.healthybob/toolchain/models/whisper/`
- install PaddleX OCR into `~/.healthybob/toolchain/venvs/paddlex-ocr` on Apple Silicon unless you pass `--skipOcr`
- initialize the target vault and run the existing inbox bootstrap flow so `.runtime/inboxd` and `.runtime/parsers/toolchain.json` are ready immediately
- open an interactive onboarding wizard where channel delivery surfaces can be selected with arrow keys plus Space
- enable iMessage by default in that wizard and show Telegram as a coming-soon placeholder so the channel surface is visible from day one
- save that vault as the default Healthy Bob CLI vault for future commands on the same machine
- install user-level `healthybob` and `vault-cli` shims into `~/.local/bin`, adding a managed PATH block to the active shell profile when needed
- configure the local iMessage connector plus assistant auto-reply state when iMessage stays enabled
- automatically launch `assistant run` after a successful interactive onboarding with iMessage enabled, or `assistant chat` when no auto-reply channel is selected

Common options:

- `--vault <path>` defaults to `./vault`
- `--whisperModel <tiny|tiny.en|base|base.en|small|small.en|medium|medium.en|large-v3-turbo>` picks the downloaded whisper.cpp model
- `--dry-run` shows the plan without mutating the machine or vault
- `--skipOcr` disables the PaddleX OCR step even on Apple Silicon

The existing operator/data-plane surface remains under `vault-cli`. The npm publish story is still intentionally blocked by `workspace:*` dependencies in `@healthybob/cli`, so the real supported onboarding path today is the repo-local wrapper below.

### Repo-local macOS bootstrap

If you are starting from a fresh checkout and the workspace itself still needs Node, pnpm, dependencies, and a build, use the repo-local wrapper entrypoint instead:

```bash
pnpm onboard --vault ./vault
```

`pnpm onboard` is a thin alias for the existing macOS wrapper. `pnpm run setup --vault ./vault` works too. Plain `pnpm setup` cannot be claimed by this repo because `pnpm` reserves `setup` as its own built-in command.

That wrapper is macOS-only. On a normal run it ensures Homebrew, Node 22+, and pnpm are present, installs workspace dependencies, builds the packages, and then delegates to `node packages/cli/dist/bin.js onboard ...` so the same installer logic is reused for both built-alias and local-checkout flows. With `--dry-run`, the wrapper now prints that bootstrap plan without mutating the machine or workspace; use the built setup entrypoint directly with `--dry-run` after bootstrap if you want the inner setup-step preview too.

Successful setup now also installs user-level `healthybob` and `vault-cli` shims under `~/.local/bin`. It saves the selected vault as the default CLI vault, so commands such as `healthybob chat` or `healthybob assistant chat` can omit `--vault` later, and a normal interactive `healthybob onboard` or `healthybob setup` run opens the channel picker first and then drops into the right assistant surface when provisioning finishes. If `~/.local/bin` is not already on `PATH`, setup appends a managed PATH block to the active shell profile and tells you to reload your shell.

## Local Inbox Parser Bootstrap

For a local-first parser setup, the repo exposes one bootstrap command:

```bash
pnpm setup:inbox --vault ./vault
```

That command installs workspace dependencies, builds the packages, and runs `vault-cli inbox bootstrap` against the target vault so the inbox runtime is created, the parser toolchain config is written, and doctor runs without hand-editing runtime files. Add `--strict` if you want bootstrap to fail when explicitly configured parser tools are still unavailable. Use this lower-level wrapper when you already manage the external parser tools yourself; use `healthybob setup`, `pnpm onboard`, or `./scripts/setup-macos.sh` when you also want the macOS dependency/toolchain provisioning step.

For product integration code, prefer `createParsedInboxPipeline(...)` or `runInboxDaemonWithParsers(...)` from `@healthybob/parsers` so pending parser jobs drain once on startup and new captures continue auto-draining without a separate manual worker step.

## Lookup Rules That Matter

The query layer distinguishes between the primary lookup id used for follow-on reads and the display id surfaced on the record itself.

- `show` accepts query-layer ids such as `journal:2026-03-12`, `evt_*`, `smp_*`, `exp_*`, `asmt_*`, `psnap_*`, `goal_*`, `cond_*`, `alg_*`, `reg_*`, `fam_*`, and `var_*`.
- `provider show` accepts either the canonical `prov_*` id or the provider slug from `bank/providers/<slug>.md`
- `event show` accepts `evt_*`; specialized nouns such as `document`, `meal`, `workout`, `history`, and `experiment` remain the preferred capture surface when they exist, but workout follow-on reads still use the returned `lookupId` or `eventId` through `event show` or generic `show`
- generic `show` still expects query-layer ids for event-backed records, but `document show` and `meal show` also accept `doc_*` and `meal_*`
- `samples batch show` and `samples batch list` are the follow-up surface for `xfm_*`; generic `show` still does not accept import-batch ids
- `intake manifest` and `intake raw` are the follow-up surface for immutable assessment artifacts under `raw/assessments/**`
- export-pack ids identify derived files under `exports/packs/`; they are not valid `show` targets.

If you chain commands together, prefer the `lookupId` or `lookupIds` returned by the write command rather than guessing which surfaced id is queryable.

## What Each Write Path Actually Produces

The main write flows map cleanly onto the vault:

- `init`
  creates `vault.json`, `CORE.md`, required directories, and a `vault_init` audit record
- `document import`
  copies a source file into `raw/documents/...`, writes an immutable raw manifest with checksum/provenance, appends an `event` record with `kind: "document"`, and appends an audit record
- `meal add`
  copies photo/audio attachments into `raw/meals/...`, writes an immutable raw manifest with checksums/provenance, appends a `kind: "meal"` event, and appends an audit record
- `workout add`
  parses one freeform workout note into the minimum canonical `activity_session` fields, preserves the original note text verbatim on the event, and appends one `evt_*` event record without introducing a separate workout ledger
- `samples import-csv`
  copies the CSV into `raw/samples/...`, writes an immutable batch manifest with checksum/import config/row provenance, returns an `xfm_*` batch id, and appends `smp_*` records to stream-specific sample ledgers
- `samples add`
  appends one or more manually curated `smp_*` records into the same stream-specific sample ledgers without writing a new raw CSV batch
- `experiment create`
  creates `bank/experiments/<slug>.md` and is idempotent when the page already exists with the same baseline attributes
- `experiment update|checkpoint|stop`
  mutates experiment frontmatter/body or appends `experiment_event` lifecycle records while preserving the existing `exp_*` identity
- `journal ensure`
  creates `journal/YYYY/YYYY-MM-DD.md` if missing and returns a stable `journal:<date>` lookup id
- `journal append|link-event|unlink-event|link-stream|unlink-stream`
  mutates only the targeted journal page through focused append/frontmatter helpers
- `provider upsert`
  creates or updates `bank/providers/<slug>.md` with a stable `prov_*` id
- `event upsert`
  appends one canonical `evt_*` event record for supported generic event kinds
- `intake import`
  copies an assessment payload into `raw/assessments/...`, writes an immutable raw manifest with checksum/provenance, appends an `asmt_*` assessment record, and returns a queryable lookup id
- `profile upsert`
  appends a `psnap_*` profile snapshot and can feed `profile current rebuild`

## Read Model And Export Packs

`packages/query` assembles a stable read model from vault metadata, Markdown documents, and ledger shards. That powers:

- `show`
- `list`
- experiment and journal helpers
- daily sample summaries
- export-pack generation

The current export-pack flow produces five derived files:

- `manifest.json`
- `question-pack.json`
- `records.json`
- `daily-samples.json`
- `assistant-context.md`

These are derived outputs. They summarize a date range and optional experiment scope without becoming canonical vault state.

## Fixtures And Smoke Coverage

The repo uses deterministic fixtures rather than informal examples:

- `fixtures/minimal-vault/`
  smallest human-reviewable vault scaffold for smoke expectations
- `fixtures/sample-imports/`
  input files for document, meal, and sample-import flows
- `fixtures/golden-outputs/`
  expected command-level shapes for stable smoke coverage
- `fixtures/health-extensions/`
  overlay assets for intake, profile, noun upserts, and health registry records
- `e2e/smoke/scenarios/`
  command-to-scenario coverage manifests

Repo checks currently verify fixture integrity and command-surface coverage, but they do not yet run full end-to-end CLI scenario orchestration against a long-lived live vault.

## Local Development

Install dependencies and build the workspace:

```bash
pnpm install
pnpm build
```

Run the root verification commands:

```bash
pnpm typecheck
pnpm test
pnpm test:coverage
```

Run the built CLI directly:

```bash
node packages/cli/dist/bin.js init --vault ./tmp/my-vault --format json
node packages/cli/dist/bin.js document import fixtures/sample-imports/documents/visit-summary.md --vault ./tmp/my-vault --format json
node packages/cli/dist/bin.js workout add "Went for a 30-minute run" --vault ./tmp/my-vault --format json
node packages/cli/dist/bin.js samples import-csv fixtures/sample-imports/samples/glucose.csv --stream glucose --ts-column recorded_at --value-column mg_dl --unit mg_dL --vault ./tmp/my-vault --format json
node packages/cli/dist/bin.js profile current rebuild --vault ./tmp/my-vault --format json
```

Useful package-local commands:

```bash
pnpm --dir packages/contracts verify
pnpm --dir packages/core test
pnpm --dir packages/importers test
pnpm --dir packages/query test
pnpm --dir packages/cli test
```

## Where To Read Next

- `ARCHITECTURE.md`
- `docs/architecture.md`
- `docs/contracts/00-invariants.md`
- `docs/contracts/01-vault-layout.md`
- `docs/contracts/02-record-schemas.md`
- `docs/contracts/03-command-surface.md`
- `agent-docs/operations/verification-and-runtime.md`

Those files are the frozen contract and process references. This README is the high-level map for how the current repo works end to end.
