import * as z from "zod";

import {
  allergyFrontmatterSchema as allergyFrontmatterContract,
  assessmentResponseSchema as assessmentResponseContract,
  auditRecordSchema as auditRecordContract,
  conditionFrontmatterSchema as conditionFrontmatterContract,
  coreFrontmatterSchema as coreFrontmatterContract,
  eventRecordSchema as eventRecordContract,
  experimentFrontmatterSchema as experimentFrontmatterContract,
  familyMemberFrontmatterSchema as familyMemberFrontmatterContract,
  foodFrontmatterSchema as foodFrontmatterContract,
  geneticVariantFrontmatterSchema as geneticVariantFrontmatterContract,
  goalFrontmatterSchema as goalFrontmatterContract,
  journalDayFrontmatterSchema as journalDayFrontmatterContract,
  profileCurrentFrontmatterSchema as profileCurrentFrontmatterContract,
  profileSnapshotSchema as profileSnapshotContract,
  providerFrontmatterSchema as providerFrontmatterContract,
  recipeFrontmatterSchema as recipeFrontmatterContract,
  protocolFrontmatterSchema as protocolFrontmatterContract,
  workoutFormatFrontmatterSchema as workoutFormatFrontmatterContract,
  sampleRecordSchema as sampleRecordContract,
  vaultMetadataSchema as vaultMetadataContract,
} from "./zod.ts";

import type { JsonSchema } from "./types.ts";

export type { JsonSchema } from "./types.ts";

function toJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return z.toJSONSchema(schema) as JsonSchema;
}

export const vaultMetadataSchema = toJsonSchema(vaultMetadataContract);
export const eventRecordSchema = toJsonSchema(eventRecordContract);
export const sampleRecordSchema = toJsonSchema(sampleRecordContract);
export const auditRecordSchema = toJsonSchema(auditRecordContract);
export const coreFrontmatterSchema = toJsonSchema(coreFrontmatterContract);
export const journalDayFrontmatterSchema = toJsonSchema(journalDayFrontmatterContract);
export const experimentFrontmatterSchema = toJsonSchema(experimentFrontmatterContract);
export const foodFrontmatterSchema = toJsonSchema(foodFrontmatterContract);
export const assessmentResponseSchema = toJsonSchema(assessmentResponseContract);
export const profileSnapshotSchema = toJsonSchema(profileSnapshotContract);
export const profileCurrentFrontmatterSchema = toJsonSchema(profileCurrentFrontmatterContract);
export const providerFrontmatterSchema = toJsonSchema(providerFrontmatterContract);
export const recipeFrontmatterSchema = toJsonSchema(recipeFrontmatterContract);
export const workoutFormatFrontmatterSchema = toJsonSchema(workoutFormatFrontmatterContract);
export const goalFrontmatterSchema = toJsonSchema(goalFrontmatterContract);
export const conditionFrontmatterSchema = toJsonSchema(conditionFrontmatterContract);
export const allergyFrontmatterSchema = toJsonSchema(allergyFrontmatterContract);
export const protocolFrontmatterSchema = toJsonSchema(protocolFrontmatterContract);
export const familyMemberFrontmatterSchema = toJsonSchema(familyMemberFrontmatterContract);
export const geneticVariantFrontmatterSchema = toJsonSchema(geneticVariantFrontmatterContract);

export const schemaCatalog = Object.freeze({
  "assessment-response": assessmentResponseSchema,
  "audit-record": auditRecordSchema,
  "event-record": eventRecordSchema,
  "frontmatter-allergy": allergyFrontmatterSchema,
  "frontmatter-condition": conditionFrontmatterSchema,
  "frontmatter-core": coreFrontmatterSchema,
  "frontmatter-experiment": experimentFrontmatterSchema,
  "frontmatter-family-member": familyMemberFrontmatterSchema,
  "frontmatter-food": foodFrontmatterSchema,
  "frontmatter-genetic-variant": geneticVariantFrontmatterSchema,
  "frontmatter-goal": goalFrontmatterSchema,
  "frontmatter-journal-day": journalDayFrontmatterSchema,
  "frontmatter-profile-current": profileCurrentFrontmatterSchema,
  "frontmatter-provider": providerFrontmatterSchema,
  "frontmatter-recipe": recipeFrontmatterSchema,
  "frontmatter-protocol": protocolFrontmatterSchema,
  "frontmatter-workout-format": workoutFormatFrontmatterSchema,
  "profile-snapshot": profileSnapshotSchema,
  "sample-record": sampleRecordSchema,
  "vault-metadata": vaultMetadataSchema,
});
