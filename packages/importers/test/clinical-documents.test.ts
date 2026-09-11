import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault, importEventBatch, findEventByExternalRef } from "@murphai/core";
import { describe, expect, it } from "vitest";
import { hashClinicalFhirBaseUrl, hashClinicalFhirPatientId, type ClinicalDocumentAttachment } from "@murphai/clinical-records";
import { buildClinicalImportPlanFromSnapshot, clinicalPlanToEventImportDecisions } from "../src/clinical-records/index.ts";
import { readClinicalAttachmentText } from "../src/clinical-records/documents.ts";

const hash = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const baseResource = {
  resourceType: "DocumentReference", id: "document-1", status: "current", docStatus: "final",
  subject: { reference: "Patient/patient-1" }, meta: { lastUpdated: "2026-07-01T12:00:00Z" },
  date: "2026-07-01T12:00:00Z", description: "Hospital document",
};
function snapshot(resource: object, documents: Array<{ bytes: Buffer; mediaType: string; extractedText?: string; attachmentIndex: number }> = []) {
  const content = JSON.stringify(resource);
  const type = "resourceType" in resource ? String(resource.resourceType) : "DocumentReference";
  const relativePath = `${type}/page.json`;
  const metadata: ClinicalDocumentAttachment[] = documents.map((document) => ({
    parentPageSha256: hash(content), resourceType: type === "DiagnosticReport" ? "DiagnosticReport" : "DocumentReference",
    resourceId: "document-1", attachmentIndex: document.attachmentIndex, status: "downloaded",
    relativePath: `attachments/${hash(document.bytes)}.bin`, sha256: hash(document.bytes), byteLength: document.bytes.length, mediaType: document.mediaType,
  }));
  return {
    manifestPath: "raw/clinical/fhir/connection-1/retrieval-1/manifest.json",
    manifest: {
      schemaVersion: "murph.clinical-raw-manifest.v2", kind: "clinical_fhir_retrieval",
      connectionId: "connection-1", retrievalJobId: "retrieval-1", sourceSystem: "epic-fhir",
      fhirBaseUrlHash: hashClinicalFhirBaseUrl("https://ehr.example.test/fhir"), patientIdHash: hashClinicalFhirPatientId("patient-1"),
      fetchedAt: "2026-07-01T12:00:00Z", requestedScopes: [`patient/${type}.read`], grantedScopes: [`patient/${type}.read`],
      resourceFiles: [{ resourceType: type, relativePath, count: 1, sha256: hash(content) }],
      retrievalScopes: [{ coverage: "whole-family", queryFingerprint: "a".repeat(64), resourceType: type }],
      completedResourceTypes: [type], documentAttachments: metadata,
    },
    pages: [{ content, relativePath }],
    attachments: documents.map((document) => ({ relativePath: `attachments/${hash(document.bytes)}.bin`, contentBase64: document.bytes.toString("base64"), extractedText: document.extractedText })),
  };
}

