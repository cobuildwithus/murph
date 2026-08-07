import * as z from "./zod-runtime.ts";

import { CONTRACT_SCHEMA_VERSION, ID_PREFIXES } from "./constants.ts";
import { withContractMetadata } from "./schema-metadata.ts";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MIME_TYPE_PATTERN = /^[^\s/]+\/[^\s/]+$/u;
const SAFE_FILE_NAME_PATTERN = /^(?!\.\.?$)[^/\\\u0000-\u001f\u007f]+$/u;
const XFM_ID_PATTERN = new RegExp(`^${ID_PREFIXES.transform}_[0-9A-Za-z]+$`, "u");
const EVENT_ID_PATTERN = new RegExp(`^${ID_PREFIXES.event}_[0-9A-Za-z]+$`, "u");
const SAMPLE_ID_PATTERN = new RegExp(`^${ID_PREFIXES.sample}_[0-9A-Za-z]+$`, "u");
const MAX_INGEST_PARTS = 10_000;

const jsonPrimitiveSchema = z.union([z.null(), z.boolean(), z.number().finite(), z.string()]);
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    jsonPrimitiveSchema,
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

function isoTimestampSchema(): z.ZodString {
  return z.string().min(1).refine(
    (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
    "Expected a canonical ISO-8601 timestamp.",
  );
}

function byteLengthUtf8(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export const integrationEvidencePartSchema = z
  .object({
    role: z.string().trim().min(1).max(240),
    fileName: z.string().min(1).max(512).regex(SAFE_FILE_NAME_PATTERN),
    mediaType: z.string().min(1).max(255).regex(MIME_TYPE_PATTERN),
    content: z.string(),
    byteSize: z.number().int().safe().nonnegative(),
    sha256: z.string().regex(SHA256_PATTERN),
    metadata: jsonObjectSchema.optional(),
  })
  .strict()
  .superRefine((part, context) => {
    if (byteLengthUtf8(part.content) !== part.byteSize) {
      context.addIssue({
        code: "custom",
        path: ["byteSize"],
        message: "Evidence part byteSize must equal its UTF-8 content byte length.",
      });
    }
  });

export const integrationIngestReceiptSchema = z
  .object({
    schemaVersion: z.literal("wearable.raw_ingest_receipt.v1"),
    id: z.string().regex(/^wearable_raw_[a-f0-9]{24}$/u),
    provider: z.string().trim().min(1).max(120),
    userId: z.string().trim().min(1).max(512).optional(),
    accountId: z.string().trim().min(1).max(512).optional(),
    connectionId: z.string().trim().min(1).max(512).optional(),
    sourceKind: z.enum(["poll", "webhook", "sdk", "xml", "manual"]),
    deliveryMode: z.enum(["full_payload", "notification_only", "scheduled_reconcile"]),
    resourceType: z.string().trim().min(1).max(240).optional(),
    resourceId: z.string().trim().min(1).max(512).optional(),
    providerEventId: z.string().trim().min(1).max(512).optional(),
    eventType: z.enum(["create", "update", "delete", "deauthorize"]).optional(),
    observedAt: isoTimestampSchema(),
    occurredAt: isoTimestampSchema().optional(),
    windowStart: isoTimestampSchema().optional(),
    windowEnd: isoTimestampSchema().optional(),
    cursor: z.string().max(4000).optional(),
    signatureVerified: z.boolean().optional(),
    payloadHash: z.string().regex(SHA256_PATTERN),
  })
  .strict();

export const integrationIngestEventOutputSchema = z
  .object({
    id: z.string().regex(EVENT_ID_PATTERN),
    roles: z.array(z.string().trim().min(1).max(240)).max(64),
  })
  .strict();

export const integrationIngestOutputsSchema = z
  .object({
    events: z.array(integrationIngestEventOutputSchema).max(10_000),
    eventIdsComplete: z.boolean(),
    sampleIds: z.array(z.string().regex(SAMPLE_ID_PATTERN)).max(10_000),
    sampleIdsComplete: z.boolean(),
  })
  .strict();

export const integrationIngestRecordSchema = withContractMetadata(
  z.object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.integrationIngest),
    id: z.string().regex(XFM_ID_PATTERN),
    provider: z.string().trim().min(1).max(120),
    accountId: z.string().trim().min(1).max(512).optional(),
    source: z.enum(["manual", "import", "device", "derived"]),
    importedAt: isoTimestampSchema(),
    receipt: integrationIngestReceiptSchema.optional(),
    parts: z.array(integrationEvidencePartSchema).max(MAX_INGEST_PARTS),
    outputs: integrationIngestOutputsSchema,
    counts: z
      .object({
        eventCount: z.number().int().safe().nonnegative(),
        sampleCount: z.number().int().safe().nonnegative(),
      })
      .strict(),
    provenance: jsonObjectSchema.optional(),
  })
  .strict()
  .superRefine((record, context) => {
    const partRoles = new Set<string>();
    for (const [index, part] of record.parts.entries()) {
      if (partRoles.has(part.role)) {
        context.addIssue({
          code: "custom",
          path: ["parts", index, "role"],
          message: `Evidence role "${part.role}" must be unique within an ingest.`,
        });
      }
      partRoles.add(part.role);
    }

    const eventIds = new Set<string>();
    for (const [eventIndex, event] of record.outputs.events.entries()) {
      if (eventIds.has(event.id)) {
        context.addIssue({
          code: "custom",
          path: ["outputs", "events", eventIndex, "id"],
          message: `Event output "${event.id}" must be unique within an ingest.`,
        });
      }
      eventIds.add(event.id);

      const roles = new Set<string>();
      for (const [roleIndex, role] of event.roles.entries()) {
        if (roles.has(role)) {
          context.addIssue({
            code: "custom",
            path: ["outputs", "events", eventIndex, "roles", roleIndex],
            message: `Event evidence role "${role}" must be unique.`,
          });
        }
        roles.add(role);
        if (!partRoles.has(role)) {
          context.addIssue({
            code: "custom",
            path: ["outputs", "events", eventIndex, "roles", roleIndex],
            message: `Event evidence role "${role}" does not exist in parts.`,
          });
        }
      }
    }

    const sampleIds = new Set<string>();
    for (const [index, sampleId] of record.outputs.sampleIds.entries()) {
      if (sampleIds.has(sampleId)) {
        context.addIssue({
          code: "custom",
          path: ["outputs", "sampleIds", index],
          message: `Sample output "${sampleId}" must be unique within an ingest.`,
        });
      }
      sampleIds.add(sampleId);
    }

    if (record.outputs.eventIdsComplete && record.outputs.events.length !== record.counts.eventCount) {
      context.addIssue({
        code: "custom",
        path: ["counts", "eventCount"],
        message: "eventCount must equal outputs.events length when eventIdsComplete is true.",
      });
    }
    if (record.outputs.sampleIdsComplete && record.outputs.sampleIds.length !== record.counts.sampleCount) {
      context.addIssue({
        code: "custom",
        path: ["counts", "sampleCount"],
        message: "sampleCount must equal outputs.sampleIds length when sampleIdsComplete is true.",
      });
    }
    if (record.receipt && record.receipt.provider !== record.provider) {
      context.addIssue({
        code: "custom",
        path: ["receipt", "provider"],
        message: "Receipt provider must equal ingest provider.",
      });
    }
  }),
  "@murphai/contracts/integration-ingest-record.schema.json",
  "Murph Integration Ingest Record",
);

export type IntegrationEvidencePart = z.infer<typeof integrationEvidencePartSchema>;
export type IntegrationIngestReceipt = z.infer<typeof integrationIngestReceiptSchema>;
export type IntegrationIngestEventOutput = z.infer<typeof integrationIngestEventOutputSchema>;
export type IntegrationIngestOutputs = z.infer<typeof integrationIngestOutputsSchema>;
export type IntegrationIngestRecord = z.infer<typeof integrationIngestRecordSchema>;
