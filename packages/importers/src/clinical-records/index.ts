import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

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
  CLINICAL_IMPORT_PLAN_MAX_CANDIDATES,
  CLINICAL_IMPORT_PLAN_MAX_UNSUPPORTED,
  CLINICAL_RAW_MANIFEST_MAX_BYTES,
  CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES,
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
  clinicalFacetSlug,
  clinicalImportPlanSchema,
  clinicalRawManifestSchema,
  clinicalRawPathSchema,
  externalRefForFhir,
  rawRefForClinicalManifestFile,
  type ClinicalImportCandidate,
  type ClinicalImportPlan,
  type ClinicalImportUnsupportedResource,
  type ClinicalRawManifest,
  type ClinicalRawManifestResourceFile,
} from "@murphai/clinical-records";
import { isStrictIsoDateTime, type BloodTestResultRecord } from "@murphai/contracts";

export interface BuildClinicalImportPlanInput {
  vaultRoot: string;
  manifestPath: string;
}

type FhirResourceContext<TResource extends Resource = Resource> = {
  hasAllergyConflictEvidence: boolean;
  manifest: ClinicalRawManifest;
  rawRef: string;
  resource: TResource;
};

type FhirResourcePage = {
  rawRef: string;
  resources: Resource[];
};

type MappedFhirResource = {
  candidates: ClinicalImportCandidate[];
  unsupported: ClinicalImportUnsupportedResource[];
};

type VitalDefinition = {
  facet: string;
  metric: string;
  title: string;
  unit: string;
};

const VITAL_LOINC_BY_CODE = new Map<string, VitalDefinition>([
  ["8480-6", { facet: "bp-systolic", metric: "systolic-blood-pressure", title: "Systolic blood pressure", unit: "mmHg" }],
  ["8462-4", { facet: "bp-diastolic", metric: "diastolic-blood-pressure", title: "Diastolic blood pressure", unit: "mmHg" }],
  ["8867-4", { facet: "heart-rate", metric: "heart-rate", title: "Heart rate", unit: "bpm" }],
  ["9279-1", { facet: "respiratory-rate", metric: "respiratory-rate", title: "Respiratory rate", unit: "breaths/min" }],
  ["59408-5", { facet: "spo2", metric: "spo2", title: "Oxygen saturation", unit: "percent" }],
  ["8310-5", { facet: "temperature", metric: "temperature", title: "Body temperature", unit: "Cel" }],
  ["29463-7", { facet: "body-weight", metric: "body-weight", title: "Body weight", unit: "kg" }],
]);

const NO_KNOWN_ALLERGY_CODES = new Set(["716186003"]);
const FHIR_SYSTEM_ALLERGY_CLINICAL_STATUS = "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical";
const FHIR_SYSTEM_ALLERGY_VERIFICATION_STATUS = "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification";
const FHIR_SYSTEM_LOINC = "http://loinc.org";
const FHIR_SYSTEM_OBSERVATION_CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category";
const FHIR_SYSTEM_OBSERVATION_INTERPRETATION = "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation";
const FHIR_SYSTEM_SNOMED_CT = "http://snomed.info/sct";
const LABORATORY_CATEGORY_CODES = new Set(["laboratory"]);
const RESULT_STATUS_NORMAL_CODES = new Set(["n"]);
const RESULT_STATUS_ABNORMAL_CODES = new Set(["a", "aa", "h", "hh", "l", "ll"]);
const VITAL_LOINC_CODES = new Set(VITAL_LOINC_BY_CODE.keys());
const FHIR_VITAL_UNIT_ALIASES_BY_FACET = new Map<string, ReadonlyMap<string, string>>([
  ["body-weight", new Map([["[lb_av]", "lb"], ["lb", "lb"]])],
  ["bp-diastolic", new Map([["mm[hg]", "mmHg"], ["mmhg", "mmHg"]])],
  ["bp-systolic", new Map([["mm[hg]", "mmHg"], ["mmhg", "mmHg"]])],
  ["spo2", new Map([["%", "percent"], ["percent", "percent"]])],
  ["temperature", new Map([["cel", "Cel"]])],
]);
type QuantityComparator = NonNullable<BloodTestResultRecord["comparator"]>;
const IMPORTABLE_OBSERVATION_STATUSES = new Set(["amended", "corrected", "final"]);
const IMPORTABLE_DIAGNOSTIC_REPORT_STATUSES = new Set(["amended", "appended", "corrected", "final"]);
const IMPORTABLE_DOCUMENT_REFERENCE_STATUSES = new Set(["current"]);
const IMPORTABLE_DOCUMENT_REFERENCE_DOC_STATUSES = new Set(["amended", "appended", "corrected", "final"]);
const IMPORTABLE_ALLERGY_CLINICAL_STATUS_CODES = new Set(["active"]);
const IMPORTABLE_ALLERGY_VERIFICATION_STATUS_CODES = new Set(["confirmed"]);

