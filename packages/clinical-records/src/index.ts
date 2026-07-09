import { createHash } from "node:crypto";

import {
  BLOOD_TEST_FASTING_STATUSES,
  CLINICAL_ASSERTION_DOMAINS,
  CLINICAL_ASSERTION_POLARITIES,
  CLINICAL_ASSERTION_TYPES,
  EVENT_SOURCES,
  TEST_RESULT_STATUSES,
  bloodTestResultSchema,
  clinicalEvidenceRefSchema,
  clinicalNoteSectionSchema,
  externalRefSchema,
  isStrictIsoDate,
  isStrictIsoDateTime,
  isValidIanaTimeZone,
  measurementEntrySchema,
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

export const CLINICAL_IMPORT_CANDIDATE_KINDS = Object.freeze([
  "assertion",
  "clinical-note",
  "diagnostic-test",
  "vitals",
] as const);

export const CLINICAL_IMPORT_PLAN_MAX_CANDIDATES = 5_000;
export const CLINICAL_IMPORT_PLAN_MAX_UNSUPPORTED = 10_000;
export const CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES = 500;
export const CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE = 1_000;
export const CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES = 5_000;
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

const isoDateTextSchema = z.string().refine(
  (value) => isStrictIsoDate(value),
  "Invalid ISO date string.",
);

const timeZoneTextSchema = z.string().refine(
  (value) => isValidIanaTimeZone(value),
  "Invalid IANA time zone.",
);

const slugSchema = z.string().regex(SLUG_PATTERN).max(80);

export const clinicalRawManifestResourceFileSchema = z
  .object({
    resourceType: clinicalFhirResourceTypeSchema,
    relativePath: clinicalRawRelativePathSchema,
    count: z.number().int().min(0).max(CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE),
    sha256: sha256HexSchema,
    pageUrlHash: sha256HexSchema.optional(),
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

export const clinicalRawManifestErrorSchema = z
  .object({
    resourceType: z.string().min(1).max(80).optional(),
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(500),
  })
  .strict();

export const clinicalRawManifestSchema = z
  .object({
    schemaVersion: z.literal("murph.clinical-raw-manifest.v1"),
    kind: z.literal("clinical_fhir_retrieval"),
    connectionId: clinicalFhirPathIdSchema,
    retrievalJobId: clinicalFhirPathIdSchema,
    providerDirectoryEntryId: z.string().min(1).max(120).optional(),
    sourceSystem: clinicalSourceSystemSchema,
    fhirBaseUrlHash: sha256HexSchema,
    patientIdHash: sha256HexSchema,
    fetchedAt: isoDateTimeTextSchema,
    resourceFiles: clinicalRawManifestResourceFilesSchema,
    completedResourceTypes: clinicalRawManifestCompletedResourceTypesSchema,
    requestedScopes: z.array(z.string().min(1).max(200)).max(50),
    grantedScopes: z.array(z.string().min(1).max(200)).max(50),
    errors: z.array(clinicalRawManifestErrorSchema).max(100).optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const declaredResourceTypes = new Set(manifest.resourceFiles.map((resourceFile) => resourceFile.resourceType));
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

export const fhirSourceRefSchema = z
  .object({
    sourceSystem: clinicalSourceSystemSchema,
    resourceType: z.string().min(1).max(80),
    resourceId: z.string().min(1).max(200),
    version: z.string().min(1).max(200).optional(),
    facet: slugSchema.optional(),
    rawRef: clinicalRawPathSchema,
  })
  .strict();

const candidateCommonPayloadSchema = z
  .object({
    occurredAt: isoDateTimeTextSchema,
    recordedAt: isoDateTimeTextSchema.optional(),
    timeZone: timeZoneTextSchema.optional(),
    source: z.enum(EVENT_SOURCES).default("import"),
    title: z.string().min(1).max(160).optional(),
    note: z.string().min(1).max(4000).optional(),
    tags: z.array(slugSchema).max(25).optional(),
    rawRefs: z.array(clinicalRawPathSchema).max(50).optional(),
    evidence: z.array(clinicalEvidenceRefSchema).max(50).optional(),
    externalRef: externalRefSchema,
  })
  .strict();

export const clinicalVitalsCandidatePayloadSchema = candidateCommonPayloadSchema
  .extend({
    title: z.string().min(1).max(160).default("FHIR vitals"),
    measurements: z.array(measurementEntrySchema).min(1).max(25),
  })
  .strict();

export const clinicalDiagnosticTestCandidatePayloadSchema = candidateCommonPayloadSchema
  .extend({
    testName: z.string().min(1).max(160),
    resultStatus: z.enum(TEST_RESULT_STATUSES).default("unknown"),
    summary: z.string().min(1).max(1000).optional(),
    testCategory: z.string().min(1).max(64).optional(),
    specimenType: z.string().min(1).max(64).optional(),
    labName: z.string().min(1).max(160).optional(),
    labPanelId: z.string().min(1).max(120).optional(),
    collectedAt: isoDateTimeTextSchema.optional(),
    reportedAt: isoDateTimeTextSchema.optional(),
    fastingStatus: z.enum(BLOOD_TEST_FASTING_STATUSES).optional(),
    results: z.array(bloodTestResultSchema).min(1).max(500).optional(),
  })
  .strict();

export const clinicalNoteCandidatePayloadSchema = candidateCommonPayloadSchema
  .extend({
    title: z.string().min(1).max(160).default("FHIR clinical note"),
    note: z.string().min(1).max(4000).optional(),
    noteType: z.string().min(1).max(120).default("clinical_note"),
    authoredAt: isoDateTimeTextSchema.optional(),
    signedAt: isoDateTimeTextSchema.optional(),
    author: z.string().min(1).max(160).optional(),
    facility: z.string().min(1).max(160).optional(),
    sections: z.array(clinicalNoteSectionSchema).min(1).max(50).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.note && (!value.sections || value.sections.length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "clinical-note candidate requires note or sections.",
        path: ["note"],
      });
    }
  });

export const clinicalAssertionCandidatePayloadSchema = candidateCommonPayloadSchema
  .extend({
    title: z.string().min(1).max(160).default("FHIR clinical assertion"),
    assertion: z.enum(CLINICAL_ASSERTION_TYPES),
    domain: z.enum(CLINICAL_ASSERTION_DOMAINS).optional(),
    polarity: z.enum(CLINICAL_ASSERTION_POLARITIES).optional(),
    subject: z.string().min(1).max(240).optional(),
    assertionText: z.string().min(1).max(1000).optional(),
    bodySite: z.string().min(1).max(120).optional(),
    code: z.string().min(1).max(80).optional(),
    codeSystem: z.string().min(1).max(80).optional(),
    assertedOn: isoDateTextSchema,
    sourceLabel: z.string().min(1).max(240).optional(),
  })
  .strict();

const clinicalImportCandidateBaseSchema = z
  .object({
    resource: fhirSourceRefSchema,
    rawRef: clinicalRawPathSchema,
  })
  .strict();

export const clinicalImportCandidateSchema = z.discriminatedUnion("kind", [
  clinicalImportCandidateBaseSchema.extend({
    kind: z.literal("assertion"),
    payload: clinicalAssertionCandidatePayloadSchema,
  }),
  clinicalImportCandidateBaseSchema.extend({
    kind: z.literal("clinical-note"),
    payload: clinicalNoteCandidatePayloadSchema,
  }),
  clinicalImportCandidateBaseSchema.extend({
    kind: z.literal("diagnostic-test"),
    payload: clinicalDiagnosticTestCandidatePayloadSchema,
  }),
  clinicalImportCandidateBaseSchema.extend({
    kind: z.literal("vitals"),
    payload: clinicalVitalsCandidatePayloadSchema,
  }),
]);

export const clinicalImportUnsupportedResourceSchema = z
  .object({
    resourceType: z.string().min(1).max(80),
    resourceId: z.string().min(1).max(200).optional(),
    reason: z.string().min(1).max(240),
    rawRef: clinicalRawPathSchema,
  })
  .strict();

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
    candidates: z.array(clinicalImportCandidateSchema).max(CLINICAL_IMPORT_PLAN_MAX_CANDIDATES),
    unsupported: z.array(clinicalImportUnsupportedResourceSchema).max(CLINICAL_IMPORT_PLAN_MAX_UNSUPPORTED),
  })
  .strict();

export type ClinicalSourceSystem = z.infer<typeof clinicalSourceSystemSchema>;
export type ClinicalRawManifest = z.infer<typeof clinicalRawManifestSchema>;
export type ClinicalRawManifestResourceFile = z.infer<typeof clinicalRawManifestResourceFileSchema>;
export type FhirSourceRef = z.infer<typeof fhirSourceRefSchema>;
export type ClinicalImportCandidate = z.infer<typeof clinicalImportCandidateSchema>;
export type ClinicalImportPlan = z.infer<typeof clinicalImportPlanSchema>;
export type ClinicalImportUnsupportedResource = z.infer<typeof clinicalImportUnsupportedResourceSchema>;
export type ClinicalImportCandidateKind = (typeof CLINICAL_IMPORT_CANDIDATE_KINDS)[number];

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
  version?: string | undefined;
  facet?: string | undefined;
}) {
  const fhirBaseUrlHash = sha256HexSchema.parse(input.fhirBaseUrlHash);
  const patientIdHash = sha256HexSchema.parse(input.patientIdHash);
  const system = [
    input.sourceSystem,
    fhirBaseUrlHash,
    patientIdHash,
  ].join("-");

  return externalRefSchema.parse({
    system,
    resourceType: fhirResourceTypeToSlug(input.resourceType),
    resourceId: input.resourceId,
    ...(input.version ? { version: input.version } : {}),
    ...(input.facet ? { facet: clinicalFacetSlug(input.facet) } : {}),
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
