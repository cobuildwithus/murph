import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { clinicalRawManifestSchema, hashClinicalFhirBaseUrl, hashClinicalFhirPatientId } from "@murphai/clinical-records";
import { applyCanonicalWriteBatch, initializeVault } from "@murphai/core";
import { afterEach, describe, expect, it } from "vitest";
import { minimizeClinicalDocumentImages, readClinicalStoredDocument, readMinimizedClinicalDocument } from "../src/clinical-document-storage.ts";
import { applyClinicalEnrichmentProposals, enqueueClinicalEnrichment, persistClinicalEnrichmentProposals, readNextClinicalEnrichment } from "../src/clinical-enrichment.ts";

const roots: string[] = [];
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(inline = false) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "clinical-storage-")); roots.push(vaultRoot);
  await initializeVault({ vaultRoot, timezone: "UTC", createdAt: "2026-07-10T12:00:00Z" });
  const decorative = Buffer.alloc(3000, 7);
  const retained = Buffer.from("unreviewed clinical image");
  const html = `<html><body><p>Report dated July 10, 2026. Documented finding.</p><img src="data:image/png;base64,${decorative.toString("base64")}"/><img src="data:image/png;base64,${retained.toString("base64")}"/></body></html>`;
  const sha256 = hash(html);
  const attachmentRelativePath = `attachments/${sha256}.bin`;
  const manifestPath = "raw/clinical/fhir/synthetic-connection/synthetic-batch/manifest.json";
  const rawRef = path.posix.join(path.posix.dirname(manifestPath), attachmentRelativePath);
  const relativePath = "documents/whole/DocumentReference/page-0001.json";
  const parent = { resourceType: "DocumentReference", id: "synthetic-report", status: "current", date: "2026-07-10T12:00:00Z",
    meta: { lastUpdated: "2026-07-10T12:00:00Z" }, subject: { reference: "Patient/synthetic-patient" },
    content: [{ attachment: { contentType: "text/html", ...(inline ? { data: Buffer.from(html).toString("base64") } : { url: "Binary/synthetic-report" }) } }],
  };
  const page = JSON.stringify({ resourceType: "Bundle", entry: [{ resource: parent }] });
  const manifest = clinicalRawManifestSchema.parse({
    schemaVersion: "murph.clinical-raw-manifest.v3", kind: "clinical_fhir_retrieval", sourceSystem: "epic-fhir",
    connectionId: "synthetic-connection", retrievalJobId: "synthetic-batch", fetchedAt: "2026-07-10T12:00:00Z",
    fhirBaseUrlHash: hashClinicalFhirBaseUrl("https://ehr.example.test/fhir"), patientIdHash: hashClinicalFhirPatientId("synthetic-patient"),
    requestedScopes: ["patient/DocumentReference.read"], grantedScopes: ["patient/DocumentReference.read"],
    retrievalSlices: [{ queryScopeId: "documents", sliceId: "whole", resourceType: "DocumentReference", coverage: "whole-family", queryFingerprint: "a".repeat(64) }],
    completedRetrievalSlices: [{ queryScopeId: "documents", sliceId: "whole" }],
    resourceFiles: [{ queryScopeId: "documents", sliceId: "whole", resourceType: "DocumentReference", relativePath, count: 1, sha256: hash(page) }],
    documentAttachments: [{ parentPageSha256: hash(page), resourceType: "DocumentReference", resourceId: parent.id, attachmentIndex: 0,
      status: "downloaded", relativePath: attachmentRelativePath, sha256, byteLength: Buffer.byteLength(html), mediaType: "text/html" }],
  });
  const content = JSON.stringify(manifest);
  for (const [ref, bytes] of [[manifestPath, content], [rawRef, html], [path.posix.join(path.posix.dirname(manifestPath), relativePath), page]]) {
    await mkdir(path.dirname(path.join(vaultRoot, ref!)), { recursive: true }); await writeFile(path.join(vaultRoot, ref!), bytes!);
  }
  const source = { rawRef, sha256, byteLength: Buffer.byteLength(html), mediaType: "text/html" };
  return { vaultRoot, manifestPath, manifestSha256: hash(content), attachmentRelativePath, reviewedImageSha256s: [hash(decorative)], source, html, retained, content };
}

