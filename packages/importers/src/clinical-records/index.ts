import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import type {
  AllergyIntolerance,
  Bundle,
  CodeableConcept,
  Coding,
  DiagnosticReport,
  DocumentReference,
  Narrative,
  Observation,
  ObservationComponent,
  Period,
  Quantity,
  Resource,
} from "@medplum/fhirtypes";
import {
  CLINICAL_IMPORT_PLAN_MAX_DECISIONS,
  CLINICAL_RAW_MANIFEST_MAX_BYTES,
  CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES,
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
  clinicalFacetSlug,
  clinicalFhirManifestPathSchema,
  clinicalImportRetractDecisionSchema,
  clinicalImportPlanSchema,
  clinicalImportReviewDecisionSchema,
  clinicalImportUpsertDecisionSchema,
  clinicalRawManifestSchema,
  externalRefForFhir,
  hashClinicalFhirPageUrl,
  hashClinicalFhirPatientId,
  isClinicalFhirUrlWithinBase,
  normalizeClinicalFhirPatientReference,
  rawRefForClinicalManifestFile,
  type ClinicalImportDecision,
  type ClinicalImportPlan,
  type ClinicalRawManifest,
  type ClinicalRawManifestResourceFile,
} from "@murphai/clinical-records";
import { isWritableIsoDateTime, type BloodTestResultRecord } from "@murphai/contracts";
import { resolveVaultPathOnDisk } from "@murphai/core";

export interface BuildClinicalImportPlanInput {
  vaultRoot: string;
  manifestPath: string;
}

type FhirResourceContext<TResource extends Resource = Resource> = {
  manifest: ClinicalRawManifest;
  rawRef: string;
  resource: TResource;
};

type FhirResourcePage = {
  nextPageUrlHash?: string;
  rawRef: string;
  resourceFile: ClinicalRawManifestResourceFile;
  resources: Resource[];
};

type AllergyEvidenceSummary = {
  complete: boolean;
  hasConflict: boolean;
};

type MappedFhirResource = ClinicalImportDecision;

type VitalDefinition = {
  facet: string;
  metric: string;
  title: string;
  unit: string;
};
type VitalMeasurementInput = {
  metric: string;
  unit: string;
  value: number;
};
type VitalConceptDecision =
  | { status: "ambiguous" }
  | { status: "matched"; vital: VitalDefinition }
  | { status: "unmatched" };
type DocumentReferenceTextDecision =
  | { status: "ambiguous" }
  | { status: "available"; text: string }
  | { status: "unavailable" };

const VITAL_LOINC_BY_CODE = new Map<string, VitalDefinition>([
  ["8480-6", { facet: "bp-systolic", metric: "systolic-blood-pressure", title: "Systolic blood pressure", unit: "mmHg" }],
  ["8462-4", { facet: "bp-diastolic", metric: "diastolic-blood-pressure", title: "Diastolic blood pressure", unit: "mmHg" }],
  ["8867-4", { facet: "heart-rate", metric: "heart-rate", title: "Heart rate", unit: "bpm" }],
  ["9279-1", { facet: "respiratory-rate", metric: "respiratory-rate", title: "Respiratory rate", unit: "breaths/min" }],
  ["59408-5", { facet: "spo2", metric: "spo2", title: "Oxygen saturation", unit: "percent" }],
  ["8310-5", { facet: "temperature", metric: "temperature", title: "Body temperature", unit: "Cel" }],
  ["29463-7", { facet: "body-weight", metric: "body-weight", title: "Body weight", unit: "kg" }],
]);

const CANONICAL_BASE64_TEXT = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const DOCUMENT_REFERENCE_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

const NO_KNOWN_ALLERGY_CODES = new Set(["716186003"]);
const ALLERGY_CONFLICT_RESOURCE_TYPES = new Set(["AllergyIntolerance", "Condition"]);
const NO_KNOWN_ALLERGY_TEXTS = new Set([
  "no known allergy",
  "no known allergy situation",
  "no known allergies",
  "no known allergies situation",
]);
const FHIR_SYSTEM_ALLERGY_CLINICAL_STATUS = "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical";
const FHIR_SYSTEM_ALLERGY_VERIFICATION_STATUS = "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification";
const FHIR_SYSTEM_LOINC = "http://loinc.org";
const FHIR_SYSTEM_OBSERVATION_CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category";
const FHIR_SYSTEM_OBSERVATION_INTERPRETATION = "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation";
const FHIR_SYSTEM_SNOMED_CT = "http://snomed.info/sct";
const FHIR_SYSTEM_UCUM = "http://unitsofmeasure.org";
const LABORATORY_CATEGORY_CODES = new Set(["laboratory"]);
const RESULT_STATUS_NORMAL_CODES = new Set(["n"]);
const RESULT_STATUS_ABNORMAL_CODES = new Set(["a", "aa", "h", "hh", "l", "ll"]);
const VITAL_LOINC_CODES = new Set(VITAL_LOINC_BY_CODE.keys());
const CLINICAL_NOTE_MAX_LENGTH = 4_000;
const DIAGNOSTIC_SUMMARY_MAX_LENGTH = 1_000;
const LAB_RESULT_TEXT_MAX_LENGTH = 160;
const LAB_RESULT_MAX_COUNT = 500;
const FHIR_VITAL_UNIT_ALIASES_BY_FACET = new Map<string, ReadonlyMap<string, string>>([
  ["body-weight", new Map([["[lb_av]", "lb"], ["lb", "lb"]])],
  ["bp-diastolic", new Map([["mm[hg]", "mmHg"], ["mmhg", "mmHg"]])],
  ["bp-systolic", new Map([["mm[hg]", "mmHg"], ["mmhg", "mmHg"]])],
  ["heart-rate", new Map([
    ["/min", "bpm"],
    ["beats per minute", "bpm"],
    ["beats/min", "bpm"],
    ["beats/minute", "bpm"],
    ["bpm", "bpm"],
  ])],
  ["respiratory-rate", new Map([
    ["/min", "breaths/min"],
    ["breaths per minute", "breaths/min"],
    ["breaths/min", "breaths/min"],
    ["breaths/minute", "breaths/min"],
  ])],
  ["spo2", new Map([["%", "percent"], ["percent", "percent"]])],
  ["temperature", new Map([["cel", "Cel"]])],
]);
type QuantityComparator = NonNullable<BloodTestResultRecord["comparator"]>;
type BloodTestResultFlag = NonNullable<BloodTestResultRecord["flag"]>;
type QuantityValue = {
  comparator?: QuantityComparator;
  system?: string;
  unit?: string;
  unitSource?: "code" | "unit";
  value: number;
};
type ResultStatus = "normal" | "abnormal" | "unknown";
type ParsedResultStatus = ResultStatus | "ambiguous";
type ResultInterpretation = {
  flag?: BloodTestResultFlag;
  status: ParsedResultStatus;
};
const IMPORTABLE_OBSERVATION_STATUSES = new Set(["amended", "corrected", "final"]);
const IMPORTABLE_DIAGNOSTIC_REPORT_STATUSES = new Set(["amended", "appended", "corrected", "final"]);
const IMPORTABLE_DOCUMENT_REFERENCE_STATUSES = new Set(["current"]);
const IMPORTABLE_DOCUMENT_REFERENCE_DOC_STATUSES = new Set(["amended", "appended", "corrected", "final"]);
const IMPORTABLE_ALLERGY_CLINICAL_STATUS_CODES = new Set(["active"]);
const IMPORTABLE_ALLERGY_VERIFICATION_STATUS_CODES = new Set(["confirmed"]);
const RETRACTED_ALLERGY_VERIFICATION_STATUS_CODES = new Set(["entered-in-error", "refuted"]);

