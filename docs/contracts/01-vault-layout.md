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
  bank/assistant-preference-mutations.json
  bank/automations/<slug>.md
  bank/scheduled-logs/<slug>.md
  bank/experiments/<slug>.md
  bank/experiments/outcomes/<filename>.json
  bank/goals/<slug>.md
  bank/conditions/<slug>.md
  bank/allergies/<slug>.md
  bank/regimens/<group>/<slug>.md
  bank/protocols/<slug>.md
  bank/family/<slug>.md
  bank/genetics/<slug>.md
  bank/foods/<slug>.md
  bank/recipes/<slug>.md
  bank/providers/<slug>.md
  bank/workout-formats/<slug>.md
  bank/habitat/<slug>.md
  bank/library/<slug>.md
  raw/documents/YYYY/MM/<documentId>/<filename>
  raw/documents/YYYY/MM/<documentId>/manifest.json
  raw/assessments/YYYY/MM/<assessmentId>/source.json
  raw/assessments/YYYY/MM/<assessmentId>/manifest.json
  raw/captures/YYYY/MM/<eventId>/<filename>
  raw/captures/YYYY/MM/<eventId>/manifest.json
  raw/inbox/<source>/<account>/YYYY/MM/<captureId>/attachments/<filename>
  ledger/inbox-attachment-retention/YYYY/YYYY-MM.jsonl
  raw/measurements/YYYY/MM/<eventId>/<filename>
  raw/measurements/YYYY/MM/<eventId>/manifest.json
  raw/meals/YYYY/MM/<mealId>/<slot>-<filename>
  raw/meals/YYYY/MM/<mealId>/manifest.json
  raw/samples/<stream>/YYYY/MM/<transformId>/<filename>.csv
  raw/samples/<stream>/YYYY/MM/<transformId>/manifest.json
  raw/workouts/YYYY/MM/<eventId>/<filename>
  raw/workouts/YYYY/MM/<eventId>/manifest.json
  ledger/inbox-captures/YYYY/YYYY-MM.jsonl
  derived/inbox/<captureId>/attachments/<attachmentId>/attempts/<attempt>/result.json
  ledger/assessments/YYYY/YYYY-MM.jsonl
  ledger/events/YYYY/YYYY-MM.jsonl
  ledger/integration-ingests/YYYY/YYYY-MM.jsonl
  ledger/metric-samples/<metric>/YYYY/YYYY-MM.jsonl
  ledger/samples/<stream>/YYYY/YYYY-MM.jsonl
  audit/YYYY/YYYY-MM.jsonl
  derived/knowledge/index.md
  derived/knowledge/log.md
  derived/knowledge/pages/<slug>.md
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
- Non-device raw imports are copied under stable type-specific folders in `raw/` and remain immutable in place.
- Each non-device raw import directory also stores an immutable `manifest.json` sidecar with artifact checksums and import provenance.
- `raw/inbox/**` is the exception: `ledger/inbox-captures/YYYY/YYYY-MM.jsonl` is the sole committed metadata owner, while `raw/inbox/**` retains attachment bytes that need raw storage and a hash/size-verified `text.txt` only when capture text exceeds the 20,000-character inline projection. Capture text is capped at 64 MiB total. The explicit legacy-envelope owner migration also retains `text.txt` at exactly 20,000 characters because the legacy projection cannot prove whether more text existed; it verifies every non-retained attachment receipt and rejects an existing current owner before deleting the envelope. Current `murph.inbox-capture.v2` records carry the complete sanitized envelope metadata plus content references, so new captures do not write a redundant `envelope.json` or a generic raw-import manifest. Image attachment bytes are normalized to bounded static WebP before they are written here or left unstored, and canonical raw metadata drops size-like provider fields instead of retaining original byte sizes. Raw inbox image/audio/video bytes may expire after 14 days when `ledger/inbox-attachment-retention/YYYY/YYYY-MM.jsonl` records the deleted path, sha256, purge time, reason, and retained parser derivative; long-form text content is canonical message content and does not use media retention.
- Legacy `murph.inbox-capture.v1` records and their raw `envelope.json` files remain readable. `vault repair-inbox-envelopes` is the dry-run-first owner migration: apply writes any required immutable text content, appends an exactly equivalent v2 record, and deletes the inspected legacy envelope in one receipt-guarded canonical batch. A missing v1 envelope is valid only when that equivalent v2 replacement exists and every referenced content byte matches its recorded size and hash; manual deletion, mismatches, duplicate ownership, and active operations fail closed.
- Assistant inbox automation may additionally preserve accepted stored inbox document attachments into canonical document imports under `raw/documents/**`, but the inbox-capture ledger remains the source-capture metadata owner and `raw/inbox/**` remains the transient attachment-byte layer. Promotion does not pin the duplicate raw inbox media bytes; explicit durability belongs to the promoted owner path or an active protected reference.
- Assessment source payloads are copied to `raw/assessments/YYYY/MM/<assessmentId>/source.json` and remain immutable in place.
- `raw/samples/<stream>/YYYY/MM/<transformId>/` uses an import-batch identifier returned from `samples import-csv`; baseline does not write a standalone transform record.
- Assessment shards use `recordedAt`: `ledger/assessments/YYYY/YYYY-MM.jsonl`.
- Inbox-capture shards use `occurredAt`: `ledger/inbox-captures/YYYY/YYYY-MM.jsonl`.
- Inbox attachment retention shards use `purgedAt`: `ledger/inbox-attachment-retention/YYYY/YYYY-MM.jsonl`.
- Event shards use `occurredAt`: `ledger/events/YYYY/YYYY-MM.jsonl`.
- Integration-ingest shards use `importedAt`: `ledger/integration-ingests/YYYY/YYYY-MM.jsonl`. Device/provider evidence is retained inline in these append-only records with exact UTF-8 bytes, byte counts, SHA-256 hashes, receipts, logical roles, and canonical output ids. Closed months may replace that logical JSONL shard with `ledger/integration-ingests/YYYY/YYYY-MM.jsonl.gz` or `ledger/integration-ingests/YYYY/YYYY-MM.jsonl.zip`; readers treat the uncompressed `.jsonl` path as the logical shard path. Hosted idle-shutdown maintenance automatically replaces valid, bounded closed raw months with deterministic level-6 gzip representations before the encrypted workspace snapshot. The pass has a 30-second runtime budget; any untouched closed raw months remain the durable worklist for a later idle checkpoint. The current UTC month and future-dated months remain raw and appendable, and an arriving foreground wake aborts this maintenance before snapshotting. Publication verifies the complete decompressed byte receipt and every integration-ingest row before removing the raw representation. A crash after gzip publication but before raw removal can leave an exact closed-month duplicate; startup deletes the raw copy only when both representations independently validate, are newline-terminated, and have identical decompressed size and SHA-256, while every mismatch remains a fail-closed representation conflict. Portable data-bundle staging applies the same lossless closed-month gzip shape without mutating the source vault. Generic write paths must not mutate archived integration-ingest months, but the core integration-ingest append planner may explicitly amend an archived month by replacing the single physical archive representation after shard, id, size/hash, replay, and rollback checks pass. Normal gzip reads and amendments stream bounded decompressed chunks; legacy ZIP compatibility remains bounded and may buffer its single entry. Each logical month must have exactly one physical representation, so archiving and amendments are replacement operations rather than copy-and-leave. ZIP archives are bounded before inflate and must contain exactly one entry whose name is the JSONL shard filename, with no path components.
- Metric-sample shards use `recordedAt`: `ledger/metric-samples/<metric>/YYYY/YYYY-MM.jsonl`.
- Sample shards use `recordedAt`: `ledger/samples/<stream>/YYYY/YYYY-MM.jsonl`. These shards are explicit import/debug ledgers; default query/read/browser paths use sparse entities and compact metric rows instead.
- Audit shards use `occurredAt`: `audit/YYYY/YYYY-MM.jsonl`.
- When materialized, export-pack directories under `exports/packs/<packId>/` are derived, read-only outputs. Current pack ids are path-safe names derived from scope rather than canonical record ids. This is the only currently reserved `exports/**` subtree; every other `exports/**` path remains ordinary vault content, and pathname shape alone grants no cleanup or packaging-exclusion authority. A generated ZIP may carry an explicit bounded list of included pack ids; before approval, the host captures each available matching manifest hash and ignores unavailable or mismatched cleanup claims so optional retirement cannot block delivery. Only after durable delivery success does it make one best-effort removal attempt for still-matching packs. Changed packs and every non-success delivery remain untouched. A missed attempt leaves harmless derived residue and creates no retry, recovery, or background-maintenance owner.
- `.runtime/operations/assistant/generated-deliveries/<filename>` is the sole flat assistant-runtime ref exception for restart-safe one-time delivery residue. The same turn that establishes a send obligation may create and adopt one direct single-link regular file there before calling `send_vault_file` with a semantic provider call id; generated-file calls are serialized, and missing identity fails before adoption. Adoption tightens runtime parents to `0700`, the file to `0600`, and transfers the friendly source to its deterministic owned ref without clobbering an existing target. Exact active descriptors preserve the file in encrypted hosted checkpoints. Snapshot construction materializes deferred skipped-inline files before quiescent cleanup, which removes only terminal, changed, or orphaned direct files after the complete physical inventory and outbox state are trusted; archive planning cannot reintroduce removed residue. An orphan hardlink removes only the runtime-owned link, while an active hardlink fails closed. Every other hidden vault-file ref remains invalid, and portable support bundles omit this path with the rest of `.runtime/**`. `exports/assistant-deliveries/**` is an ordinary, unreserved vault path.
- `bank/memory.md` is the durable freeform current-state document for user-facing context that should stay small enough to read whole.
- `bank/preferences.json` is the canonical typed preferences singleton for compact machine-readable defaults such as workout units.
- `bank/assistant-preference-mutations.json` is the separately versioned, bounded per-field causal-watermark companion for assistant preferences. The core preference owner stages it atomically with affected preference writes; user-facing preference readers do not need to understand it.
- `bank/automations/*.md` stores canonical assistant automation definitions, including schedule, route, optional assistant target override, and continuity policy frontmatter alongside the authored prompt body.
- `bank/scheduled-logs/*.md` stores canonical scheduled log definitions that later mint canonical events when the schedule executes.
- Experiment storage has an exact allowlist: canonical experiment records are direct `bank/experiments/<slug>.md` files, and reserved machine-written outcomes are direct `bank/experiments/outcomes/*.json` files. Generic query and assistant readers inspect only the direct canonical Markdown documents. The encrypted hosted browser-vault replica builder may additionally dereference the one direct outcome JSON named by a schema-valid experiment `outcomeRef`; it validates the direct path, outcome schema, exact reference, and stable experiment identity before projection, and includes the referenced bytes in its source hash. Each valid referenced outcome artifact is write-once and owns its saved title, status, protocol, analysis-window, metric-summary, and any daily metric-point snapshots it contains, so later supported lifecycle, metadata, or metric-data edits do not invalidate or rewrite that historical result. Terminal closeout may advance an active run's interim reference to its distinct final outcome ID; it never overwrites either artifact. Current v2 outcomes require bounded point snapshots consistent with their saved counts and means. Legacy v1 outcomes remain readable and aggregate-only. Results projection may pair their saved averages with current browser-safe daily measurements selected strictly by the artifact's saved biomarker identities and windows; it does not upgrade the stored or replicated artifact or represent those display points as historical saved evidence. Media, nested Markdown, symlinks, and other files under `bank/experiments/**` are invalid storage.
- `bank/goals`, `bank/conditions`, `bank/allergies`, `bank/foods`, `bank/recipes`, `bank/providers`, `bank/workout-formats`, `bank/family`, and `bank/genetics` store one Markdown document per canonical record id or slug-safe alias or saved-default lookup key.
- `bank/library/**/*.md` is the stable health reference layer for reusable entities such as biomarkers, domains, protocol variants, and source artifacts. It is durable reference context, not the user-specific synthesized wiki.
- `bank/foods` stores long-lived remembered foods such as regular restaurant orders, smoothie presets, and grocery staples so assistants can resolve shorthand references without re-scraping menus or ingredient lists, and food records may optionally carry a narrow `autoLogDaily.time` rule for daily note-only meal auto-logging.
- `bank/workout-formats` stores reusable workout templates plus summary defaults such as activity type, duration, distance, and saved routine text; `workout format log` still writes the canonical `activity_session` event and does not create a separate workout record family.
- `bank/habitat/*.md` stores one optional canonical living-context aspect document per versioned habitat catalog aspect.
- `bank/regimens/**/*.md` stores the private medication, supplement, therapy, and habit registry. Nested regimen group folders are allowed, but every path segment must remain slug-safe ASCII.
- `bank/protocols/*.md` stores private reusable adaptations of Health Commons protocols. Public Health Commons recipes remain under the separate `commons protocol` lookup surface and are not copied into the private vault by default.
- `derived/knowledge/index.md` is the content-oriented entrypoint into the personal compiled wiki.
- `derived/knowledge/log.md` is the append-only chronological log of derived knowledge writes.
- `derived/knowledge/pages/*.md` stores the non-canonical assistant-authored personal wiki pages; these pages may optionally link back to stable `bank/library` entities through `librarySlugs` frontmatter.

