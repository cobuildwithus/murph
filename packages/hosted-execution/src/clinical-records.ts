import { z } from "zod";

export const HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS = 5 * 1024 * 1024;
export const HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES = 32 * 1024 * 1024;
export const HOSTED_CLINICAL_RECORDS_MAX_PAGES = 500;
export const HOSTED_CLINICAL_RECORDS_MAX_RESOURCE_FAMILIES = 14;
export const HOSTED_CLINICAL_RECORDS_MAX_CURSOR_CHARS = 2_048;

const identifierSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._-]+$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const errorCodeSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
const resourceTypeSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Z][A-Za-z0-9]+$/u);
const isoDateTimeSchema = z.string().refine(
  (value) => /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)),
  "Expected an ISO date-time.",
);
const nonNegativeCountSchema = z.number().int().min(0).max(1_000_000);

export const hostedClinicalRecordsRetrievalScopeSchema = z.discriminatedUnion("coverage", [
  z.object({
    coverage: z.literal("whole-family"),
    queryFingerprint: sha256Schema,
    resourceType: resourceTypeSchema,
  }).strict(),
  z.object({
    coverage: z.literal("bounded-window"),
    from: isoDateTimeSchema,
    queryFingerprint: sha256Schema,
    resourceType: resourceTypeSchema,
    to: isoDateTimeSchema,
  }).strict().superRefine((scope, context) => {
    if (Date.parse(scope.from) >= Date.parse(scope.to)) {
      context.addIssue({
        code: "custom",
        message: "Expected bounded retrieval scope from to precede to.",
        path: ["from"],
      });
    }
  }),
]);

const hostedClinicalRecordsRetrievalScopesSchema = z
  .array(hostedClinicalRecordsRetrievalScopeSchema)
  .min(1)
  .max(HOSTED_CLINICAL_RECORDS_MAX_RESOURCE_FAMILIES)
  .superRefine((scopes, context) => {
    const seen = new Set<string>();
    scopes.forEach((scope, index) => {
      if (seen.has(scope.resourceType)) {
        context.addIssue({
          code: "custom",
          message: "Expected one retrieval scope per FHIR resource family.",
          path: [index, "resourceType"],
        });
      }
      seen.add(scope.resourceType);
    });
  });

export const hostedClinicalRecordsRunDescriptorSchema = z.object({
  connectionId: identifierSchema,
  fetchedAt: isoDateTimeSchema,
  fhirBaseUrlHash: sha256Schema,
  generation: z.number().int().min(1),
  grantedScopes: z.array(z.string().min(1).max(200)).max(50),
  patientIdHash: sha256Schema,
  providerDirectoryEntryId: identifierSchema.optional(),
  requestedScopes: z.array(z.string().min(1).max(200)).max(50),
  retrievalJobId: identifierSchema,
  retrievalScopes: hostedClinicalRecordsRetrievalScopesSchema,
  runId: identifierSchema,
  sourceSystem: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
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
  resourceType: resourceTypeSchema,
  runId: identifierSchema,
}).strict();

export const hostedClinicalRecordsFetchPageResponseSchema = z.discriminatedUnion("status", [
  z.object({
    body: z.string().max(HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS),
    nextCursor: z.string().min(1).max(HOSTED_CLINICAL_RECORDS_MAX_CURSOR_CHARS).nullable(),
    pageUrlHash: sha256Schema.optional(),
    status: z.literal("page"),
  }).strict(),
  z.object({
    errorCode: errorCodeSchema,
    retryable: z.boolean(),
    status: z.literal("unavailable"),
  }).strict(),
]);

export const hostedClinicalRecordsOutcomeCountsSchema = z.object({
  createdCount: nonNegativeCountSchema,
  executableDecisionCount: nonNegativeCountSchema,
  fetchedPageCount: nonNegativeCountSchema,
  fetchedResourceFamilyCount: nonNegativeCountSchema,
  rawFileCount: nonNegativeCountSchema,
  retractedCount: nonNegativeCountSchema,
  reviewDecisionCount: nonNegativeCountSchema,
  skippedExistingCount: nonNegativeCountSchema,
  supersededCount: nonNegativeCountSchema,
}).strict();

export const hostedClinicalRecordsRecordOutcomeRequestSchema = z.object({
  counts: hostedClinicalRecordsOutcomeCountsSchema,
  errorCode: errorCodeSchema.optional(),
  generation: z.number().int().min(1),
  runId: identifierSchema,
  status: z.enum(["completed", "partial", "failed", "preempted"]),
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
export type HostedClinicalRecordsOutcomeCounts = z.infer<
  typeof hostedClinicalRecordsOutcomeCountsSchema
>;
export type HostedClinicalRecordsRecordOutcomeRequest = z.infer<
  typeof hostedClinicalRecordsRecordOutcomeRequestSchema
>;

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
