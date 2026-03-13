# Healthy Bob

Healthy Bob is a file-native health vault. It keeps human-reviewable truth in Markdown, machine-readable truth in append-only JSONL ledgers, and exposes a typed `vault-cli` surface over a shared TypeScript workspace.

The workspace includes buildable packages for contracts, shared runtime-state helpers, core mutations, importer adapters, inbox capture/runtime indexing, local-first parser workers, query/export helpers, and the CLI, along with deterministic fixtures and repo-level verification.

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
- a typed `vault-cli` command surface in `packages/cli`
- deterministic fixtures and smoke manifests under `fixtures/` and `e2e/`

The repo does not define a deployment target yet. It is currently a local TypeScript workspace with truthful package/runtime verification and fixture-based smoke coverage.

## Mental Model

Healthy Bob splits the vault into six kinds of state:

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
6. Derived exports
   read-only packs under `exports/packs`.

That means a typical record is not hidden in a database. You can inspect the vault directly, and the package boundaries are designed to keep writes disciplined.

## How A Command Flows Through The System

Every CLI command follows the same shape:

1. `vault-cli` validates arguments and shared options using Incur.
2. Root middleware normalizes `vault`, `format`, and optional `requestId`.
3. The handler delegates exactly one boundary call into `core`, `importers`, `inboxd`, or `query`, with parser-toolchain queue control layered through the inbox CLI services.
4. Write commands copy raw artifacts first; inbox ingestion flows persist capture evidence under `raw/inbox/...` and enqueue attachment parse jobs in `.runtime/`.
5. Parser-capable product flows may use `@healthybob/parsers` to drain those jobs and publish only derived artifacts under `derived/inbox/...`.
6. For `--format json`, successful commands return the command-specific payload directly and failures return a direct error object.

Shared options:

- `--vault <path>` is required for all commands.
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

Important storage rules:

- stored paths are always relative to the vault root
- raw imports are immutable once written
- each raw import directory gets an immutable `manifest.json` sidecar with checksums and import provenance
- JSONL ledgers are append-only
- `bank/profile/current.md` is derived from profile snapshots
- inbox parser outputs under `derived/inbox/**` are rebuildable and non-canonical
- `.runtime/**` is local runtime state and may be rebuilt from durable vault files
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
| `packages/cli` | The `vault-cli` operator surface, input validation, middleware, and output envelopes. |

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
- `vault-cli inbox promote meal|journal|experiment-note` exposes implemented promotion flows for deterministic meal, journal, and experiment-note follow-ups

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

Nouns are compositions of those bundles rather than a shared grammar plus exceptions:

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

## Local Inbox Parser Bootstrap

For a local-first parser setup, the repo exposes one bootstrap command:

```bash
pnpm setup:inbox -- --vault ./vault
```

That command installs workspace dependencies, builds the packages, and runs `vault-cli inbox bootstrap` against the target vault so the inbox runtime is created, the parser toolchain config is written, and doctor runs without hand-editing runtime files. Add `--strict` if you want bootstrap to fail when explicitly configured parser tools are still unavailable. External tools such as `ffmpeg`, `pdftotext`, `whisper.cpp`, and PaddleOCR still need to be installed through your OS or environment.

For product integration code, prefer `createParsedInboxPipeline(...)` or `runInboxDaemonWithParsers(...)` from `@healthybob/parsers` so pending parser jobs drain once on startup and new captures continue auto-draining without a separate manual worker step.

## Lookup Rules That Matter

The query layer distinguishes between the primary lookup id used for follow-on reads and the display id surfaced on the record itself.

- `show` accepts query-layer ids such as `journal:2026-03-12`, `evt_*`, `smp_*`, `exp_*`, `asmt_*`, `psnap_*`, `goal_*`, `cond_*`, `alg_*`, `reg_*`, `fam_*`, and `var_*`.
- `provider show` accepts either the canonical `prov_*` id or the provider slug from `bank/providers/<slug>.md`
- `event show` accepts `evt_*`; specialized nouns such as `document`, `meal`, `history`, and `experiment` remain the preferred follow-up surface when they exist
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
