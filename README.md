# Healthy Bob

Healthy Bob is a file-native health vault. It keeps human-reviewable truth in Markdown, machine-readable truth in append-only JSONL ledgers, and exposes a typed `vault-cli` surface over a shared TypeScript workspace.

The workspace includes buildable packages for contracts, core mutations, importer adapters, query and export helpers, and the CLI, along with deterministic fixtures and repo-level verification.

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
- canonical write flows in `packages/core`
- importer adapters for documents, meals, CSV samples, and intake assessments in `packages/importers`
- a read model and export-pack builder in `packages/query`
- a typed `vault-cli` command surface in `packages/cli`
- deterministic fixtures and smoke manifests under `fixtures/` and `e2e/`

The repo does not define a deployment target yet. It is currently a local TypeScript workspace with truthful package/runtime verification and fixture-based smoke coverage.

## Mental Model

Healthy Bob splits the vault into four kinds of state:

1. Human-readable canonical docs
   `CORE.md`, journal pages, experiments, current profile, goals, conditions, allergies, regimens, family records, and genetics records.
2. Append-only machine ledgers
   `ledger/events`, `ledger/samples`, `ledger/assessments`, `ledger/profile-snapshots`, and `audit`.
3. Immutable imported artifacts
   copied originals under `raw/documents`, `raw/meals`, `raw/samples`, and `raw/assessments`.
4. Derived exports
   read-only packs under `exports/packs`.

That means a typical record is not hidden in a database. You can inspect the vault directly, and the package boundaries are designed to keep writes disciplined.

## How A Command Flows Through The System

Every CLI command follows the same shape:

1. `vault-cli` validates arguments and shared options using Incur.
2. Root middleware normalizes `vault`, `format`, and optional `requestId`.
3. The handler delegates exactly one boundary call into `core`, `importers`, or `query`.
4. Write commands copy any raw artifacts first, then create or update canonical Markdown/JSONL state through `core`.
5. Results are returned in a stable success or failure envelope.

Shared options:

- `--vault <path>` is required for all commands.
- `--format json|md` controls whether the response includes a human-oriented markdown rendering. JSON is the canonical machine format.
- `--request-id <id>` is optional and reserved for correlation/audit flows.

Success envelope shape:

```json
{
  "command": "show",
  "ok": true,
  "format": "json",
  "requestId": null,
  "data": {}
}
```

Failure envelope shape:

```json
{
  "command": "document import",
  "ok": false,
  "format": "json",
  "requestId": null,
  "error": {
    "code": "command_failed",
    "message": "Document import failed."
  }
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
  raw/assessments/YYYY/MM/<assessmentId>/source.json
  raw/meals/YYYY/MM/<mealId>/<slot>-<filename>
  raw/samples/<stream>/YYYY/MM/<transformId>/<filename>.csv
  ledger/assessments/YYYY/YYYY-MM.jsonl
  ledger/events/YYYY/YYYY-MM.jsonl
  ledger/profile-snapshots/YYYY/YYYY-MM.jsonl
  ledger/samples/<stream>/YYYY/YYYY-MM.jsonl
  audit/YYYY/YYYY-MM.jsonl
  exports/packs/<packId>/
```

Important storage rules:

- stored paths are always relative to the vault root
- raw imports are immutable once written
- JSONL ledgers are append-only
- `bank/profile/current.md` is derived from profile snapshots
- export packs are derived outputs, not canonical records

Canonical ids use one policy: `<prefix>_<ULID>`. Examples include `vault_*`, `evt_*`, `smp_*`, `aud_*`, `asmt_*`, `psnap_*`, `goal_*`, `cond_*`, `alg_*`, `reg_*`, `fam_*`, and `var_*`.

## Package Layout

| Package | Responsibility |
| --- | --- |
| `packages/contracts` | Runtime schemas, TypeScript types, examples, and generated JSON Schema artifacts. |
| `packages/core` | Canonical vault initialization, filesystem rules, audit emission, raw-copy rules, and all write mutations. |
| `packages/importers` | Adapters that normalize external inputs and then call `core`. |
| `packages/query` | Read model assembly, lookups, list filters, summaries, and export-pack generation. |
| `packages/cli` | The `vault-cli` operator surface, input validation, middleware, and output envelopes. |

## Implemented Command Surface

### Baseline Vault Commands

| Command | What it does |
| --- | --- |
| `vault-cli init` | Bootstraps a new vault with `vault.json`, `CORE.md`, directory structure, and an audit entry. |
| `vault-cli validate` | Validates vault metadata, frontmatter, and contract-shaped records. |
| `vault-cli document import <file>` | Copies a source document into `raw/documents/...` and appends a document event. |
| `vault-cli meal add` | Copies meal attachments into `raw/meals/...` and appends a meal event. |
| `vault-cli samples import-csv <file>` | Copies a CSV into `raw/samples/...` and appends sample records into sharded sample ledgers. |
| `vault-cli experiment create <slug>` | Creates or reuses an experiment page under `bank/experiments`. |
| `vault-cli journal ensure <date>` | Creates a journal page for a date if missing. |
| `vault-cli show <id>` | Resolves one queryable record or document view. |
| `vault-cli list` | Lists records through the read model with filters. |
| `vault-cli export pack` | Builds a derived export pack for a date range and optional experiment scope. |

### Health Extension Commands

The repo also includes a larger health-record surface:

- `vault-cli intake import <file>`
- `vault-cli intake project <assessmentId>`
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

The noun-oriented commands follow one payload-first grammar:

- `scaffold` emits a template payload
- `upsert --input @file.json` writes one canonical record from a JSON payload
- `show` and `list` read through the query layer
- `profile current rebuild` derives `bank/profile/current.md` from the latest accepted snapshot
- `regimen stop` updates a regimen while preserving its canonical id

## Lookup Rules That Matter

The query layer distinguishes between canonical lookup ids and related ids embedded inside records.

- `show` accepts query-layer ids such as `journal:2026-03-12`, `evt_*`, `smp_*`, `exp_*`, `asmt_*`, `psnap_*`, `goal_*`, `cond_*`, `alg_*`, `reg_*`, `fam_*`, and `var_*`.
- `meal_*` and `doc_*` are stable related ids carried inside events, but follow-on reads should use the returned `lookupId`, usually an `evt_*`.
- `xfm_*` is a sample import batch id, not a showable record id.
- export-pack ids identify derived files under `exports/packs/`; they are not valid `show` targets.

If you chain commands together, prefer the `lookupId` or `lookupIds` returned by the write command rather than guessing which related id is queryable.

## What Each Write Path Actually Produces

The main write flows map cleanly onto the vault:

- `init`
  creates `vault.json`, `CORE.md`, required directories, and a `vault_init` audit record
- `document import`
  copies a source file into `raw/documents/...`, appends an `event` record with `kind: "document"`, and appends an audit record
- `meal add`
  copies photo/audio attachments into `raw/meals/...`, appends a `kind: "meal"` event, and appends an audit record
- `samples import-csv`
  copies the CSV into `raw/samples/...`, returns an `xfm_*` batch id, and appends `smp_*` records to stream-specific sample ledgers
- `experiment create`
  creates `bank/experiments/<slug>.md` and is idempotent when the page already exists with the same baseline attributes
- `journal ensure`
  creates `journal/YYYY/YYYY-MM-DD.md` if missing and returns a stable `journal:<date>` lookup id
- `intake import`
  copies an assessment payload into `raw/assessments/...`, appends an `asmt_*` assessment record, and returns a queryable lookup id
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
