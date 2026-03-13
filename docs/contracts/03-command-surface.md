# Command Surface

Status: frozen baseline plus health extension fence for `vault-cli`

## Namespace

- The only public baseline namespace is `vault-cli`.
- `packages/cli` owns argument validation, output validation, formatting hints, and error normalization.
- `packages/cli` must not write vault files directly. Write commands delegate to `packages/core` or `packages/importers`; read commands delegate to `packages/query`.

## Command Groups

```text
vault-cli init --vault <path> [--format json|md] [--request-id <id>]
vault-cli validate --vault <path> [--format json|md] [--request-id <id>]
vault-cli document import <file> --vault <path> [--format json|md] [--request-id <id>]
vault-cli meal add --vault <path> --photo <path> [--audio <path>] [--note "..."] [--occurred-at <ts>] [--format json|md] [--request-id <id>]
vault-cli samples import-csv <file> --vault <path> --stream <stream> --ts-column <name> --value-column <name> --unit <unit> [--format json|md] [--request-id <id>]
vault-cli experiment create <slug> --vault <path> [--format json|md] [--request-id <id>]
vault-cli journal ensure <date> --vault <path> [--format json|md] [--request-id <id>]
vault-cli show <id> --vault <path> [--format json|md] [--request-id <id>]
vault-cli list --vault <path> [--kind <kind>] [--experiment <slug>] [--date-from <date>] [--date-to <date>] [--cursor <cursor>] [--limit <n>] [--format json|md] [--request-id <id>]
vault-cli export pack --vault <path> --from <date> --to <date> [--experiment <slug>] [--out <dir>] [--format json|md] [--request-id <id>]
```

## Health Noun Grammar

Health nouns use one payload-first grammar with only a few explicit exceptions:

```text
vault-cli intake import <file> --vault <path> [--format json|md] [--request-id <id>]
vault-cli intake show <assessmentId> --vault <path> [--format json|md] [--request-id <id>]
vault-cli intake list --vault <path> [--date-from <date>] [--date-to <date>] [--cursor <cursor>] [--limit <n>] [--format json|md] [--request-id <id>]
vault-cli intake project <assessmentId> --vault <path> [--format json|md] [--request-id <id>]
vault-cli <noun> scaffold --vault <path> [--format json|md] [--request-id <id>]
vault-cli <noun> upsert --vault <path> --input @file.json [--format json|md] [--request-id <id>]
vault-cli <noun> show <id|current> --vault <path> [--format json|md] [--request-id <id>]
vault-cli <noun> list --vault <path> [--cursor <cursor>] [--limit <n>] [--format json|md] [--request-id <id>]
vault-cli profile current rebuild --vault <path> [--format json|md] [--request-id <id>]
vault-cli regimen stop <regimenId> --vault <path> [--stopped-on <date>] [--format json|md] [--request-id <id>]
```

Registry nouns may also expose `--status <status>` where the underlying record family has a meaningful status field. `profile list` intentionally does not.

Frozen health nouns:

- `profile`
- `goal`
- `condition`
- `allergy`
- `regimen`
- `family`
- `genetics`
- `history`

## Root Middleware Contract

Every command passes through one shared middleware layer before any package call:

1. Incur validates positional arguments and named options against the command schema.
2. The middleware injects a normalized execution context:
   - `vault: string`
   - `format: "json" | "md"`
   - `requestId: string | null`
3. The handler delegates exactly one boundary call to `core`, `importers`, or `query`.
4. The middleware wraps the command result in a stable success envelope.
5. Thrown errors normalize to a stable failure envelope with a string `code`.

## Shared Option Rules

