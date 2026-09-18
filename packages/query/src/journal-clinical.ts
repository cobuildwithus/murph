import type { CanonicalEntity } from "./canonical-entities.ts";

const SOURCE_SYSTEM = /^(?:epic|cerner|athena|generic-smart)-fhir(?:-|$)/u;
const EXTRACTION_FACET = "document-extraction-";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function clinicalJournalSourceKey(event: CanonicalEntity): string | null {
  const ref = object(event.attributes.externalRef);
  if (typeof ref.system !== "string" || !SOURCE_SYSTEM.test(ref.system)
    || typeof ref.resourceType !== "string" || typeof ref.resourceId !== "string") return null;
  return JSON.stringify([ref.system, ref.resourceType, ref.resourceId, ref.version ?? null]);
}

function isExtraction(event: CanonicalEntity): boolean {
  const facet = object(event.attributes.externalRef).facet;
  return typeof facet === "string" && facet.startsWith(EXTRACTION_FACET);
}

function sourceOnlyDate(event: CanonicalEntity): boolean {
  const note = sourceText(event);
  return note.includes("Clinical event date is not available.")
    || note.includes("Record timestamp describes source-update metadata:")
    || note.includes("Record timestamp describes the retrieval revision:");
}

/** Ambiguous legacy extraction dates do not establish a dated visit. */
export function prepareClinicalJournalEvents(events: readonly CanonicalEntity[]): CanonicalEntity[] {
  const parents = new Map<string, CanonicalEntity>();
  for (const event of events) {
    const key = clinicalJournalSourceKey(event);
    if (key && !object(event.attributes.externalRef).facet) parents.set(key, event);
  }
  return events.filter((event) => {
    const key = clinicalJournalSourceKey(event);
    if (!key) return true;
    if (sourceOnlyDate(event)) return false;
    if (!isExtraction(event) || event.tags.includes("clinical-date-document")
      || event.tags.includes("clinical-date-source")) return true;
    const parent = parents.get(key);
    const day = event.occurredAt?.slice(0, 10);
    const importedOn = [object(event.attributes.externalRef).version, event.attributes.recordedAt]
      .some((value) => text(value)?.slice(0, 10) === day);
    // Keep the original dated source report. Do not silently rewrite a derived
    // fact: a longitudinal document can contain several independent dates.
    return !parent || !day || !importedOn || (!sourceOnlyDate(parent)
      && (!parent.occurredAt || parent.occurredAt.slice(0, 10) >= day));
  });
}

function sourceText(event: CanonicalEntity): string {
  const sections = event.attributes.sections;
  return Array.isArray(sections) && sections.length
    ? sections.map((section) => text(object(section).text) ?? "").join("")
    : text(event.attributes.note) ?? "";
}

const HISTORY_LABELS: Readonly<Record<string, string>> = {
  allergyintolerance: "Allergy record", condition: "Condition record",
  medicationrequest: "Medication order", medicationstatement: "Medication history",
  medicationdispense: "Medication dispensed", encounter: "Visit", procedure: "Procedure",
  immunization: "Immunization", familymemberhistory: "Family history", careplan: "Care plan",
  careteam: "Care team", goal: "Care goal", device: "Medical device", servicerequest: "Care order",
};

const LABEL_FIELDS = ["name", "title", "code", "vaccineCode", "medicationCodeableConcept", "medicationReference", "description", "type"];
const DETAIL_FIELDS: Readonly<Record<string, string>> = {
  status: "Status", clinicalStatus: "Clinical status", verificationStatus: "Verification",
  category: "Category", description: "Description", reasonCode: "Reason", outcome: "Outcome",
  participant: "Care team", managingOrganization: "Organization", serviceProvider: "Provider",
  dosageInstruction: "Instructions", patientInstruction: "Instructions", note: "Note",
};

// Display labels only: source references, coding systems and opaque IDs remain
// in the original record, never substituted for missing human-readable text.
function readable(value: unknown): string | null {
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) return [...new Set(value.map(readable).filter(Boolean))].join(" · ") || null;
  const row = object(value);
  const label = text(row.text) ?? text(row.display);
  if (label) return label;
  if (row.member) return [readable(row.member), readable(row.role)].filter(Boolean).join(" — ") || null;
  if (row.coding) return readable(row.coding);
  return null;
}

export function clinicalJournalPresentation(event: CanonicalEntity): {
  title: string; summary: string | null; details: string[];
} | null {
  if (!clinicalJournalSourceKey(event)) return null;
  const noteType = text(event.attributes.noteType) ?? "";
  const historyLabel = HISTORY_LABELS[noteType.replace(/^fhir_/u, "")];
  if (historyLabel) {
    const original = sourceText(event);
    const start = original.indexOf("\n\n{");
    let fields: Record<string, unknown> = {};
    try { if (start >= 0) fields = object(JSON.parse(original.slice(start + 2))); } catch { /* Retain evidence in the vault. */ }
    const title = LABEL_FIELDS.map((key) => readable(fields[key])).find(Boolean) ?? historyLabel;
    const details = Object.entries(DETAIL_FIELDS).flatMap(([key, label]) => {
      const value = readable(fields[key]);
      return value ? [`${label}: ${value}`] : [];
    });
    if (noteType.startsWith("fhir_medication")) details.push("A source medication record does not establish that a dose was taken.");
    return { title, summary: details[0] ?? "Imported health record", details };
  }
  if (noteType === "clinical-document-receipt") {
    return { title: event.title ?? "Health record", summary: "Imported health record", details: [] };
  }
  return null;
}

export function clinicalJournalIsExtraction(event: CanonicalEntity): boolean {
  return clinicalJournalSourceKey(event) !== null && isExtraction(event);
}