describe("reviewed clinical image storage", () => {
  it("omits only exact reviewed payloads, preserves text and source identity, and replays idempotently", async () => {
    const input = await fixture();
    const result = await minimizeClinicalDocumentImages(input);
    expect(result).toMatchObject({ changed: true, removedImageCount: 1 }); expect(result.bytesSaved).toBeGreaterThan(2000);
    const stored = await readClinicalStoredDocument(input);
    expect(stored.bytes.toString()).toContain(input.retained.toString("base64"));
    expect(stored.bytes.toString()).toContain("Documented finding.");
    expect(stored.receipt?.original.sha256).toBe(input.source.sha256);
    expect(stored.sha256).not.toBe(input.source.sha256);
    expect(await readFile(path.join(input.vaultRoot, input.manifestPath), "utf8")).toBe(input.content);
    expect(await readMinimizedClinicalDocument(input)).toEqual(stored.bytes);
    expect(await minimizeClinicalDocumentImages(input)).toEqual({ changed: false, bytesSaved: 0, removedImageCount: 0 });
  });

  it("binds new extraction and frozen proposals to the current stored bytes", async () => {
    const input = await fixture(); const { jobId } = await enqueueClinicalEnrichment(input);
    const first = await readNextClinicalEnrichment({ vaultRoot: input.vaultRoot, jobId });
    expect(first?.status).toBe("extract");
    await minimizeClinicalDocumentImages(input);
    const next = await readNextClinicalEnrichment({ vaultRoot: input.vaultRoot, jobId });
    if (next?.status !== "extract") throw new Error("Expected extraction work.");
    expect(next.source.sha256).toBe(hash(await readFile(next.documentPath)));
    const empty = { status: "complete" as const, records: [] };
    await expect(persistClinicalEnrichmentProposals({ vaultRoot: input.vaultRoot, jobId, sourceSha256: input.source.sha256, page: 1, totalPages: 1, outputs: { labs: empty, measurements: empty, history: empty } })).rejects.toThrow("source changed");
    await persistClinicalEnrichmentProposals({ vaultRoot: input.vaultRoot, jobId, sourceSha256: next.source.sha256, page: 1, totalPages: 1, outputs: { labs: empty, measurements: empty, history: empty } });
    expect(await applyClinicalEnrichmentProposals({ vaultRoot: input.vaultRoot, jobId })).toMatchObject({ readback: { verifiedCount: 0 }, counts: { documents: 1 } });
  });

  it("recovers already frozen proposals after reviewed image omission", async () => {
    const input = await fixture(); const { jobId } = await enqueueClinicalEnrichment(input);
    await readNextClinicalEnrichment({ vaultRoot: input.vaultRoot, jobId });
    const empty = { status: "complete" as const, records: [] };
    await persistClinicalEnrichmentProposals({ vaultRoot: input.vaultRoot, jobId, sourceSha256: input.source.sha256, page: 1, totalPages: 1,
      outputs: { labs: empty, measurements: empty, history: empty } });
    await minimizeClinicalDocumentImages(input);
    expect(await readNextClinicalEnrichment({ vaultRoot: input.vaultRoot, jobId })).toMatchObject({ status: "apply" });
    expect(await applyClinicalEnrichmentProposals({ vaultRoot: input.vaultRoot, jobId })).toMatchObject({ counts: { documents: 1 } });
  });

  it("rejects unreviewed hashes and inline duplicates without changing bytes", async () => {
    const input = await fixture();
    await expect(minimizeClinicalDocumentImages({ ...input, reviewedImageSha256s: ["f".repeat(64)] })).rejects.toThrow("not found");
    expect(await readFile(path.join(input.vaultRoot, input.source.rawRef), "utf8")).toBe(input.html);
    await expect(minimizeClinicalDocumentImages(await fixture(true))).rejects.toThrow("eligible linked document");
  });

  it("rejects altered postimages, mismatched originals, and orphan receipts", async () => {
    const input = await fixture(); await minimizeClinicalDocumentImages(input);
    await expect(readClinicalStoredDocument({ ...input, source: { ...input.source, sha256: "f".repeat(64) } })).rejects.toThrow("original source");
    await writeFile(path.join(input.vaultRoot, input.source.rawRef), "changed");
    await expect(readClinicalStoredDocument(input)).rejects.toThrow("integrity mismatch");
    await rm(path.join(input.vaultRoot, input.source.rawRef));
    await expect(readMinimizedClinicalDocument(input)).rejects.toThrow();
  });

  it("requires the exact raw preimage at the canonical write boundary", async () => {
    const input = await fixture();
    await expect(applyCanonicalWriteBatch({ vaultRoot: input.vaultRoot, operationType: "clinical_storage_test", summary: "Synthetic raw repair",
      audit: { action: "vault_repair", commandName: "synthetic", summary: "Synthetic preimage rejection" },
      textWrites: [{ relativePath: input.source.rawRef, content: "replacement", overwrite: true, rawReplacement: { sha256: "f".repeat(64), byteLength: input.source.byteLength } }],
    })).rejects.toThrow();
    expect(await readFile(path.join(input.vaultRoot, input.source.rawRef), "utf8")).toBe(input.html);
  });
});
