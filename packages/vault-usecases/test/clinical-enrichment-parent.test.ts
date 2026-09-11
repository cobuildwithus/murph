import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { clinicalRawManifestSchema, hashClinicalFhirBaseUrl, hashClinicalFhirPatientId } from "@murphai/clinical-records";
import { initializeVault } from "@murphai/core";
import { listCanonicalEntities } from "@murphai/query";
import { afterEach, describe, expect, it } from "vitest";

import { applyClinicalEnrichmentProposals, enqueueClinicalEnrichment, readNextClinicalEnrichment } from "../src/clinical-enrichment.ts";
import { readClinicalEnrichmentParentEligibility } from "../src/clinical-enrichment-parent.ts";

const roots: string[] = [];
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(options: { resourceType?: "DocumentReference" | "DiagnosticReport"; status?: string; docStatus?: string; duplicate?: boolean; subject?: string; revision?: unknown } = {}) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "clinical-enrichment-parent-"));
  roots.push(vaultRoot);
  await initializeVault({ vaultRoot, timezone: "UTC", createdAt: "2026-07-10T12:00:00Z" });
  const resourceType = options.resourceType ?? "DocumentReference";
  const attachment = { contentType: "application/pdf", url: "Binary/synthetic-document" };
  const parent = { resourceType, id: "synthetic-document", status: options.status ?? "current",
    ...(options.docStatus ? { docStatus: options.docStatus } : {}),
    meta: { lastUpdated: "revision" in options ? options.revision : "2026-07-10T12:00:00Z" }, subject: { reference: options.subject ?? "Patient/synthetic-patient" },
    ...(resourceType === "DocumentReference" ? { content: [{ attachment }] } : { presentedForm: [attachment] }),
  };
  const content = JSON.stringify({ resourceType: "Bundle", entry: (options.duplicate ? [parent, parent] : [parent]).map((resource) => ({ resource })) });
  const manifestPath = "raw/clinical/fhir/synthetic-connection/synthetic-batch/manifest.json";
  const relativePath = `documents/whole/${resourceType}/page-0001.json`;
  const document = "%PDF-1.7 synthetic scanned evidence";
  const sha256 = digest(document);
  const manifest = clinicalRawManifestSchema.parse({
    schemaVersion: "murph.clinical-raw-manifest.v3", kind: "clinical_fhir_retrieval", sourceSystem: "epic-fhir",
    connectionId: "synthetic-connection", retrievalJobId: "synthetic-batch", fetchedAt: "2026-07-10T12:00:00Z",
    fhirBaseUrlHash: hashClinicalFhirBaseUrl("https://ehr.example.test/fhir"), patientIdHash: hashClinicalFhirPatientId("synthetic-patient"),
    requestedScopes: [`patient/${resourceType}.read`], grantedScopes: [`patient/${resourceType}.read`],
    retrievalSlices: [{ queryScopeId: "documents", sliceId: "whole", resourceType, coverage: "whole-family", queryFingerprint: "a".repeat(64) }],
    completedRetrievalSlices: [{ queryScopeId: "documents", sliceId: "whole" }],
    resourceFiles: [{ queryScopeId: "documents", sliceId: "whole", resourceType, relativePath, count: options.duplicate ? 2 : 1, sha256: digest(content) }],
    documentAttachments: [{ parentPageSha256: digest(content), resourceType, resourceId: parent.id, attachmentIndex: 0,
      status: "downloaded", relativePath: `attachments/${sha256}.bin`, sha256, byteLength: Buffer.byteLength(document), mediaType: "application/pdf" }],
  });
  const parentPagePath = path.join(vaultRoot, path.dirname(manifestPath), relativePath);
  await mkdir(path.dirname(parentPagePath), { recursive: true });
  await writeFile(parentPagePath, content);
  const downloaded = manifest.documentAttachments?.[0];
  if (downloaded?.status !== "downloaded") throw new Error("Missing synthetic attachment.");
  const rawRef = path.posix.join(path.posix.dirname(manifestPath), downloaded.relativePath);
  await mkdir(path.dirname(path.join(vaultRoot, rawRef)), { recursive: true });
  await writeFile(path.join(vaultRoot, rawRef), document);
  const manifestContent = JSON.stringify(manifest);
  await writeFile(path.join(vaultRoot, manifestPath), manifestContent);
  return { vaultRoot, manifestPath, manifestSha256: digest(manifestContent), manifest, attachment: downloaded, parentPagePath, rawRef };
}

