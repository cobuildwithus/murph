# Command Surface

Status: frozen baseline plus health extension fence for `vault-cli`

## Namespace

- The only public baseline namespace is `vault-cli`.
- `packages/cli` owns command registration, schema validation, and delegation into `core`, `importers`, and `query`.
- Native `incur` owns the transport envelope and human-oriented formatting behavior.
- `packages/cli` must not write vault files directly. Write commands delegate to `packages/core` or `packages/importers`; read commands delegate to `packages/query`.

## Command Groups

```text
vault-cli init --vault <path> [--request-id <id>]
vault-cli validate --vault <path> [--request-id <id>]
vault-cli vault show --vault <path> [--request-id <id>]
vault-cli vault paths --vault <path> [--request-id <id>]
vault-cli vault stats --vault <path> [--request-id <id>]
vault-cli vault update --vault <path> [--title <title>] [--timezone <tz>] [--request-id <id>]
vault-cli audit show <id> --vault <path> [--request-id <id>]
vault-cli audit list --vault <path> [--action <action>] [--actor <actor>] [--status <status>] [--from <date>] [--to <date>] [--sort asc|desc] [--limit <n>] [--request-id <id>]
vault-cli audit tail --vault <path> [--limit <n>] [--request-id <id>]
vault-cli provider scaffold --vault <path> [--request-id <id>]
vault-cli provider upsert --vault <path> --input @file.json [--request-id <id>]
vault-cli provider show <id> --vault <path> [--request-id <id>]
vault-cli provider list --vault <path> [--status active|inactive] [--limit <n>] [--request-id <id>]
vault-cli event scaffold --vault <path> --kind <kind> [--request-id <id>]
vault-cli event upsert --vault <path> --input @file.json [--request-id <id>]
vault-cli event show <id> --vault <path> [--request-id <id>]
vault-cli event list --vault <path> [--kind <kind>] [--from <date>] [--to <date>] [--tag <tag> ...] [--experiment <slug>] [--limit <n>] [--request-id <id>]
vault-cli document import <file> --vault <path> [--title <title>] [--occurred-at <ts>] [--note "..."] [--source <source>] [--request-id <id>]
vault-cli document show <id> --vault <path> [--request-id <id>]
vault-cli document list --vault <path> [--from <date>] [--to <date>] [--request-id <id>]
vault-cli document manifest <id> --vault <path> [--request-id <id>]
vault-cli meal add --vault <path> --photo <path> [--audio <path>] [--note "..."] [--occurred-at <ts>] [--source <source>] [--request-id <id>]
vault-cli meal show <id> --vault <path> [--request-id <id>]
vault-cli meal list --vault <path> [--from <date>] [--to <date>] [--request-id <id>]
vault-cli meal manifest <id> --vault <path> [--request-id <id>]
vault-cli samples add --vault <path> --input @file.json [--request-id <id>]
vault-cli samples import-csv <file> --vault <path> [--preset <id>] [--stream <stream>] [--ts-column <name>] [--value-column <name>] [--unit <unit>] [--delimiter <char>] [--metadata-columns <name> ...] [--source <source>] [--request-id <id>]
vault-cli samples show <id> --vault <path> [--request-id <id>]
vault-cli samples list --vault <path> [--stream <stream>] [--from <date>] [--to <date>] [--quality <quality>] [--limit <n>] [--request-id <id>]
vault-cli samples batch show <id> --vault <path> [--request-id <id>]
vault-cli samples batch list --vault <path> [--stream <stream>] [--from <date>] [--to <date>] [--limit <n>] [--request-id <id>]
vault-cli experiment create <slug> --vault <path> [--title <title>] [--hypothesis <text>] [--started-on <date>] [--status <status>] [--request-id <id>]
vault-cli experiment show <id> --vault <path> [--request-id <id>]
vault-cli experiment list --vault <path> [--status <status>] [--limit <n>] [--request-id <id>]
vault-cli experiment update --vault <path> --input @file.json [--request-id <id>]
vault-cli experiment checkpoint --vault <path> --input @file.json [--request-id <id>]
vault-cli experiment stop <id> --vault <path> [--occurred-at <ts>] [--note "..."] [--request-id <id>]
vault-cli journal ensure <date> --vault <path> [--request-id <id>]
vault-cli journal show <date> --vault <path> [--request-id <id>]
vault-cli journal list --vault <path> [--from <date>] [--to <date>] [--limit <n>] [--request-id <id>]
vault-cli journal append <date> --vault <path> --text "..." [--request-id <id>]
vault-cli journal link <date> --vault <path> [--event-id <evt_*> ...] [--stream <stream> ...] [--request-id <id>]
vault-cli journal unlink <date> --vault <path> [--event-id <evt_*> ...] [--stream <stream> ...] [--request-id <id>]
vault-cli show <id> --vault <path> [--request-id <id>]
vault-cli list --vault <path> [--record-type <type> ...] [--kind <kind>] [--status <status>] [--stream <stream> ...] [--tag <tag> ...] [--experiment <slug>] [--from <date>] [--to <date>] [--limit <n>] [--request-id <id>]
vault-cli search query --vault <path> --text <query> [--backend auto|scan|sqlite] [--record-type <type> ...] [--kind <kind> ...] [--stream <stream> ...] [--experiment <slug>] [--from <date>] [--to <date>] [--tag <tag> ...] [--limit <n>] [--request-id <id>]
vault-cli search index status --vault <path> [--request-id <id>]
vault-cli search index rebuild --vault <path> [--request-id <id>]
vault-cli timeline --vault <path> [--from <date>] [--to <date>] [--experiment <slug>] [--kind <kind> ...] [--stream <stream> ...] [--entry-type <type> ...] [--limit <n>] [--request-id <id>]
vault-cli export pack create --vault <path> --from <date> --to <date> [--experiment <slug>] [--out <dir>] [--request-id <id>]
vault-cli export pack show <id> --vault <path> [--request-id <id>]
vault-cli export pack list --vault <path> [--from <date>] [--to <date>] [--experiment <slug>] [--limit <n>] [--request-id <id>]
vault-cli export pack materialize <id> --vault <path> [--out <dir>] [--request-id <id>]
vault-cli export pack prune <id> --vault <path> [--request-id <id>]
vault-cli intake import <file> --vault <path> [--title <title>] [--occurred-at <ts>] [--imported-at <ts>] [--source <source>] [--request-id <id>]
vault-cli intake show <id> --vault <path> [--request-id <id>]
vault-cli intake list --vault <path> [--from <date>] [--to <date>] [--limit <n>] [--request-id <id>]
vault-cli intake manifest <id> --vault <path> [--request-id <id>]
vault-cli intake raw <id> --vault <path> [--request-id <id>]
vault-cli intake project <id> --vault <path> [--request-id <id>]
vault-cli profile current rebuild --vault <path> [--request-id <id>]
vault-cli regimen stop <regimenId> --vault <path> [--stopped-on <date>] [--request-id <id>]
vault-cli inbox bootstrap --vault <path> [--rebuild] [--strict] [--ffmpegCommand <command>] [--pdftotextCommand <command>] [--whisperCommand <command>] [--whisperModelPath <path>] [--paddleocrCommand <command>] [--request-id <id>]
vault-cli inbox attachment list <captureId> --vault <path> [--request-id <id>]
vault-cli inbox attachment show <attachmentId> --vault <path> [--request-id <id>]
vault-cli inbox attachment show-status <attachmentId> --vault <path> [--request-id <id>]
vault-cli inbox attachment parse <attachmentId> --vault <path> [--request-id <id>]
vault-cli inbox attachment reparse <attachmentId> --vault <path> [--request-id <id>]
vault-cli inbox promote meal <captureId> --vault <path> [--request-id <id>]
vault-cli inbox promote document <captureId> --vault <path> [--request-id <id>]
vault-cli inbox promote journal <captureId> --vault <path> [--request-id <id>]
vault-cli inbox promote experiment-note <captureId> --vault <path> [--request-id <id>]
vault-cli inbox model bundle <captureId> --vault <path> [--request-id <id>]
vault-cli inbox model route <captureId> --vault <path> --model <model> [--baseUrl <url>] [--apiKey <key>] [--apiKeyEnv <name>] [--providerName <name>] [--headersJson <json>] [--apply] [--request-id <id>]
```

