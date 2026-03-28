# Vault Layout

Status: frozen baseline plus health extension fence

## Baseline Root

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
  bank/foods/<slug>.md
  bank/workout-formats/<slug>.md
  bank/protocols/<group>/<slug>.md
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
  raw/integrations/<provider>/YYYY/MM/<transformId>/<filename>
  raw/integrations/<provider>/YYYY/MM/<transformId>/manifest.json
  ledger/assessments/YYYY/YYYY-MM.jsonl
  ledger/events/YYYY/YYYY-MM.jsonl
  ledger/profile-snapshots/YYYY/YYYY-MM.jsonl
  ledger/samples/<stream>/YYYY/YYYY-MM.jsonl
  audit/YYYY/YYYY-MM.jsonl
  exports/packs/<packId>/
```

## `vault.json`

`vault.json` is a closed metadata document with these required keys:

- `schemaVersion`
- `vaultId`
- `createdAt`
- `title`
- `timezone`
- `idPolicy`
- `paths`
- `shards`

Source contract: `packages/contracts/src/schemas.ts`
Generated artifact: `packages/contracts/generated/vault-metadata.schema.json`

## Path Rules

- All stored paths are relative to the vault root.
- Stored paths may not start with `/` or contain `..`.
- Markdown docs remain human-readable and reviewable in place.
- Raw imports are copied under stable type-specific folders in `raw/` and remain immutable in place.
- Each raw import directory also stores an immutable `manifest.json` sidecar with artifact checksums and import provenance.
- `raw/inbox/**` is the exception: inbox captures store immutable `envelope.json` plus copied attachments as canonical evidence and do not use the generic raw-import manifest contract.
- Assessment source payloads are copied to `raw/assessments/YYYY/MM/<assessmentId>/source.json` and remain immutable in place.
- `raw/samples/<stream>/YYYY/MM/<transformId>/` uses an import-batch identifier returned from `samples import-csv`; baseline does not write a standalone transform record.
- `raw/integrations/<provider>/YYYY/MM/<transformId>/` uses an import-batch identifier returned from normalized device/provider imports and keeps provider API snapshots immutable alongside a manifest.
- Assessment shards use `recordedAt`: `ledger/assessments/YYYY/YYYY-MM.jsonl`.
- Event shards use `occurredAt`: `ledger/events/YYYY/YYYY-MM.jsonl`.
- Profile snapshot shards use `recordedAt`: `ledger/profile-snapshots/YYYY/YYYY-MM.jsonl`.
- Sample shards use `recordedAt`: `ledger/samples/<stream>/YYYY/YYYY-MM.jsonl`.
- Audit shards use `occurredAt`: `audit/YYYY/YYYY-MM.jsonl`.
- Export-pack directories under `exports/packs/<packId>/` are derived, read-only outputs. Current pack ids are path-safe names derived from scope rather than canonical record ids.
- `bank/profile/current.md` is a derived current-state document rebuilt from profile snapshots; append-only truth remains in `ledger/profile-snapshots/`.
- Keep both the snapshot ledger and `bank/profile/current.md`: the ledger is the authoritative historical source and rebuild input, while the Markdown page remains the operator-facing current view.
- Query readers must tolerate `bank/profile/current.md` being stale, missing, or malformed by falling back to the latest snapshot; the materialized page improves human readability but must not become a hard dependency for current-state reads.
- `bank/goals`, `bank/conditions`, `bank/allergies`, `bank/foods`, `bank/workout-formats`, `bank/family`, and `bank/genetics` store one Markdown document per canonical record id or slug-safe alias or saved-default lookup key.
- `bank/foods` stores long-lived remembered foods such as regular restaurant orders, smoothie presets, and grocery staples so assistants can resolve shorthand references without re-scraping menus or ingredient lists, and food records may optionally carry a narrow `autoLogDaily.time` rule for daily note-only meal auto-logging.
- `bank/workout-formats` stores thin reusable workout defaults such as a saved lifting note plus optional duration, type, or distance overrides; `workout format log` still writes the canonical `activity_session` event and does not create a separate workout record family.
- `bank/protocols/**/*.md` allows nested protocol group folders, but every path segment must remain slug-safe ASCII.

## Attachment Conventions

- Document imports use `raw/documents/YYYY/MM/<documentId>/<filename>`.
- Assessment imports use `raw/assessments/YYYY/MM/<assessmentId>/source.json`.
- Meal attachments use `raw/meals/YYYY/MM/<mealId>/<slot>-<filename>`.
- Sample CSV imports use `raw/samples/<stream>/YYYY/MM/<transformId>/<filename>.csv`, where `transformId` is the returned import-batch id.
- Device/provider API snapshot imports use `raw/integrations/<provider>/YYYY/MM/<transformId>/<filename>`, where `transformId` is the returned device-batch id.
- Each raw import directory also reserves `manifest.json` for the immutable sidecar describing imported artifacts, checksums, and provenance.
- `raw/inbox/**` instead reserves `envelope.json` as the immutable capture record and may include copied attachments without manifest sidecars.
- File names are slug-safe ASCII and preserve the original extension.

## Schema Version Policy

- Stored documents and ledgers use explicit `schemaVersion` fields; raw import sidecars also carry a versioned manifest shape.
- Published version strings are immutable.
- Any incompatible change must mint a new version string and come with an explicit cutover decision: ship a one-time core migration or intentionally drop older read support.
- `packages/core` owns migrations and versioned write behavior. Query/CLI paths may validate or branch on versions but must not keep legacy reads alive by silently rewriting stored records during reads.