describe("clinical document bodies", () => {
  it.each(["DocumentReference", "DiagnosticReport"])("records a scanned %s revision, retires older extraction, and materializes same-revision text", async (resourceType) => {
    const resource = resourceType === "DocumentReference"
      ? { ...baseResource, content: [{ attachment: { contentType: "application/pdf", url: "Binary/scanned" } }] }
      : { ...baseResource, resourceType, status: "final", issued: baseResource.date, code: { text: "Hospital diagnostic report" }, presentedForm: [{ contentType: "application/pdf", url: "Binary/scanned" }] };
    const bytes = Buffer.from("%PDF-synthetic-scanned-document");
    const document = { attachmentIndex: 0, bytes, mediaType: "application/pdf" };
    const prior = buildClinicalImportPlanFromSnapshot(snapshot(resource, [{ ...document, extractedText: "Earlier provider narrative." }]));
    const newer = { ...resource, meta: { lastUpdated: "2026-07-01T12:01:00Z" } };
    const receipt = buildClinicalImportPlanFromSnapshot(snapshot(newer, [document]));
    const first = prior.decisions[0];
    const next = receipt.decisions[0];
    if (first?.action !== "upsert" || next?.action !== "upsert") throw new Error("Expected canonical source document decisions.");
    expect(next.payload).toMatchObject({ kind: "note", noteType: "clinical-document-receipt", occurredAt: "2026-07-01T12:00:00.000Z",
      externalRef: { version: newer.meta.lastUpdated }, evidence: [{ rawRef: expect.stringContaining(`${resourceType}/page.json`) }] });
    expect(next.payload.note).toContain(`FHIR ${resourceType} source document.`);
    expect(next.payload.note).not.toMatch(/Earlier provider narrative|awaiting|pending|unreadable/iu);
    const child = { action: "upsert" as const, sourceParent: first.payload.externalRef, payload: {
      kind: "measurement", occurredAt: baseResource.date, title: "Synthetic earlier extracted pulse", source: "import",
      measurements: [{ metric: "heart-rate", value: 72, unit: "bpm" }],
      externalRef: { ...first.payload.externalRef, facet: "document-extraction-measurements-synthetic" },
    } };
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "clinical-document-receipt-"));
    try {
      await initializeVault({ vaultRoot, createdAt: baseResource.date, timezone: "UTC" });
      await importEventBatch({ vaultRoot, apply: true, decisions: [...clinicalPlanToEventImportDecisions(prior), child] });
      expect((await importEventBatch({ vaultRoot, apply: true, decisions: clinicalPlanToEventImportDecisions(receipt) })).retractedCount).toBe(1);
      expect(await findEventByExternalRef({ vaultRoot, ...child.payload.externalRef })).toBeNull();
      await expect(importEventBatch({ vaultRoot, apply: true, decisions: [child] })).rejects.toMatchObject({ code: "EVENT_SOURCE_PARENT_STALE" });
      const full = buildClinicalImportPlanFromSnapshot(snapshot(newer, [{ ...document, extractedText: "Full source narrative from the same PDF bytes." }]));
      expect((await importEventBatch({ vaultRoot, apply: true, decisions: clinicalPlanToEventImportDecisions(full) })).supersededCount).toBe(1);
      expect((await importEventBatch({ vaultRoot, apply: true, decisions: clinicalPlanToEventImportDecisions(receipt) })).skippedExistingCount).toBe(1);
      expect(await findEventByExternalRef({ vaultRoot, ...next.payload.externalRef })).toMatchObject({
        noteType: resourceType === "DocumentReference" ? "fhir_document_reference" : "fhir_diagnostic_report",
        note: "Full source narrative from the same PDF bytes.",
      });
    } finally { await rm(vaultRoot, { recursive: true, force: true }); }
  });

  it.each([
    { meta: { lastUpdated: undefined } },
    { modifierExtension: [{ url: "https://example.test/unknown-modifier", valueBoolean: true }] },
  ])("keeps unsafe raw-only document metadata on review", (invalid) => {
    const resource = { ...baseResource, ...invalid, content: [{ attachment: { contentType: "application/pdf", url: "Binary/scanned" } }] };
    expect(buildClinicalImportPlanFromSnapshot(snapshot(resource)).decisions[0]).toMatchObject({ action: "review" });
  });

  it.each(["DocumentReference", "DiagnosticReport"])("uses a %s source-update receipt when clinical dates are absent or date-only", (resourceType) => {
    for (const clinicalDate of [undefined, "2026-07-01"]) {
      for (const extractedText of [undefined, "Provider text with its own clinical dates."]) {
        const resource = resourceType === "DocumentReference"
          ? { ...baseResource, date: clinicalDate, content: [{ attachment: { contentType: "application/pdf", url: "Binary/scanned" } }] }
          : { ...baseResource, resourceType, date: undefined, issued: clinicalDate, status: "final", presentedForm: [{ contentType: "application/pdf", url: "Binary/scanned" }] };
        const input = snapshot(resource, [{ attachmentIndex: 0, bytes: Buffer.from("%PDF-synthetic"), mediaType: "application/pdf", extractedText }]);
        const decision = buildClinicalImportPlanFromSnapshot(input).decisions[0];
        expect(decision).toMatchObject({ action: "upsert", payload: {
          kind: "note", noteType: "clinical-document-receipt", occurredAt: "2026-07-01T12:00:00.000Z",
          note: expect.stringContaining("Record timestamp describes source-update metadata"),
        } });
        if (decision?.action === "upsert") expect(decision.payload.note).not.toContain("Provider text with its own clinical dates");
      }
    }
  });

  it.each(["DocumentReference", "DiagnosticReport"])("opts %s withdrawals into only document-extraction facets", (resourceType) => {
    const resource = { ...baseResource, resourceType, status: resourceType === "DocumentReference" ? "entered-in-error" : "cancelled" };
    const decisions = clinicalPlanToEventImportDecisions(buildClinicalImportPlanFromSnapshot(snapshot(resource)));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ action: "retract", retractFacetPrefixes: ["document-extraction"] });
  });

  it("combines linked and embedded attachments without changing the raw parent", () => {
    const resource = { ...baseResource, content: [
      { attachment: { contentType: "text/plain", data: Buffer.from("First page").toString("base64") } },
      { attachment: { contentType: "text/html", url: "Binary/body-2", title: "Addendum" } },
    ] };
    const input = snapshot(resource, [{ attachmentIndex: 1, bytes: Buffer.from("<p>Second &amp; final page</p>"), mediaType: "text/html" }]);
    const original = JSON.stringify(input);
    const plan = buildClinicalImportPlanFromSnapshot(input);
    expect(plan.decisions).toEqual([expect.objectContaining({ action: "upsert", payload: expect.objectContaining({ kind: "note", note: "Attachment 1\n\nFirst page\n\nAttachment 2: Addendum\n\nSecond & final page" }) })]);
    expect(JSON.stringify(input)).toBe(original);
  });

  it("does not publish a partial equal-revision body while another attachment is missing", async () => {
    const resource = { ...baseResource, content: [
      { attachment: { contentType: "text/plain", data: Buffer.from("Partial body").toString("base64") } },
      { attachment: { contentType: "text/plain", url: "Binary/body-2" } },
    ] };
    const partial = buildClinicalImportPlanFromSnapshot(snapshot(resource));
    expect(partial.decisions).toEqual([expect.objectContaining({ action: "upsert", payload: expect.objectContaining({ noteType: "clinical-document-receipt" }) })]);
    const complete = buildClinicalImportPlanFromSnapshot(snapshot(resource, [{ attachmentIndex: 1, bytes: Buffer.from("Remaining body"), mediaType: "text/plain" }]));
    expect(complete.decisions[0]).toMatchObject({ action: "upsert" });
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "clinical-document-recovery-"));
    try {
      await initializeVault({ vaultRoot, createdAt: "2026-07-01T12:00:00Z", timezone: "UTC" });
      const completeImport = await importEventBatch({ vaultRoot, apply: true, decisions: clinicalPlanToEventImportDecisions(complete) });
      const replay = await importEventBatch({ vaultRoot, apply: true, decisions: clinicalPlanToEventImportDecisions(complete) });
      expect(completeImport.createdCount).toBe(1);
      expect(replay.skippedExistingCount).toBe(1);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("retains long DiagnosticReport presented forms as ordered note sections", () => {
    const input = snapshot({ ...baseResource, resourceType: "DiagnosticReport", status: "final", issued: baseResource.date,
      conclusion: "Recorded conclusion", presentedForm: [{ contentType: "text/plain", data: Buffer.from("z".repeat(24_001)).toString("base64") }],
    });
    const result = buildClinicalImportPlanFromSnapshot(input).decisions[0];
    expect(result).toMatchObject({ action: "upsert", payload: { kind: "note", noteType: "fhir_diagnostic_report" } });
    if (result?.action !== "upsert" || result.payload.kind !== "note") throw new Error("Expected report note");
    expect(result.payload.sections?.map((section) => section.text).join("")).toBe(`Recorded conclusion\n\n${"z".repeat(24_001)}`);
  });

  it("uses exact-byte parser text for a PDF while retaining the original evidence", () => {
    const input = snapshot({ ...baseResource, content: [{ attachment: { contentType: "application/pdf", url: "Binary/pdf-1" } }] },
      [{ attachmentIndex: 0, bytes: Buffer.from("%PDF-synthetic"), mediaType: "application/pdf", extractedText: "Extracted provider document" }]);
    expect(buildClinicalImportPlanFromSnapshot(input).decisions[0]).toMatchObject({ action: "upsert", payload: { note: "Extracted provider document" } });
    input.attachments[0]!.contentBase64 = Buffer.from("wrong").toString("base64");
    expect(() => buildClinicalImportPlanFromSnapshot(input)).toThrow("integrity mismatch");
  });

  it.each(["parent", "index", "orphan", "embedded"])("rejects %s attachment substitution", (variant) => {
    const input = snapshot({ ...baseResource, content: [{ attachment: variant === "embedded" ? { contentType: "text/plain", data: Buffer.from("Original").toString("base64") } : { contentType: "text/plain", url: "Binary/body-1" } }] },
      [{ attachmentIndex: 0, bytes: Buffer.from("Other document"), mediaType: "text/plain" }]);
    if (variant === "parent") input.manifest.documentAttachments[0]!.parentPageSha256 = "b".repeat(64);
    if (variant === "index") input.manifest.documentAttachments[0]!.attachmentIndex = 1;
    if (variant === "orphan") input.manifest.documentAttachments = [];
    expect(() => buildClinicalImportPlanFromSnapshot(input)).toThrow();
  });

  it("preserves unavailable malformed slots without rejecting a useful sibling", () => {
    const malformed = { ...baseResource, content: [{ attachment: {} }] };
    const useful = { ...baseResource, id: "useful-document", content: [{ attachment: { contentType: "text/plain", data: Buffer.from("Useful sibling record").toString("base64") } }] };
    const input = snapshot(malformed);
    input.pages[0]!.content = JSON.stringify([malformed, useful]);
    input.manifest.resourceFiles[0]!.count = 2;
    input.manifest.resourceFiles[0]!.sha256 = hash(input.pages[0]!.content);
    input.manifest.documentAttachments.push({ parentPageSha256: hash(input.pages[0]!.content), resourceType: "DocumentReference", resourceId: malformed.id, attachmentIndex: 0, status: "unavailable", errorCode: "missing_attachment_content" });
    const plan = buildClinicalImportPlanFromSnapshot(input);
    expect(plan.decisions).toEqual([
      expect.objectContaining({ action: "upsert", payload: expect.objectContaining({ noteType: "clinical-document-receipt", externalRef: expect.objectContaining({ resourceId: malformed.id }) }) }),
      expect.objectContaining({ action: "upsert", payload: expect.objectContaining({ kind: "note", note: "Useful sibling record" }) }),
    ]);
  });

  it("imports Epic document identifiers longer than the base FHIR id limit", () => {
    const resourceId = "d".repeat(66);
    const input = snapshot({ ...baseResource, id: resourceId, content: [{ attachment: { contentType: "text/plain", url: "Binary/body-1" } }] },
      [{ attachmentIndex: 0, bytes: Buffer.from("Complete report"), mediaType: "text/plain" }]);
    input.manifest.documentAttachments[0]!.resourceId = resourceId;
    expect(buildClinicalImportPlanFromSnapshot(input).decisions[0]).toMatchObject({ action: "upsert", payload: { externalRef: { resourceId } } });
  });

  it("keeps native diagnostic conclusions while preserving supporting image evidence", () => {
    const resource = { ...baseResource, resourceType: "DiagnosticReport", status: "final", issued: baseResource.date,
      conclusion: "Provider recorded no fracture.", media: [{ link: { reference: "Media/image-1" } }],
    };
    const input = snapshot(resource, [{ attachmentIndex: 0, bytes: Buffer.from("synthetic-image"), mediaType: "image/png" }]);
    expect(buildClinicalImportPlanFromSnapshot(input).decisions[0]).toMatchObject({ action: "upsert", payload: { kind: "test", summary: resource.conclusion } });
    const imageOnly = snapshot({ ...resource, conclusion: undefined }, [{ attachmentIndex: 0, bytes: Buffer.from("synthetic-image"), mediaType: "image/png" }]);
    expect(buildClinicalImportPlanFromSnapshot(imageOnly).decisions[0]).toMatchObject({ action: "upsert", payload: { noteType: "clinical-document-receipt" } });
  });

  it("honors declared text encoding and refuses contradictory or unknown charset", () => {
    const bytes = Buffer.from("Provider report: stable.", "utf16le");
    expect(readClinicalAttachmentText(bytes, 'text/plain; charset="utf-16le"')).toBe("Provider report: stable.");
    expect(readClinicalAttachmentText(bytes, "text/plain; charset=not-an-encoding")).toBeUndefined();
    expect(readClinicalAttachmentText(Buffer.from([0xff, 0xfe, 0x41, 0x00]), "text/plain; charset=utf-8")).toBeUndefined();
    expect(readClinicalAttachmentText(Buffer.from('<?xml version="1.0" encoding="windows-1252"?><text>caf\xe9</text>', "latin1"), "application/xml")).toBe("café");
  });

  it("extracts C-CDA narrative without resolving entities or executing markup", () => {
    expect(readClinicalAttachmentText(Buffer.from('<ClinicalDocument><section><title>Results</title><text>Value &lt; 5 &amp; stable.</text></section></ClinicalDocument>'), "application/xml")).toBe("Results Value < 5 & stable.");
    expect(readClinicalAttachmentText(Buffer.from('<p>Document</p><script>ignored()</script>'), "text/html")).toBe("Document");
  });
});
