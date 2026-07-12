import { createHash } from "node:crypto";

import {
  clinicalEvidenceRefSchema,
  eventImportRetractionDecisionSchema,
  isStrictIsoDateTime,
  publicEventImportJsonlRowPayloadSchemasByKind,
  versionedExternalRefSchema,
} from "@murphai/contracts";
import { z } from "zod";

export const CLINICAL_SOURCE_SYSTEMS = Object.freeze([
  "epic-fhir",
  "cerner-fhir",
  "athena-fhir",
  "generic-smart-fhir",
] as const);

export const CLINICAL_FHIR_RESOURCE_TYPES = Object.freeze([
  "Patient",
  "AllergyIntolerance",
  "Condition",
  "MedicationRequest",
  "MedicationStatement",
  "Observation",
  "DiagnosticReport",
  "DocumentReference",
  "Encounter",
  "Procedure",
  "Immunization",
  "CarePlan",
  "CareTeam",
  "Goal",
] as const);

export const CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES = 500;
export const CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE = 1_000;
export const CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES = 5_000;
export const CLINICAL_IMPORT_PLAN_MAX_DECISIONS =
  CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES + 1;
export const CLINICAL_RAW_MANIFEST_MAX_BYTES = 1024 * 1024;
export const CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES = 32 * 1024 * 1024;

const RAW_PATH_PATTERN = /^raw\/[A-Za-z0-9._/-]+$/u;
const RELATIVE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
const CLINICAL_FHIR_PATH_ID_PATTERN = /^[A-Za-z0-9._-]+$/u;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UNIT_PATTERN = /^[A-Za-z0-9._/%-]+$/u;
const FHIR_RESOURCE_ID_PATTERN = /^[A-Za-z0-9.-]{1,64}$/u;
const FHIR_RELATIVE_PATIENT_REFERENCE_PATTERN =
  /^Patient\/([A-Za-z0-9.-]{1,64})(?:\/_history\/[A-Za-z0-9.-]{1,64})?$/u;
const FHIR_ABSOLUTE_PATIENT_PATH_PATTERN =
  /^(.*)\/Patient\/([A-Za-z0-9.-]{1,64})(?:\/_history\/[A-Za-z0-9.-]{1,64})?$/u;
const sha256HexSchema = z.string().regex(SHA256_HEX_PATTERN);

export const clinicalSourceSystemSchema = z.enum(CLINICAL_SOURCE_SYSTEMS);
export const clinicalFhirResourceTypeSchema = z.enum(CLINICAL_FHIR_RESOURCE_TYPES);

export const clinicalRawRelativePathSchema = z
  .string()
  .regex(RELATIVE_PATH_PATTERN, "Expected a relative path without parent traversal.");

export const clinicalRawPathSchema = z
  .string()
  .regex(RAW_PATH_PATTERN, "Expected a vault-relative raw/* path.")
  .refine(
    (value) => !value.split("/").includes(".."),
    "Expected a vault-relative raw/* path without parent traversal.",
  );

const clinicalFhirPathIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(CLINICAL_FHIR_PATH_ID_PATTERN, "Expected a path-safe clinical FHIR identifier.")
  .refine((value) => value !== "." && value !== "..", "Expected a path-safe clinical FHIR identifier.");

export const clinicalFhirManifestPathSchema = clinicalRawPathSchema.refine((value) => {
  const parts = value.split("/");
  return (
    parts.length === 6
    && parts[0] === "raw"
    && parts[1] === "clinical"
    && parts[2] === "fhir"
    && clinicalFhirPathIdSchema.safeParse(parts[3]).success
    && clinicalFhirPathIdSchema.safeParse(parts[4]).success
    && parts[5] === "manifest.json"
  );
}, "Expected raw/clinical/fhir/<connectionId>/<retrievalJobId>/manifest.json.");

export const fhirResourceTypeSlugSchema = z.string().regex(SLUG_PATTERN);

const isoDateTimeTextSchema = z.string().refine(
  (value) => isStrictIsoDateTime(value),
  "Invalid ISO date-time string.",
);

