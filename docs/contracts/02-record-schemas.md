# Record Schemas

Status: frozen baseline plus health extension fence

Canonical Zod contract sources live in `packages/contracts/src/zod.ts`. The JSON Schema surface in `packages/contracts/src/schemas.ts` and the artifacts in `packages/contracts/generated/` are derived from those Zod definitions.

## ID Policy

Canonical record ids and importer batch ids use one format: `<prefix>_<ULID>`.
Derived export-pack directories use a path-safe pack name and are not canonical vault record ids.

| Family | Prefix | Notes |
| --- | --- | --- |
| vault | `vault` | vault metadata id |
| event | `evt` | canonical event record id |
| sample | `smp` | canonical sample record id |
| audit | `aud` | canonical audit record id |
| transform batch | `xfm` | import-batch id returned from sample-import and normalized device/provider import flows and used in raw paths |
| document | `doc` | related id stored on document events |
| meal | `meal` | related id stored on meal events |
| experiment | `exp` | experiment page id and related event id |
| provider | `prov` | provider page id |
| food | `food` | regular-food page id |
| assessment | `asmt` | assessment response id and raw-assessment path id |
| profile snapshot | `psnap` | append-only profile snapshot id |
| goal | `goal` | goal Markdown record id |
| condition | `cond` | condition Markdown record id |
| allergy | `alg` | allergy Markdown record id |
| protocol | `prot` | protocol Markdown record id |
| family member | `fam` | family-member Markdown record id |
| genetic variant | `var` | genetic-variant Markdown record id |

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
- Profile snapshot records:
  `schemaVersion`, `id`, `recordedAt`, `sourceAssessmentIds`, `sourceEventIds`, `profile`
- Markdown frontmatter:
  `CORE.md`, journal day pages, experiment pages, provider pages, food pages, workout-format pages, and health registry pages each use a closed or explicitly documented frontmatter schema

Baseline does not define a standalone transform record family. `xfm_*` ids are batch identifiers surfaced by import flows and raw-path layout only.

## Event Kinds

| Kind | Required contract fields |
| --- | --- |
| `document` | `documentId`, `documentPath`, `mimeType` |
| `meal` | `mealId`, `photoPaths`, `audioPaths` |
| `symptom` | `symptom`, `intensity` |
| `note` | `note` |
| `observation` | `metric`, `value`, `unit` |
| `experiment_event` | `experimentId`, `experimentSlug`, `phase` |
| `medication_intake` | `medicationName`, `dose`, `unit` |
| `supplement_intake` | `supplementName`, `dose`, `unit` |
| `activity_session` | `activityType`, `durationMinutes` |
| `sleep_session` | `startAt`, `endAt`, `durationMinutes` |
| `intervention_session` | `interventionType` |
| `encounter` | `encounterType`, `location` |
| `procedure` | `procedure`, `status` |
| `test` | `testName`, `resultStatus` |
| `adverse_effect` | `substance`, `effect`, `severity` |
| `exposure` | `exposureType`, `substance` |

Shared optional event fields are limited to `note`, `tags`, `relatedIds`, `rawRefs`, and `externalRef`. `externalRef` stores device/provider provenance as `system`, `resourceType`, `resourceId`, optional `version`, and optional `facet`.

`test` events may also carry optional structured lab payloads. When `testCategory` is `blood`, the canonical `test` event may include `specimenType`, `labName`, `labPanelId`, `collectedAt`, `reportedAt`, `fastingStatus`, and `results`. Each `results[]` entry stores `analyte`, optional `slug`, optional numeric `value` or textual `textValue`, optional `comparator`, optional `unit`, optional `flag`, optional `biomarkerSlug`, optional `note`, and an optional `referenceRange` with numeric `low`, numeric `high`, and/or textual `text` boundaries.

`activity_session` may also include optional `distanceKm` for cardio sessions and optional `strengthExercises` for explicit lifting notes. Each `strengthExercises` entry stores `exercise`, `setCount`, `repsPerSet`, and may also carry `load`, `loadUnit`, and `loadDescription`.

`intervention_session` may also include optional `durationMinutes` when the session length is known and optional `protocolId` when the intervention should stay linked back to one therapy or habit protocol.

## Sample Streams

| Stream | Required contract fields |
| --- | --- |
| `heart_rate` | `value`, `unit: "bpm"` |
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
  `schemaVersion`, `docType`, `experimentId`, `slug`, `status`, `title`, `startedOn`
- Provider frontmatter:
  `schemaVersion`, `docType`, `providerId`, `slug`, `title`, `status`, `specialty`, `organization`
- Food frontmatter:
  `schemaVersion`, `docType`, `foodId`, `slug`, `title`, `status`, `kind`, `vendor`, `ingredients`, optional `autoLogDaily.time`
- Workout-format frontmatter (vault-local saved defaults, not a canonical event family):
  `schemaVersion`, `docType`, `slug`, `title`, `text`, optional `type`, optional `durationMinutes`, optional `distanceKm`
- Profile current frontmatter:
  `schemaVersion`, `docType`, `snapshotId`, `updatedAt`
- Goal frontmatter:
  `schemaVersion`, `docType`, `goalId`, `slug`, `status`, `title`
- Condition frontmatter:
  `schemaVersion`, `docType`, `conditionId`, `slug`, `clinicalStatus`, `title`
- Allergy frontmatter:
  `schemaVersion`, `docType`, `allergyId`, `slug`, `substance`, `status`
- Protocol frontmatter:
  `schemaVersion`, `docType`, `protocolId`, `slug`, `status`, `title`, `startedOn`
- Family-member frontmatter:
  `schemaVersion`, `docType`, `familyMemberId`, `slug`, `relationship`, `title`
- Genetic-variant frontmatter:
  `schemaVersion`, `docType`, `variantId`, `slug`, `gene`, `title`

## Generated Artifact Set

Health artifact filenames are reserved here. They do not become valid generated artifacts until `packages/contracts/src/` exports matching source schemas.

- `vault-metadata.schema.json`
- `event-record.schema.json`
- `sample-record.schema.json`
- `audit-record.schema.json`
- `frontmatter-core.schema.json`
- `frontmatter-journal-day.schema.json`
- `frontmatter-experiment.schema.json`
- `frontmatter-food.schema.json`
- `frontmatter-provider.schema.json`
- `assessment-response.schema.json`
- `profile-snapshot.schema.json`
- `frontmatter-profile-current.schema.json`
- `frontmatter-goal.schema.json`
- `frontmatter-condition.schema.json`
- `frontmatter-allergy.schema.json`
- `frontmatter-protocol.schema.json`
- `frontmatter-family-member.schema.json`
- `frontmatter-genetic-variant.schema.json`
