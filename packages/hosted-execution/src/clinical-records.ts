import {
  CLINICAL_FHIR_RESOURCE_TYPES,
  clinicalFhirResourceTypeSchema,
  clinicalFhirRetrievalScopeSchema,
  clinicalFhirRetrievalScopesSchema,
  clinicalIsoDateTimeSchema,
  clinicalSourceSystemSchema,
} from "@murphai/clinical-records";
import { z } from "zod";
import {
  HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
  HOSTED_CLINICAL_RECORDS_ERROR_CODE_MAX_CHARS,
  HOSTED_CLINICAL_RECORDS_ERROR_CODE_PATTERN,
  HOSTED_CLINICAL_RECORDS_IDENTIFIER_MAX_CHARS,
  HOSTED_CLINICAL_RECORDS_IDENTIFIER_PATTERN,
  HOSTED_CLINICAL_RECORDS_MAX_CURSOR_CHARS,
  HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS,
  HOSTED_CLINICAL_RECORDS_MAX_PAGES,
  HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES,
  HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH,
  parseHostedClinicalRecordsIdentifier,
  parseHostedClinicalRecordsRecordOutcomeRequest,
  type HostedClinicalRecordsOutcomeCounts,
  type HostedClinicalRecordsRecordOutcomeRequest,
} from "./clinical-records-boundary.ts";

export {
  HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
  HOSTED_CLINICAL_RECORDS_ERROR_CODE_MAX_CHARS,
  HOSTED_CLINICAL_RECORDS_ERROR_CODE_PATTERN,
  HOSTED_CLINICAL_RECORDS_IDENTIFIER_MAX_CHARS,
  HOSTED_CLINICAL_RECORDS_IDENTIFIER_PATTERN,
  HOSTED_CLINICAL_RECORDS_MAX_CURSOR_CHARS,
  HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS,
  HOSTED_CLINICAL_RECORDS_MAX_PAGES,
  HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES,
  HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH,
  parseHostedClinicalRecordsIdentifier,
  parseHostedClinicalRecordsRecordOutcomeRequest,
  type HostedClinicalRecordsOutcomeCounts,
  type HostedClinicalRecordsRecordOutcomeRequest,
};

export const HOSTED_CLINICAL_RECORDS_MAX_RESOURCE_FAMILIES =
  CLINICAL_FHIR_RESOURCE_TYPES.length;

const identifierSchema = z
  .string()
  .min(1)
  .max(HOSTED_CLINICAL_RECORDS_IDENTIFIER_MAX_CHARS)
  .regex(HOSTED_CLINICAL_RECORDS_IDENTIFIER_PATTERN);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const errorCodeSchema = z
  .string()
  .min(1)
  .max(HOSTED_CLINICAL_RECORDS_ERROR_CODE_MAX_CHARS)
  .regex(HOSTED_CLINICAL_RECORDS_ERROR_CODE_PATTERN);

export const hostedClinicalRecordsSyncRequestedWakeSchema = z.object({
  eventId: z.string().min(1),
  generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  kind: z.literal("clinical-records.sync-requested"),
  occurredAt: z.string().min(1),
  runId: identifierSchema,
  userId: z.string().min(1),
}).strict();

export const hostedClinicalRecordsRetrievalScopeSchema =
  clinicalFhirRetrievalScopeSchema;

const hostedClinicalRecordsRetrievalScopesSchema = z
  .array(hostedClinicalRecordsRetrievalScopeSchema)
  .min(1)
  .pipe(clinicalFhirRetrievalScopesSchema);

export const hostedClinicalRecordsRunDescriptorSchema = z.object({
  connectionId: identifierSchema,
  fetchedAt: clinicalIsoDateTimeSchema,
  fhirBaseUrlHash: sha256Schema,
  generation: z.number().int().min(1),
  grantedScopes: z.array(z.string().min(1).max(200)).max(50),
  patientIdHash: sha256Schema,
  providerDirectoryEntryId: identifierSchema.optional(),
  requestedScopes: z.array(z.string().min(1).max(200)).max(50),
  retrievalJobId: identifierSchema,
  retrievalScopes: hostedClinicalRecordsRetrievalScopesSchema,
  runId: identifierSchema,
  sourceSystem: clinicalSourceSystemSchema,
}).strict();

