import { measurementEntrySchema, measurementQualifierValueSchema, publicEventImportJsonlRowPayloadSchemasByKind } from "@murphai/contracts";
import * as z from "@murphai/contracts/zod-runtime";

export const CLINICAL_DOCUMENT_EXTRACTION_MAX_RECORDS = 100;
// The standard clinical vital keys already written by the FHIR importer, plus
// the canonical resting-heart-rate metric when the source explicitly names it.
export const CLINICAL_DOCUMENT_MEASUREMENT_METRICS = [
  "heart-rate", "resting-heart-rate", "systolic-blood-pressure", "diastolic-blood-pressure",
  "respiratory-rate", "spo2", "temperature", "body-height", "body-weight", "bmi", "head-circumference",
] as const;
export const clinicalDocumentExtractionFamilySchema = z.enum(["labs", "measurements", "history"]);
export type ClinicalDocumentExtractionFamily = z.infer<typeof clinicalDocumentExtractionFamilySchema>;

// Extractors propose clinical content only. The canonical owner supplies source
// identity, evidence, relationships and write authority after validating a proposal.
const clinicalContentFields = { kind: true, occurredAt: true, title: true, note: true } as const;
const labPayloadSchema = publicEventImportJsonlRowPayloadSchemasByKind.test.pick({
  ...clinicalContentFields,
  testName: true,
  resultStatus: true,
  summary: true,
  testCategory: true,
  specimenType: true,
  collectedAt: true,
  reportedAt: true,
  fastingStatus: true,
  results: true,
}).strict();
const measurementPayloadSchema = publicEventImportJsonlRowPayloadSchemasByKind.measurement.pick({
  ...clinicalContentFields,
  measurements: true,
}).extend({
  measurements: z.array(measurementEntrySchema.extend({
    metric: z.enum(CLINICAL_DOCUMENT_MEASUREMENT_METRICS),
    qualifiers: z.object({
      position: measurementQualifierValueSchema.optional(),
      site: measurementQualifierValueSchema.optional(),
      method: measurementQualifierValueSchema.optional(),
      subject: measurementQualifierValueSchema.optional(),
      specimen: measurementQualifierValueSchema.optional(),
      fasting: measurementQualifierValueSchema.optional(),
    }).strict().optional(),
  })).min(1).max(25),
}).strict();
const notePayloadSchema = publicEventImportJsonlRowPayloadSchemasByKind.note.pick({
  ...clinicalContentFields,
  noteType: true,
  authoredAt: true,
  signedAt: true,
  sections: true,
}).strict();
const assertionPayloadSchema = publicEventImportJsonlRowPayloadSchemasByKind.clinical_assertion.pick({
  ...clinicalContentFields,
  assertion: true,
  domain: true,
  polarity: true,
  subject: true,
  assertionText: true,
  bodySite: true,
  code: true,
  codeSystem: true,
  assertedOn: true,
}).strict();

export const clinicalDocumentExtractionPayloadSchema = z.discriminatedUnion("kind", [
  labPayloadSchema,
  measurementPayloadSchema,
  notePayloadSchema,
  assertionPayloadSchema,
]);
export type ClinicalDocumentExtractionPayload = z.infer<typeof clinicalDocumentExtractionPayloadSchema>;

function extractionOutputSchema<TPayload extends z.ZodType>(payload: TPayload) {
  const record = z.object({
    payload,
    page: z.number().int().positive().max(100_000).optional(),
    excerpt: z.string().trim().min(1).max(500).optional(),
  }).strict();
  const reason = z.string().trim().min(1).max(500);
  return z.discriminatedUnion("status", [
    z.object({
      status: z.literal("complete"),
      records: z.array(record).max(CLINICAL_DOCUMENT_EXTRACTION_MAX_RECORDS),
      reason: reason.optional(),
    }).strict(),
    z.object({
      status: z.literal("blocked"),
      records: z.array(record).max(CLINICAL_DOCUMENT_EXTRACTION_MAX_RECORDS),
      reason,
    }).strict(),
  ]);
}

