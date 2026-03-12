import {
  AUDIT_ACTIONS,
  AUDIT_ACTORS,
  AUDIT_STATUSES,
  CONTRACT_ID_FORMAT,
  CONTRACT_SCHEMA_VERSION,
  ERROR_CODE_VALUES,
  EVENT_KINDS,
  EVENT_SOURCES,
  EXPERIMENT_PHASES,
  EXPERIMENT_STATUSES,
  FILE_CHANGE_OPERATIONS,
  FRONTMATTER_DOC_TYPES,
  ID_PREFIXES,
  SAMPLE_QUALITIES,
  SAMPLE_SOURCES,
  SAMPLE_STREAMS,
  SLEEP_STAGES,
} from "./constants.js";
import { GENERIC_CONTRACT_ID_PATTERN, idPattern } from "./ids.js";
import type { EventKind, JsonSchema, SampleStream } from "./types.js";

type StringSchemaOptions = {
  const?: string;
  enum?: readonly string[];
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
};

type NumericSchemaOptions = {
  const?: number;
  minimum?: number;
  maximum?: number;
};

type ArraySchemaOptions = {
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
};

export type { JsonSchema } from "./types.js";

const JSON_SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";
const DAY_KEY_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const RELATIVE_PATH_PATTERN = "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$";
const RAW_PATH_PATTERN = "^raw/[A-Za-z0-9._/-]+$";
const SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const UNIT_PATTERN = "^[A-Za-z0-9._/%-]+$";

function stringSchema(options: StringSchemaOptions = {}): JsonSchema {
  return { type: "string", ...options };
}

function idSchema(prefix: string): JsonSchema {
  return stringSchema({ pattern: idPattern(prefix) });
}

function integerSchema(options: NumericSchemaOptions = {}): JsonSchema {
  return { type: "integer", ...options };
}

function numberSchema(options: NumericSchemaOptions = {}): JsonSchema {
  return { type: "number", ...options };
}

function stringArraySchema(itemSchema: JsonSchema = stringSchema(), options: ArraySchemaOptions = {}): JsonSchema {
  return {
    type: "array",
    items: itemSchema,
    ...options,
  };
}