## Attachment Conventions

- Document imports use `raw/documents/YYYY/MM/<documentId>/<filename>`.
- Auto-preserved inbox document attachments reuse the same `raw/documents/YYYY/MM/<documentId>/<filename>` contract instead of introducing a second evidence folder family.
- Assessment imports use `raw/assessments/YYYY/MM/<assessmentId>/source.json`.
- Capture imports use `raw/captures/YYYY/MM/<eventId>/<filename>`.
- `vault repair-experiment-media` is the proof-driven recovery path for supported legacy media under `bank/experiments/**`. A candidate qualifies only when its boundary-safe, byte-exact full vault-relative source path appears in exactly one direct canonical experiment document. Basenames, relative or encoded paths, substrings, case or Unicode normalization variants, residual alternate spellings, or owners in multiple documents do not qualify. The command dry-runs by default. Explicit apply copies through the canonical capture owner, verifies the event, attachment, raw byte, and manifest, replaces only the proved full-path literals with the canonical capture path, then atomically quarantines and verifies the inspected note and legacy source before replacing or deleting either path. A concurrent edit or interruption preserves recoverable bytes rather than overwriting them. Unsupported, unassociated, multiply-associated, ambiguous-reference, symlink, special, or conflicting files block apply.
- Inbox captures store metadata in `ledger/inbox-captures/YYYY/YYYY-MM.jsonl` and, when needed, attachment bytes under `raw/inbox/<source>/<account>/YYYY/MM/<captureId>/attachments/`.
- Body-measurement attachments use `raw/measurements/YYYY/MM/<eventId>/<filename>`.
- Meal attachments use `raw/meals/YYYY/MM/<mealId>/<slot>-<filename>`.
- An automatic meal-capture photo may be retired only by the canonical `meal remove-photo` mutation after inspection. The mutation appends a meal revision without the photo reference and atomically replaces the image bytes in place with `murph.automatic-meal-photo-tombstone.v1`; the matching manifest artifact becomes `application/json` with role `privacy_tombstone` and records the purge provenance. Ordinary meal photos are ineligible.
- Sample CSV imports use `raw/samples/<stream>/YYYY/MM/<transformId>/<filename>.csv`, where `transformId` is the returned import-batch id.
- Workout attachments use `raw/workouts/YYYY/MM/<eventId>/<filename>`.
- Device/provider API snapshot imports use `ledger/integration-ingests/YYYY/YYYY-MM.jsonl` for live months, may read closed months from `.jsonl.gz` or `.jsonl.zip` archives, and do not create `raw/integrations` files or manifest sidecars.
- Each non-device raw import directory also reserves `manifest.json` for the sidecar describing imported artifacts, checksums, and provenance. It is immutable except for the receipt-checked automatic meal-photo retirement above.
- `raw/inbox/**` may contain canonical attachment bytes without manifest sidecars; its owning current inbox-capture ledger record supplies the metadata boundary. Image/audio/video bytes intentionally expired by retention leave the ledger record intact and are represented by `ledger/inbox-attachment-retention/**` so readers can surface `retention_expired` instead of corruption.
- Each parser attempt is consumed as one versioned `murph.parser-output.v1` bundle at `derived/inbox/<captureId>/attachments/<attachmentId>/attempts/<attempt>/result.json`. The owning parser-output contract applies one 512 MiB canonical serialized ceiling to provider normalization, publication, reads, and legacy compaction. This covers the 292 MiB aggregate legacy sidecar ceilings plus normalized JSON expansion while keeping result I/O bounded. `vault compact-inbox-parser-attempts` dry-runs by default and replaces a legacy manifest/plain-text/Markdown/chunks/tables set only after exact path, identity, and semantic-equivalence validation.
- File names are slug-safe ASCII and preserve the original extension.

## Schema Version Policy

- `vault.json` uses `formatVersion` as its sole compatibility knob.
- Stored documents and ledgers use explicit `schemaVersion` fields; raw import sidecars also carry a versioned manifest shape.
- Published version strings are immutable.
- Any incompatible change must mint a new version string and either ship an explicit core migration or fail closed until one exists.
- `packages/core` owns the future migration seam and versioned write behavior. Current older-format vaults fail closed until an explicit upgrade step is registered, and query/CLI paths must not keep legacy reads alive by silently rewriting stored records during reads.