describe("clinical enrichment attested parent eligibility", () => {
  it.each([
    { resourceType: "DocumentReference" as const, status: "current", eligible: true },
    { resourceType: "DocumentReference" as const, status: "current", docStatus: "final", eligible: true },
    { resourceType: "DocumentReference" as const, status: "entered-in-error", eligible: false },
    { resourceType: "DocumentReference" as const, status: "superseded", eligible: false },
    { resourceType: "DocumentReference" as const, status: "current", docStatus: "entered-in-error", eligible: false },
    { resourceType: "DocumentReference" as const, status: "current", docStatus: "preliminary", eligible: false },
    { resourceType: "DiagnosticReport" as const, status: "final", eligible: true },
    { resourceType: "DiagnosticReport" as const, status: "corrected", eligible: true },
    { resourceType: "DiagnosticReport" as const, status: "cancelled", eligible: false },
    { resourceType: "DiagnosticReport" as const, status: "entered-in-error", eligible: false },
    { resourceType: "DiagnosticReport" as const, status: "preliminary", eligible: false },
  ])("uses shared parent policy for $resourceType $status $docStatus without requiring a readable canonical note", async (options) => {
    const input = await fixture(options);
    expect(await readClinicalEnrichmentParentEligibility(input)).toMatchObject({ eligible: options.eligible });
  });

  it.each([
    { resourceType: "DocumentReference" as const, status: "current", revision: "2026-07-10T12:00:00.123456Z" },
    { resourceType: "DocumentReference" as const, status: "current", revision: "2026-07-10T12:00:00.123456789Z" },
    { resourceType: "DiagnosticReport" as const, status: "final", revision: "2026-07-10T08:00:00.123456-04:00" },
    { resourceType: "DiagnosticReport" as const, status: "final", revision: "2026-07-10T12:00:00.123456789Z" },
  ])("preserves the exact writable revision for $resourceType $revision", async (options) => {
    const parent = await readClinicalEnrichmentParentEligibility(await fixture(options));
    expect(parent).toMatchObject({ eligible: true, parentRevision: options.revision, parentExternalRef: { version: options.revision } });
  });

  it.each([undefined, "not-a-timestamp", "2026-07-10", "2026-02-30T12:00:00.123456789Z"])("rejects invalid parent revisions: %s", async (revision) => {
    await expect(readClinicalEnrichmentParentEligibility(await fixture({ revision }))).rejects.toThrow("source attestation");
  });

  it("holds already prepared proposals for a withdrawn origin without altering raw evidence or publishing facts", async () => {
    const input = await fixture({ status: "entered-in-error" });
    const { jobId } = await enqueueClinicalEnrichment(input);
    const statePath = path.join(input.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${jobId}.json`);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const empty = { status: "complete", records: [] };
    // Restore an accepted proposal checkpoint produced before origin eligibility was enforced.
    await writeFile(statePath, JSON.stringify({ ...state, status: "prepared",
      source: { rawRef: input.rawRef, sha256: input.attachment.sha256, byteLength: input.attachment.byteLength, mediaType: input.attachment.mediaType },
      prepared: { page: 1, totalPages: 1, outputs: { labs: empty, history: empty, measurements: { status: "complete", records: [{ payload: {
        kind: "measurement", occurredAt: "2026-07-10T12:00:00Z", title: "Synthetic heart rate", note: null,
        measurements: [{ metric: "heart-rate", value: 70, unit: "bpm" }],
      } }] } } },
    }));
    const rawBefore = await readFile(path.join(input.vaultRoot, input.rawRef));
    expect(await applyClinicalEnrichmentProposals({ vaultRoot: input.vaultRoot, jobId })).toMatchObject({
      canonical: null, counts: { created: 0, held: 1 }, readback: { verifiedCount: 0 },
    });
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toEqual([]);
    expect(await readFile(path.join(input.vaultRoot, input.rawRef))).toEqual(rawBefore);
    expect(await readNextClinicalEnrichment({ vaultRoot: input.vaultRoot, jobId })).toMatchObject({ status: "advance" });
    expect(await readNextClinicalEnrichment({ vaultRoot: input.vaultRoot, jobId })).toBeNull();
  });

  it("rejects mutated parent bytes, ambiguous resource identity and contradictory patient binding", async () => {
    const altered = await fixture();
    await writeFile(altered.parentPagePath, "{}");
    await expect(readClinicalEnrichmentParentEligibility(altered)).rejects.toThrow("source attestation");
    await expect(readClinicalEnrichmentParentEligibility(await fixture({ duplicate: true }))).rejects.toThrow("source attestation");
    await expect(readClinicalEnrichmentParentEligibility(await fixture({ subject: "Patient/other" }))).rejects.toThrow("source attestation");
  });

  it("rejects a forged attachment slot or a manifest with no matching parent page", async () => {
    const input = await fixture();
    await expect(readClinicalEnrichmentParentEligibility({ ...input, attachment: { ...input.attachment, attachmentIndex: 1 } })).rejects.toThrow("source attestation");
    input.manifest.resourceFiles[0]!.sha256 = "c".repeat(64);
    await expect(readClinicalEnrichmentParentEligibility(input)).rejects.toThrow("source attestation");
  });
});