The per-command synopses above intentionally omit incur-owned global output and discovery flags such as `--format`, `--json`, `--verbose`, `--schema`, `--llms`, `skills add`, and `--mcp`. Those surfaces are provided by incur and are not re-frozen command-by-command in this contract.

## Health Noun Grammar

```text
vault-cli <noun> scaffold --vault <path> [--request-id <id>]
vault-cli <noun> upsert --vault <path> --input @file.json [--request-id <id>]
vault-cli <noun> show <id|current> --vault <path> [--request-id <id>]
vault-cli <noun> list --vault <path> [--limit <n>] [--request-id <id>]
```

The placeholder grammar above applies to the frozen health nouns listed below when they expose the shared scaffold/upsert/show/list capability bundle.

## Capability Bundles

The command surface is organized around reusable capability bundles, not a payload-first grammar plus a growing exception list. The shared capability taxonomy lives in `packages/contracts/src/command-capabilities.ts`.

- `readable`: `show | list`
- `payloadCrud`: `scaffold | upsert | show | list`
- `artifactImport`: `import | show | list | manifest`
- `batchInspection`: `batch show | batch list`
- `lifecycle`: `create | show | list | update | checkpoint | stop`
- `dateAddressedDoc`: `ensure | show | list | append | link | unlink`
- `derivedAdmin`: `stats | paths | rebuild | materialize | prune | validate`
- `runtimeControl`: `bootstrap | setup | doctor | parse | requeue | attachment list/show/show-status/parse/reparse | promote | model bundle/route`