export const clinicalDocumentExtractionOutputSchema = extractionOutputSchema(clinicalDocumentExtractionPayloadSchema);
export type ClinicalDocumentExtractionOutput = z.infer<typeof clinicalDocumentExtractionOutputSchema>;

const outputSchemasByFamily = {
  labs: extractionOutputSchema(labPayloadSchema),
  measurements: extractionOutputSchema(measurementPayloadSchema),
  history: extractionOutputSchema(z.discriminatedUnion("kind", [notePayloadSchema, assertionPayloadSchema])),
} as const;

export function clinicalDocumentExtractionOutputSchemaForFamily(family: ClinicalDocumentExtractionFamily) {
  return outputSchemasByFamily[family];
}

export function clinicalDocumentExtractionOutputJsonSchema(
  family: ClinicalDocumentExtractionFamily,
): z.ZodJsonSchema {
  const schema = z.toJSONSchema(clinicalDocumentExtractionOutputSchemaForFamily(family), { io: "input" });
  const complete = schemaObject(Array.isArray(schema.oneOf) ? schema.oneOf[0] : undefined);
  const properties = schemaObject(complete?.properties);
  if (!complete || !properties) throw new TypeError("Clinical extraction schema must define its complete result.");
  // Codex structured output requires one root object and every property to be
  // required. Optional clinical fields travel as null and are normalized below.
  return strictProviderSchema({
    ...schema,
    ...complete,
    oneOf: undefined,
    properties: { ...properties, status: { type: "string", enum: ["complete", "blocked"] } },
  });
}

export function parseClinicalDocumentExtractionOutput(
  family: ClinicalDocumentExtractionFamily,
  value: unknown,
): ClinicalDocumentExtractionOutput {
  const schema = clinicalDocumentExtractionOutputSchemaForFamily(family);
  const jsonSchema = z.toJSONSchema(schema, { io: "input" });
  return schema.parse(normalizeOptionalNulls(value, jsonSchema));
}

function schemaObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function strictProviderSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (value === undefined) continue;
    const outputKey = key === "oneOf" ? "anyOf" : key;
    result[outputKey] = Array.isArray(value)
      ? value.map((item) => schemaObject(item) ? strictProviderSchema(item) : item)
      : schemaObject(value) ? strictProviderSchema(value as Record<string, unknown>) : value;
  }
  const properties = schemaObject(schema.properties);
  if (schema.type === "object" && properties) {
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    result.properties = Object.fromEntries(Object.entries(properties).map(([key, property]) => {
      const normalized = strictProviderSchema(schemaObject(property) ?? {});
      return [key, required.has(key) ? normalized : { anyOf: [normalized, { type: "null" }] }];
    }));
    result.required = Object.keys(properties);
    result.additionalProperties = false;
  }
  return result;
}

function normalizeOptionalNulls(value: unknown, schema: Record<string, unknown>): unknown {
  const branches = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(branches)) {
    const options = branches.flatMap((branch) => schemaObject(branch) ? [schemaObject(branch)!] : []);
    const object = schemaObject(value);
    const selected = object && options.find((option) => {
      const properties = schemaObject(option.properties);
      return properties && Object.entries(properties).every(([key, property]) => {
        const definition = schemaObject(property);
        return definition?.const === undefined || definition.const === object[key];
      }) && (!Array.isArray(option.required) || option.required.every((key) =>
        typeof key === "string" && object[key] !== undefined && object[key] !== null));
    });
    return selected ? normalizeOptionalNulls(value, selected) : value;
  }
  if (Array.isArray(value)) {
    const items = schemaObject(schema.items);
    return items ? value.map((item) => normalizeOptionalNulls(item, items)) : value;
  }
  const object = schemaObject(value);
  const properties = schemaObject(schema.properties);
  if (!object || !properties) return value;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.fromEntries(Object.entries(object).flatMap(([key, item]) => {
    const property = schemaObject(properties[key]);
    if (property && !required.has(key) && item === null) return [];
    return [[key, property ? normalizeOptionalNulls(item, property) : item]];
  }));
}
