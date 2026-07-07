import { readFile } from "node:fs/promises";
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
} from "@murphai/clinical-records";
import { isStrictIsoDate, isStrictIsoDateTime, type BloodTestResultRecord } from "@murphai/contracts";

export interface BuildClinicalImportPlanInput {
  vaultRoot: string;
  manifestPath: string;
}

type FhirResourceContext<TResource extends Resource = Resource> = {
  fallbackOccurredAt: string;
  manifest: ClinicalRawManifest;
  rawRef: string;
  resource: TResource;
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
const LABORATORY_CATEGORY_CODES = new Set(["laboratory", "lab"]);
const RESULT_STATUS_NORMAL_CODES = new Set(["n", "normal"]);
const RESULT_STATUS_ABNORMAL_CODES = new Set(["a", "aa", "h", "hh", "l", "ll", "abnormal", "high", "low"]);

export async function buildClinicalImportPlan(input: BuildClinicalImportPlanInput): Promise<ClinicalImportPlan> {
  const manifestPath = clinicalRawPathSchema.parse(input.manifestPath);
  const manifest = clinicalRawManifestSchema.parse(
    JSON.parse(await readVaultRelativeText(input.vaultRoot, manifestPath)),
  );
  const candidates: ClinicalImportCandidate[] = [];
  const unsupported: ClinicalImportUnsupportedResource[] = [];

  for (const resourceFile of manifest.resourceFiles) {
    const rawRef = rawRefForClinicalManifestFile({
      manifestPath,
      resourceFile,
    });
    const page = JSON.parse(await readVaultRelativeText(input.vaultRoot, rawRef));
    const resources = extractFhirResources(page);

    for (const resource of resources) {
      const context: FhirResourceContext = {
        fallbackOccurredAt: manifest.fetchedAt,
        manifest,
        rawRef,
        resource,
      };
      const mapped = mapFhirResource(context);
      candidates.push(...mapped.candidates);
      unsupported.push(...mapped.unsupported);
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

async function readVaultRelativeText(vaultRoot: string, relativePath: string): Promise<string> {
  if (path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
    throw new Error("Clinical FHIR imports read only vault-relative raw paths.");
  }

  return readFile(path.join(vaultRoot, relativePath), "utf8");
}

function mapFhirResource(context: FhirResourceContext): {
  candidates: ClinicalImportCandidate[];
  unsupported: ClinicalImportUnsupportedResource[];
} {
  if (isObservation(context.resource)) {
    return {
      candidates: mapObservation(resourceContext(context, context.resource)),
      unsupported: [],
    };
  }
  if (isDiagnosticReport(context.resource)) {
    return {
      candidates: mapDiagnosticReport(resourceContext(context, context.resource)),
      unsupported: [],
    };
  }
  if (isDocumentReference(context.resource)) {
    return {
      candidates: mapDocumentReference(resourceContext(context, context.resource)),
      unsupported: [],
    };
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
    fallbackOccurredAt: context.fallbackOccurredAt,
    manifest: context.manifest,
    rawRef: context.rawRef,
    resource,
  };
}

function mapObservation(context: FhirResourceContext<Observation>): ClinicalImportCandidate[] {
  const resourceId = readResourceId(context.resource);
  if (!resourceId) {
    return [];
  }

  const occurredAt = readClinicalOccurredAt(context.resource, context.fallbackOccurredAt);
  const candidates: ClinicalImportCandidate[] = [];
  const components = readFhirArray(context.resource.component);

  for (const component of components) {
    const vital = vitalForCodeableConcept(component.code);
    const value = readQuantityValue(component.valueQuantity);
    if (!vital || !value) {
      continue;
    }

    candidates.push(buildVitalsCandidate(context, {
      occurredAt,
      resourceId,
      title: vital.title,
      facet: vital.facet,
      metric: vital.metric,
      unit: value.unit ?? vital.unit,
      value: value.value,
    }));
  }

  if (candidates.length > 0) {
    return candidates;
  }

  const vital = vitalForCodeableConcept(context.resource.code);
  const quantity = readQuantityValue(context.resource.valueQuantity);
  if (vital && quantity) {
    return [
      buildVitalsCandidate(context, {
        occurredAt,
        resourceId,
        title: vital.title,
        facet: vital.facet,
        metric: vital.metric,
        unit: quantity.unit ?? vital.unit,
        value: quantity.value,
      }),
    ];
  }

  if (!isLaboratoryObservation(context.resource)) {
    return [];
  }

  const results = components
    .map((component) => buildBloodTestResult(component))
    .filter((result): result is BloodTestResultRecord => result !== null);
  const singleResult = buildBloodTestResult(context.resource);
  if (singleResult) {
    results.unshift(singleResult);
  }

  if (results.length === 0) {
    return [];
  }

  const testName = textForCodeableConcept(context.resource.code) ?? "FHIR laboratory observation";
  return [
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
        externalRef: externalRefForFhir({
          sourceSystem: context.manifest.sourceSystem,
          resourceType: "Observation",
          resourceId,
          version: readResourceVersion(context.resource),
          facet: "lab-observation",
        }),
      },
    },
  ];
}

function mapDiagnosticReport(context: FhirResourceContext<DiagnosticReport>): ClinicalImportCandidate[] {
  const resourceId = readResourceId(context.resource);
  if (!resourceId) {
    return [];
  }

  const occurredAt = readClinicalOccurredAt(context.resource, context.fallbackOccurredAt);
  const testName = textForCodeableConcept(context.resource.code) ?? "FHIR diagnostic report";
  const conclusion = readString(context.resource.conclusion);
  const narrativeText = textFromNarrative(context.resource.text);

  if (conclusion || narrativeText) {
    return [
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
          externalRef: externalRefForFhir({
            sourceSystem: context.manifest.sourceSystem,
            resourceType: "DiagnosticReport",
            resourceId,
            version: readResourceVersion(context.resource),
            facet: "diagnostic-report-summary",
          }),
        },
      },
    ];
  }

  return [];
}

