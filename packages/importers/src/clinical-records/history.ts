import type { Resource } from "@medplum/fhirtypes";
import { isWritableIsoDateTime } from "@murphai/contracts";

// These are provider statements, not member-confirmed diagnoses or medication
// intake. Keep their original statuses and coding alongside readable labels.
const HISTORY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  AllergyIntolerance: ["code", "clinicalStatus", "verificationStatus", "type", "category", "criticality", "onsetDateTime", "onsetAge", "onsetPeriod", "onsetString", "recordedDate", "lastOccurrence", "reaction", "note"],
  Condition: ["code", "clinicalStatus", "verificationStatus", "category", "severity", "bodySite", "onsetDateTime", "onsetAge", "onsetPeriod", "onsetString", "abatementDateTime", "abatementAge", "abatementPeriod", "abatementString", "recordedDate", "stage", "evidence", "note"],
  MedicationRequest: ["medicationCodeableConcept", "medicationReference", "status", "statusReason", "intent", "category", "reportedBoolean", "reportedReference", "authoredOn", "reasonCode", "reasonReference", "dosageInstruction", "dispenseRequest", "substitution", "priorPrescription", "note"],
  MedicationStatement: ["medicationCodeableConcept", "medicationReference", "status", "statusReason", "category", "effectiveDateTime", "effectivePeriod", "dateAsserted", "informationSource", "reasonCode", "reasonReference", "dosage", "note"],
  MedicationDispense: ["medicationCodeableConcept", "medicationReference", "status", "statusReasonCodeableConcept", "type", "quantity", "daysSupply", "whenPrepared", "whenHandedOver", "dosageInstruction", "authorizingPrescription", "substitution", "note"],
  Encounter: ["status", "class", "type", "serviceType", "priority", "period", "length", "reasonCode", "reasonReference", "diagnosis", "hospitalization", "serviceProvider", "location"],
  Procedure: ["code", "status", "statusReason", "category", "performedDateTime", "performedPeriod", "performedAge", "performedString", "reasonCode", "bodySite", "outcome", "complication", "followUp", "report", "usedCode", "usedReference", "note"],
  Immunization: ["vaccineCode", "status", "statusReason", "occurrenceDateTime", "occurrenceString", "recorded", "primarySource", "reportOrigin", "manufacturer", "lotNumber", "expirationDate", "site", "route", "doseQuantity", "protocolApplied", "reaction", "note"],
  FamilyMemberHistory: ["status", "dataAbsentReason", "date", "relationship", "sex", "bornDate", "ageAge", "ageRange", "ageString", "deceasedBoolean", "deceasedAge", "deceasedDate", "condition", "note"],
  CarePlan: ["title", "description", "status", "intent", "category", "period", "addresses", "goal", "activity", "note"],
  CareTeam: ["name", "status", "category", "period", "reasonCode", "participant", "managingOrganization", "note"],
  Goal: ["description", "lifecycleStatus", "achievementStatus", "category", "priority", "startDate", "startCodeableConcept", "target", "statusDate", "statusReason", "addresses", "outcomeCode", "outcomeReference", "note"],
  Device: ["status", "statusReason", "type", "deviceName", "udiCarrier", "manufacturer", "modelNumber", "serialNumber", "lotNumber", "expirationDate", "property", "note"],
  ServiceRequest: ["code", "status", "intent", "category", "priority", "doNotPerform", "orderDetail", "quantityQuantity", "occurrenceDateTime", "occurrencePeriod", "occurrenceTiming", "authoredOn", "reasonCode", "reasonReference", "bodySite", "patientInstruction", "note"],
};

export const FHIR_HISTORY_RESOURCE_TYPES = new Set(Object.keys(HISTORY_FIELDS));

const CLINICAL_DATE_FIELDS = [
  "recordedDate", "authoredOn", "dateAsserted", "whenHandedOver", "whenPrepared",
  "occurrenceDateTime", "performedDateTime", "effectiveDateTime", "date", "startDate", "recorded",
] as const;

export interface FhirSourceNote {
  note: string;
  sections?: Array<{ heading: string; kind: "other"; text: string }>;
}

/** Preserve the full text within the existing note/section contract. */
export function buildFhirSourceNote(text: string): FhirSourceNote | null {
  if (text.length <= 4_000) return { note: text };
  const sections: NonNullable<FhirSourceNote["sections"]> = [];
  // Preserve surrogate pairs when a section is split.
  let remaining = text;
  while (remaining.length > 0 && sections.length < 50) {
    let end = Math.min(12_000, remaining.length);
    if (end < remaining.length && /[\uD800-\uDBFF]/u.test(remaining[end - 1] ?? "")) end -= 1;
    sections.push({ heading: `Provider record — part ${sections.length + 1}`, kind: "other", text: remaining.slice(0, end) });
    remaining = remaining.slice(end);
  }
  if (remaining.length > 0) return null;
  return { note: "The complete provider record is retained in the ordered sections below.", sections };
}

export function buildFhirHistoryNote(resource: Resource): ({
  title: string;
  occurredAt: string;
  noteType: string;
} & FhirSourceNote) | null {
  const fields = HISTORY_FIELDS[resource.resourceType];
  if (!fields) return null;
  const selected = Object.fromEntries(Object.entries(resource).filter(([key]) => fields.includes(key)));
  if (Object.keys(selected).length === 0) return null;
  const clinicalDate = readClinicalDate(selected);
  const occurredAt = clinicalDate ?? readExactDate(resource.meta?.lastUpdated);
  if (!occurredAt) return null;
  const note = buildFhirSourceNote([
    `Provider ${resource.resourceType} record. Statuses and statements below are as recorded by the source.`,
    ...(resource.resourceType.startsWith("Medication") ? ["A medication order, statement or dispense does not establish that a dose was taken."] : []),
    clinicalDate ? `Clinical record date: ${clinicalDate}` : `Record updated: ${occurredAt}. Clinical event date is not available.`,
    JSON.stringify(selected, (_key, value: unknown) => {
      // JSON object order is not clinical content; array order remains meaningful.
      if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, Reflect.get(value, key)]));
    }, 2),
  ].join("\n\n"));
  if (!note) return null;
  const label = ["code", "medicationCodeableConcept", "medicationReference", "vaccineCode", "description", "title", "type"]
    .map((key) => readLabel(selected[key])).find((value) => value !== undefined);
  const title = label ? `Hospital ${resource.resourceType}: ${label}` : `Hospital ${resource.resourceType} record`;
  return { ...note, title: title.slice(0, 160), occurredAt, noteType: `fhir_${resource.resourceType.toLowerCase()}` };
}

function readClinicalDate(fields: Record<string, unknown>): string | undefined {
  for (const key of CLINICAL_DATE_FIELDS) {
    const date = readExactDate(fields[key]);
    if (date) return date;
  }
  for (const key of ["period", "effectivePeriod", "performedPeriod", "occurrencePeriod"]) {
    const value = fields[key];
    if (value && typeof value === "object" && "start" in value) {
      const date = readExactDate(value.start);
      if (date) return date;
    }
  }
  return undefined;
}

function readExactDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (isWritableIsoDateTime(value)) return new Date(value).toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) return value;
  }
  return undefined;
}

function readLabel(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return undefined;
  for (const key of ["text", "display"] as const) {
    if (key in value) {
      const text = Reflect.get(value, key);
      if (typeof text === "string" && text.trim()) return text.trim();
    }
  }
  if ("coding" in value && Array.isArray(value.coding)) {
    return value.coding.map(readLabel).find((label) => label !== undefined);
  }
  return undefined;
}