function closedObject(required: readonly string[], properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

function withDraft(id: string, title: string, schema: JsonSchema): JsonSchema {
  return {
    $schema: JSON_SCHEMA_DRAFT,
    $id: id,
    title,
    ...schema,
  };
}

const baseEventProperties: Record<string, JsonSchema> = {
  schemaVersion: { const: CONTRACT_SCHEMA_VERSION.event },
  id: idSchema(ID_PREFIXES.event),
  kind: stringSchema({ enum: EVENT_KINDS }),
  occurredAt: stringSchema({ format: "date-time" }),
  recordedAt: stringSchema({ format: "date-time" }),
  dayKey: stringSchema({ pattern: DAY_KEY_PATTERN }),
  source: stringSchema({ enum: EVENT_SOURCES }),
  title: stringSchema({ minLength: 1, maxLength: 160 }),
  note: stringSchema({ minLength: 1, maxLength: 4000 }),
  tags: stringArraySchema(stringSchema({ pattern: SLUG_PATTERN }), { uniqueItems: true }),
  relatedIds: stringArraySchema(stringSchema({ pattern: GENERIC_CONTRACT_ID_PATTERN }), { uniqueItems: true }),
  rawRefs: stringArraySchema(stringSchema({ pattern: RAW_PATH_PATTERN }), { uniqueItems: true }),
};

function eventSchema(
  kind: EventKind,
  extraRequired: readonly string[],
  extraProperties: Record<string, JsonSchema>,
): JsonSchema {
  return closedObject(
    [
      "schemaVersion",
      "id",
      "kind",
      "occurredAt",
      "recordedAt",
      "dayKey",
      "source",
      "title",
      ...extraRequired,
    ],
    {
      ...baseEventProperties,
      kind: { const: kind },
      ...extraProperties,
    },
  );
}

const baseSampleProperties: Record<string, JsonSchema> = {
  schemaVersion: { const: CONTRACT_SCHEMA_VERSION.sample },
  id: idSchema(ID_PREFIXES.sample),
  stream: stringSchema({ enum: SAMPLE_STREAMS }),
  recordedAt: stringSchema({ format: "date-time" }),
  dayKey: stringSchema({ pattern: DAY_KEY_PATTERN }),
  source: stringSchema({ enum: SAMPLE_SOURCES }),
  quality: stringSchema({ enum: SAMPLE_QUALITIES }),
};

function sampleSchema(
  stream: SampleStream,
  extraRequired: readonly string[],
  extraProperties: Record<string, JsonSchema>,
): JsonSchema {
  return closedObject(
    [
      "schemaVersion",
      "id",
      "stream",
      "recordedAt",
      "dayKey",
      "source",
      "quality",
      ...extraRequired,
    ],
    {
      ...baseSampleProperties,
      stream: { const: stream },
      ...extraProperties,
    },
  );
}

export const vaultMetadataSchema = withDraft(
  "@healthybob/contracts/vault-metadata.schema.json",
  "Healthy Bob Vault Metadata",
  closedObject(
    [
      "schemaVersion",
      "vaultId",
      "createdAt",
      "title",
      "timezone",
      "idPolicy",
      "paths",
      "shards",
    ],
    {
      schemaVersion: { const: CONTRACT_SCHEMA_VERSION.vault },
      vaultId: idSchema(ID_PREFIXES.vault),
      createdAt: stringSchema({ format: "date-time" }),
      title: stringSchema({ minLength: 1, maxLength: 120 }),
      timezone: stringSchema({ minLength: 3, maxLength: 64 }),
      idPolicy: closedObject(["format", "prefixes"], {
        format: { const: CONTRACT_ID_FORMAT },
        prefixes: closedObject(
          [
            "audit",
            "document",
            "event",
            "experiment",
            "meal",
            "pack",
            "provider",
            "sample",
            "transform",
            "vault",
          ],
          {
            audit: { const: ID_PREFIXES.audit },
            document: { const: ID_PREFIXES.document },
            event: { const: ID_PREFIXES.event },
            experiment: { const: ID_PREFIXES.experiment },
            meal: { const: ID_PREFIXES.meal },
            pack: { const: ID_PREFIXES.pack },
            provider: { const: ID_PREFIXES.provider },
            sample: { const: ID_PREFIXES.sample },
            transform: { const: ID_PREFIXES.transform },
            vault: { const: ID_PREFIXES.vault },
          },
        ),
      }),
      paths: closedObject(
        [
          "coreDocument",
          "journalRoot",
          "experimentsRoot",
          "providersRoot",
          "rawRoot",
          "eventsRoot",
          "samplesRoot",
          "auditRoot",
          "exportsRoot",
        ],
        {
          coreDocument: { const: "CORE.md" },
          journalRoot: { const: "journal" },
          experimentsRoot: { const: "bank/experiments" },
          providersRoot: { const: "bank/providers" },
          rawRoot: { const: "raw" },
          eventsRoot: { const: "ledger/events" },
          samplesRoot: { const: "ledger/samples" },
          auditRoot: { const: "audit" },
          exportsRoot: { const: "exports" },
        },
      ),
      shards: closedObject(["events", "samples", "audit"], {
        events: { const: "ledger/events/YYYY/YYYY-MM.jsonl" },
        samples: { const: "ledger/samples/<stream>/YYYY/YYYY-MM.jsonl" },
        audit: { const: "audit/YYYY/YYYY-MM.jsonl" },
      }),
    },
  ),
);

export const eventRecordSchema = withDraft(
  "@healthybob/contracts/event-record.schema.json",
  "Healthy Bob Event Record",
  {
    oneOf: [
      eventSchema("document", ["documentId", "documentPath", "mimeType"], {
        documentId: idSchema(ID_PREFIXES.document),
        documentPath: stringSchema({ pattern: "^raw/documents/[A-Za-z0-9._/-]+$" }),
        mimeType: stringSchema({ minLength: 3, maxLength: 120 }),
        providerId: idSchema(ID_PREFIXES.provider),
      }),
      eventSchema("meal", ["mealId", "photoPaths", "audioPaths"], {
        mealId: idSchema(ID_PREFIXES.meal),
        photoPaths: stringArraySchema(stringSchema({ pattern: "^raw/meals/[A-Za-z0-9._/-]+$" }), {
          minItems: 1,
        }),
        audioPaths: stringArraySchema(stringSchema({ pattern: "^raw/meals/[A-Za-z0-9._/-]+$" })),
      }),
      eventSchema("symptom", ["symptom", "intensity"], {
        symptom: stringSchema({ minLength: 1, maxLength: 120 }),
        intensity: integerSchema({ minimum: 0, maximum: 10 }),
        bodySite: stringSchema({ minLength: 1, maxLength: 120 }),
      }),
      eventSchema("note", ["note"], {}),
      eventSchema("observation", ["metric", "value", "unit"], {
        metric: stringSchema({ pattern: SLUG_PATTERN }),
        value: numberSchema(),
        unit: stringSchema({ pattern: UNIT_PATTERN }),
      }),
      eventSchema("experiment_event", ["experimentId", "experimentSlug", "phase"], {
        experimentId: idSchema(ID_PREFIXES.experiment),
        experimentSlug: stringSchema({ pattern: SLUG_PATTERN }),
        phase: stringSchema({ enum: EXPERIMENT_PHASES }),
      }),
      eventSchema("medication_intake", ["medicationName", "dose", "unit"], {
        medicationName: stringSchema({ minLength: 1, maxLength: 160 }),
        dose: numberSchema({ minimum: 0 }),
        unit: stringSchema({ pattern: UNIT_PATTERN }),
      }),
      eventSchema("supplement_intake", ["supplementName", "dose", "unit"], {
        supplementName: stringSchema({ minLength: 1, maxLength: 160 }),
        dose: numberSchema({ minimum: 0 }),
        unit: stringSchema({ pattern: UNIT_PATTERN }),
      }),
      eventSchema("activity_session", ["activityType", "durationMinutes"], {
        activityType: stringSchema({ pattern: SLUG_PATTERN }),
        durationMinutes: integerSchema({ minimum: 1 }),
        distanceKm: numberSchema({ minimum: 0 }),
      }),
      eventSchema("sleep_session", ["startAt", "endAt", "durationMinutes"], {
        startAt: stringSchema({ format: "date-time" }),
        endAt: stringSchema({ format: "date-time" }),
        durationMinutes: integerSchema({ minimum: 1 }),
      }),
    ],
  },
);

export const sampleRecordSchema = withDraft(
  "@healthybob/contracts/sample-record.schema.json",
  "Healthy Bob Sample Record",
  {
    oneOf: [
      sampleSchema("heart_rate", ["value", "unit"], {
        value: integerSchema({ minimum: 0 }),
        unit: { const: "bpm" },
      }),
      sampleSchema("hrv", ["value", "unit"], {
        value: numberSchema({ minimum: 0 }),
        unit: { const: "ms" },
      }),
      sampleSchema("steps", ["value", "unit"], {
        value: integerSchema({ minimum: 0 }),
        unit: { const: "count" },
      }),
      sampleSchema("sleep_stage", ["stage", "startAt", "endAt", "durationMinutes", "unit"], {
        stage: stringSchema({ enum: SLEEP_STAGES }),
        startAt: stringSchema({ format: "date-time" }),
        endAt: stringSchema({ format: "date-time" }),
        durationMinutes: integerSchema({ minimum: 1 }),
        unit: { const: "stage" },
      }),
      sampleSchema("respiratory_rate", ["value", "unit"], {
        value: numberSchema({ minimum: 0 }),
        unit: { const: "breaths_per_minute" },
      }),
      sampleSchema("temperature", ["value", "unit"], {
        value: numberSchema(),
        unit: { const: "celsius" },
      }),
      sampleSchema("glucose", ["value", "unit"], {
        value: numberSchema({ minimum: 0 }),
        unit: { const: "mg_dL" },
      }),
    ],
  },
);

export const auditRecordSchema = withDraft(
  "@healthybob/contracts/audit-record.schema.json",
  "Healthy Bob Audit Record",
  closedObject(
    ["schemaVersion", "id", "action", "status", "occurredAt", "actor", "commandName", "summary", "changes"],
    {
      schemaVersion: { const: CONTRACT_SCHEMA_VERSION.audit },
      id: idSchema(ID_PREFIXES.audit),
      action: stringSchema({ enum: AUDIT_ACTIONS }),
      status: stringSchema({ enum: AUDIT_STATUSES }),
      occurredAt: stringSchema({ format: "date-time" }),
      actor: stringSchema({ enum: AUDIT_ACTORS }),
      commandName: stringSchema({ minLength: 1, maxLength: 160 }),
      summary: stringSchema({ minLength: 1, maxLength: 4000 }),
      targetIds: stringArraySchema(stringSchema({ pattern: GENERIC_CONTRACT_ID_PATTERN }), { uniqueItems: true }),
      errorCode: stringSchema({ enum: ERROR_CODE_VALUES }),
      changes: {
        type: "array",
        items: closedObject(["path", "op"], {
          path: stringSchema({ pattern: RELATIVE_PATH_PATTERN }),
          op: stringSchema({ enum: FILE_CHANGE_OPERATIONS }),
        }),
      },
    },
  ),
);

export const coreFrontmatterSchema = withDraft(
  "@healthybob/contracts/frontmatter-core.schema.json",
  "Healthy Bob CORE Frontmatter",
  closedObject(
    ["schemaVersion", "docType", "vaultId", "title", "timezone", "updatedAt"],
    {
      schemaVersion: { const: CONTRACT_SCHEMA_VERSION.coreFrontmatter },
      docType: { const: FRONTMATTER_DOC_TYPES.core },
      vaultId: idSchema(ID_PREFIXES.vault),
      title: stringSchema({ minLength: 1, maxLength: 160 }),
      timezone: stringSchema({ minLength: 3, maxLength: 64 }),
      updatedAt: stringSchema({ format: "date-time" }),
      activeExperimentSlugs: stringArraySchema(stringSchema({ pattern: SLUG_PATTERN }), { uniqueItems: true }),
    },
  ),
);

export const journalDayFrontmatterSchema = withDraft(
  "@healthybob/contracts/frontmatter-journal-day.schema.json",
  "Healthy Bob Journal Day Frontmatter",
  closedObject(
    ["schemaVersion", "docType", "dayKey", "eventIds", "sampleStreams"],
    {
      schemaVersion: { const: CONTRACT_SCHEMA_VERSION.journalDayFrontmatter },
      docType: { const: FRONTMATTER_DOC_TYPES.journalDay },
      dayKey: stringSchema({ pattern: DAY_KEY_PATTERN }),
      eventIds: stringArraySchema(idSchema(ID_PREFIXES.event), { uniqueItems: true }),
      sampleStreams: stringArraySchema(stringSchema({ enum: SAMPLE_STREAMS }), { uniqueItems: true }),
    },
  ),
);

export const experimentFrontmatterSchema = withDraft(
  "@healthybob/contracts/frontmatter-experiment.schema.json",
  "Healthy Bob Experiment Frontmatter",
  closedObject(
    ["schemaVersion", "docType", "experimentId", "slug", "status", "title", "startedOn"],
    {
      schemaVersion: { const: CONTRACT_SCHEMA_VERSION.experimentFrontmatter },
      docType: { const: FRONTMATTER_DOC_TYPES.experiment },
      experimentId: idSchema(ID_PREFIXES.experiment),
      slug: stringSchema({ pattern: SLUG_PATTERN }),
      status: stringSchema({ enum: EXPERIMENT_STATUSES }),
      title: stringSchema({ minLength: 1, maxLength: 160 }),
      startedOn: stringSchema({ format: "date" }),
      endedOn: stringSchema({ format: "date" }),
      hypothesis: stringSchema({ minLength: 1, maxLength: 4000 }),
      tags: stringArraySchema(stringSchema({ pattern: SLUG_PATTERN }), { uniqueItems: true }),
    },
  ),
);

export const schemaCatalog = Object.freeze({
  "audit-record": auditRecordSchema,
  "event-record": eventRecordSchema,
  "frontmatter-core": coreFrontmatterSchema,
  "frontmatter-experiment": experimentFrontmatterSchema,
  "frontmatter-journal-day": journalDayFrontmatterSchema,
  "sample-record": sampleRecordSchema,
  "vault-metadata": vaultMetadataSchema,
});