function mapDocumentReference(context: FhirResourceContext<DocumentReference>): ClinicalImportCandidate[] {
  const resourceId = readResourceId(context.resource);
  if (!resourceId) {
    return [];
  }

  const note = readDocumentReferenceText(context.resource);
  if (!note) {
    return [];
  }

  const occurredAt = readClinicalOccurredAt(context.resource, context.fallbackOccurredAt);
  const title = readString(context.resource.description)
    ?? textForCodeableConcept(context.resource.type)
    ?? "FHIR document reference";

  return [
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
        externalRef: externalRefForFhir({
          sourceSystem: context.manifest.sourceSystem,
          resourceType: "DocumentReference",
          resourceId,
          version: readResourceVersion(context.resource),
          facet: "document-note",
        }),
      },
    },
  ];
}

function mapAllergyIntolerance(context: FhirResourceContext<AllergyIntolerance>): {
  candidates: ClinicalImportCandidate[];
  unsupported: ClinicalImportUnsupportedResource[];
} {
  const resourceId = readResourceId(context.resource);
  if (!resourceId) {
    return { candidates: [], unsupported: [] };
  }

  if (!isNoKnownAllergy(context.resource)) {
    return { candidates: [], unsupported: [unsupportedResource(context, "allergy registry import not implemented")] };
  }

  const occurredAt = readClinicalOccurredAt(context.resource, context.fallbackOccurredAt);
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
          externalRef: externalRefForFhir({
            sourceSystem: context.manifest.sourceSystem,
            resourceType: "AllergyIntolerance",
            resourceId,
            version: readResourceVersion(context.resource),
            facet: "no-known-allergies",
          }),
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
      externalRef: externalRefForFhir({
        sourceSystem: context.manifest.sourceSystem,
        resourceType: "Observation",
        resourceId: input.resourceId,
        version: readResourceVersion(context.resource),
        facet: input.facet,
      }),
    },
  };
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

