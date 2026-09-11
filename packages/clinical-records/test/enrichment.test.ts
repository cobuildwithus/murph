import { describe, expect, it } from "vitest";
import {
  CLINICAL_DOCUMENT_EXTRACTION_MAX_RECORDS,
  clinicalDocumentExtractionOutputJsonSchema,
  clinicalDocumentExtractionOutputSchema,
  clinicalDocumentExtractionOutputSchemaForFamily,
  parseClinicalDocumentExtractionOutput,
} from "../src/index.ts";

const occurredAt = "2026-09-01T12:00:00Z";
const lab = {
  kind: "test",
  occurredAt,
  title: "Laboratory report",
  testName: "Glucose",
  resultStatus: "normal",
  specimenType: "serum",
  results: [{
    analyte: "Glucose",
    value: 90,
    unit: "mg/dL",
    referenceRange: { low: 70, high: 99 },
  }],
};
const measurement = {
  kind: "measurement",
  occurredAt,
  title: "Blood pressure",
  measurements: [{ metric: "systolic-blood-pressure", value: 120, unit: "mmHg" }],
};
const note = {
  kind: "note",
  occurredAt,
  title: "Medication history",
  note: "The provider recorded an instruction not to take the named medication.",
};
const complete = (payload: unknown) => ({
  status: "complete",
  records: [{ payload, page: 2, excerpt: "Synthetic source excerpt." }],
});