export async function buildClinicalImportPlan(input: BuildClinicalImportPlanInput): Promise<ClinicalImportPlan> {
  const manifestPath = clinicalRawPathSchema.parse(input.manifestPath);
  const manifest = clinicalRawManifestSchema.parse(
    JSON.parse(await readVaultRelativeText(input.vaultRoot, manifestPath, {
      maxBytes: CLINICAL_RAW_MANIFEST_MAX_BYTES,
    })),
  );
  await assertRawResourceFileByteBounds({
    manifest,
    manifestPath,
    vaultRoot: input.vaultRoot,
  });
  const candidates: ClinicalImportCandidate[] = [];
  const unsupported: ClinicalImportUnsupportedResource[] = [];

  const hasAllergyConflictEvidence = await scanAllergyConflictEvidence({
    manifest,
    manifestPath,
    vaultRoot: input.vaultRoot,
  });

  for (const resourceFile of manifest.resourceFiles) {
    const { rawRef, resources } = await readClinicalResourcePage({
      manifestPath,
      resourceFile,
      vaultRoot: input.vaultRoot,
    });
    for (const resource of resources) {
      const context: FhirResourceContext = {
        hasAllergyConflictEvidence,
        manifest,
        rawRef,
        resource,
      };
      const mapped = mapFhirResource(context);
      appendMappedResource({ candidates, mapped, unsupported });
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
    candidates,
    unsupported,
  });
}

