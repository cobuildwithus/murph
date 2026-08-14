# Record Schemas

Status: frozen baseline plus health extension fence

Canonical Zod contract sources live in `packages/contracts/src/zod.ts`. The JSON Schema surface in `packages/contracts/src/schemas.ts` and the artifacts in `packages/contracts/generated/` are derived from those Zod definitions. The code exports `ID_PREFIXES`, `EVENT_KINDS`, `SAMPLE_STREAMS`, and `schemaCatalog`; those exports are canonical when this human-readable contract needs refreshing.

## ID Policy

Canonical record ids and importer batch ids use one format: `<prefix>_<ULID>`.
Derived export-pack directories use a path-safe pack name and are not canonical vault record ids.
Memory record metadata uses only canonical `mem_<ULID>` ids.

| Family | Prefix | Notes |
| --- | --- | --- |
| vault | `vault` | vault metadata id |
| event | `evt` | canonical event record id |
| sample | `smp` | canonical sample record id |
| audit | `aud` | canonical audit record id |
| automation | `automation` | automation frontmatter id |
| scheduled log | `slog` | scheduled-log frontmatter id |
| transform batch | `xfm` | import-batch id returned from sample-import and normalized device/provider import flows and used in raw paths |
| document | `doc` | related id stored on document events |
| meal | `meal` | related id stored on meal events |
| experiment | `exp` | experiment page id and related event id |
| provider | `prov` | provider page id |
| food | `food` | regular-food page id |
| recipe | `rcp` | recipe page id |
| assessment | `asmt` | assessment response id and raw-assessment path id |
| memory record | `mem` | record id stored inside `bank/memory.md` |
| goal | `goal` | goal Markdown record id |
| condition | `cond` | condition Markdown record id |
| allergy | `alg` | allergy Markdown record id |
| regimen | `reg` | private medication, supplement, therapy, or habit registry id |
| protocol | `prot` | private Health Commons-backed protocol adaptation id |
| family member | `fam` | family-member Markdown record id |
| genetic variant | `var` | genetic-variant Markdown record id |
| workout format | `wfmt` | workout-format page id |

## Record Families

- Vault metadata:
  `formatVersion`, `vaultId`, `createdAt`, `title`, `timezone`
- Event records:
  `schemaVersion`, `id`, `kind`, `occurredAt`, `recordedAt`, `dayKey`, `source`, `title`, plus kind-specific fields and optional provenance fields
- Sample records:
  `schemaVersion`, `id`, `stream`, `recordedAt`, `dayKey`, `source`, `quality`, plus stream-specific fields and optional provenance fields
- Audit records:
  `schemaVersion`, `id`, `action`, `status`, `occurredAt`, `actor`, `commandName`, `summary`, `changes`
- Assessment response records:
  `schemaVersion`, `id`, `assessmentType`, `recordedAt`, `source`, `rawPath`, `responses`
- Inbox capture records:
  `murph.inbox-capture.v2` is the current committed metadata owner and stores capture identity, sanitized message fields, `sourceDirectory`, attachment descriptors, attachment-only `rawRefs`, and at most 20,000 characters of inline text. Capture text is capped at 64 MiB total; a longer value stores its complete UTF-8 body in one immutable content artifact described by `textContent` path, byte size, and SHA-256. Immutable `murph.inbox-capture.v1` records additionally name the historical `envelopePath`; an explicit owner migration may atomically write long-form text content and append an exactly equivalent v2 replacement before deleting that redundant envelope, but readers never rewrite append-only ledger history in place.
- Memory document:
  `docType`, `schemaVersion`, `title`, `updatedAt`, plus sectioned memory records under `Identity`, `Preferences`, `Instructions`, and `Context`. Each stored memory bullet carries a hidden `murph-memory` metadata comment with canonical id, creation time, and update time.
- Preferences singleton:
  `schemaVersion`, `updatedAt`, optional `assistant`, `workoutUnitPreferences`, and `wearablePreferences`
- Markdown frontmatter:
  `CORE.md`, journal day pages, experiment pages, provider pages, food pages, workout-format pages, and health registry pages each use a closed or explicitly documented frontmatter schema

Baseline does not define a standalone transform record family. `xfm_*` ids are batch identifiers surfaced by import flows and raw-path layout only.

## Preferences Singleton

