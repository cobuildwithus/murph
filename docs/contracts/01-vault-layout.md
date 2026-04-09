# Vault Layout

Status: frozen current contract plus health extension fence

## Baseline Root

```text
  vault/
  vault.json
  CORE.md
  journal/YYYY/YYYY-MM-DD.md
  bank/memory.md
  bank/preferences.json
  bank/experiments/<slug>.md
  bank/providers/<provider-slug>.md
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
  raw/measurements/YYYY/MM/<eventId>/<filename>
  raw/measurements/YYYY/MM/<eventId>/manifest.json
  raw/meals/YYYY/MM/<mealId>/<slot>-<filename>
  raw/meals/YYYY/MM/<mealId>/manifest.json
  raw/samples/<stream>/YYYY/MM/<transformId>/<filename>.csv
  raw/samples/<stream>/YYYY/MM/<transformId>/manifest.json
  raw/workouts/YYYY/MM/<eventId>/<filename>
  raw/workouts/YYYY/MM/<eventId>/manifest.json
  raw/integrations/<provider>/YYYY/MM/<transformId>/<filename>
  raw/integrations/<provider>/YYYY/MM/<transformId>/manifest.json
  ledger/inbox-captures/YYYY/YYYY-MM.jsonl
  ledger/assessments/YYYY/YYYY-MM.jsonl
  ledger/events/YYYY/YYYY-MM.jsonl
  ledger/samples/<stream>/YYYY/YYYY-MM.jsonl
  audit/YYYY/YYYY-MM.jsonl
  derived/knowledge/index.md
  derived/knowledge/log.md
  derived/knowledge/pages/<slug>.md
  exports/packs/<packId>/
```

## `vault.json`

`vault.json` is a closed metadata document with these required keys:

- `formatVersion`
- `vaultId`
- `createdAt`
- `title`
- `timezone`

`vault.json` stores instance facts only. Layout paths, shard patterns, and id-prefix policy are code-owned runtime contract details rather than per-vault durable data.

Source contract: `packages/contracts/src/schemas.ts`
Generated artifact: `packages/contracts/generated/vault-metadata.schema.json`

## Path Rules

- All stored paths are relative to the vault root.
- Stored paths may not start with `/` or contain `..`.
- Markdown docs remain human-readable and reviewable in place.
- Raw imports are copied under stable type-specific folders in `raw/` and remain immutable in place.
- Each raw import directory also stores an immutable `manifest.json` sidecar with artifact checksums and import provenance.
- `raw/inbox/**` is the exception: inbox captures store immutable `envelope.json` plus copied attachments as canonical evidence, and the structured canonical capture facts live in `ledger/inbox-captures/YYYY/YYYY-MM.jsonl` instead of the generic raw-import manifest contract.
- Assistant inbox automation may additionally preserve accepted stored inbox document attachments into canonical document imports under `raw/documents/**`, but `raw/inbox/**` remains the source-capture layer for the original message envelope and copied attachment bytes.
- Assessment source payloads are copied to `raw/assessments/YYYY/MM/<assessmentId>/source.json` and remain immutable in place.
- `raw/samples/<stream>/YYYY/MM/<transformId>/` uses an import-batch identifier returned from `samples import-csv`; baseline does not write a standalone transform record.
- `raw/integrations/<provider>/YYYY/MM/<transformId>/` uses an import-batch identifier returned from normalized device/provider imports and keeps provider API snapshots immutable alongside a manifest.
- Assessment shards use `recordedAt`: `ledger/assessments/YYYY/YYYY-MM.jsonl`.
- Inbox-capture shards use `occurredAt`: `ledger/inbox-captures/YYYY/YYYY-MM.jsonl`.
- Event shards use `occurredAt`: `ledger/events/YYYY/YYYY-MM.jsonl`.
- Sample shards use `recordedAt`: `ledger/samples/<stream>/YYYY/YYYY-MM.jsonl`.
- Audit shards use `occurredAt`: `audit/YYYY/YYYY-MM.jsonl`.
- Export-pack directories under `exports/packs/<packId>/` are derived, read-only outputs. Current pack ids are path-safe names derived from scope rather than canonical record ids.
- `bank/memory.md` is the durable freeform current-state document for user-facing context that should stay small enough to read whole.
- `bank/preferences.json` is the canonical typed preferences singleton for compact machine-readable defaults such as workout units.
- `bank/goals`, `bank/conditions`, `bank/allergies`, `bank/foods`, `bank/workout-formats`, `bank/family`, and `bank/genetics` store one Markdown document per canonical record id or slug-safe alias or saved-default lookup key.
- `bank/library/**/*.md` is the stable health reference layer for reusable entities such as biomarkers, domains, protocol variants, and source artifacts. It is durable reference context, not the user-specific synthesized wiki.
- `bank/foods` stores long-lived remembered foods such as regular restaurant orders, smoothie presets, and grocery staples so assistants can resolve shorthand references without re-scraping menus or ingredient lists, and food records may optionally carry a narrow `autoLogDaily.time` rule for daily note-only meal auto-logging.
- `bank/workout-formats` stores reusable workout templates plus summary defaults such as activity type, duration, distance, and saved routine text; `workout format log` still writes the canonical `activity_session` event and does not create a separate workout record family.
- `bank/protocols/**/*.md` allows nested protocol group folders, but every path segment must remain slug-safe ASCII.
- `derived/knowledge/index.md` is the content-oriented entrypoint into the personal compiled wiki.
- `derived/knowledge/log.md` is the append-only chronological log of derived knowledge writes.
- `derived/knowledge/pages/*.md` stores the non-canonical assistant-authored personal wiki pages; these pages may optionally link back to stable `bank/library` entities through `librarySlugs` frontmatter.

## Attachment Conventions

- Document imports use `raw/documents/YYYY/MM/<documentId>/<filename>`.
- Auto-preserved inbox document attachments reuse the same `raw/documents/YYYY/MM/<documentId>/<filename>` contract instead of introducing a second evidence folder family.
- Assessment imports use `raw/assessments/YYYY/MM/<assessmentId>/source.json`.
- Body-measurement attachments use `raw/measurements/YYYY/MM/<eventId>/<filename>`.
- Meal attachments use `raw/meals/YYYY/MM/<mealId>/<slot>-<filename>`.
- Sample CSV imports use `raw/samples/<stream>/YYYY/MM/<transformId>/<filename>.csv`, where `transformId` is the returned import-batch id.
- Workout attachments use `raw/workouts/YYYY/MM/<eventId>/<filename>`.
- Device/provider API snapshot imports use `raw/integrations/<provider>/YYYY/MM/<transformId>/<filename>`, where `transformId` is the returned device-batch id.
- Each raw import directory also reserves `manifest.json` for the immutable sidecar describing imported artifacts, checksums, and provenance.
- `raw/inbox/**` instead reserves `envelope.json` as the immutable capture record and may include copied attachments without manifest sidecars.
- File names are slug-safe ASCII and preserve the original extension.

## Schema Version Policy

- `vault.json` uses `formatVersion` as its sole compatibility knob.
- Stored documents and ledgers use explicit `schemaVersion` fields; raw import sidecars also carry a versioned manifest shape.
- Published version strings are immutable.
- Any incompatible change must mint a new version string and either ship an explicit core migration or fail closed until one exists.
- `packages/core` owns the future migration seam and versioned write behavior. Current older-format vaults fail closed until an explicit upgrade step is registered, and query/CLI paths must not keep legacy reads alive by silently rewriting stored records during reads.
