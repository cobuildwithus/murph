import * as z from "./zod-runtime.ts";

import {
  automationFrontmatterSchema as automationFrontmatterContract,
} from "./automation.ts";
import {
  allergyFrontmatterSchema as allergyFrontmatterContract,
  assessmentResponseSchema as assessmentResponseContract,
  auditRecordSchema as auditRecordContract,
  bloodTestImportPayloadSchema as bloodTestImportPayloadContract,
  conditionFrontmatterSchema as conditionFrontmatterContract,
  coreFrontmatterSchema as coreFrontmatterContract,
  eventRecordSchema as eventRecordContract,
  experimentFrontmatterSchema as experimentFrontmatterContract,
  familyMemberFrontmatterSchema as familyMemberFrontmatterContract,
  foodFrontmatterSchema as foodFrontmatterContract,
  geneticVariantFrontmatterSchema as geneticVariantFrontmatterContract,
  inboxCaptureRecordSchema as inboxCaptureRecordContract,
  inboxAttachmentRetentionRecordSchema as inboxAttachmentRetentionRecordContract,
  goalFrontmatterSchema as goalFrontmatterContract,
  habitatFrontmatterSchema as habitatFrontmatterContract,
  journalDayFrontmatterSchema as journalDayFrontmatterContract,
  protocolFrontmatterSchema as protocolFrontmatterContract,
  regimenFrontmatterSchema as regimenFrontmatterContract,
  providerFrontmatterSchema as providerFrontmatterContract,
  recipeFrontmatterSchema as recipeFrontmatterContract,
  metricSampleRecordSchema as metricSampleRecordContract,
  sampleRecordSchema as sampleRecordContract,
  vaultMetadataSchema as vaultMetadataContract,
  workoutFormatFrontmatterSchema as workoutFormatFrontmatterContract,
  workoutImportPayloadSchema as workoutImportPayloadContract,
} from "./zod.ts";
import {
  integrationIngestRecordSchema as integrationIngestRecordContract,
} from "./integration-ingest.ts";
import {
  conditionImportPayloadSchema as conditionImportPayloadContract,
} from "./shares.ts";
import {
  memoryDocumentFrontmatterSchema as memoryDocumentFrontmatterContract,
} from "./memory.ts";
import {
  assistantPreferenceMutationStateDocumentSchema as assistantPreferenceMutationStateDocumentContract,
  preferencesDocumentSchema as preferencesDocumentContract,
} from "./preferences.ts";
import {
  scheduledLogFrontmatterSchema as scheduledLogFrontmatterContract,
} from "./scheduled-log.ts";

import type { JsonSchema } from "./types.ts";

export type { JsonSchema } from "./types.ts";

function toJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return z.toJSONSchema(schema) as JsonSchema;
}

function toInputJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
}

function withDependentRequired(
  schema: JsonSchema,
  dependentRequired: Record<string, readonly string[]>,
): JsonSchema {
  return {
    ...schema,
    dependentRequired,
  };
}