`bank/preferences.json` is the canonical typed product-preferences singleton. Its optional `assistant` object may contain `tone`, `voice`, and a strict sparse `personality` object. Personality supports only `humor`, `push`, and `detail`; each stored value is an integer from 0 through 10.

Missing personality values resolve through the shared contract defaults: Humor 3, Push 3, and Detail 5. Missing means default, not a stored choice. An explicit stored value remains a custom choice even when it equals the current default. Reset removes the selected property, and resetting the final override removes the empty personality object.

`bank/assistant-preference-mutations.json` is a strict versioned companion record containing only the latest mailbox causal sequence applied to each assistant preference field. It is bounded by the fixed field catalog and is committed in the same canonical write batch as an affected `bank/preferences.json` change. Keeping these watermarks out of the user-facing preferences schema preserves reader compatibility while making stale cross-lane replays field-local no-ops.

Personality stores expression preferences only. It never stores prompt text, conversation excerpts, inferred psychological traits, notification policy, or tool authority. In a person member's vault it configures that private Murph; in a synthetic thread-container vault it configures that group room's Murph. A room value is owned by the container and must never be copied from, resolved through, or written to a participant's private preferences.

The preferences schema is strict. Although `assistant.personality` is additive, a binary that predates the field can reject a document after the first personality write. Roll out compatible readers before writers. After a personality override is stored, the first compatible reader/writer version is the rollback floor unless a current compatible binary removes the field through the canonical mutation path.

## Event Kinds

The canonical event-kind list is `EVENT_KINDS` in
`packages/contracts/src/constants.ts`. Current kinds are:

`adverse_effect`, `body_measurement`, `clinical_assertion`, `document`,
`encounter`, `exposure`, `meal`, `measurement`, `symptom`, `note`,
`observation`, `experiment_event`, `experiment_context`, `immunization`,
`medication_intake`, `procedure`, `supplement_intake`, `test`,
`activity_session`, `sleep_session`, and `intervention_session`.

Kind-specific required fields live in the Zod contracts and generated JSON
Schemas. Do not update this document by guessing those fields from CLI options.

Shared event envelope fields include `note`, `tags`, canonical `links[]`, `rawRefs`, `evidence[]`, `attachments`, optional `lifecycle`, and `externalRef`. `links[]` is the canonical relation primitive. `attachments[]` stores canonical file metadata as `role`, `kind`, `relativePath`, `mediaType`, `sha256`, and `originalFileName`, while `rawRefs[]` records the staged raw artifact paths referenced by the event. `evidence[]` stores bounded source pointers for imported clinical facts. Every evidence ref must include a canonical `sourceDocumentId` or vault-relative `rawRef`; it may also include `sourceLabel`, `page`, `chunkId`, text spans, a short excerpt, and confidence. `lifecycle` carries append-only revision state and optional `"deleted"` tombstones. `externalRef` stores device/provider provenance as `system`, `resourceType`, `resourceId`, optional `version`, and optional `facet`.

`test` events may also carry optional structured lab payloads. When `testCategory` is `blood`, the canonical `test` event may include `specimenType`, `labName`, `labPanelId`, `collectedAt`, `reportedAt`, `fastingStatus`, and `results`. Each `results[]` entry stores `analyte`, optional `slug`, optional numeric `value` or textual `textValue`, optional `comparator`, optional `unit`, optional `flag`, optional `biomarkerSlug`, optional `note`, and an optional `referenceRange` with numeric `low`, numeric `high`, and/or textual `text` boundaries.

Blood tests do not define a separate canonical record family. `blood-test` remains the user-facing noun/view over canonical `kind: "test"` event-ledger records.

`clinical_assertion` events store bounded assertion facts such as NKDA/NKFA, denied social-history statements, normality assertions, negative screenings, not-applicable statements, no-known-medications, and no-known-family-history. They carry `assertion`, `assertedOn`, optional `domain`, optional `polarity`, optional `subject`, optional `assertionText`, optional coding fields, and optional source context/evidence. They are not allergy records, because an allergy record represents an actual allergy or intolerance.

Structured clinical notes do not define a separate event kind. They are canonical `kind: "note"` events with optional `noteType`, `authoredAt`, `signedAt`, `author`, `providerId`, `facility`, `encounterId`, and `sections[]`. A section stores `heading`, `text`, and an optional bounded section kind such as `assessment`, `plan`, `results`, or `instructions`.