## Noun Composition

- `goal`, `condition`, `allergy`, `family`, `genetics`, `history`, `provider`, and `event` are payload-CRUD nouns.
- `profile` is primarily payload CRUD and also exposes `rebuild` for the derived current-profile view.
- `regimen` is primarily payload CRUD and also exposes `stop` as an id-preserving lifecycle helper.
- `document` and `meal` are artifact-import nouns.
- `intake` is an artifact-import noun that also exposes `raw` and `project`.
- `samples` composes artifact import with batch inspection.
- `experiment` is a lifecycle noun.
- `journal` is a date-addressed document noun.
- `vault` composes readable and derived/admin capabilities, plus `update` for metadata mutation.
- `export` composes readable and derived/admin capabilities.
- `audit` is a readable noun with `tail` as its stream-style follow-up.
- `inbox` is a runtime-control noun, including attachment inspection, deterministic promotion flows, and audited model-routing helpers.

These are capabilities, not exceptions. For example, `event` remains the generic write/read surface for non-specialized event kinds, `provider` remains the registry-backed noun for `bank/providers/*.md`, and the inbox attachment commands remain the attachment-level runtime surface for `.runtime` plus `derived/inbox/**`.

Registry-backed readable/list surfaces may expose noun-specific filters where the underlying records justify them. `goal`, `condition`, `allergy`, `regimen`, and similar registry nouns may expose `--status <status>`. `profile list` exposes `--from` and `--to`. `history list` adds `--kind`, `--from`, and `--to`. Generic top-level `list` adds `--record-type`, `--status`, `--stream`, and `--tag` parity.

Frozen health nouns remain:

- `profile`
- `goal`
- `condition`
- `allergy`
- `regimen`
- `family`
- `genetics`
- `history`

## Native Incur Contract

Every command now uses native `incur` command definitions directly:

1. `incur` validates positional arguments and named options against the command schema.
2. The handler receives parsed `args` and `options` and delegates exactly one boundary call to `core`, `importers`, or `query`.
3. The handler returns the command-specific payload directly.
4. Non-verbose `--format json` writes that payload body directly to stdout.
5. `--verbose --format json` wraps the same payload in incur's success/error envelope, including metadata and CTAs when present.
6. Human-oriented rendering, alternate formats, completions, `--llms`, skills, and MCP surfaces are incur-owned and are not redefined here.

## Shared Option Rules

- `--vault <path>` is required for every baseline command so the target vault is explicit.
- `--request-id` is optional, forwarded to package service calls, and reserved for audit correlation.
- Incur's global output flags are available everywhere; this contract freezes only the command-specific option semantics and JSON payload shapes described below.
- Machine-stable callers that need metadata or CTA suggestions should prefer `--verbose --format json`. The payload examples below describe the `data` body emitted by non-verbose JSON mode.
- Retrieval filters and similar multi-value options use repeatable flags such as `--kind meal --kind note`, `--entry-type event --entry-type sample_summary`, or `--metadata-columns device --metadata-columns context`. Comma-delimited tokens such as `--kind meal,note` are invalid and should be rewritten as repeated flags.
- Canonical ids emitted by core/import flows follow the frozen `<prefix>_<ULID>` policy in `docs/contracts/02-record-schemas.md`.
- Commands that create or read canonical records align to the generated schemas in `packages/contracts/generated/`.
- Write/import commands return `lookupId` or `lookupIds` when the follow-on read path should use a queryable id rather than a related or batch id.
- `upsert --input @file.json` uses one file argument and does not expose per-field mutation flags in the public grammar.

