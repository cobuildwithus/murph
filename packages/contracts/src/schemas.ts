import * as z from "zod";

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
  eventImportJsonlRowPayloadSchema as eventImportJsonlRowPayloadContract,
  eventRecordSchema as eventRecordContract,
  experimentFrontmatterSchema as experimentFrontmatterContract,
  familyMemberFrontmatterSchema as familyMemberFrontmatterContract,
  foodFrontmatterSchema as foodFrontmatterContract,
  geneticVariantFrontmatterSchema as geneticVariantFrontmatterContract,
  inboxCaptureRecordSchema as inboxCaptureRecordContract,
  goalFrontmatterSchema as goalFrontmatterContract,
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
  conditionUpsertPatchPayloadSchema as conditionImportPayloadContract,
} from "./shares.ts";
import {
  memoryDocumentFrontmatterSchema as memoryDocumentFrontmatterContract,
} from "./memory.ts";
import {
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
export const conditionImportPayloadSchema = toJsonSchema(conditionImportPayloadContract);
export const bloodTestImportPayloadSchema = toJsonSchema(bloodTestImportPayloadContract);
export const eventImportJsonlRowPayloadSchema = toJsonSchema(eventImportJsonlRowPayloadContract);
export const sampleRecordSchema = toJsonSchema(sampleRecordContract);
export const metricSampleRecordSchema = toJsonSchema(metricSampleRecordContract);
export const auditRecordSchema = toJsonSchema(auditRecordContract);
export const inboxCaptureRecordSchema = toJsonSchema(inboxCaptureRecordContract);
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
export const providerFrontmatterSchema = toJsonSchema(providerFrontmatterContract);
export const recipeFrontmatterSchema = toJsonSchema(recipeFrontmatterContract);
export const scheduledLogFrontmatterSchema = toJsonSchema(scheduledLogFrontmatterContract);
export const workoutFormatFrontmatterSchema = toJsonSchema(workoutFormatFrontmatterContract);
export const workoutImportPayloadSchema = toJsonSchema(workoutImportPayloadContract);
export const goalFrontmatterSchema = toJsonSchema(goalFrontmatterContract);
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
  "event-import-jsonl-row-payload": eventImportJsonlRowPayloadSchema,
  "event-record": eventRecordSchema,
  "inbox-capture-record": inboxCaptureRecordSchema,
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
  "frontmatter-journal-day": journalDayFrontmatterSchema,
  "frontmatter-memory": memoryDocumentFrontmatterSchema,
  "frontmatter-provider": providerFrontmatterSchema,
  "frontmatter-protocol": protocolFrontmatterSchema,
  "frontmatter-regimen": regimenFrontmatterSchema,
  "frontmatter-recipe": recipeFrontmatterSchema,
  "frontmatter-scheduled-log": scheduledLogFrontmatterSchema,
  "frontmatter-workout-format": workoutFormatFrontmatterSchema,
  "preferences-document": preferencesDocumentSchema,
  "sample-record": sampleRecordSchema,
  "vault-metadata": vaultMetadataSchema,
  "workout-import-payload": workoutImportPayloadSchema,
});