async function scanAllergyConflictEvidence(input: {
  manifest: ClinicalRawManifest;
  manifestPath: string;
  vaultRoot: string;
}): Promise<boolean> {
  for (const resourceFile of input.manifest.resourceFiles) {
    const { resources } = await readClinicalResourcePage({
      manifestPath: input.manifestPath,
      resourceFile,
      vaultRoot: input.vaultRoot,
    });
    if (resources.some(isAllergyConflictEvidence)) {
      return true;
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
  return { rawRef, resources };
}

async function readVaultRelativeText(
  vaultRoot: string,
  relativePath: string,
  options?: { maxBytes?: number },
): Promise<string> {
  const targetPath = vaultRelativePath(vaultRoot, relativePath);
  if (options?.maxBytes !== undefined) {
    const byteSize = await readVaultRelativeFileSize(vaultRoot, relativePath);
    if (byteSize > options.maxBytes) {
      throw new Error(`Clinical FHIR raw file exceeds ${options.maxBytes} bytes for ${relativePath}.`);
    }
  }

  return readFile(targetPath, "utf8");
}

async function readVaultRelativeFileSize(vaultRoot: string, relativePath: string): Promise<number> {
  const fileStat = await stat(vaultRelativePath(vaultRoot, relativePath));
  return fileStat.size;
}

function vaultRelativePath(vaultRoot: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
    throw new Error("Clinical FHIR imports read only vault-relative raw paths.");
  }

  return path.join(vaultRoot, relativePath);
}

function appendMappedResource(input: {
  candidates: ClinicalImportCandidate[];
  mapped: MappedFhirResource;
  unsupported: ClinicalImportUnsupportedResource[];
}): void {
  if (input.candidates.length + input.mapped.candidates.length > CLINICAL_IMPORT_PLAN_MAX_CANDIDATES) {
    throw new Error(`Clinical FHIR import plan candidate count exceeds ${CLINICAL_IMPORT_PLAN_MAX_CANDIDATES}.`);
  }
  if (input.unsupported.length + input.mapped.unsupported.length > CLINICAL_IMPORT_PLAN_MAX_UNSUPPORTED) {
    throw new Error(`Clinical FHIR import plan unsupported resource count exceeds ${CLINICAL_IMPORT_PLAN_MAX_UNSUPPORTED}.`);
  }

  input.candidates.push(...input.mapped.candidates);
  input.unsupported.push(...input.mapped.unsupported);
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

function mapFhirResource(context: FhirResourceContext): {
  candidates: ClinicalImportCandidate[];
  unsupported: ClinicalImportUnsupportedResource[];
} {
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
    return mapAllergyIntolerance(resourceContext(context, context.resource));
  }

  switch (readString(context.resource.resourceType)) {
    case "Condition":
      return { candidates: [], unsupported: [unsupportedResource(context, "condition registry import not implemented")] };
    case "MedicationRequest":
    case "MedicationStatement":
      return { candidates: [], unsupported: [unsupportedResource(context, "medication history import not implemented")] };
    case "Encounter":
      return { candidates: [], unsupported: [unsupportedResource(context, "externalRef-idempotent encounter import not implemented")] };
    case "Procedure":
      return { candidates: [], unsupported: [unsupportedResource(context, "procedure import not implemented")] };
    case "Immunization":
      return { candidates: [], unsupported: [unsupportedResource(context, "externalRef-idempotent immunization import not implemented")] };
    default:
      return { candidates: [], unsupported: [unsupportedResource(context, "FHIR resource type is raw evidence only in v1")] };
  }
}

function resourceContext<TResource extends Resource>(
  context: FhirResourceContext,
  resource: TResource,
): FhirResourceContext<TResource> {
  return {
    hasAllergyConflictEvidence: context.hasAllergyConflictEvidence,
    manifest: context.manifest,
    rawRef: context.rawRef,
    resource,
  };
}

function unsupportedOnly(context: FhirResourceContext, reason: string): MappedFhirResource {
  return { candidates: [], unsupported: [unsupportedResource(context, reason)] };
}

function mapObservation(context: FhirResourceContext<Observation>): MappedFhirResource {
  const resourceId = readResourceId(context.resource);
  if (!resourceId) {
    return unsupportedOnly(context, "FHIR resource id is missing");
  }

  if (!hasImportableStatus(context.resource.status, IMPORTABLE_OBSERVATION_STATUSES)) {
    return unsupportedOnly(context, "observation status is not importable");
  }

  const occurredAt = readClinicalOccurredAt(context.resource);
  const candidates: ClinicalImportCandidate[] = [];
  const unsupported: ClinicalImportUnsupportedResource[] = [];
  const components = readFhirArray(context.resource.component);
  const emittedVitalFacets = new Set<string>();

  for (const component of components) {
    const vital = vitalForCodeableConcept(component.code);
    if (!vital && codeableConceptHasCodeWithUnexpectedSystem(component.code, FHIR_SYSTEM_LOINC, VITAL_LOINC_CODES)) {
      unsupported.push(unsupportedResource(context, "vital coding system is not importable"));
      continue;
    }

    const value = readQuantityValue(component.valueQuantity);
    if (vital && !value) {
      unsupported.push(unsupportedResource(context, "vital quantity is not importable"));
      continue;
    }
    if (!vital || !value) {
      continue;
    }

    if (!occurredAt) {
      unsupported.push(unsupportedResource(context, "clinical timestamp is missing"));
      continue;
    }
    if (value.comparator) {
      unsupported.push(unsupportedResource(context, "vital quantity comparator is not importable"));
      continue;
    }
    const unit = normalizeVitalUnit(value.unit, vital);
    if (!unit) {
      unsupported.push(unsupportedResource(context, "vital quantity unit is not importable"));
      continue;
    }
    if (emittedVitalFacets.has(vital.facet)) {
      return unsupportedOnly(context, "duplicate vital facet in FHIR observation");
    }
    emittedVitalFacets.add(vital.facet);

    candidates.push(buildVitalsCandidate(context, {
      occurredAt,
      resourceId,
      title: vital.title,
      facet: vital.facet,
      metric: vital.metric,
      unit,
      value: value.value,
    }));
  }

  if (candidates.length > 0 || unsupported.length > 0) {
    return { candidates, unsupported };
  }

  const vital = vitalForCodeableConcept(context.resource.code);
  if (!vital && codeableConceptHasCodeWithUnexpectedSystem(context.resource.code, FHIR_SYSTEM_LOINC, VITAL_LOINC_CODES)) {
    return unsupportedOnly(context, "vital coding system is not importable");
  }

  const quantity = readQuantityValue(context.resource.valueQuantity);
  if (vital && !quantity) {
    return unsupportedOnly(context, "vital quantity is not importable");
  }
  if (vital && quantity) {
    if (!occurredAt) {
      return unsupportedOnly(context, "clinical timestamp is missing");
    }
    if (quantity.comparator) {
      return unsupportedOnly(context, "vital quantity comparator is not importable");
    }
    const unit = normalizeVitalUnit(quantity.unit, vital);
    if (!unit) {
      return unsupportedOnly(context, "vital quantity unit is not importable");
    }

    return {
      candidates: [
        buildVitalsCandidate(context, {
          occurredAt,
          resourceId,
          title: vital.title,
          facet: vital.facet,
          metric: vital.metric,
          unit,
          value: quantity.value,
        }),
      ],
      unsupported: [],
    };
  }

  if (!isLaboratoryObservation(context.resource)) {
    return unsupportedOnly(context, "observation code is not importable");
  }

  const results = components
    .map((component) => buildBloodTestResult(component))
    .filter((result): result is BloodTestResultRecord => result !== null);
  const singleResult = buildBloodTestResult(context.resource);
  if (singleResult) {
    results.unshift(singleResult);
  }

  if (results.length === 0) {
    return unsupportedOnly(context, "laboratory observation result is not importable");
  }

  if (!occurredAt) {
    return unsupportedOnly(context, "clinical timestamp is missing");
  }

  const testName = textForCodeableConcept(context.resource.code) ?? "FHIR laboratory observation";
  return {
    candidates: [
      {
        kind: "diagnostic-test",
        rawRef: context.rawRef,
        resource: sourceRef(context, resourceId, "lab-observation"),
        payload: {
          occurredAt,
          source: "import",
          title: `FHIR lab: ${truncate(testName, 148)}`,
          testName: truncate(testName, 160),
          resultStatus: resultStatusFromInterpretation(context.resource.interpretation),
          testCategory: "laboratory",
          collectedAt: occurredAt,
          reportedAt: readIsoDateTime(context.resource.issued),
          results,
          rawRefs: [context.rawRef],
          evidence: [evidenceForResource(context, resourceId)],
          externalRef: externalRefForResource(context, "Observation", resourceId, "lab-observation"),
        },
      },
    ],
    unsupported: [],
  };
}

function mapDiagnosticReport(context: FhirResourceContext<DiagnosticReport>): MappedFhirResource {
  const resourceId = readResourceId(context.resource);
  if (!resourceId) {
    return unsupportedOnly(context, "FHIR resource id is missing");
  }

  if (!hasImportableStatus(context.resource.status, IMPORTABLE_DIAGNOSTIC_REPORT_STATUSES)) {
    return unsupportedOnly(context, "diagnostic report status is not importable");
  }

  const occurredAt = readClinicalOccurredAt(context.resource);
  const testName = textForCodeableConcept(context.resource.code) ?? "FHIR diagnostic report";
  const conclusion = readString(context.resource.conclusion);
  const narrativeText = textFromNarrative(context.resource.text);

  if (conclusion || narrativeText) {
    if (!occurredAt) {
      return unsupportedOnly(context, "clinical timestamp is missing");
    }

    return {
      candidates: [
        {
          kind: "diagnostic-test",
          rawRef: context.rawRef,
          resource: sourceRef(context, resourceId, "diagnostic-report-summary"),
          payload: {
            occurredAt,
            source: "import",
            title: `FHIR report: ${truncate(testName, 148)}`,
            testName: truncate(testName, 160),
            resultStatus: resultStatusFromInterpretation(context.resource.conclusionCode),
            summary: truncate(conclusion ?? narrativeText ?? "", 1000),
            testCategory: "diagnostic-report",
            reportedAt: readIsoDateTime(context.resource.issued),
            rawRefs: [context.rawRef],
            evidence: [evidenceForResource(context, resourceId)],
            externalRef: externalRefForResource(
              context,
              "DiagnosticReport",
              resourceId,
              "diagnostic-report-summary",
            ),
          },
        },
      ],
      unsupported: [],
    };
  }

  return unsupportedOnly(context, "diagnostic report summary is not available in raw FHIR page");
}

function mapDocumentReference(context: FhirResourceContext<DocumentReference>): MappedFhirResource {
  const resourceId = readResourceId(context.resource);
  if (!resourceId) {
    return unsupportedOnly(context, "FHIR resource id is missing");
  }

  if (!hasImportableStatus(context.resource.status, IMPORTABLE_DOCUMENT_REFERENCE_STATUSES)) {
    return unsupportedOnly(context, "document reference status is not importable");
  }

  if (!hasImportableOptionalStatus(context.resource.docStatus, IMPORTABLE_DOCUMENT_REFERENCE_DOC_STATUSES)) {
    return unsupportedOnly(context, "document reference docStatus is not importable");
  }

  const note = readDocumentReferenceText(context.resource);
  if (!note) {
    return unsupportedOnly(context, "document reference text is not available in raw FHIR page");
  }

  const occurredAt = readClinicalOccurredAt(context.resource);
  if (!occurredAt) {
    return unsupportedOnly(context, "clinical timestamp is missing");
  }

  const title = readString(context.resource.description)
    ?? textForCodeableConcept(context.resource.type)
    ?? "FHIR document reference";

  return {
    candidates: [
      {
        kind: "clinical-note",
        rawRef: context.rawRef,
        resource: sourceRef(context, resourceId, "document-note"),
        payload: {
          occurredAt,
          source: "import",
          title: truncate(title, 160),
          note: truncate(note, 4000),
          noteType: "fhir_document_reference",
          authoredAt: readIsoDateTime(context.resource.date),
          rawRefs: [context.rawRef],
          evidence: [evidenceForResource(context, resourceId)],
          externalRef: externalRefForResource(context, "DocumentReference", resourceId, "document-note"),
        },
      },
    ],
    unsupported: [],
  };
}

function mapAllergyIntolerance(context: FhirResourceContext<AllergyIntolerance>): MappedFhirResource {
  const resourceId = readResourceId(context.resource);
  if (!resourceId) {
    return unsupportedOnly(context, "FHIR resource id is missing");
  }

  if (codeableConceptHasCodeWithUnexpectedSystem(context.resource.code, FHIR_SYSTEM_SNOMED_CT, NO_KNOWN_ALLERGY_CODES)) {
    return unsupportedOnly(context, "no-known allergy code system is not importable");
  }

  if (!isNoKnownAllergy(context.resource)) {
    return { candidates: [], unsupported: [unsupportedResource(context, "allergy registry import not implemented")] };
  }

  if (!hasImportableAllergyStatus(context.resource)) {
    return unsupportedOnly(context, "allergy status is not importable");
  }

  if (context.hasAllergyConflictEvidence) {
    return unsupportedOnly(context, "no-known allergy conflicts with allergy evidence");
  }

  const occurredAt = readClinicalOccurredAt(context.resource);
  if (!occurredAt) {
    return unsupportedOnly(context, "clinical timestamp is missing");
  }

  return {
    candidates: [
      {
        kind: "assertion",
        rawRef: context.rawRef,
        resource: sourceRef(context, resourceId, "no-known-allergies"),
        payload: {
          occurredAt,
          source: "import",
          title: "No known allergies",
          assertion: "no_known_allergies",
          domain: "allergy",
          polarity: "absent",
          subject: "allergies",
          assertedOn: occurredAt.slice(0, 10),
          sourceLabel: "FHIR AllergyIntolerance",
          rawRefs: [context.rawRef],
          evidence: [evidenceForResource(context, resourceId)],
          externalRef: externalRefForResource(
            context,
            "AllergyIntolerance",
            resourceId,
            "no-known-allergies",
          ),
        },
      },
    ],
    unsupported: [],
  };
}

function buildVitalsCandidate(
  context: FhirResourceContext<Observation>,
  input: {
    facet: string;
    metric: string;
    occurredAt: string;
    resourceId: string;
    title: string;
    unit: string;
    value: number;
  },
): ClinicalImportCandidate {
  return {
    kind: "vitals",
    rawRef: context.rawRef,
    resource: sourceRef(context, input.resourceId, input.facet),
    payload: {
      occurredAt: input.occurredAt,
      source: "import",
      title: input.title,
      measurements: [
        {
          metric: input.metric,
          unit: input.unit,
          value: input.value,
        },
      ],
      rawRefs: [context.rawRef],
      evidence: [evidenceForResource(context, input.resourceId)],
      externalRef: externalRefForResource(context, "Observation", input.resourceId, input.facet),
    },
  };
}

function normalizeVitalUnit(rawUnit: string | undefined, vital: VitalDefinition): string | null {
  const trimmedUnit = rawUnit?.trim();
  if (!trimmedUnit) {
    return null;
  }

  const alias = FHIR_VITAL_UNIT_ALIASES_BY_FACET.get(vital.facet)?.get(trimmedUnit.toLowerCase());
  const unit = alias ?? trimmedUnit;
  return unit === vital.unit || alias !== undefined ? unit : null;
}

function buildBloodTestResult(resource: Observation | ObservationComponent): BloodTestResultRecord | null {
  const analyte = textForCodeableConcept(resource.code);
  if (!analyte) {
    return null;
  }

  const quantity = readQuantityValue(resource.valueQuantity);
  if (quantity) {
    return {
      analyte: truncate(analyte, 160),
      biomarkerSlug: clinicalFacetSlug(analyte),
      comparator: quantity.comparator,
      slug: clinicalFacetSlug(analyte),
      unit: quantity.unit,
      value: quantity.value,
    };
  }

  const textValue = readObservationTextValue(resource);
  if (textValue) {
    return {
      analyte: truncate(analyte, 160),
      biomarkerSlug: clinicalFacetSlug(analyte),
      slug: clinicalFacetSlug(analyte),
      textValue: truncate(textValue, 160),
    };
  }

  return null;
}

function sourceRef(context: FhirResourceContext, resourceId: string, facet: string) {
  return {
    sourceSystem: context.manifest.sourceSystem,
    resourceType: readString(context.resource.resourceType) ?? "FHIR",
    resourceId,
    version: readResourceVersion(context.resource),
    facet: clinicalFacetSlug(facet),
    rawRef: context.rawRef,
  };
}

function externalRefForResource(
  context: FhirResourceContext,
  resourceType: string,
  resourceId: string,
  facet: string,
) {
  return externalRefForFhir({
    fhirBaseUrlHash: context.manifest.fhirBaseUrlHash,
    patientIdHash: context.manifest.patientIdHash,
    sourceSystem: context.manifest.sourceSystem,
    resourceType,
    resourceId,
    version: readResourceVersion(context.resource),
    facet,
  });
}

function evidenceForResource(context: FhirResourceContext, resourceId: string) {
  return {
    rawRef: context.rawRef,
    sourceLabel: `${readString(context.resource.resourceType) ?? "FHIR"}/${resourceId}`,
  };
}

function unsupportedResource(
  context: FhirResourceContext,
  reason: string,
): ClinicalImportUnsupportedResource {
  return {
    resourceType: readString(context.resource.resourceType) ?? "Unknown",
    resourceId: readResourceId(context.resource),
    reason,
    rawRef: context.rawRef,
  };
}

function extractFhirResources(
  value: unknown,
  input: { maxResources: number; rawRef: string },
): Resource[] {
  const resources: Resource[] = [];
  const appendResource = (resource: unknown): void => {
    if (!isFhirResource(resource)) {
      return;
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
    return resources;
  }

  for (const entry of readUnknownArray(value.entry)) {
    appendResource(isRecord(entry) ? entry.resource : null);
  }

  return resources;
}

function vitalForCodeableConcept(value: CodeableConcept | undefined): VitalDefinition | null {
  for (const coding of codingsForCodeableConcept(value)) {
    if (coding.system === FHIR_SYSTEM_LOINC && coding.code && VITAL_LOINC_BY_CODE.has(coding.code)) {
      return VITAL_LOINC_BY_CODE.get(coding.code) ?? null;
    }
  }

  return null;
}

function isLaboratoryObservation(resource: Observation): boolean {
  return readFhirArray(resource.category).some((category) =>
    codeableConceptHasSystemCode(category, FHIR_SYSTEM_OBSERVATION_CATEGORY, LABORATORY_CATEGORY_CODES)
  );
}

function isNoKnownAllergy(resource: AllergyIntolerance): boolean {
  return codeableConceptHasSystemCode(resource.code, FHIR_SYSTEM_SNOMED_CT, NO_KNOWN_ALLERGY_CODES);
}

function isAllergyConflictEvidence(resource: Resource): boolean {
  return isAllergyIntolerance(resource) && !isNoKnownAllergy(resource);
}

function hasImportableAllergyStatus(resource: AllergyIntolerance): boolean {
  return (
    codeableConceptHasSystemCode(
      resource.clinicalStatus,
      FHIR_SYSTEM_ALLERGY_CLINICAL_STATUS,
      IMPORTABLE_ALLERGY_CLINICAL_STATUS_CODES,
    )
    && codeableConceptHasSystemCode(
      resource.verificationStatus,
      FHIR_SYSTEM_ALLERGY_VERIFICATION_STATUS,
      IMPORTABLE_ALLERGY_VERIFICATION_STATUS_CODES,
    )
  );
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

function resultStatusFromInterpretation(value: CodeableConcept[] | undefined): "normal" | "abnormal" | "unknown" {
  for (const interpretation of readFhirArray(value)) {
    for (const coding of codingsForCodeableConcept(interpretation)) {
      if (coding.system !== FHIR_SYSTEM_OBSERVATION_INTERPRETATION) {
        continue;
      }
      const code = coding.code?.toLowerCase();
      if (code && RESULT_STATUS_ABNORMAL_CODES.has(code)) {
        return "abnormal";
      }
      if (code && RESULT_STATUS_NORMAL_CODES.has(code)) {
        return "normal";
      }
    }
  }

  return "unknown";
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
  if (isStrictIsoDateTime(text)) {
    return text;
  }

  return undefined;
}

function readResourceId(resource: Resource): string | undefined {
  return readString(resource.id);
}

function readResourceVersion(resource: Resource): string | undefined {
  return readString(resource.meta?.versionId);
}

function readQuantityValue(
  quantity: Quantity | undefined,
): { comparator?: QuantityComparator; unit?: string; value: number } | null {
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

  return {
    comparator,
    unit: readString(quantity.code) ?? readString(quantity.unit),
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

function readDocumentReferenceText(resource: DocumentReference): string | null {
  for (const content of readUnknownArray(resource.content)) {
    const attachment = isRecord(content) && isRecord(content.attachment) ? content.attachment : null;
    const contentType = readString(attachment?.contentType)?.toLowerCase() ?? "";
    const data = readString(attachment?.data);
    if (!data || !contentType.startsWith("text/")) {
      continue;
    }
    try {
      const decoded = Buffer.from(data, "base64").toString("utf8").trim();
      if (decoded.length > 0) {
        return decoded;
      }
    } catch {
      continue;
    }
  }

  return null;
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

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