export async function buildClinicalImportPlan(input: BuildClinicalImportPlanInput): Promise<ClinicalImportPlan> {
  const manifestPath = clinicalFhirManifestPathSchema.parse(input.manifestPath);
  const manifest = clinicalRawManifestSchema.parse(
    JSON.parse(await readVaultRelativeText(input.vaultRoot, manifestPath, {
      maxBytes: CLINICAL_RAW_MANIFEST_MAX_BYTES,
    })),
  );
  const manifestPathParts = manifestPath.split("/");
  if (manifestPathParts[3] !== manifest.connectionId || manifestPathParts[4] !== manifest.retrievalJobId) {
    throw new Error("Clinical FHIR raw manifest path does not match manifest identity.");
  }
  await assertRawResourceFileByteBounds({
    manifest,
    manifestPath,
    vaultRoot: input.vaultRoot,
  });
  const decisions: ClinicalImportDecision[] = [];
  const resourcePages: FhirResourcePage[] = [];
  let hasAllergyConflictEvidence = false;

  for (const resourceFile of manifest.resourceFiles) {
    const page = await readClinicalResourcePage({
      manifest,
      manifestPath,
      resourceFile,
      vaultRoot: input.vaultRoot,
    });
    resourcePages.push(page);
    if (page.resources.some(isAllergyConflictEvidence)) {
      hasAllergyConflictEvidence = true;
    }
  }
  assertResolvedFhirPagination(resourcePages);
  const allergyEvidence: AllergyEvidenceSummary = {
    complete: hasCompleteAllergyEvidence(manifest),
    hasConflict: hasAllergyConflictEvidence,
  };

  for (const page of resourcePages) {
    for (const resource of page.resources) {
      const context: FhirResourceContext = {
        manifest,
        rawRef: page.rawRef,
        resource,
      };
      if (decisions.length >= CLINICAL_IMPORT_PLAN_MAX_DECISIONS) {
        throw new Error(`Clinical FHIR import plan decision count exceeds ${CLINICAL_IMPORT_PLAN_MAX_DECISIONS}.`);
      }
      decisions.push(mapFhirResource(context, allergyEvidence));
    }
  }

  return clinicalImportPlanSchema.parse({
    schemaVersion: "murph.clinical-import-plan.v1",
    source: {
      kind: "fhir",
      rawManifestPath: manifestPath,
      sourceSystem: manifest.sourceSystem,
      connectionId: manifest.connectionId,
      retrievalJobId: manifest.retrievalJobId,
    },
    decisions,
  });
}

function hasCompleteAllergyEvidence(manifest: ClinicalRawManifest): boolean {
  const completedResourceTypes = new Set<string>(manifest.completedResourceTypes);
  return [...ALLERGY_CONFLICT_RESOURCE_TYPES].every((resourceType) =>
    completedResourceTypes.has(resourceType)
    && hasGrantedFhirReadScope(manifest, resourceType)
    && manifest.errors?.some((error) =>
      error.resourceType === undefined || error.resourceType === resourceType
    ) !== true
  );
}