export const clinicalRawManifestResourceFileSchema = z
  .object({
    resourceType: clinicalFhirResourceTypeSchema,
    relativePath: clinicalRawRelativePathSchema,
    count: z.number().int().min(0).max(CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE),
    sha256: sha256HexSchema,
    pageUrlHash: sha256HexSchema.optional(),
    nextPageUrlHash: sha256HexSchema.optional(),
  })
  .strict()
  .superRefine((resourceFile, context) => {
    const pathParts = resourceFile.relativePath.split("/");
    const hasResourceTypeDirectory = (
      clinicalFhirPathIdSchema.safeParse(resourceFile.resourceType).success
      && pathParts.length >= 2
      && pathParts[0] === resourceFile.resourceType
      && pathParts.slice(1).every((part) => part.length > 0 && part !== ".")
    );
    if (!hasResourceTypeDirectory) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected a relative path beneath the declared FHIR resource type directory.",
        path: ["relativePath"],
      });
    }
  });

const clinicalRawManifestResourceFilesSchema = z
  .array(clinicalRawManifestResourceFileSchema)
  .max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES)
  .superRefine((resourceFiles, context) => {
    const totalResourceCount = resourceFiles.reduce((sum, resourceFile) => sum + resourceFile.count, 0);
    if (totalResourceCount > CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Clinical raw FHIR manifest total resource count exceeds ${CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES}.`,
      });
    }

    const seenRelativePaths = new Set<string>();
    resourceFiles.forEach((resourceFile, index) => {
      if (seenRelativePaths.has(resourceFile.relativePath)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Clinical raw FHIR manifest resource file relativePath values must be unique.",
          path: [index, "relativePath"],
        });
      }
      seenRelativePaths.add(resourceFile.relativePath);
    });
  });

const clinicalRawManifestCompletedResourceTypesSchema = z
  .array(clinicalFhirResourceTypeSchema)
  .max(CLINICAL_FHIR_RESOURCE_TYPES.length)
  .superRefine((resourceTypes, context) => {
    if (new Set(resourceTypes).size !== resourceTypes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected completed FHIR resource types to be unique.",
      });
    }
  });

export const clinicalFhirRetrievalScopeSchema = z.discriminatedUnion("coverage", [
  z
    .object({
      coverage: z.literal("whole-family"),
      queryFingerprint: sha256HexSchema,
      resourceType: clinicalFhirResourceTypeSchema,
    })
    .strict(),
  z
    .object({
      coverage: z.literal("bounded-window"),
      from: isoDateTimeTextSchema,
      queryFingerprint: sha256HexSchema,
      resourceType: clinicalFhirResourceTypeSchema,
      to: isoDateTimeTextSchema,
    })
    .strict()
    .superRefine((scope, context) => {
      if (Date.parse(scope.from) >= Date.parse(scope.to)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Expected bounded FHIR retrieval scope from to precede to.",
          path: ["from"],
        });
      }
    }),
]);

const clinicalFhirRetrievalScopesSchema = z
  .array(clinicalFhirRetrievalScopeSchema)
  .max(CLINICAL_FHIR_RESOURCE_TYPES.length)
  .superRefine((scopes, context) => {
    const seenResourceTypes = new Set<string>();
    scopes.forEach((scope, index) => {
      if (seenResourceTypes.has(scope.resourceType)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Expected one retrieval scope per FHIR resource type.",
          path: [index, "resourceType"],
        });
      }
      seenResourceTypes.add(scope.resourceType);
    });
  });

export const clinicalRawManifestErrorSchema = z
  .object({
    resourceType: clinicalFhirResourceTypeSchema.optional(),
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(500),
  })
  .strict();

export const clinicalRawManifestSchema = z
  .object({
    schemaVersion: z.literal("murph.clinical-raw-manifest.v2"),
    kind: z.literal("clinical_fhir_retrieval"),
    connectionId: clinicalFhirPathIdSchema,
    retrievalJobId: clinicalFhirPathIdSchema,
    providerDirectoryEntryId: z.string().min(1).max(120).optional(),
    sourceSystem: clinicalSourceSystemSchema,
    fhirBaseUrlHash: sha256HexSchema,
    patientIdHash: sha256HexSchema,
    fetchedAt: isoDateTimeTextSchema,
    resourceFiles: clinicalRawManifestResourceFilesSchema,
    retrievalScopes: clinicalFhirRetrievalScopesSchema,
    completedResourceTypes: clinicalRawManifestCompletedResourceTypesSchema,
    requestedScopes: z.array(z.string().min(1).max(200)).max(50),
    grantedScopes: z.array(z.string().min(1).max(200)).max(50),
    errors: z.array(clinicalRawManifestErrorSchema).max(100).optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const declaredResourceTypes = new Set(manifest.resourceFiles.map((resourceFile) => resourceFile.resourceType));
    const scopedResourceTypes = new Set(manifest.retrievalScopes.map((scope) => scope.resourceType));
    for (const resourceType of declaredResourceTypes) {
      if (!scopedResourceTypes.has(resourceType)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A declared FHIR resource file must have an explicit retrieval scope.",
          path: ["retrievalScopes"],
        });
      }
    }
    for (const scope of manifest.retrievalScopes) {
      const hasResourceFile = declaredResourceTypes.has(scope.resourceType);
      const hasResourceError = manifest.errors?.some((error) =>
        error.resourceType === scope.resourceType
      ) === true;
      if (!hasResourceFile && !hasResourceError) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A scoped FHIR resource type must have raw evidence or a typed retrieval error.",
          path: ["retrievalScopes"],
        });
      }
    }
    for (const resourceType of manifest.completedResourceTypes) {
      if (!declaredResourceTypes.has(resourceType)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A completed FHIR resource type must have a declared raw resource file.",
          path: ["completedResourceTypes"],
        });
      }
    }
  });

export const clinicalFhirExternalRefSchema = versionedExternalRefSchema.omit({ facet: true });

const clinicalDecisionEvidenceSchema = z.array(clinicalEvidenceRefSchema).min(1).max(50);

const clinicalUpsertOwnedShape = {
  evidence: clinicalDecisionEvidenceSchema,
  externalRef: clinicalFhirExternalRefSchema,
  source: z.literal("import"),
} satisfies z.ZodRawShape;

const clinicalImportBoundaryFields = {
  attachments: true,
  dataOrigin: true,
  evidence: true,
  externalRef: true,
  links: true,
  rawRefs: true,
  source: true,
} as const;

export const clinicalImportUpsertPayloadSchema = z.discriminatedUnion("kind", [
  publicEventImportJsonlRowPayloadSchemasByKind.clinical_assertion
    .omit(clinicalImportBoundaryFields)
    .extend(clinicalUpsertOwnedShape)
    .strict(),
  publicEventImportJsonlRowPayloadSchemasByKind.measurement
    .omit(clinicalImportBoundaryFields)
    .extend(clinicalUpsertOwnedShape)
    .strict(),
  publicEventImportJsonlRowPayloadSchemasByKind.note
    .omit(clinicalImportBoundaryFields)
    .extend(clinicalUpsertOwnedShape)
    .strict(),
  publicEventImportJsonlRowPayloadSchemasByKind.test
    .omit(clinicalImportBoundaryFields)
    .extend(clinicalUpsertOwnedShape)
    .strict(),
]);

export const clinicalImportUpsertDecisionSchema = z
  .object({
    action: z.literal("upsert"),
    payload: clinicalImportUpsertPayloadSchema,
  })
  .strict();

export const clinicalImportRetractDecisionSchema = eventImportRetractionDecisionSchema
  .extend({
    evidence: clinicalDecisionEvidenceSchema,
    externalRef: clinicalFhirExternalRefSchema,
  })
  .strict();

export const clinicalImportReviewDecisionSchema = z
  .object({
    action: z.literal("review"),
    resourceType: clinicalFhirResourceTypeSchema,
    resourceId: z.string().min(1).max(200).optional(),
    externalRef: clinicalFhirExternalRefSchema.optional(),
    reason: z.string().min(1).max(240),
    evidence: clinicalDecisionEvidenceSchema,
  })
  .strict();

export const clinicalImportDecisionSchema = z.discriminatedUnion("action", [
  clinicalImportUpsertDecisionSchema,
  clinicalImportRetractDecisionSchema,
  clinicalImportReviewDecisionSchema,
]);

export const clinicalImportPlanSchema = z
  .object({
    schemaVersion: z.literal("murph.clinical-import-plan.v1"),
    source: z
      .object({
        kind: z.literal("fhir"),
        rawManifestPath: clinicalFhirManifestPathSchema,
        sourceSystem: clinicalSourceSystemSchema,
        connectionId: clinicalFhirPathIdSchema,
        retrievalJobId: clinicalFhirPathIdSchema,
      })
      .strict(),
    decisions: z.array(clinicalImportDecisionSchema).max(CLINICAL_IMPORT_PLAN_MAX_DECISIONS),
  })
  .strict();

export type ClinicalSourceSystem = z.infer<typeof clinicalSourceSystemSchema>;
export type ClinicalRawManifest = z.infer<typeof clinicalRawManifestSchema>;
export type ClinicalRawManifestResourceFile = z.infer<typeof clinicalRawManifestResourceFileSchema>;
export type ClinicalFhirRetrievalScope = z.infer<typeof clinicalFhirRetrievalScopeSchema>;
export type ClinicalFhirExternalRef = z.infer<typeof clinicalFhirExternalRefSchema>;
export type ClinicalImportUpsertPayload = z.infer<typeof clinicalImportUpsertPayloadSchema>;
export type ClinicalImportDecision = z.infer<typeof clinicalImportDecisionSchema>;
export type ClinicalImportPlan = z.infer<typeof clinicalImportPlanSchema>;

export function fhirResourceTypeToSlug(resourceType: string): string {
  return resourceType
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function clinicalFacetSlug(value: string): string {
  return fhirResourceTypeToSlug(value);
}

export function normalizeClinicalFhirPatientId(value: string): string | null {
  const trimmed = value.trim();
  if (FHIR_RESOURCE_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  return parseClinicalFhirPatientReference(trimmed)?.patientId ?? null;
}

export function hashClinicalFhirPatientId(value: string): string {
  const patientId = normalizeClinicalFhirPatientId(value);
  if (!patientId) {
    throw new Error("Expected a FHIR Patient id or reference.");
  }

  return createHash("sha256").update(patientId, "utf8").digest("hex");
}

export function hashClinicalFhirBaseUrl(value: string): string {
  const fhirBaseUrl = normalizeClinicalFhirBaseUrl(value);
  if (!fhirBaseUrl) {
    throw new Error("Expected an absolute HTTP(S) FHIR base URL without credentials, query, or fragment.");
  }

  return createHash("sha256").update(fhirBaseUrl, "utf8").digest("hex");
}

export function normalizeClinicalFhirPatientReference(input: {
  fhirBaseUrlHash: string;
  reference: string;
}): string | null {
  const expectedFhirBaseUrlHash = sha256HexSchema.safeParse(input.fhirBaseUrlHash);
  const parsedReference = parseClinicalFhirPatientReference(input.reference.trim());
  if (!expectedFhirBaseUrlHash.success || !parsedReference) {
    return null;
  }
  if (
    parsedReference.fhirBaseUrl
    && hashClinicalFhirBaseUrl(parsedReference.fhirBaseUrl) !== expectedFhirBaseUrlHash.data
  ) {
    return null;
  }

  return parsedReference.patientId;
}

export function isClinicalFhirUrlWithinBase(input: {
  fhirBaseUrlHash: string;
  url: string;
}): boolean {
  const expectedFhirBaseUrlHash = sha256HexSchema.safeParse(input.fhirBaseUrlHash);
  const pageUrlText = input.url.trim();
  if (!expectedFhirBaseUrlHash.success || pageUrlText.length === 0 || pageUrlText.length > 4_096) {
    return false;
  }

  let pageUrl: URL;
  try {
    pageUrl = new URL(pageUrlText);
  } catch {
    return false;
  }
  if (
    (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:")
    || pageUrl.username.length > 0
    || pageUrl.password.length > 0
    || pageUrl.hash.length > 0
  ) {
    return false;
  }

  const pathSegments = pageUrl.pathname.split("/");
  for (let segmentCount = 1; segmentCount <= pathSegments.length; segmentCount += 1) {
    const pathname = pathSegments.slice(0, segmentCount).join("/");
    const candidateBaseUrl = `${pageUrl.origin}${pathname}`;
    if (hashClinicalFhirBaseUrl(candidateBaseUrl) === expectedFhirBaseUrlHash.data) {
      return true;
    }
  }

  return false;
}

export function hashClinicalFhirPageUrl(value: string): string {
  const pageUrl = value.trim();
  if (pageUrl.length === 0 || pageUrl.length > 4_096) {
    throw new Error("Expected a bounded FHIR page URL.");
  }

  return createHash("sha256").update(pageUrl, "utf8").digest("hex");
}

function parseClinicalFhirPatientReference(value: string): {
  fhirBaseUrl?: string;
  patientId: string;
} | null {
  const relativeMatch = FHIR_RELATIVE_PATIENT_REFERENCE_PATTERN.exec(value);
  if (relativeMatch?.[1]) {
    return { patientId: relativeMatch[1] };
  }
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value)) {
    return null;
  }

  let referenceUrl: URL;
  try {
    referenceUrl = new URL(value);
  } catch {
    return null;
  }
  if (
    (referenceUrl.protocol !== "http:" && referenceUrl.protocol !== "https:")
    || referenceUrl.username.length > 0
    || referenceUrl.password.length > 0
    || referenceUrl.search.length > 0
    || referenceUrl.hash.length > 0
  ) {
    return null;
  }

  const absoluteMatch = FHIR_ABSOLUTE_PATIENT_PATH_PATTERN.exec(referenceUrl.pathname);
  const patientId = absoluteMatch?.[2];
  if (!patientId) {
    return null;
  }
  const fhirBaseUrl = normalizeClinicalFhirBaseUrl(
    `${referenceUrl.origin}${absoluteMatch[1] ?? ""}`,
  );
  return fhirBaseUrl ? { fhirBaseUrl, patientId } : null;
}

function normalizeClinicalFhirBaseUrl(value: string): string | null {
  let fhirBaseUrl: URL;
  try {
    fhirBaseUrl = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    (fhirBaseUrl.protocol !== "http:" && fhirBaseUrl.protocol !== "https:")
    || fhirBaseUrl.username.length > 0
    || fhirBaseUrl.password.length > 0
    || fhirBaseUrl.search.length > 0
    || fhirBaseUrl.hash.length > 0
  ) {
    return null;
  }

  const pathname = fhirBaseUrl.pathname.replace(/\/+$/u, "");
  return `${fhirBaseUrl.origin}${pathname}`;
}

export function externalRefForFhir(input: {
  fhirBaseUrlHash: string;
  patientIdHash: string;
  sourceSystem: ClinicalSourceSystem;
  resourceType: string;
  resourceId: string;
  version: string;
}) {
  const fhirBaseUrlHash = sha256HexSchema.parse(input.fhirBaseUrlHash);
  const patientIdHash = sha256HexSchema.parse(input.patientIdHash);
  const system = [
    input.sourceSystem,
    fhirBaseUrlHash,
    patientIdHash,
  ].join("-");

  return clinicalFhirExternalRefSchema.parse({
    system,
    resourceType: fhirResourceTypeToSlug(input.resourceType),
    resourceId: input.resourceId,
    version: input.version,
  });
}

export function rawRefForClinicalManifestFile(input: {
  manifestPath: string;
  resourceFile: ClinicalRawManifestResourceFile;
}): string {
  const resourceFile = clinicalRawManifestResourceFileSchema.parse(input.resourceFile);
  const manifestParts = clinicalFhirManifestPathSchema.parse(input.manifestPath).split("/");
  manifestParts.pop();
  const rawRef = [...manifestParts, resourceFile.relativePath].join("/");
  return clinicalRawPathSchema.parse(rawRef);
}

export function hasWholeFamilyClinicalFhirRetrievalScope(
  manifest: Pick<ClinicalRawManifest, "retrievalScopes">,
  resourceType: string,
): boolean {
  return manifest.retrievalScopes.some((scope) =>
    scope.resourceType === resourceType && scope.coverage === "whole-family"
  );
}