- `--vault <path>` is required for every baseline command so the target vault is explicit.
- `--format` accepts only `json` or `md`; default is `json`.
- `--request-id` is optional and reserved for audit correlation.
- `json` is the canonical machine format.
- `md` is a human-oriented rendering hint; the structured envelope remains the source of truth.
- Canonical ids emitted by core/import flows follow the frozen `<prefix>_<ULID>` policy in `docs/contracts/02-record-schemas.md`.
- Commands that create or read canonical records align to the generated schemas in `packages/contracts/generated/`.
- Write/import commands return `lookupId` or `lookupIds` when the follow-on read path should use a queryable id rather than a related or batch id.
- `upsert --input @file.json` uses one file argument and does not expose per-field mutation flags in the public grammar.

## Lookup Rules

- `show` accepts query-layer ids such as `core`, `journal:<YYYY-MM-DD>`, `exp_*`, `evt_*`, `smp_*`, `aud_*`, `asmt_*`, `psnap_*`, `goal_*`, `cond_*`, `alg_*`, `reg_*`, `fam_*`, and `var_*`.
- `profile show current` and `profile current rebuild` target the derived `bank/profile/current.md` view rather than a standalone canonical record id.
- `meal_*` and `doc_*` ids are stable related ids carried in event payloads, but the CLI read path expects the returned `lookupId`/`eventId` instead.
- `xfm_*` identifies an import batch, not a query-layer record.
- Export pack ids identify derived files under `exports/packs/`; they are not valid `show` targets.
- A successful `show` response may surface a stable related id such as `meal_*` or `doc_*` in `entity.id` even when the lookup key was a queryable event id.

## Success Envelope

All successful commands resolve to this shape:

```json
{
  "command": "show",
  "ok": true,
  "format": "json",
  "requestId": "req-123",
  "data": {},
  "notes": ["optional"],
  "rendered": "optional markdown when format=md"
}
```

Field rules:

- `command`: stable command identifier using the mounted command path.
- `ok`: always `true` for success envelopes.
- `format`: echoes the requested output mode.
- `requestId`: caller value or `null`.
- `data`: command-specific payload described below.
- `notes`: optional non-fatal operator notes.
- `rendered`: optional markdown summary. Present only when markdown formatting is requested and the command supplies one.

## Failure Envelope

All failed commands resolve to this shape:

```json
{
  "command": "document import",
  "ok": false,
  "format": "json",
  "requestId": null,
  "error": {
    "code": "command_failed",
    "message": "Document import failed.",
    "details": {}
  }
}
```

Field rules:

- `code` is a stable string suitable for machine branching.
- `message` is operator-facing and actionable.
- `details` is optional structured context.

## Command Payloads

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
  "lookupIds": ["smp_123", "smp_124"],
  "ledgerFiles": ["<path>"]
}
```

`transformId` identifies the raw import batch only. Use the returned `lookupIds` or `list --kind sample` for follow-on reads.

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

### `show`

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

```json
{
  "vault": "<path>",
  "filters": {
    "kind": "meal",
    "experiment": "sleep-window",
    "dateFrom": "2026-03-01",
    "dateTo": "2026-03-12",
    "cursor": "opaque",
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
  "nextCursor": null
}
```

### `export pack`

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
The five-file pack shape stays stable; health extensions enrich the payloads inside `manifest.json`, `question-pack.json`, `records.json`, and `assistant-context.md` with assessments, profile snapshots/current profile, health history, and registry context.

## Boundary Rules

- `init`, `validate`, `meal add`, `experiment create`, and `journal ensure` delegate to `packages/core`.
- `document import`, `samples import-csv`, and `intake import` delegate to `packages/importers`.
- `intake project`, health `<noun> scaffold`, health `<noun> upsert`, `profile current rebuild`, and `regimen stop` delegate to `packages/core`.
- `show`, `list`, and `export pack` delegate to `packages/query`.
- Contract validation errors normalize to the shared codes in `docs/contracts/04-error-codes.md`.
- The default CLI service layer is expected to delegate to the real `core`, `importers`, and `query` package exports. If the local TypeScript or `incur` toolchain is unavailable, that is an environment blocker, not a contract excuse to return placeholder payloads.