describe("clinical document extraction proposals", () => {
  it("admits only the assigned family's clinical record kinds", () => {
    const cases = [
      ["labs", lab],
      ["measurements", measurement],
      ["history", note],
      ["history", {
        kind: "clinical_assertion", occurredAt, title: "Source symptom denial",
        assertion: "denial_asserted", assertedOn: "2026-09-01", domain: "symptom",
        polarity: "denied", subject: "Nausea", assertionText: "The source records a denial of nausea.",
      }],
    ] as const;
    for (const [family, payload] of cases) {
      expect(clinicalDocumentExtractionOutputSchemaForFamily(family).safeParse(complete(payload)).success).toBe(true);
      for (const [otherFamily] of cases) {
        if (otherFamily !== family) {
          expect(clinicalDocumentExtractionOutputSchemaForFamily(otherFamily).safeParse(complete(payload)).success).toBe(false);
        }
      }
    }
    expect(clinicalDocumentExtractionOutputSchema.safeParse(complete({
      kind: "medication_intake", occurredAt, title: "Prescription", medicationName: "Example", dose: 1, unit: "tablet",
    })).success).toBe(false);
  });

  it("rejects caller-supplied write identity, provenance, and relationships", () => {
    for (const field of [
      "id", "source", "recordedAt", "externalRef", "evidence", "rawRefs",
      "links", "author", "providerId", "encounterId", "experimentId", "attachments", "media",
    ]) {
      expect(clinicalDocumentExtractionOutputSchema.safeParse(complete({ ...note, [field]: "untrusted" })).success, field).toBe(false);
    }
    expect(clinicalDocumentExtractionOutputSchema.safeParse(complete({
      ...lab, results: [{ ...lab.results[0], externalRef: { resourceId: "untrusted" } }],
    })).success).toBe(false);
  });

  it("preserves useful partial records while keeping blocked work incomplete", () => {
    expect(clinicalDocumentExtractionOutputSchema.parse({
      status: "blocked", records: [], reason: "The page is unreadable.",
    }).status).toBe("blocked");
    expect(clinicalDocumentExtractionOutputSchema.safeParse({ status: "blocked", records: [] }).success).toBe(false);
    expect(clinicalDocumentExtractionOutputSchema.safeParse({
      ...complete(note), status: "blocked", reason: "Only part of the document was read.",
    }).success).toBe(true);
    expect(clinicalDocumentExtractionOutputSchema.safeParse({ status: "complete", records: [] }).success).toBe(true);
  });

  it("bounds proposals and evidence locators while retaining canonical validation", () => {
    const records = Array.from({ length: CLINICAL_DOCUMENT_EXTRACTION_MAX_RECORDS }, () => ({ payload: note }));
    expect(clinicalDocumentExtractionOutputSchema.safeParse({ status: "complete", records }).success).toBe(true);
    expect(clinicalDocumentExtractionOutputSchema.safeParse({ status: "complete", records: [...records, records[0]] }).success).toBe(false);
    expect(clinicalDocumentExtractionOutputSchema.safeParse({ status: "blocked", records: [...records, records[0]], reason: "More records remain." }).success).toBe(false);
    for (const record of [
      { payload: note, page: 0 },
      { payload: note, page: 1.5 },
      { payload: note, excerpt: "x".repeat(501) },
      { payload: { ...measurement, measurements: [{ metric: "heart-rate", value: "fast", unit: "bpm" }] } },
      { payload: { ...lab, results: [{ analyte: "Glucose" }] } },
    ]) {
      expect(clinicalDocumentExtractionOutputSchema.safeParse({ status: "complete", records: [record] }).success).toBe(false);
    }
    expect(clinicalDocumentExtractionOutputSchema.safeParse({
      status: "blocked", records: [], reason: "x".repeat(501),
    }).success).toBe(false);
  });

  it("generates family-specific JSON schemas for read-only extractor output", () => {
    for (const family of ["labs", "measurements", "history"] as const) {
      const json = clinicalDocumentExtractionOutputJsonSchema(family);
      const serialized = JSON.stringify(json);
      expect(json).toHaveProperty("$schema");
      expect(json.type).toBe("object");
      expect(json).not.toHaveProperty("oneOf");
      expect(json).not.toHaveProperty("anyOf");
      expect(serialized).toContain('"additionalProperties":false');
      expect(serialized).not.toContain('"oneOf"');
      expect(serialized).not.toContain('"externalRef"');
      expect(serialized).not.toContain('"medication_intake"');
      expect(serialized).toContain('"maxItems":100');
      const inspect = (node: unknown): void => {
        if (Array.isArray(node)) { node.forEach(inspect); return; }
        if (!node || typeof node !== "object") return;
        const object = node as Record<string, unknown>;
        if (object.type === "object") {
          expect(object.additionalProperties).toBe(false);
          expect(object.required).toEqual(Object.keys(object.properties as Record<string, unknown>));
        }
        Object.values(object).forEach(inspect);
      };
      inspect(json);
    }
  });

  it("retains bounded measurement qualifiers and rejects unsupported material context", () => {
    const measurementWithQualifier = (qualifiers: unknown) => complete({
      ...measurement, measurements: [{ ...measurement.measurements[0], qualifiers }],
    });
    expect(clinicalDocumentExtractionOutputSchemaForFamily("measurements").safeParse(
      measurementWithQualifier({ position: "seated", site: "left-arm", method: "automatic", subject: "member" }),
    ).success).toBe(true);
    expect(clinicalDocumentExtractionOutputSchemaForFamily("measurements").safeParse(
      measurementWithQualifier({ "unsupported-context": "cannot silently ignore" }),
    ).success).toBe(false);
    for (const metric of ["pulse", "unsupported-measurement"]) {
      expect(clinicalDocumentExtractionOutputSchemaForFamily("measurements").safeParse(complete({
        ...measurement, measurements: [{ metric, value: 72, unit: "bpm" }],
      })).success).toBe(false);
    }
  });

  it("normalizes nullable optional provider fields without accepting unknown authority", () => {
    const wire = {
      status: "complete", reason: null,
      records: [{
        page: null, excerpt: null,
        payload: { ...lab, note: null, reportedAt: null, results: [{
          ...lab.results[0], flag: null, textValue: null,
          referenceRange: { low: null, high: 99, text: null },
        }] },
      }],
    };
    expect(parseClinicalDocumentExtractionOutput("labs", wire)).toEqual({
      status: "complete",
      records: [{ payload: { ...lab, results: [{ ...lab.results[0], referenceRange: { high: 99 } }] } }],
    });
    expect(() => parseClinicalDocumentExtractionOutput("labs", {
      ...wire, records: [{ payload: { ...lab, source: null } }],
    })).toThrow();
    expect(() => parseClinicalDocumentExtractionOutput("labs", {
      ...wire, records: [{ payload: { ...lab, occurredAt: null } }],
    })).toThrow();
    expect(() => parseClinicalDocumentExtractionOutput("labs", {
      ...wire, status: "blocked",
    })).toThrow();
  });
});