function hasGrantedFhirReadScope(manifest: ClinicalRawManifest, resourceType: string): boolean {
  for (const scopeGroup of manifest.grantedScopes) {
    for (const scope of scopeGroup.split(/\s+/u)) {
      const match = /^(?:patient|system|user)\/([^\s.]+)\.([a-z]+)$/u.exec(scope);
      const scopedResourceType = match?.[1];
      const permissions = match?.[2];
      if (
        (scopedResourceType === "*" || scopedResourceType === resourceType)
        && (
          permissions === "read"
          || (/^c?r?u?d?s?$/u.test(permissions ?? "") && permissions?.includes("r") === true)
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

async function assertRawResourceFileByteBounds(input: {
  manifest: ClinicalRawManifest;
  manifestPath: string;
  vaultRoot: string;
}): Promise<void> {
  let totalBytes = 0;

  for (const resourceFile of input.manifest.resourceFiles) {
    const rawRef = rawRefForClinicalManifestFile({
      manifestPath: input.manifestPath,
      resourceFile,
    });
    const byteSize = await readVaultRelativeFileSize(input.vaultRoot, rawRef);
    if (byteSize > CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES) {
      throw new Error(`Clinical FHIR raw resource file exceeds ${CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES} bytes for ${rawRef}.`);
    }

    totalBytes += byteSize;
    if (totalBytes > CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES) {
      throw new Error(`Clinical FHIR raw resource files exceed ${CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES} total bytes.`);
    }
  }
}

async function readClinicalResourcePage(input: {
  manifest: ClinicalRawManifest;
  manifestPath: string;
  resourceFile: ClinicalRawManifestResourceFile;
  vaultRoot: string;
}): Promise<FhirResourcePage> {
  const rawRef = rawRefForClinicalManifestFile({
    manifestPath: input.manifestPath,
    resourceFile: input.resourceFile,
  });
  const pageText = await readVaultRelativeText(input.vaultRoot, rawRef, {
    maxBytes: CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
  });
  assertRawResourceFileHash({ rawRef, resourceFile: input.resourceFile, text: pageText });
  const page = JSON.parse(pageText);
  const resources = extractFhirResources(page, {
    maxResources: input.resourceFile.count,
    rawRef,
  });
  assertRawResourceFileCount({ actualCount: resources.length, rawRef, resourceFile: input.resourceFile });
  assertDeclaredResourceFamily({ rawRef, resourceFile: input.resourceFile, resources });
  assertManifestPatientBinding({ manifest: input.manifest, rawRef, resources });
  const nextPageUrlHash = readFhirNextPageUrlHash({
    fhirBaseUrlHash: input.manifest.fhirBaseUrlHash,
    page,
    rawRef,
  });
  return {
    ...(nextPageUrlHash ? { nextPageUrlHash } : {}),
    rawRef,
    resourceFile: input.resourceFile,
    resources,
  };
}

function assertDeclaredResourceFamily(input: {
  rawRef: string;
  resourceFile: ClinicalRawManifestResourceFile;
  resources: readonly Resource[];
}): void {
  if (input.resources.some((resource) => resource.resourceType !== input.resourceFile.resourceType)) {
    throw new Error(`Clinical FHIR raw resource does not match declared resource type for ${input.rawRef}.`);
  }
}

function assertManifestPatientBinding(input: {
  manifest: ClinicalRawManifest;
  rawRef: string;
  resources: readonly Resource[];
}): void {
  for (const resource of input.resources) {
    const patientReferences = patientReferencesForResource(resource);
    if (patientReferences.length === 0) {
      throw new Error(`Clinical FHIR raw resource is missing its manifest patient reference for ${input.rawRef}.`);
    }

    for (const patientReference of patientReferences) {
      const patientId = resource.resourceType === "Patient"
        ? patientReference
        : normalizeClinicalFhirPatientReference({
            fhirBaseUrlHash: input.manifest.fhirBaseUrlHash,
            reference: patientReference,
          });
      if (!patientId) {
        throw new Error(`Clinical FHIR raw resource has an invalid manifest patient reference for ${input.rawRef}.`);
      }
      const patientIdHash = hashClinicalFhirPatientId(patientId);
      if (patientIdHash !== input.manifest.patientIdHash) {
        throw new Error(`Clinical FHIR raw resource does not match manifest patient for ${input.rawRef}.`);
      }
    }
  }
}

function patientReferencesForResource(resource: Resource): string[] {
  if (resource.resourceType === "Patient") {
    const patientId = readResourceId(resource);
    return patientId ? [patientId] : [];
  }

  const patientField = resource.resourceType === "AllergyIntolerance" || resource.resourceType === "Immunization"
    ? "patient"
    : "subject";
  if (!isRecord(resource)) {
    return [];
  }
  const record: Record<string, unknown> = resource;
  const expectedReference = readReferenceValue(record[patientField]);
  if (!expectedReference) {
    return [];
  }

  const alternateField = patientField === "patient" ? "subject" : "patient";
  const alternateValue = record[alternateField];
  if (alternateValue === undefined) {
    return [expectedReference];
  }
  const alternateReference = readReferenceValue(alternateValue);
  return alternateReference ? [expectedReference, alternateReference] : [];
}

function readReferenceValue(value: unknown): string | undefined {
  return isRecord(value) ? readString(value.reference) : undefined;
}

function readFhirNextPageUrlHash(input: {
  fhirBaseUrlHash: string;
  page: unknown;
  rawRef: string;
}): string | undefined {
  if (!isFhirBundle(input.page) || input.page.link === undefined) {
    return undefined;
  }
  if (!Array.isArray(input.page.link)) {
    throw new Error(`Clinical FHIR raw Bundle pagination links are invalid for ${input.rawRef}.`);
  }

  const nextUrls = new Set<string>();
  for (const link of input.page.link) {
    if (readString(link?.relation)?.toLowerCase() !== "next") {
      continue;
    }
    const nextUrl = readString(link.url);
    if (!nextUrl) {
      throw new Error(`Clinical FHIR raw Bundle next link is invalid for ${input.rawRef}.`);
    }
    if (!isClinicalFhirUrlWithinBase({
      fhirBaseUrlHash: input.fhirBaseUrlHash,
      url: nextUrl,
    })) {
      throw new Error(`Clinical FHIR raw Bundle next link is outside the manifest FHIR base for ${input.rawRef}.`);
    }
    nextUrls.add(nextUrl);
  }
  if (nextUrls.size > 1) {
    throw new Error(`Clinical FHIR raw Bundle has ambiguous next links for ${input.rawRef}.`);
  }

  const nextUrl = nextUrls.values().next().value;
  return nextUrl === undefined ? undefined : hashClinicalFhirPageUrl(nextUrl);
}

function assertResolvedFhirPagination(resourcePages: readonly FhirResourcePage[]): void {
  const pagesByResourceTypeAndUrl = new Map<string, Map<string, FhirResourcePage>>();
  for (const page of resourcePages) {
    const pageUrlHash = page.resourceFile.pageUrlHash;
    if (!pageUrlHash) {
      continue;
    }
    const pagesByUrl = pagesByResourceTypeAndUrl.get(page.resourceFile.resourceType) ?? new Map();
    if (pagesByUrl.has(pageUrlHash)) {
      throw new Error(`Clinical FHIR raw manifest has duplicate page URL hashes for ${page.resourceFile.resourceType}.`);
    }
    pagesByUrl.set(pageUrlHash, page);
    pagesByResourceTypeAndUrl.set(page.resourceFile.resourceType, pagesByUrl);
  }

  const nextPageByRawRef = new Map<string, FhirResourcePage>();
  const targetedRawRefs = new Set<string>();
  for (const page of resourcePages) {
    if (!page.nextPageUrlHash) {
      continue;
    }
    const nextPage = pagesByResourceTypeAndUrl
      .get(page.resourceFile.resourceType)
      ?.get(page.nextPageUrlHash);
    if (!nextPage) {
      throw new Error(`Clinical FHIR raw manifest has unresolved pagination for ${page.rawRef}.`);
    }
    nextPageByRawRef.set(page.rawRef, nextPage);
    targetedRawRefs.add(nextPage.rawRef);
  }

  for (const page of resourcePages) {
    if (page.resourceFile.pageUrlHash && !targetedRawRefs.has(page.rawRef)) {
      throw new Error(`Clinical FHIR raw manifest has unreachable pagination for ${page.rawRef}.`);
    }
  }

  for (const page of resourcePages) {
    const seenRawRefs = new Set<string>();
    let currentPage: FhirResourcePage | undefined = page;
    while (currentPage) {
      if (seenRawRefs.has(currentPage.rawRef)) {
        throw new Error(`Clinical FHIR raw manifest has cyclic pagination for ${currentPage.rawRef}.`);
      }
      seenRawRefs.add(currentPage.rawRef);
      currentPage = nextPageByRawRef.get(currentPage.rawRef);
    }
  }
}

async function readVaultRelativeText(
  vaultRoot: string,
  relativePath: string,
  options?: { maxBytes?: number },
): Promise<string> {
  const { absolutePath } = await resolveVaultPathOnDisk(vaultRoot, relativePath);
  if (options?.maxBytes !== undefined) {
    const byteSize = (await stat(absolutePath)).size;
    if (byteSize > options.maxBytes) {
      throw new Error(`Clinical FHIR raw file exceeds ${options.maxBytes} bytes for ${relativePath}.`);
    }
  }

  return readFile(absolutePath, "utf8");
}

async function readVaultRelativeFileSize(vaultRoot: string, relativePath: string): Promise<number> {
  const { absolutePath } = await resolveVaultPathOnDisk(vaultRoot, relativePath);
  const fileStat = await stat(absolutePath);
  return fileStat.size;
}

function assertRawResourceFileHash(input: {
  rawRef: string;
  resourceFile: ClinicalRawManifestResourceFile;
  text: string;
}): void {
  const actualSha256 = sha256Hex(input.text);
  if (actualSha256 !== input.resourceFile.sha256) {
    throw new Error(`Clinical FHIR raw resource file hash mismatch for ${input.rawRef}.`);
  }
}

function assertRawResourceFileCount(input: {
  actualCount: number;
  rawRef: string;
  resourceFile: ClinicalRawManifestResourceFile;
}): void {
  if (input.actualCount !== input.resourceFile.count) {
    throw new Error(`Clinical FHIR raw resource count mismatch for ${input.rawRef}.`);
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function mapFhirResource(
  context: FhirResourceContext,
  allergyEvidence: AllergyEvidenceSummary,
): MappedFhirResource {
  if (hasUnsupportedFhirModifier(context.resource)) {
    return reviewOnly(context, "FHIR modifier semantics are not importable");
  }
  if (
    (isObservation(context.resource)
      || isDiagnosticReport(context.resource)
      || isDocumentReference(context.resource)
      || isAllergyIntolerance(context.resource))
    && !readResourceUpdatedAt(context.resource)
  ) {
    return reviewOnly(context, "FHIR resource lastUpdated is missing");
  }
  const retractionReason = authoritativeRetractionReason(context.resource);
  if (retractionReason) {
    const resourceId = readResourceId(context.resource);
    return resourceId
      ? retractionDecision(context, resourceId, retractionReason)
      : reviewOnly(context, "FHIR resource id is missing");
  }
  if (isObservation(context.resource)) {
    return mapObservation(resourceContext(context, context.resource));
  }
  if (isDiagnosticReport(context.resource)) {
    return mapDiagnosticReport(resourceContext(context, context.resource));
  }
  if (isDocumentReference(context.resource)) {
    return mapDocumentReference(resourceContext(context, context.resource));
  }
  if (isAllergyIntolerance(context.resource)) {
    return mapAllergyIntolerance(resourceContext(context, context.resource), allergyEvidence);
  }

  switch (readString(context.resource.resourceType)) {
    case "Condition":
      return reviewOnly(context, "condition registry import not implemented");
    case "MedicationRequest":
    case "MedicationStatement":
      return reviewOnly(context, "medication history import not implemented");
    case "Encounter":
      return reviewOnly(context, "externalRef-idempotent encounter import not implemented");
    case "Procedure":
      return reviewOnly(context, "procedure import not implemented");
    case "Immunization":
      return reviewOnly(context, "externalRef-idempotent immunization import not implemented");
    default:
      return reviewOnly(context, "FHIR resource type is raw evidence only in v1");
  }
}

function resourceContext<TResource extends Resource>(
  context: FhirResourceContext,
  resource: TResource,
): FhirResourceContext<TResource> {
  return {
    manifest: context.manifest,
    rawRef: context.rawRef,
    resource,
  };
}

function reviewOnly(context: FhirResourceContext, reason: string): MappedFhirResource {
  return clinicalImportReviewDecisionSchema.parse({
    action: "review",
    resourceType: context.resource.resourceType,
    resourceId: readResourceId(context.resource),
    reason,
    evidence: [evidenceForResource(context, readResourceId(context.resource))],
  });
}

function upsertOrReview(
  context: FhirResourceContext,
  payload: Record<string, unknown>,
  reviewReason: string,
): MappedFhirResource {
  const parsedDecision = clinicalImportUpsertDecisionSchema.safeParse({ action: "upsert", payload });
  if (!parsedDecision.success) {
    return reviewOnly(context, reviewReason);
  }

  return parsedDecision.data;
}

function retractionDecision(
  context: FhirResourceContext,
  resourceId: string,
  reason: string,
): MappedFhirResource {
  return clinicalImportRetractDecisionSchema.parse({
    action: "retract",
    externalRef: externalRefForResource(context, context.resource.resourceType, resourceId),
    reason,
    evidence: [evidenceForResource(context, resourceId)],
  });
}

function authoritativeRetractionReason(resource: Resource): string | null {
  if (isObservation(resource) || isDiagnosticReport(resource)) {
    const status = readString(resource.status)?.toLowerCase();
    if (status === "cancelled" || status === "entered-in-error") {
      return `FHIR ${resource.resourceType} status ${status}`;
    }
  }
  if (isDocumentReference(resource)) {
    const status = readString(resource.status)?.toLowerCase();
    const docStatus = readString(resource.docStatus)?.toLowerCase();
    if (status === "entered-in-error" || status === "superseded") {
      return `FHIR DocumentReference status ${status}`;
    }
    if (docStatus === "entered-in-error") {
      return "FHIR DocumentReference docStatus entered-in-error";
    }
  }
  if (
    isAllergyIntolerance(resource)
    && isNoKnownAllergy(resource)
    && codeableConceptHasOnlyImportableCodings(
      resource.verificationStatus,
      FHIR_SYSTEM_ALLERGY_VERIFICATION_STATUS,
      RETRACTED_ALLERGY_VERIFICATION_STATUS_CODES,
    )
  ) {
    return "FHIR no-known-allergy assertion was refuted or entered in error";
  }

  return null;
}

function mapObservation(context: FhirResourceContext<Observation>): MappedFhirResource {
  const resourceId = readResourceId(context.resource);
  if (!resourceId) {
    return reviewOnly(context, "FHIR resource id is missing");
  }

  if (!hasImportableStatus(context.resource.status, IMPORTABLE_OBSERVATION_STATUSES)) {
    return reviewOnly(context, "observation status is not importable");
  }

  const occurredAt = readClinicalOccurredAt(context.resource);
  if (isLaboratoryObservation(context.resource)) {
    return mapLaboratoryObservation(context, resourceId);
  }

  const components = readFhirArray(context.resource.component);
  const emittedVitalFacets = new Set<string>();
  const vitalMeasurements: VitalMeasurementInput[] = [];
  let hasUnmatchedVitalComponent = false;

  for (const component of components) {
    const vitalDecision = vitalDecisionForCodeableConcept(component.code);
    if (vitalDecision.status === "ambiguous") {
      return reviewOnly(context, "vital code is ambiguous");
    }
    const vital = vitalDecision.status === "matched" ? vitalDecision.vital : null;
    if (!vital && codeableConceptHasCodeWithUnexpectedSystem(component.code, FHIR_SYSTEM_LOINC, VITAL_LOINC_CODES)) {
      return reviewOnly(context, "vital coding system is not importable");
    }
    if (!vital) {
      hasUnmatchedVitalComponent = true;
      continue;
    }

    const value = readQuantityValue(component.valueQuantity);
    if (!value) {
      return reviewOnly(context, "vital quantity is not importable");
    }

    if (!occurredAt) {
      return reviewOnly(context, "clinical timestamp is missing");
    }
    if (value.comparator) {
      return reviewOnly(context, "vital quantity comparator is not importable");
    }
    const unit = normalizeVitalUnit(value, vital);
    if (!unit) {
      return reviewOnly(context, "vital quantity unit is not importable");
    }
    if (emittedVitalFacets.has(vital.facet)) {
      return reviewOnly(context, "duplicate vital facet in FHIR observation");
    }
    emittedVitalFacets.add(vital.facet);

    vitalMeasurements.push({
      metric: vital.metric,
      unit,
      value: value.value,
    });
  }

  if (vitalMeasurements.length > 0) {
    if (hasUnmatchedVitalComponent) {
      return reviewOnly(context, "vital component code is not importable");
    }
    if (!occurredAt) {
      return reviewOnly(context, "clinical timestamp is missing");
    }
    return upsertOrReview(
      context,
      buildVitalsPayload(context, {
        occurredAt,
        resourceId,
        title: textForCodeableConcept(context.resource.code) ?? "FHIR vitals",
        measurements: vitalMeasurements,
      }),
      "clinical upsert exceeds supported import bounds",
    );
  }

  const vitalDecision = vitalDecisionForCodeableConcept(context.resource.code);
  if (vitalDecision.status === "ambiguous") {
    return reviewOnly(context, "vital code is ambiguous");
  }
  const vital = vitalDecision.status === "matched" ? vitalDecision.vital : null;
  if (!vital && codeableConceptHasCodeWithUnexpectedSystem(context.resource.code, FHIR_SYSTEM_LOINC, VITAL_LOINC_CODES)) {
    return reviewOnly(context, "vital coding system is not importable");
  }
  if (vital && components.length > 0) {
    return reviewOnly(context, "vital component code is not importable");
  }

  const quantity = readQuantityValue(context.resource.valueQuantity);
  if (vital && !quantity) {
    return reviewOnly(context, "vital quantity is not importable");
  }
  if (vital && quantity) {
    if (!occurredAt) {
      return reviewOnly(context, "clinical timestamp is missing");
    }
    if (quantity.comparator) {
      return reviewOnly(context, "vital quantity comparator is not importable");
    }
    const unit = normalizeVitalUnit(quantity, vital);
    if (!unit) {
      return reviewOnly(context, "vital quantity unit is not importable");
    }

    return upsertOrReview(
      context,
      buildVitalsPayload(context, {
        occurredAt,
        resourceId,
        title: vital.title,
        measurements: [{
          metric: vital.metric,
          unit,
          value: quantity.value,
        }],
      }),
      "clinical upsert exceeds supported import bounds",
    );
  }

  return reviewOnly(context, "observation code is not importable");
}

function mapLaboratoryObservation(
  context: FhirResourceContext<Observation>,
  resourceId: string,
): MappedFhirResource {
  const occurredAt = readClinicalOccurredAt(context.resource);
  const components = readFhirArray(context.resource.component);
  const results: BloodTestResultRecord[] = [];
  for (const component of components) {
    const componentInterpretation = resultInterpretationFromInterpretation(component.interpretation);
    if (componentInterpretation.status === "ambiguous") {
      return reviewOnly(context, "clinical result interpretation is ambiguous");
    }

    const componentResult = buildBloodTestResult(component, componentInterpretation.flag);
    if (!componentResult) {
      return reviewOnly(context, "laboratory observation component result is not importable");
    }
    results.push(componentResult);
  }
  const topLevelInterpretation = resultInterpretationFromInterpretation(context.resource.interpretation);
  if (topLevelInterpretation.status === "ambiguous") {
    return reviewOnly(context, "clinical result interpretation is ambiguous");
  }

  const singleResult = buildBloodTestResult(context.resource, topLevelInterpretation.flag);
  if (singleResult) {
    results.unshift(singleResult);
  }

  if (results.length === 0) {
    return reviewOnly(context, "laboratory observation result is not importable");
  }
  if (results.length > LAB_RESULT_MAX_COUNT) {
    return reviewOnly(context, "laboratory observation result count exceeds supported import bounds");
  }

  if (!occurredAt) {
    return reviewOnly(context, "clinical timestamp is missing");
  }

  const testName = textForCodeableConcept(context.resource.code) ?? "FHIR laboratory observation";
  const emittedResultStatus = resultStatusFromBloodTestResults(results);
  if (
    topLevelInterpretation.status !== "unknown"
    && emittedResultStatus !== "unknown"
    && topLevelInterpretation.status !== emittedResultStatus
  ) {
    return reviewOnly(context, "clinical result interpretation is ambiguous");
  }
  let resultStatus = emittedResultStatus;
  if (topLevelInterpretation.status === "abnormal" && emittedResultStatus === "unknown") {
    resultStatus = "abnormal";
  }

  return upsertOrReview(
    context,
    {
      kind: "test",
      occurredAt,
      source: "import",
      title: testName,
      testName,
      resultStatus,
      testCategory: "laboratory",
      collectedAt: occurredAt,
      reportedAt: readIsoDateTime(context.resource.issued),
      results,
      evidence: [evidenceForResource(context, resourceId)],
      externalRef: externalRefForResource(context, "Observation", resourceId),
    },
    "clinical upsert exceeds supported import bounds",
  );
}

function mapDiagnosticReport(context: FhirResourceContext<DiagnosticReport>): MappedFhirResource {
  const resourceId = readResourceId(context.resource);
  if (!resourceId) {
    return reviewOnly(context, "FHIR resource id is missing");
  }

  if (!hasImportableStatus(context.resource.status, IMPORTABLE_DIAGNOSTIC_REPORT_STATUSES)) {
    return reviewOnly(context, "diagnostic report status is not importable");
  }

  const occurredAt = readClinicalOccurredAt(context.resource);
  const testName = textForCodeableConcept(context.resource.code) ?? "FHIR diagnostic report";
  const conclusion = readString(context.resource.conclusion);
  const narrativeText = textFromNarrative(context.resource.text);

  if (conclusion || narrativeText) {
    if (!occurredAt) {
      return reviewOnly(context, "clinical timestamp is missing");
    }
    const summary = conclusion ?? narrativeText ?? "";
    if (summary.length > DIAGNOSTIC_SUMMARY_MAX_LENGTH) {
      return reviewOnly(context, "diagnostic report summary exceeds supported import bounds");
    }
    const resultInterpretation = resultInterpretationFromInterpretation(context.resource.conclusionCode);
    if (resultInterpretation.status === "ambiguous") {
      return reviewOnly(context, "clinical result interpretation is ambiguous");
    }
    const resultStatus = resultInterpretation.status;

    return upsertOrReview(
      context,
      {
        kind: "test",
        occurredAt,
        source: "import",
        title: testName,
        testName,
        resultStatus,
        summary,
        testCategory: "diagnostic-report",
        reportedAt: readIsoDateTime(context.resource.issued),
        evidence: [evidenceForResource(context, resourceId)],
        externalRef: externalRefForResource(context, "DiagnosticReport", resourceId),
      },
      "clinical upsert exceeds supported import bounds",
    );
  }

  return reviewOnly(context, "diagnostic report summary is not available in raw FHIR page");
}

function mapDocumentReference(context: FhirResourceContext<DocumentReference>): MappedFhirResource {
  const resourceId = readResourceId(context.resource);
  if (!resourceId) {
    return reviewOnly(context, "FHIR resource id is missing");
  }

  if (!hasImportableStatus(context.resource.status, IMPORTABLE_DOCUMENT_REFERENCE_STATUSES)) {
    return reviewOnly(context, "document reference status is not importable");
  }

  if (!hasImportableOptionalStatus(context.resource.docStatus, IMPORTABLE_DOCUMENT_REFERENCE_DOC_STATUSES)) {
    return reviewOnly(context, "document reference docStatus is not importable");
  }

  const noteDecision = decideDocumentReferenceText(context.resource);
  if (noteDecision.status === "ambiguous") {
    return reviewOnly(context, "document reference has multiple inline text attachments");
  }
  if (noteDecision.status === "unavailable") {
    return reviewOnly(context, "document reference text is not available in raw FHIR page");
  }
  const note = noteDecision.text;
  if (note.length > CLINICAL_NOTE_MAX_LENGTH) {
    return reviewOnly(context, "document reference text exceeds supported import bounds");
  }

  const occurredAt = readClinicalOccurredAt(context.resource);
  if (!occurredAt) {
    return reviewOnly(context, "clinical timestamp is missing");
  }

  const title = readString(context.resource.description)
    ?? textForCodeableConcept(context.resource.type)
    ?? "FHIR document reference";

  return upsertOrReview(
    context,
    {
      kind: "note",
      occurredAt,
      source: "import",
      title,
      note,
      noteType: "fhir_document_reference",
      authoredAt: readIsoDateTime(context.resource.date),
      evidence: [evidenceForResource(context, resourceId)],
      externalRef: externalRefForResource(context, "DocumentReference", resourceId),
    },
    "clinical upsert exceeds supported import bounds",
  );
}

function mapAllergyIntolerance(
  context: FhirResourceContext<AllergyIntolerance>,
  allergyEvidence: AllergyEvidenceSummary,
): MappedFhirResource {
  const resourceId = readResourceId(context.resource);
  if (!resourceId) {
    return reviewOnly(context, "FHIR resource id is missing");
  }

  if (codeableConceptHasCodeWithUnexpectedSystem(context.resource.code, FHIR_SYSTEM_SNOMED_CT, NO_KNOWN_ALLERGY_CODES)) {
    return reviewOnly(context, "no-known allergy code system is not importable");
  }

  if (hasTrustedNoKnownAllergyCode(context.resource) && !isNoKnownAllergy(context.resource)) {
    return reviewOnly(context, "no-known allergy code is ambiguous");
  }

  if (!isNoKnownAllergy(context.resource)) {
    return reviewOnly(context, "allergy registry import not implemented");
  }

  if (!hasImportableAllergyStatus(context.resource)) {
    return reviewOnly(context, "allergy status is not importable");
  }

  if (!isImportableGlobalNoKnownAllergyAssertion(context.resource) || allergyEvidence.hasConflict) {
    return reviewOnly(context, "no-known allergy conflicts with allergy evidence");
  }
  if (!allergyEvidence.complete) {
    return reviewOnly(context, "no-known allergy conflicts with incomplete allergy evidence");
  }

  const recordedDate = readString(context.resource.recordedDate);
  const occurredAt = readIsoDateTime(recordedDate);
  if (!recordedDate || !occurredAt) {
    return reviewOnly(context, "clinical timestamp is missing");
  }

  return upsertOrReview(
    context,
    {
      kind: "clinical_assertion",
      occurredAt,
      source: "import",
      title: "No known allergies",
      assertion: "no_known_allergies",
      domain: "allergy",
      polarity: "absent",
      subject: "allergies",
      assertedOn: recordedDate.slice(0, 10),
      sourceLabel: "FHIR AllergyIntolerance",
      evidence: [evidenceForResource(context, resourceId)],
      externalRef: externalRefForResource(context, "AllergyIntolerance", resourceId),
    },
    "clinical upsert exceeds supported import bounds",
  );
}

function buildVitalsPayload(
  context: FhirResourceContext<Observation>,
  input: {
    measurements: VitalMeasurementInput[];
    occurredAt: string;
    resourceId: string;
    title: string;
  },
): Record<string, unknown> {
  return {
    kind: "measurement",
    occurredAt: input.occurredAt,
    source: "import",
    title: input.title,
    measurements: input.measurements,
    evidence: [evidenceForResource(context, input.resourceId)],
    externalRef: externalRefForResource(context, "Observation", input.resourceId),
  };
}

function normalizeVitalUnit(
  quantity: QuantityValue,
  vital: VitalDefinition,
): string | null {
  if (quantity.system !== undefined && quantity.system !== FHIR_SYSTEM_UCUM) {
    return null;
  }
  if (quantity.unitSource === "code" && quantity.system !== FHIR_SYSTEM_UCUM) {
    return null;
  }

  const trimmedUnit = quantity.unit?.trim();
  if (!trimmedUnit) {
    return null;
  }

  const alias = FHIR_VITAL_UNIT_ALIASES_BY_FACET.get(vital.facet)?.get(trimmedUnit.toLowerCase());
  const unit = alias ?? trimmedUnit;
  return unit === vital.unit || alias !== undefined ? unit : null;
}

function buildBloodTestResult(
  resource: Observation | ObservationComponent,
  flag?: BloodTestResultFlag,
): BloodTestResultRecord | null {
  const analyte = textForCodeableConcept(resource.code);
  if (!analyte || analyte.length > LAB_RESULT_TEXT_MAX_LENGTH) {
    return null;
  }

  const quantity = readQuantityValue(resource.valueQuantity);
  const slugFields = clinicalSlugFields(analyte);
  if (quantity) {
    return {
      analyte,
      ...slugFields,
      comparator: quantity.comparator,
      ...(flag ? { flag } : {}),
      unit: quantity.unit,
      value: quantity.value,
    };
  }

  const textValue = readObservationTextValue(resource);
  if (textValue) {
    if (textValue.length > LAB_RESULT_TEXT_MAX_LENGTH) {
      return null;
    }

    return {
      analyte,
      ...slugFields,
      ...(flag ? { flag } : {}),
      textValue,
    };
  }

  return null;
}

function clinicalSlugFields(value: string): Pick<BloodTestResultRecord, "biomarkerSlug" | "slug"> {
  const slug = clinicalFacetSlug(value);
  if (!slug) {
    return {};
  }

  return { biomarkerSlug: slug, slug };
}

function externalRefForResource(
  context: FhirResourceContext,
  resourceType: string,
  resourceId: string,
) {
  const version = readResourceUpdatedAt(context.resource);
  if (!version) {
    throw new Error("Clinical FHIR source revision is missing after admission.");
  }
  return externalRefForFhir({
    fhirBaseUrlHash: context.manifest.fhirBaseUrlHash,
    patientIdHash: context.manifest.patientIdHash,
    sourceSystem: context.manifest.sourceSystem,
    resourceType,
    resourceId,
    version,
  });
}

function evidenceForResource(context: FhirResourceContext, resourceId?: string) {
  const resourceType = readString(context.resource.resourceType) ?? "FHIR";
  return {
    rawRef: context.rawRef,
    sourceLabel: resourceId ? `${resourceType}/${resourceId}` : resourceType,
  };
}

function extractFhirResources(
  value: unknown,
  input: { maxResources: number; rawRef: string },
): Resource[] {
  const resources: Resource[] = [];
  const appendResource = (resource: unknown): void => {
    if (!isFhirResource(resource)) {
      throw new Error(`Clinical FHIR raw page contains an invalid resource for ${input.rawRef}.`);
    }
    resources.push(resource);
    if (resources.length > input.maxResources) {
      throw new Error(`Clinical FHIR raw resource count exceeds declared count for ${input.rawRef}.`);
    }
  };

  if (Array.isArray(value)) {
    for (const resource of value) {
      appendResource(resource);
    }
    return resources;
  }
  if (isFhirResource(value) && !isFhirBundle(value)) {
    appendResource(value);
    return resources;
  }
  if (!isFhirBundle(value)) {
    throw new Error(`Clinical FHIR raw page has an invalid shape for ${input.rawRef}.`);
  }
  if (hasUnsupportedFhirBundleEnvelopeModifier(value)) {
    throw new Error(`Clinical FHIR raw Bundle has unsupported modifier semantics for ${input.rawRef}.`);
  }

  if (value.entry === undefined) {
    return resources;
  }
  if (!Array.isArray(value.entry)) {
    throw new Error(`Clinical FHIR raw Bundle entries are invalid for ${input.rawRef}.`);
  }
  for (const entry of value.entry) {
    appendResource(isRecord(entry) ? entry.resource : undefined);
  }

  return resources;
}

function vitalDecisionForCodeableConcept(value: CodeableConcept | undefined): VitalConceptDecision {
  const vitalDefinitionsByFacet = new Map<string, VitalDefinition>();
  for (const coding of codingsForCodeableConcept(value)) {
    const code = coding.code?.toLowerCase();
    const vital = coding.system === FHIR_SYSTEM_LOINC && code ? VITAL_LOINC_BY_CODE.get(code) : undefined;
    if (vital) {
      vitalDefinitionsByFacet.set(vital.facet, vital);
    }
  }

  if (vitalDefinitionsByFacet.size === 0) {
    return { status: "unmatched" };
  }
  if (vitalDefinitionsByFacet.size > 1) {
    return { status: "ambiguous" };
  }

  const vital = vitalDefinitionsByFacet.values().next().value;
  return vital === undefined ? { status: "unmatched" } : { status: "matched", vital };
}

function isLaboratoryObservation(resource: Observation): boolean {
  return readFhirArray(resource.category).some((category) =>
    codeableConceptHasSystemCode(category, FHIR_SYSTEM_OBSERVATION_CATEGORY, LABORATORY_CATEGORY_CODES)
  );
}

function isNoKnownAllergy(resource: AllergyIntolerance): boolean {
  return hasTrustedNoKnownAllergyCode(resource) && isUnambiguousNoKnownAllergy(resource);
}

function isImportableGlobalNoKnownAllergyAssertion(resource: AllergyIntolerance): boolean {
  return (
    isNoKnownAllergy(resource)
    && hasImportableAllergyStatus(resource)
    && !hasScopedOrContradictoryAllergyDetail(resource)
  );
}

function hasTrustedNoKnownAllergyCode(resource: AllergyIntolerance): boolean {
  return codeableConceptHasSystemCode(resource.code, FHIR_SYSTEM_SNOMED_CT, NO_KNOWN_ALLERGY_CODES);
}

function isUnambiguousNoKnownAllergy(resource: AllergyIntolerance): boolean {
  for (const coding of codingsForCodeableConcept(resource.code)) {
    const code = coding.code?.toLowerCase();
    if (coding.system !== FHIR_SYSTEM_SNOMED_CT || code === undefined || !NO_KNOWN_ALLERGY_CODES.has(code)) {
      return false;
    }
    if (!isNoKnownAllergyConceptText(coding.display)) {
      return false;
    }
  }

  return isNoKnownAllergyConceptText(resource.code?.text);
}

function isAllergyConflictEvidence(resource: Resource): boolean {
  if (!ALLERGY_CONFLICT_RESOURCE_TYPES.has(resource.resourceType)) {
    return false;
  }
  if (hasUnsupportedFhirModifier(resource)) {
    return true;
  }
  if (isAllergyIntolerance(resource)) {
    return !isImportableGlobalNoKnownAllergyAssertion(resource);
  }
  return resource.resourceType === "Condition";
}

function hasUnsupportedFhirModifier(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      for (const nested of current) {
        pending.push(nested);
      }
      continue;
    }
    if (!isRecord(current)) {
      continue;
    }
    if (hasUnsupportedFhirModifierFields(current)) {
      return true;
    }
    for (const nested of Object.values(current)) {
      pending.push(nested);
    }
  }

  return false;
}

function hasUnsupportedFhirBundleEnvelopeModifier(bundle: Bundle): boolean {
  const pending: unknown[] = [bundle];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      for (const nested of current) {
        pending.push(nested);
      }
      continue;
    }
    if (!isRecord(current)) {
      continue;
    }
    if (hasUnsupportedFhirModifierFields(current)) {
      return true;
    }
    for (const [key, nested] of Object.entries(current)) {
      if (key !== "resource") {
        pending.push(nested);
      }
    }
  }

  return false;
}

function hasUnsupportedFhirModifierFields(value: Record<string, unknown>): boolean {
  if (Object.hasOwn(value, "implicitRules")) {
    return true;
  }
  if (!Object.hasOwn(value, "modifierExtension")) {
    return false;
  }

  return !Array.isArray(value.modifierExtension) || value.modifierExtension.length > 0;
}

function isNoKnownAllergyConceptText(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }

  return NO_KNOWN_ALLERGY_TEXTS.has(value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
}

function hasImportableAllergyStatus(resource: AllergyIntolerance): boolean {
  return (
    codeableConceptHasOnlyImportableCodings(
      resource.clinicalStatus,
      FHIR_SYSTEM_ALLERGY_CLINICAL_STATUS,
      IMPORTABLE_ALLERGY_CLINICAL_STATUS_CODES,
    )
    && codeableConceptHasOnlyImportableCodings(
      resource.verificationStatus,
      FHIR_SYSTEM_ALLERGY_VERIFICATION_STATUS,
      IMPORTABLE_ALLERGY_VERIFICATION_STATUS_CODES,
    )
  );
}

function hasScopedOrContradictoryAllergyDetail(resource: AllergyIntolerance): boolean {
  return readFhirArray(resource.category).length > 0 || readFhirArray(resource.reaction).length > 0;
}

function hasImportableStatus(value: unknown, importableStatuses: ReadonlySet<string>): boolean {
  const status = readString(value)?.toLowerCase();
  return status !== undefined && importableStatuses.has(status);
}

function hasImportableOptionalStatus(value: unknown, importableStatuses: ReadonlySet<string>): boolean {
  const status = readString(value)?.toLowerCase();
  return status === undefined || importableStatuses.has(status);
}

function codeableConceptHasSystemCode(
  value: CodeableConcept | undefined,
  system: string,
  codes: ReadonlySet<string>,
): boolean {
  return codingsForCodeableConcept(value).some((coding) => {
    const code = coding.code?.toLowerCase();
    return coding.system === system && code !== undefined && codes.has(code);
  });
}

function codeableConceptHasOnlyImportableCodings(
  value: CodeableConcept | undefined,
  system: string,
  codes: ReadonlySet<string>,
): boolean {
  const codings = codingsForCodeableConcept(value);
  return codings.length > 0 && codings.every((coding) => {
    const code = coding.code?.toLowerCase();
    return coding.system === system && code !== undefined && codes.has(code);
  });
}

function codeableConceptHasCodeWithUnexpectedSystem(
  value: CodeableConcept | undefined,
  expectedSystem: string,
  codes: ReadonlySet<string>,
): boolean {
  if (codeableConceptHasSystemCode(value, expectedSystem, codes)) {
    return false;
  }

  return codingsForCodeableConcept(value).some((coding) => {
    const code = coding.code?.toLowerCase();
    return code !== undefined && codes.has(code) && coding.system !== expectedSystem;
  });
}

function resultInterpretationFromInterpretation(value: CodeableConcept[] | undefined): ResultInterpretation {
  let hasAbnormal = false;
  let hasNormal = false;
  let flag: BloodTestResultFlag | undefined;

  for (const interpretation of readFhirArray(value)) {
    for (const coding of codingsForCodeableConcept(interpretation)) {
      if (coding.system !== FHIR_SYSTEM_OBSERVATION_INTERPRETATION) {
        continue;
      }
      const code = coding.code?.toLowerCase();
      if (code && RESULT_STATUS_ABNORMAL_CODES.has(code)) {
        hasAbnormal = true;
        flag = combineResultFlags(flag, flagForInterpretationCode(code));
      }
      if (code && RESULT_STATUS_NORMAL_CODES.has(code)) {
        hasNormal = true;
      }
    }
  }

  if (hasAbnormal && hasNormal) {
    return { status: "ambiguous" };
  }
  if (hasAbnormal) {
    return { flag: flag ?? "abnormal", status: "abnormal" };
  }
  if (hasNormal) {
    return { flag: "normal", status: "normal" };
  }

  return { status: "unknown" };
}

function flagForInterpretationCode(code: string): BloodTestResultFlag {
  switch (code) {
    case "aa":
    case "hh":
    case "ll":
      return "critical";
    case "h":
      return "high";
    case "l":
      return "low";
    default:
      return "abnormal";
  }
}

function combineResultFlags(
  current: BloodTestResultFlag | undefined,
  next: BloodTestResultFlag,
): BloodTestResultFlag {
  if (current === "critical" || next === "critical") {
    return "critical";
  }
  if (current === "high" && next === "low") {
    return "abnormal";
  }
  if (current === "low" && next === "high") {
    return "abnormal";
  }

  return current ?? next;
}

function resultStatusFromBloodTestResults(results: readonly BloodTestResultRecord[]): ResultStatus {
  let allResultsAreKnownNormal = results.length > 0;
  for (const result of results) {
    const flag = result.flag;
    if (flag === "normal") {
      continue;
    }
    allResultsAreKnownNormal = false;
    if (flag !== undefined && flag !== "unknown") {
      return "abnormal";
    }
  }

  return allResultsAreKnownNormal ? "normal" : "unknown";
}

function readClinicalOccurredAt(
  resource: AllergyIntolerance | DiagnosticReport | DocumentReference | Observation,
): string | undefined {
  if ("effectiveDateTime" in resource || "effectivePeriod" in resource) {
    return readEffectiveOccurredAt(resource);
  }
  if (resource.resourceType === "Observation") {
    return undefined;
  }

  return readIsoDateTime("issued" in resource ? resource.issued : undefined)
    ?? readIsoDateTime("date" in resource ? resource.date : undefined)
    ?? readIsoDateTime("recordedDate" in resource ? resource.recordedDate : undefined);
}

function readEffectiveOccurredAt(resource: DiagnosticReport | Observation): string | undefined {
  const effectiveDateTime = readString(resource.effectiveDateTime);
  if (effectiveDateTime) {
    return readIsoDateTime(effectiveDateTime);
  }
  if (resource.effectivePeriod !== undefined) {
    return readIsoDateTime(readPeriodStart(resource.effectivePeriod));
  }

  return undefined;
}

function readPeriodStart(period: Period | undefined): string | undefined {
  return readString(period?.start);
}

function readIsoDateTime(value: unknown): string | undefined {
  const text = readString(value);
  if (!text) {
    return undefined;
  }
  if (isWritableIsoDateTime(text)) {
    return new Date(text).toISOString();
  }

  return undefined;
}

function readResourceId(resource: Resource): string | undefined {
  return readString(resource.id);
}

function readResourceUpdatedAt(resource: Resource): string | undefined {
  const text = readString(resource.meta?.lastUpdated);
  return text && isWritableIsoDateTime(text) ? text : undefined;
}

function readQuantityValue(
  quantity: Quantity | undefined,
): QuantityValue | null {
  if (!quantity) {
    return null;
  }
  const numericValue = readNumber(quantity.value);
  if (numericValue === undefined) {
    return null;
  }
  const rawComparator = readString(quantity.comparator);
  const comparator = readQuantityComparator(rawComparator);
  if (rawComparator && !comparator) {
    return null;
  }

  const system = readString(quantity.system);
  const code = system === FHIR_SYSTEM_UCUM ? readString(quantity.code) : undefined;
  const unit = readString(quantity.unit);

  return {
    comparator,
    system,
    unit: code ?? unit,
    unitSource: code ? "code" : unit ? "unit" : undefined,
    value: numericValue,
  };
}

function readQuantityComparator(comparator: string | undefined): QuantityComparator | undefined {
  switch (comparator) {
    case "<":
    case "<=":
    case ">":
    case ">=":
      return comparator;
    default:
      return undefined;
  }
}

function readObservationTextValue(resource: Observation | ObservationComponent): string | null {
  return (
    readString(resource.valueString)
    ?? readString(resource.valueInteger)
    ?? readString(resource.valueBoolean)
    ?? textForCodeableConcept(resource.valueCodeableConcept)
    ?? null
  );
}

function textForCodeableConcept(value: CodeableConcept | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return (
    readString(value.text)
    ?? codingsForCodeableConcept(value)
      .map((coding) => coding.display)
      .find((display): display is string => typeof display === "string" && display.length > 0)
  );
}

function codingsForCodeableConcept(value: CodeableConcept | undefined): Array<Pick<Coding, "code" | "display" | "system">> {
  if (!value) {
    return [];
  }

  return readUnknownArray(value.coding)
    .filter(isRecord)
    .map((coding) => ({
      code: readString(coding.code),
      display: readString(coding.display),
      system: readString(coding.system),
    }));
}

function decideDocumentReferenceText(resource: DocumentReference): DocumentReferenceTextDecision {
  const textData: Array<string | undefined> = [];
  for (const content of readUnknownArray(resource.content)) {
    const attachment = isRecord(content) && isRecord(content.attachment) ? content.attachment : null;
    const contentType = readString(attachment?.contentType)?.toLowerCase() ?? "";
    if (contentType.startsWith("text/")) {
      textData.push(readString(attachment?.data));
    }
  }

  if (textData.length > 1) {
    return { status: "ambiguous" };
  }

  const data = textData[0];
  const text = data ? decodeDocumentReferenceTextData(data)?.trim() : null;
  return text ? { status: "available", text } : { status: "unavailable" };
}

function decodeDocumentReferenceTextData(value: string): string | null {
  const normalized = value.replace(/\s+/gu, "");
  if (normalized.length === 0 || !CANONICAL_BASE64_TEXT.test(normalized)) {
    return null;
  }

  const bytes = Buffer.from(normalized, "base64");
  if (bytes.toString("base64") !== normalized) {
    return null;
  }

  try {
    return DOCUMENT_REFERENCE_TEXT_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

function textFromNarrative(value: Narrative | undefined): string | null {
  const div = readString(value?.div);
  if (!div) {
    return null;
  }

  const text = div
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  return text.length > 0 ? text : null;
}

function isObservation(resource: Resource): resource is Observation {
  return resource.resourceType === "Observation";
}

function isDiagnosticReport(resource: Resource): resource is DiagnosticReport {
  return resource.resourceType === "DiagnosticReport";
}

function isDocumentReference(resource: Resource): resource is DocumentReference {
  return resource.resourceType === "DocumentReference";
}

function isAllergyIntolerance(resource: Resource): resource is AllergyIntolerance {
  return resource.resourceType === "AllergyIntolerance";
}

function isFhirBundle(value: unknown): value is Bundle {
  return isFhirResource(value) && value.resourceType === "Bundle";
}

function isFhirResource(value: unknown): value is Resource {
  return isRecord(value) && typeof value.resourceType === "string" && value.resourceType.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readFhirArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