export const vaultMetadataSchema = toJsonSchema(vaultMetadataContract);
export const eventRecordSchema = toJsonSchema(eventRecordContract);
export const integrationIngestRecordSchema = toJsonSchema(integrationIngestRecordContract);
export const conditionImportPayloadSchema = toInputJsonSchema(conditionImportPayloadContract);
export const bloodTestImportPayloadSchema = toInputJsonSchema(bloodTestImportPayloadContract);
export const sampleRecordSchema = toJsonSchema(sampleRecordContract);
export const metricSampleRecordSchema = toJsonSchema(metricSampleRecordContract);
export const auditRecordSchema = toJsonSchema(auditRecordContract);
export const inboxCaptureRecordSchema = toJsonSchema(inboxCaptureRecordContract);
export const inboxAttachmentRetentionRecordSchema = toJsonSchema(inboxAttachmentRetentionRecordContract);
export const automationFrontmatterSchema = toJsonSchema(automationFrontmatterContract);
export const coreFrontmatterSchema = toJsonSchema(coreFrontmatterContract);
export const journalDayFrontmatterSchema = toJsonSchema(journalDayFrontmatterContract);
export const experimentFrontmatterSchema = withDependentRequired(
  toJsonSchema(experimentFrontmatterContract),
  {
    commonsProtocolRef: ["effectiveProtocolSnapshot"],
    protocolRef: ["commonsProtocolRef", "effectiveProtocolSnapshot"],
  },
);
export const foodFrontmatterSchema = toJsonSchema(foodFrontmatterContract);
export const assessmentResponseSchema = toJsonSchema(assessmentResponseContract);
export const memoryDocumentFrontmatterSchema = toJsonSchema(memoryDocumentFrontmatterContract);
export const preferencesDocumentSchema = toJsonSchema(preferencesDocumentContract);
export const assistantPreferenceMutationStateDocumentSchema = toJsonSchema(
  assistantPreferenceMutationStateDocumentContract,
);
export const providerFrontmatterSchema = toJsonSchema(providerFrontmatterContract);
export const recipeFrontmatterSchema = toJsonSchema(recipeFrontmatterContract);
export const scheduledLogFrontmatterSchema = toJsonSchema(scheduledLogFrontmatterContract);
export const workoutFormatFrontmatterSchema = toJsonSchema(workoutFormatFrontmatterContract);
export const workoutImportPayloadSchema = toInputJsonSchema(workoutImportPayloadContract);
export const goalFrontmatterSchema = toJsonSchema(goalFrontmatterContract);
export const habitatFrontmatterSchema = toJsonSchema(habitatFrontmatterContract);
export const conditionFrontmatterSchema = toJsonSchema(conditionFrontmatterContract);
export const allergyFrontmatterSchema = toJsonSchema(allergyFrontmatterContract);
export const protocolFrontmatterSchema = toJsonSchema(protocolFrontmatterContract);
export const regimenFrontmatterSchema = toJsonSchema(regimenFrontmatterContract);
export const familyMemberFrontmatterSchema = toJsonSchema(familyMemberFrontmatterContract);
export const geneticVariantFrontmatterSchema = toJsonSchema(geneticVariantFrontmatterContract);

export const schemaCatalog = Object.freeze({
  "assessment-response": assessmentResponseSchema,
  "audit-record": auditRecordSchema,
  "blood-test-import-payload": bloodTestImportPayloadSchema,
  "condition-import-payload": conditionImportPayloadSchema,
  "event-record": eventRecordSchema,
  "integration-ingest-record": integrationIngestRecordSchema,
  "inbox-capture-record": inboxCaptureRecordSchema,
  "inbox-attachment-retention-record": inboxAttachmentRetentionRecordSchema,
  "metric-sample-record": metricSampleRecordSchema,
  "frontmatter-allergy": allergyFrontmatterSchema,
  "frontmatter-automation": automationFrontmatterSchema,
  "frontmatter-condition": conditionFrontmatterSchema,
  "frontmatter-core": coreFrontmatterSchema,
  "frontmatter-experiment": experimentFrontmatterSchema,
  "frontmatter-family-member": familyMemberFrontmatterSchema,
  "frontmatter-food": foodFrontmatterSchema,
  "frontmatter-genetic-variant": geneticVariantFrontmatterSchema,
  "frontmatter-goal": goalFrontmatterSchema,
  "frontmatter-habitat": habitatFrontmatterSchema,
  "frontmatter-journal-day": journalDayFrontmatterSchema,
  "frontmatter-memory": memoryDocumentFrontmatterSchema,
  "frontmatter-provider": providerFrontmatterSchema,
  "frontmatter-protocol": protocolFrontmatterSchema,
  "frontmatter-regimen": regimenFrontmatterSchema,
  "frontmatter-recipe": recipeFrontmatterSchema,
  "frontmatter-scheduled-log": scheduledLogFrontmatterSchema,
  "frontmatter-workout-format": workoutFormatFrontmatterSchema,
  "preferences-document": preferencesDocumentSchema,
  "assistant-preference-mutations": assistantPreferenceMutationStateDocumentSchema,
  "sample-record": sampleRecordSchema,
  "vault-metadata": vaultMetadataSchema,
  "workout-import-payload": workoutImportPayloadSchema,
});
