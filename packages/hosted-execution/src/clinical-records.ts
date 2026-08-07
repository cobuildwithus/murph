import {
  CLINICAL_FHIR_RESOURCE_TYPES,
  clinicalFhirResourceTypeSchema,
  clinicalFhirRetrievalScopeSchema,
  clinicalFhirRetrievalScopesSchema,
  clinicalFhirRetrievalSliceSchema,
  clinicalFhirRetrievalSlicesSchema,
  clinicalIsoDateTimeSchema,
  clinicalSourceSystemSchema,
} from "@murphai/clinical-records";
import * as z from "@murphai/contracts/zod-runtime";
import {
  HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
  HOSTED_CLINICAL_RECORDS_CONNECT_LINK_PATH,
  HOSTED_CLINICAL_RECORDS_CONNECT_LINK_RESPONSE_MAX_BYTES,
  HOSTED_CLINICAL_RECORDS_ERROR_CODE_MAX_CHARS,
  HOSTED_CLINICAL_RECORDS_ERROR_CODE_PATTERN,
  HOSTED_CLINICAL_RECORDS_IDENTIFIER_MAX_CHARS,
  HOSTED_CLINICAL_RECORDS_IDENTIFIER_PATTERN,
  HOSTED_CLINICAL_RECORDS_MAX_CURSOR_CHARS,
  HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS,
  HOSTED_CLINICAL_RECORDS_MAX_PAGES,
  HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES,
  HOSTED_CLINICAL_RECORDS_RECORD_OUTCOME_REQUEST_MAX_BYTES,
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
  HOSTED_CLINICAL_RECORDS_CONNECT_LINK_PATH,
  HOSTED_CLINICAL_RECORDS_CONNECT_LINK_RESPONSE_MAX_BYTES,
  HOSTED_CLINICAL_RECORDS_ERROR_CODE_MAX_CHARS,
  HOSTED_CLINICAL_RECORDS_ERROR_CODE_PATTERN,
  HOSTED_CLINICAL_RECORDS_IDENTIFIER_MAX_CHARS,
  HOSTED_CLINICAL_RECORDS_IDENTIFIER_PATTERN,
  HOSTED_CLINICAL_RECORDS_MAX_CURSOR_CHARS,
  HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS,
  HOSTED_CLINICAL_RECORDS_MAX_PAGES,
  HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES,
  HOSTED_CLINICAL_RECORDS_RECORD_OUTCOME_REQUEST_MAX_BYTES,
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

export const hostedClinicalRecordsConnectLinkRequestSchema = z.object({
  requestKey: z.string().regex(/^scheduled_[a-f0-9]{64}$/u).optional(),
}).strict();

const hostedClinicalRecordsConnectUrlSchema = z.string().url().max(2_048).refine(
  isHostedClinicalRecordsConnectUrl,
  "Hosted clinical records connect URL is invalid.",
);

export const hostedClinicalRecordsConnectLinkResponseSchema = z.object({
  connectUrl: hostedClinicalRecordsConnectUrlSchema,
  expiresAt: clinicalIsoDateTimeSchema.nullable(),
  ok: z.literal(true),
}).strict();

export const hostedClinicalRecordsSyncRequestedWakeSchema = z.object({
  eventId: z.string().min(1),
  generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  kind: z.literal("clinical-records.sync-requested"),
  occurredAt: z.string().min(1),
  runId: identifierSchema,
  userId: z.string().min(1),
}).strict();

export const hostedClinicalRecordsReadRunRequestSchema = z.object({
  generation: z.number().int().min(1),
  runId: identifierSchema,
}).strict();

export const hostedClinicalRecordsRetrievalScopeSchema =
  clinicalFhirRetrievalScopeSchema;
export const hostedClinicalRecordsRetrievalSliceSchema =
  clinicalFhirRetrievalSliceSchema;

const hostedClinicalRecordsRetrievalScopesSchema = z
  .array(hostedClinicalRecordsRetrievalScopeSchema)
  .min(1)
  .pipe(clinicalFhirRetrievalScopesSchema);

const hostedClinicalRecordsRunDescriptorBaseShape = {
  connectionId: identifierSchema,
  fetchedAt: clinicalIsoDateTimeSchema,
  fhirBaseUrlHash: sha256Schema,
  generation: z.number().int().min(1),
  grantedScopes: z.array(z.string().min(1).max(200)).max(50),
  patientIdHash: sha256Schema,
  providerDirectoryEntryId: identifierSchema.optional(),
  requestedScopes: z.array(z.string().min(1).max(200)).max(50),
  retrievalJobId: identifierSchema,
  runId: identifierSchema,
  sourceSystem: clinicalSourceSystemSchema,
} satisfies z.ZodRawShape;

export const hostedClinicalRecordsLegacyRunDescriptorSchema = z.object({
  ...hostedClinicalRecordsRunDescriptorBaseShape,
  retrievalScopes: hostedClinicalRecordsRetrievalScopesSchema,
}).strict();

export const hostedClinicalRecordsQueryRunDescriptorSchema = z.object({
  ...hostedClinicalRecordsRunDescriptorBaseShape,
  retrievalProtocol: z.literal("query-slices-v2"),
  retrievalSlices: clinicalFhirRetrievalSlicesSchema,
}).strict();

export const hostedClinicalRecordsRunDescriptorSchema = z.union([
  hostedClinicalRecordsQueryRunDescriptorSchema,
  hostedClinicalRecordsLegacyRunDescriptorSchema,
]);

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

const hostedClinicalRecordsFetchPageRequestBaseShape = {
  cursor: z.string().min(1).max(HOSTED_CLINICAL_RECORDS_MAX_CURSOR_CHARS).nullable(),
  generation: z.number().int().min(1),
  requestId: identifierSchema,
  resourceType: clinicalFhirResourceTypeSchema,
  runId: identifierSchema,
} satisfies z.ZodRawShape;

export const hostedClinicalRecordsLegacyFetchPageRequestSchema = z.object(
  hostedClinicalRecordsFetchPageRequestBaseShape,
).strict();

export const hostedClinicalRecordsQueryFetchPageRequestSchema = z.object({
  ...hostedClinicalRecordsFetchPageRequestBaseShape,
  // Optional for the one-way deploy window in which the PR 1 runner can read
  // query descriptors but does not echo this frozen fingerprint. Remove after
  // old runner bundles and their serviceable in-flight runs have drained.
  queryFingerprint: sha256Schema.optional(),
  queryScopeId: clinicalFhirRetrievalSliceSchema.options[0].shape.queryScopeId,
  retrievalProtocol: z.literal("query-slices-v2"),
  sliceId: clinicalFhirRetrievalSliceSchema.options[0].shape.sliceId,
}).strict();

export const hostedClinicalRecordsFetchPageRequestSchema = z.union([
  hostedClinicalRecordsQueryFetchPageRequestSchema,
  hostedClinicalRecordsLegacyFetchPageRequestSchema,
]);

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
export type HostedClinicalRecordsRetrievalSlice = z.infer<
  typeof hostedClinicalRecordsRetrievalSliceSchema
>;
export type HostedClinicalRecordsConnectLinkResponse = z.infer<
  typeof hostedClinicalRecordsConnectLinkResponseSchema
>;
export type HostedClinicalRecordsConnectLinkRequest = z.infer<
  typeof hostedClinicalRecordsConnectLinkRequestSchema
>;
export type HostedClinicalRecordsRunDescriptor = z.infer<
  typeof hostedClinicalRecordsLegacyRunDescriptorSchema
>;
export type HostedClinicalRecordsQueryRunDescriptor = z.infer<
  typeof hostedClinicalRecordsQueryRunDescriptorSchema
>;
export type HostedClinicalRecordsAnyRunDescriptor = z.infer<
  typeof hostedClinicalRecordsRunDescriptorSchema
>;
export type HostedClinicalRecordsReadRunResponse = z.infer<
  typeof hostedClinicalRecordsReadRunResponseSchema
>;
export type HostedClinicalRecordsReadRunRequest = z.infer<
  typeof hostedClinicalRecordsReadRunRequestSchema
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

export function parseHostedClinicalRecordsConnectLinkResponse(
  value: unknown,
): HostedClinicalRecordsConnectLinkResponse {
  return hostedClinicalRecordsConnectLinkResponseSchema.parse(value);
}

function isHostedClinicalRecordsConnectUrl(value: string): boolean {
  const url = new URL(value);
  const httpLoopbackAllowed = url.protocol === "http:"
    && isLoopbackHostname(url.hostname);
  if (
    (url.protocol !== "https:" && !httpLoopbackAllowed)
    || url.username.length > 0
    || url.password.length > 0
    || url.pathname !== "/records/connect"
  ) {
    return false;
  }

  if (
    url.hash.length === 0
    && url.searchParams.size === 1
    && url.searchParams.get("launch") === "clinical-records"
  ) {
    return true;
  }
  if (url.search.length > 0) {
    return false;
  }

  return /^clinicalRecordsIntent=cr_[A-Za-z0-9_-]{32}$/u.test(
    url.hash.slice(1),
  );
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1";
}

export function parseHostedClinicalRecordsRunDescriptor(
  value: unknown,
): HostedClinicalRecordsAnyRunDescriptor {
  return hostedClinicalRecordsRunDescriptorSchema.parse(value);
}

export function parseHostedClinicalRecordsReadRunRequest(
  value: unknown,
): HostedClinicalRecordsReadRunRequest {
  return hostedClinicalRecordsReadRunRequestSchema.parse(value);
}

export function parseHostedClinicalRecordsFetchPageRequest(
  value: unknown,
): HostedClinicalRecordsFetchPageRequest {
  return hostedClinicalRecordsFetchPageRequestSchema.parse(value);
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