## Lookup Rules

- `show` accepts query-layer ids such as `core`, `journal:<YYYY-MM-DD>`, `exp_*`, `evt_*`, `smp_*`, `aud_*`, `asmt_*`, `psnap_*`, `goal_*`, `cond_*`, `alg_*`, `reg_*`, `fam_*`, and `var_*`.
- `profile show current` and `profile current rebuild` target the derived `bank/profile/current.md` view rather than a standalone canonical record id.
- `provider show` accepts either the canonical `prov_*` id or the stable provider slug stored in `bank/providers/<slug>.md`.
- `event show` accepts the canonical `evt_*` id. Specialized nouns such as `document`, `meal`, `history`, and `experiment` remain the preferred follow-up surface when they already exist.
- Generic `show` still expects query-layer ids for event-backed records, but `document show`, `document manifest`, `meal show`, and `meal manifest` accept the stable `doc_*` and `meal_*` related ids as well as `evt_*`.
- `samples batch show` and `samples batch list` are the first-class follow-up surface for `xfm_*` import-batch ids; generic `show` still does not accept them.
- `intake manifest` and `intake raw` are the first-class follow-up surface for immutable assessment evidence under `raw/assessments/**`.
- `audit show|list|tail` and `vault show|paths|stats|update` are first-class vault noun commands layered on top of the read model and core metadata write path.
- Export pack ids identify derived files under `exports/packs/`; they are not valid `show` targets.
- `sample-summary:<date>:<stream>` ids emitted by `timeline` are derived context handles, not valid `show` targets.
- A successful `show` response may surface a stable display id such as `meal_*` or `doc_*` in `entity.id` even when the lookup key was a queryable event id such as `evt_*`.

## Success Output

For non-verbose `--format json`, successful commands write the command payload directly:

```json
{
  "vault": "<path>",
  "created": true,
  "directories": ["journal/2026"],
  "files": ["CORE.md"]
}
```

Field rules:

- Success output is the command-specific payload described below, with no extra wrapper fields.
- With `--verbose --format json`, the same payload appears under `data` in incur's success envelope.
- Exit code `0` indicates success.
- The payload examples below are representative rather than exhaustive. Newer noun and mutation commands follow the same direct-payload rule and are covered by the runtime schemas in `packages/cli/src/**/*.ts`.

## Failure Output

For non-verbose `--format json`, failed commands write a direct error object and exit non-zero:

```json
{
  "code": "command_failed",
  "message": "Document import failed.",
  "retryable": false
}
```

Field rules:

- `code` is a stable string suitable for machine branching.
- `message` is operator-facing and actionable.
- `retryable` follows native `incur` semantics.
- With `--verbose --format json`, the same error shape appears under `error` in incur's envelope.

## Command Payloads

The examples below are the full successful non-verbose `--format json` response bodies.

### `init`

```json
{
  "vault": "<path>",
  "created": true,
  "directories": ["journal/2026"],
  "files": ["CORE.md"]
}
```

### `validate`

```json
{
  "vault": "<path>",
  "valid": true,
  "issues": [
    {
      "code": "missing-core",
      "path": "CORE.md",
      "message": "CORE.md is missing.",
      "severity": "error"
    }
  ]
}
```

### `document import`

```json
{
  "vault": "<path>",
  "sourceFile": "<path>",
  "rawFile": "<path>",
  "manifestFile": "<path>",
  "documentId": "doc_123",
  "eventId": "evt_123",
  "lookupId": "evt_123"
}
```

### `meal add`

```json
{
  "vault": "<path>",
  "mealId": "meal_123",
  "eventId": "evt_123",
  "lookupId": "evt_123",
  "occurredAt": "2026-03-12T09:30:00-05:00",
  "photoPath": "<path>",
  "audioPath": null,
  "manifestFile": "<path>",
  "note": "optional note"
}
```

### `samples import-csv`