function extractFhirResources(value: unknown): Resource[] {
  if (Array.isArray(value)) {
    return value.filter(isFhirResource);
  }
  if (isFhirResource(value) && !isFhirBundle(value)) {
    return [value];
  }
  if (!isFhirBundle(value)) {
    return [];
  }

  return readUnknownArray(value.entry)
    .map((entry) => isRecord(entry) ? entry.resource : null)
    .filter(isFhirResource);
}

function vitalForCodeableConcept(value: CodeableConcept | undefined): VitalDefinition | null {
  for (const coding of codingsForCodeableConcept(value)) {
    if (coding.system && !coding.system.toLowerCase().includes("loinc")) {
      continue;
    }
    if (coding.code && VITAL_LOINC_BY_CODE.has(coding.code)) {
      return VITAL_LOINC_BY_CODE.get(coding.code) ?? null;
    }
  }

  return null;
}

function isLaboratoryObservation(resource: Observation): boolean {
  for (const category of readFhirArray(resource.category)) {
    for (const coding of codingsForCodeableConcept(category)) {
      if (coding.code && LABORATORY_CATEGORY_CODES.has(coding.code.toLowerCase())) {
        return true;
      }
    }
  }

  return codingsForCodeableConcept(resource.code).some((coding) =>
    typeof coding.system === "string" && coding.system.toLowerCase().includes("loinc")
  );
}

function isNoKnownAllergy(resource: AllergyIntolerance): boolean {
  const text = textForCodeableConcept(resource.code)?.toLowerCase() ?? "";

  if (text.includes("no known allerg")) {
    return true;
  }

  return codingsForCodeableConcept(resource.code).some((coding) =>
    typeof coding.code === "string" && NO_KNOWN_ALLERGY_CODES.has(coding.code)
  );
}

function resultStatusFromInterpretation(value: CodeableConcept[] | undefined): "normal" | "abnormal" | "unknown" {
  for (const interpretation of readFhirArray(value)) {
    for (const coding of codingsForCodeableConcept(interpretation)) {
      const code = coding.code?.toLowerCase();
      const display = coding.display?.toLowerCase();
      if ((code && RESULT_STATUS_ABNORMAL_CODES.has(code)) || (display && RESULT_STATUS_ABNORMAL_CODES.has(display))) {
        return "abnormal";
      }
      if ((code && RESULT_STATUS_NORMAL_CODES.has(code)) || (display && RESULT_STATUS_NORMAL_CODES.has(display))) {
        return "normal";
      }
    }
  }

  return "unknown";
}

function readClinicalOccurredAt(
  resource: AllergyIntolerance | DiagnosticReport | DocumentReference | Observation,
  fallback: string,
): string {
  return (
    readIsoDateTime("effectiveDateTime" in resource ? resource.effectiveDateTime : undefined)
    ?? readIsoDateTime(readPeriodStart("effectivePeriod" in resource ? resource.effectivePeriod : undefined))
    ?? readIsoDateTime("issued" in resource ? resource.issued : undefined)
    ?? readIsoDateTime("date" in resource ? resource.date : undefined)
    ?? readIsoDateTime("recordedDate" in resource ? resource.recordedDate : undefined)
    ?? readIsoDateTime(resource.meta?.lastUpdated)
    ?? fallback
  );
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
  if (isStrictIsoDate(text)) {
    return `${text}T00:00:00.000Z`;
  }

  return undefined;
}

function readResourceId(resource: Resource): string | undefined {
  return readString(resource.id);
}

function readResourceVersion(resource: Resource): string | undefined {
  return readString(resource.meta?.versionId);
}

function readQuantityValue(quantity: Quantity | undefined): { unit?: string; value: number } | null {
  if (!quantity) {
    return null;
  }
  const numericValue = readNumber(quantity.value);
  if (numericValue === undefined) {
    return null;
  }

  return {
    unit: readString(quantity.unit) ?? readString(quantity.code),
    value: numericValue,
  };
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
  const narrative = textFromNarrative(resource.text);
  if (narrative) {
    return narrative;
  }

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

  return readString(resource.description) ?? null;
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