`vitals`, `diagnostic-test`, `clinical-note`, and `social-history` are user-facing import facades, not canonical event kinds. `vitals` writes `kind: "measurement"` events, `diagnostic-test` writes `kind: "test"` events, `clinical-note` writes `kind: "note"` events, and `social-history` fans out to canonical `clinical_assertion`, `exposure`, or tagged `note` events depending on the imported entry. `social-history` entries require stable `externalRef` values because the canonical event batch reconciles retries on external identity; `current` and `former` exposure-category entries become exposure events, denial-style statuses become clinical assertions, and unknown or unclassified entries remain tagged notes. `social-history import-json` validates the generated canonical event batch before committing so one bad entry does not partially write earlier entries.

Immunizations do not define a separate canonical record family. `immunization` remains the user-facing noun/view over canonical `kind: "immunization"` event-ledger records, with vaccine-specific fields such as `vaccineName`, optional `manufacturer`, optional `lotNumber`, optional `route`, optional `site`, optional `series`, and optional `targetDiseases`.

`encounter` events may carry visit-scoped clinical context: `clinician`, `facility`, `reasonForVisit`, `assessmentText`, `planText`, `instructionsText`, `followUpText`, and `diagnoses[]`. `diagnoses[]` is encounter-scoped only; it does not automatically promote durable `condition` records. Visit facts such as vitals, ordered procedures, and tests stay as linked canonical events using `links[]` with `type: "related_to"` back to the encounter and shared `rawRefs` for provenance. Import payloads for `encounter import-json` must provide stable `eventId` values for the encounter and every linked child fact so retry attempts cannot append duplicate clinical facts under new ids.

`observation` events carry numeric metric facts with `metric`, `value`, and `unit`. Provider observations may also set `observationGrain` to `sample`, `summary`, or `derived_fact` so read paths can understand whether the fact came from a raw sample, a compact summary, or a derived calculation. Admission protects the dangerous storage shape directly: provider adapters must not emit high-frequency wearable telemetry as oversized canonical sample batches, and compact observations do not need an observation-grain gate to be stored. Device-provider imports also cannot set query promotion fields such as `queryVisibility`, `visibility`, or `canonicalFact`; promotion belongs in intentional read/projector code.

`activity_session` also carries a required nested `workout` payload as the canonical structured workout/session detail. Top-level `activityType`, optional `durationMinutes`, and optional `distanceKm` stay as query-friendly summaries, while exercises, sets, loads, session notes, source ids, workout media descriptors, and optional session-scoped `metrics` such as calories, heart rate, HRV, strain, speed, elevation, and recording quality live under `workout`. An absent duration means a verified evidence owner did not prove a valid session length; it does not invalidate otherwise structured workout evidence. Generic event JSONL imports and ordinary workout writers still require or derive a duration before writing, while the Strong/Hevy CSV owner may preserve unknown duration with its raw evidence and aggregate warning. Those nested workout metrics are readable workout detail; daily wearable summaries should consume explicit display-grade daily facts or an intentional projector, not infer daily rollups from raw/session payloads.

`intervention_session` may also include optional `durationMinutes` when the session length is known, optional `regimenId` when the intervention should stay linked back to one private therapy or habit regimen, and optional `experimentId`/`experimentSlug` when the session belongs to one experiment run. Experiment membership is also represented as a `related_to` link to the experiment id so generic link queries and experiment-specific reads stay aligned.

## Sample Streams

| Stream | Required contract fields |
| --- | --- |
| `heart_rate` | `value`, `unit: "bpm"` |
| `spo2` | `value`, `unit: "%"` |
| `hrv` | `value`, `unit: "ms"` |
| `steps` | `value`, `unit: "count"` |
| `sleep_stage` | `stage`, `startAt`, `endAt`, `durationMinutes`, `unit: "stage"` |
| `respiratory_rate` | `value`, `unit: "breaths_per_minute"` |
| `temperature` | `value`, `unit: "celsius"` |
| `glucose` | `value`, `unit: "mg_dL"` |

Sample records may also carry optional `externalRef` provenance with the same shape as events so normalized device/provider imports can dedupe retries against upstream resource ids and versions.

## Frontmatter Contracts

- `CORE.md` frontmatter:
  `schemaVersion`, `docType`, `vaultId`, `title`, `timezone`, `updatedAt`
- Journal day frontmatter:
  `schemaVersion`, `docType`, `dayKey`, `eventIds`, `sampleStreams`
