import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault, importEventBatch } from "@murphai/core";
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
    expect(partial.decisions).toEqual([expect.objectContaining({ action: "review", disposition: "incomplete" })]);
    expect(clinicalPlanToEventImportDecisions(partial)).toEqual([]);
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
      expect.objectContaining({ action: "review", disposition: "incomplete", resourceId: malformed.id }),
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
    expect(buildClinicalImportPlanFromSnapshot(imageOnly).decisions[0]).toMatchObject({ action: "review", disposition: "incomplete" });
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