```json
{
  "vault": "<path>",
  "sourceFile": "<path>",
  "stream": "glucose",
  "importedCount": 42,
  "transformId": "xfm_123",
  "manifestFile": "<path>",
  "lookupIds": ["smp_123", "smp_124"],
  "ledgerFiles": ["<path>"]
}
```

`transformId` identifies the raw import batch only. `manifestFile` points at the immutable batch sidecar with checksum, import-config, and row provenance. Use the returned `lookupIds` or `list --kind sample` for follow-on reads.

### `experiment create`

```json
{
  "vault": "<path>",
  "experimentId": "exp_123",
  "lookupId": "exp_123",
  "slug": "sleep-window",
  "experimentPath": "<path>",
  "created": false
}
```

`created: false` is the idempotent retry case when the experiment page already exists with matching baseline attributes.

### `journal ensure`

```json
{
  "vault": "<path>",
  "date": "2026-03-12",
  "lookupId": "journal:2026-03-12",
  "journalPath": "<path>",
  "created": true
}
```

### Follow-up Read Commands

- `provider show`, `event show`, `document show`, `meal show`, `samples show`, `experiment show`, `journal show`, `intake show`, `audit show`, and `vault show` all return the same direct `entity`-style payload shape used by generic `show`, with command-local lookup behavior where documented.
- `provider list`, `event list`, `document list`, `meal list`, `samples list`, `experiment list`, `journal list`, `intake list`, `audit list`, `audit tail`, and `export pack list` all return the same direct `items` plus `filters` list payload shape used by generic `list`, but with noun-specific filter echoes.
- `document manifest`, `meal manifest`, `samples batch show`, `intake manifest`, `intake raw`, and `export pack show` return direct artifact-inspection payloads rather than generic `entity` wrappers.
- `inbox attachment list|show|show-status|parse|reparse` expose runtime attachment inspection and parser queue control over `.runtime` plus `derived/inbox/**`; they do not mutate canonical vault records.

### `show`

`entity.id` is the surfaced display identity for the record. For meal/document events, that can differ from the lookup id accepted by `show`.

```json
{
  "vault": "<path>",
  "entity": {
    "id": "meal_123",
    "kind": "meal",
    "title": "Lunch bowl",
    "occurredAt": "2026-03-12T12:15:00-05:00",
    "path": "<path>",
    "markdown": "# Lunch",
    "data": {},
    "links": [
      {
        "id": "evt_123",
        "kind": "event",
        "queryable": true
      }
    ]
  }
}
```

### `list`

`items[].id` follows the same surfaced display-identity rule as `show`.

```json
{
  "vault": "<path>",
  "filters": {
    "recordType": ["event"],
    "kind": "meal",
    "status": null,
    "stream": [],
    "experiment": "sleep-window",
    "from": "2026-03-01",
    "to": "2026-03-12",
    "tag": ["lunch"],
    "limit": 50
  },
  "items": [
    {
      "id": "meal_123",
      "kind": "meal",
      "title": "Lunch bowl",
      "occurredAt": "2026-03-12T12:15:00-05:00",
      "path": "<path>"
    }
  ],
  "count": 1,
  "nextCursor": null
}
```

### `search query`

`recordId` is the surfaced display identity; `aliasIds` includes the queryable lookup id when that differs.

```json
{
  "vault": "<path>",
  "query": "ferritin labcorp",
  "filters": {
    "text": "ferritin labcorp",
    "backend": "auto",
    "recordTypes": ["event"],
    "kinds": ["document"],
    "streams": [],
    "experiment": null,
    "from": null,
    "to": null,
    "tags": ["labs"],
    "limit": 20
  },
  "total": 2,
  "hits": [
    {
      "recordId": "doc_123",
      "aliasIds": ["doc_123", "evt_123"],
      "recordType": "event",
      "kind": "document",
      "stream": null,
      "title": "Lab Report",
      "occurredAt": "2026-03-12T08:00:00Z",
      "date": "2026-03-12",
      "experimentSlug": null,
      "tags": ["labs"],
      "path": "ledger/events/2026/2026-03.jsonl",
      "snippet": "...ferritin from Labcorp...",
      "score": 21.5,
      "matchedTerms": ["ferritin", "labcorp"],
      "citation": {
        "path": "ledger/events/2026/2026-03.jsonl",
        "recordId": "doc_123",
        "aliasIds": ["doc_123", "evt_123"]
      }
    }
  ]
}
```