- Experiment frontmatter:
  `schemaVersion`, `docType`, `experimentId`, `slug`, `status`, `title`, `startedOn`, `commonsProtocolRef`, optional private `protocolRef`, optional `effectiveProtocolSnapshot`, optional `runPlan.baseline` with `mode: prospective | retrospective | omitted`, and optional analysis evidence in `analysisPlan.measurementAnchors[]` plus future timing in `analysisPlan.plannedMeasurements[]`. `runPlan.baseline` is the run baseline or pre-intervention window; lab panels and other observed measurement evidence belong in `analysisPlan.measurementAnchors[]`. Protocol-backed experiments require the public `commonsProtocolRef` plus the effective snapshot; private `protocolRef` is present only when the run uses a saved private adaptation.
- Provider frontmatter:
  `schemaVersion`, `docType`, `providerId`, `slug`, `title`, `status`, `specialty`, `organization`
- Food frontmatter:
  `schemaVersion`, `docType`, `foodId`, `slug`, `title`, `status`, `kind`, `vendor`, `ingredients`, optional `autoLogDaily.time`
- Automation frontmatter:
  `schemaVersion`, `docType`, `automationId`, `slug`, `title`, `status`, schedule fields, optional assistant target override, and prompt/delivery policy fields
- Scheduled-log frontmatter:
  `schemaVersion`, `docType`, `scheduledLogId`, `slug`, `title`, `status`, schedule fields, and log template fields
- Recipe frontmatter:
  `schemaVersion`, `docType`, `recipeId`, `slug`, `title`, `status`, ingredients, steps, and optional nutrition or linking fields
- Workout-format frontmatter (vault-local saved defaults, not a canonical event family):
  `schemaVersion`, `docType`, `workoutFormatId`, `slug`, `title`, `status`, `activityType`, required `template`, optional `durationMinutes`, optional `distanceKm`, optional `templateText`
- Memory frontmatter:
  `docType: "memory"`, `schemaVersion: "murph.frontmatter.memory.v1"`, `title`, `updatedAt`
- Goal frontmatter:
  `schemaVersion`, `docType`, `goalId`, `slug`, `status`, `title`
- Condition frontmatter:
  `schemaVersion`, `docType`, `conditionId`, `slug`, `clinicalStatus`, `title`
- Allergy frontmatter:
  `schemaVersion`, `docType`, `allergyId`, `slug`, `substance`, `status`
- Regimen frontmatter:
  `schemaVersion`, `docType`, `regimenId`, `slug`, `status`, `title`, `kind`, `startedOn`, optional `note`
- Protocol frontmatter:
  `schemaVersion`, `docType`, `protocolId`, `slug`, `title`, `status`, `commonsProtocolRef`, `lineage`, `diff`, `effectiveSpec`, `personalization`, `effectiveSpecHash`, `protocolRevisionId`
- Family-member frontmatter:
  `schemaVersion`, `docType`, `familyMemberId`, `slug`, `relationship`, `title`, optional `conditions[]`, optional structured `conditionHistory[]`, optional `deceased`, and optional `note`. Each `conditionHistory[]` entry stores a condition statement plus optional code, code system, status, certainty, onset, deceased-cause flag, source label, evidence refs, and note.
- Genetic-variant frontmatter:
  `schemaVersion`, `docType`, `variantId`, `slug`, `gene`, `title`

## Generated Artifact Set

Health artifact filenames are reserved here. They do not become valid generated artifacts until `packages/contracts/src/` exports matching source schemas.

- `vault-metadata.schema.json`
- `event-record.schema.json`
- `sample-record.schema.json`
- `audit-record.schema.json`
- `inbox-capture-record.schema.json`
- `metric-sample-record.schema.json`
- `preferences-document.schema.json`
- `frontmatter-automation.schema.json`
- `frontmatter-core.schema.json`
- `frontmatter-journal-day.schema.json`
- `frontmatter-experiment.schema.json`
- `frontmatter-food.schema.json`
- `frontmatter-provider.schema.json`
- `frontmatter-recipe.schema.json`
- `frontmatter-scheduled-log.schema.json`
- `frontmatter-workout-format.schema.json`
- `assessment-response.schema.json`
- `frontmatter-goal.schema.json`
- `frontmatter-condition.schema.json`
- `frontmatter-allergy.schema.json`
- `frontmatter-regimen.schema.json`
- `frontmatter-protocol.schema.json`
- `frontmatter-family-member.schema.json`
- `frontmatter-genetic-variant.schema.json`