export const hostedClinicalRecordsReadRunResponseSchema = z.discriminatedUnion("status", [
  z.object({
    run: hostedClinicalRecordsRunDescriptorSchema,
    status: z.literal("ready"),
  }).strict(),
  z.object({
    errorCode: errorCodeSchema,
    retryable: z.boolean(),
    status: z.literal("unavailable"),
  }).strict(),
]);

export const hostedClinicalRecordsFetchPageRequestSchema = z.object({
  cursor: z.string().min(1).max(HOSTED_CLINICAL_RECORDS_MAX_CURSOR_CHARS).nullable(),
  generation: z.number().int().min(1),
  requestId: identifierSchema,
  resourceType: clinicalFhirResourceTypeSchema,
  runId: identifierSchema,
}).strict();

export const hostedClinicalRecordsFetchPageResponseSchema = z.discriminatedUnion("status", [
  z.object({
    body: z.string().max(HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS),
    nextCursor: z.string().min(1).max(HOSTED_CLINICAL_RECORDS_MAX_CURSOR_CHARS).nullable(),
    nextPageUrlHash: sha256Schema.optional(),
    pageUrlHash: sha256Schema.optional(),
    status: z.literal("page"),
  }).strict(),
  z.object({
    errorCode: errorCodeSchema,
    retryable: z.boolean(),
    status: z.literal("unavailable"),
  }).strict(),
]);

export const hostedClinicalRecordsRecordOutcomeResponseSchema = z.object({
  ok: z.literal(true),
}).strict();

export type HostedClinicalRecordsRetrievalScope = z.infer<
  typeof hostedClinicalRecordsRetrievalScopeSchema
>;
export type HostedClinicalRecordsRunDescriptor = z.infer<
  typeof hostedClinicalRecordsRunDescriptorSchema
>;
export type HostedClinicalRecordsReadRunResponse = z.infer<
  typeof hostedClinicalRecordsReadRunResponseSchema
>;
export type HostedClinicalRecordsFetchPageRequest = z.infer<
  typeof hostedClinicalRecordsFetchPageRequestSchema
>;
export type HostedClinicalRecordsFetchPageResponse = z.infer<
  typeof hostedClinicalRecordsFetchPageResponseSchema
>;
export type HostedExecutionClinicalRecordsSyncRequestedWake = z.infer<
  typeof hostedClinicalRecordsSyncRequestedWakeSchema
>;

export function buildHostedExecutionClinicalRecordsSyncRequestedWake(
  input: Omit<HostedExecutionClinicalRecordsSyncRequestedWake, "kind">,
): HostedExecutionClinicalRecordsSyncRequestedWake {
  return parseHostedClinicalRecordsSyncRequestedWake({
    ...input,
    kind: "clinical-records.sync-requested",
  });
}

export function parseHostedClinicalRecordsSyncRequestedWake(
  value: unknown,
): HostedExecutionClinicalRecordsSyncRequestedWake {
  return hostedClinicalRecordsSyncRequestedWakeSchema.parse(value);
}

export function parseHostedClinicalRecordsRunDescriptor(
  value: unknown,
): HostedClinicalRecordsRunDescriptor {
  return hostedClinicalRecordsRunDescriptorSchema.parse(value);
}

export function parseHostedClinicalRecordsReadRunResponse(
  value: unknown,
): HostedClinicalRecordsReadRunResponse {
  return hostedClinicalRecordsReadRunResponseSchema.parse(value);
}

export function parseHostedClinicalRecordsFetchPageResponse(
  value: unknown,
): HostedClinicalRecordsFetchPageResponse {
  return hostedClinicalRecordsFetchPageResponseSchema.parse(value);
}

export function parseHostedClinicalRecordsRecordOutcomeResponse(
  value: unknown,
): { ok: true } {
  return hostedClinicalRecordsRecordOutcomeResponseSchema.parse(value);
}