### `search index status`

```json
{
  "vault": "<path>",
  "backend": "sqlite",
  "dbPath": ".runtime/search.sqlite",
  "exists": true,
  "schemaVersion": "hb.search.v1",
  "indexedAt": "2026-03-13T03:55:00.000Z",
  "documentCount": 42
}
```

During the compatibility window, `dbPath` may report `.runtime/inboxd.sqlite` if
legacy search tables have not been rebuilt into `.runtime/search.sqlite` yet.

### `search index rebuild`

```json
{
  "vault": "<path>",
  "backend": "sqlite",
  "dbPath": ".runtime/search.sqlite",
  "exists": true,
  "schemaVersion": "hb.search.v1",
  "indexedAt": "2026-03-13T03:55:00.000Z",
  "documentCount": 42,
  "rebuilt": true
}
```

### `timeline`

```json
{
  "vault": "<path>",
  "filters": {
    "from": "2026-03-12",
    "to": "2026-03-12",
    "experiment": null,
    "kinds": [],
    "streams": [],
    "entryTypes": [],
    "limit": 200
  },
  "items": [
    {
      "id": "sample-summary:2026-03-12:heart_rate",
      "entryType": "sample_summary",
      "occurredAt": "2026-03-12T20:00:00Z",
      "date": "2026-03-12",
      "title": "heart_rate daily summary",
      "kind": "sample_summary",
      "stream": "heart_rate",
      "experimentSlug": null,
      "path": "ledger/samples/heart_rate/2026/2026-03.jsonl",
      "relatedIds": ["smp_123", "smp_124"],
      "tags": ["sample_summary", "heart_rate"],
      "data": {
        "stream": "heart_rate",
        "sampleCount": 2,
        "averageValue": 69
      }
    }
  ]
}
```

### `export pack create`

```json
{
  "vault": "<path>",
  "from": "2026-03-01",
  "to": "2026-03-12",
  "experiment": "sleep-window",
  "outDir": "<path>",
  "packId": "pack-2026-03-01-2026-03-12-sleep-window",
  "files": [
    "exports/packs/pack-2026-03-01-2026-03-12-sleep-window/manifest.json",
    "exports/packs/pack-2026-03-01-2026-03-12-sleep-window/question-pack.json",
    "exports/packs/pack-2026-03-01-2026-03-12-sleep-window/records.json",
    "exports/packs/pack-2026-03-01-2026-03-12-sleep-window/daily-samples.json",
    "exports/packs/pack-2026-03-01-2026-03-12-sleep-window/assistant-context.md"
  ]
}
```

Export packs are derived outputs and do not create canonical vault records.
The five-file pack shape stays stable; health extensions enrich `manifest.json`, `question-pack.json`, and `assistant-context.md` with assessments, profile snapshots/current profile, health history, and registry context while preserving `records.json` as the legacy records array.

## Boundary Rules

- `init`, `validate`, `meal add`, `document import`, `samples import-csv`, and `intake import` delegate to `packages/core` or `packages/importers` write paths that preserve immutable raw evidence and append-only ledgers.
- `provider upsert`, `event upsert`, `samples add`, `experiment create|update|checkpoint|stop`, `journal ensure|append|link|unlink`, `vault update`, `intake project`, health `<noun> scaffold`, health `<noun> upsert`, `profile current rebuild`, and `regimen stop` all delegate to `packages/core` exports or to CLI-local helpers built only on top of `packages/core` frontmatter/jsonl primitives and canonical write locks.
- `show`, `list`, `search query`, `search index status|rebuild`, `timeline`, `document/meal/samples/intake/export` follow-up reads, `audit show|list|tail`, and `vault show|paths|stats` delegate to the read model plus immutable-manifest inspection helpers.
- `inbox` bootstrap/setup, capture review, attachment parse, and promote commands delegate to `packages/inboxd`, `packages/parsers`, and shared `packages/core` primitives without directly writing arbitrary vault files from the CLI layer.
- Contract validation errors normalize to the shared codes in `docs/contracts/04-error-codes.md`.
- The default CLI service layer is expected to delegate to the real `core`, `importers`, and `query` package exports. If the local TypeScript or `incur` toolchain is unavailable, that is an environment blocker, not a contract excuse to return placeholder payloads.
