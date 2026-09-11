import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { hashClinicalFhirBaseUrl, hashClinicalFhirPatientId, type ClinicalDocumentExtractionOutput } from "@murphai/clinical-records";
import { initializeVault } from "@murphai/core";
import { listCanonicalEntities, listMetricPoints } from "@murphai/query";
import { importClinicalFhirSnapshot } from "@murphai/vault-usecases/clinical-records";
import { enqueueClinicalEnrichment, readClinicalEnrichmentStatus } from "@murphai/vault-usecases/clinical-enrichment";
import { describe, expect, it, vi } from "vitest";

import { runOneHostedClinicalEnrichment, type HostedClinicalEnrichmentInput } from "../src/hosted-runtime/clinical-enrichment.ts";
import { admitHostedClinicalEnrichmentWake, makeHostedClinicalEnrichmentWakeDue } from "../src/hosted-runtime/clinical-enrichment-wake.ts";
import { executeHostedClinicalEnrichmentWake } from "../src/hosted-runtime/events/clinical-enrichment.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import { prepareHostedSystemMailboxItemForCheckpoint, type HostedSystemMailboxRuntime } from "../src/hosted-runtime/system-mailbox.ts";
import { createHostedRuntimeResolvedConfig, createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

// Bootstrap/environment loading is unrelated to this deterministic data path.
// The real mailbox dispatcher, enrichment handler, renderer and vault owners run.
vi.mock("../src/hosted-runtime/context.ts", () => ({
  prepareHostedWakeContext: async () => null,
  hydrateHostedExecutionDefaultTarget: async (context: unknown) => context,
  applyHostedMemberPreferences: vi.fn(),
}));

const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const OCCURRED_AT = "2020-03-12T12:00:00.000Z";
const SOURCE_TEXT = "Synthetic laboratory report. Collected 2020-03-12T12:00:00Z. Serum glucose 90 mg/dL. Reference 70-99 mg/dL.";
const empty: ClinicalDocumentExtractionOutput = { status: "complete", records: [] };

function runtime(): HostedSystemMailboxRuntime {
  return {
    commitTimeoutMs: null, forwardedEnv: {}, platformEnv: {}, userEnv: {},
    platform: {
      artifactStore: { async get() { return null; }, async put() {} },
      effectsPort: { async readRawEmailMessage() { return null; }, async sendEmail() {} },
    },
    resolvedConfig: createHostedRuntimeResolvedConfig(),
  };
}

async function importSource(vaultRoot: string) {
  const now = new Date().toISOString();
  const bytes = Buffer.from(SOURCE_TEXT);
  const sha256 = digest(bytes);
  const resource = {
    resourceType: "DocumentReference", id: "synthetic-lab-document", status: "current",
    subject: { reference: "Patient/synthetic-patient" }, meta: { lastUpdated: now },
    date: OCCURRED_AT, type: { text: "Synthetic lab report" },
    content: [{ attachment: { contentType: "text/plain", url: "Binary/synthetic-lab-document" } }],
  };
  const content = JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: [{ resource }] });
  const imported = await importClinicalFhirSnapshot({
    vaultRoot, connectionId: "synthetic-connection", retrievalJobId: "synthetic-retrieval",
    retrievalProtocol: "query-slices-v2", sourceSystem: "epic-fhir", fetchedAt: now,
    fhirBaseUrlHash: hashClinicalFhirBaseUrl("https://ehr.example.test/fhir"),
    patientIdHash: hashClinicalFhirPatientId("synthetic-patient"),
    requestedScopes: ["patient/DocumentReference.read"], grantedScopes: ["patient/DocumentReference.read"],
    retrievalSlices: [{ queryScopeId: "documentreference", sliceId: "whole", resourceType: "DocumentReference", coverage: "whole-family", queryFingerprint: "a".repeat(64) }],
    completedRetrievalSlices: [{ queryScopeId: "documentreference", sliceId: "whole" }],
    pages: [{ queryScopeId: "documentreference", sliceId: "whole", resourceType: "DocumentReference", content }],
    documentAttachments: [{ parentPageSha256: digest(content), resourceType: "DocumentReference", resourceId: resource.id, attachmentIndex: 0, status: "downloaded", relativePath: `attachments/${sha256}.bin`, sha256, byteLength: bytes.length, mediaType: "text/plain" }],
    attachments: [{ relativePath: `attachments/${sha256}.bin`, contentBase64: bytes.toString("base64") }],
  });
  const job = await enqueueClinicalEnrichment({ vaultRoot, manifestPath: imported.manifestPath, manifestSha256: imported.manifestSha256 });
  await admitHostedClinicalEnrichmentWake({ vaultRoot, jobId: job.jobId, userId: "synthetic-member", occurredAt: now });
  return { ...job, rawRef: path.posix.join(path.posix.dirname(imported.manifestPath), `attachments/${sha256}.bin`), sha256 };
}

describe("clinical enrichment import-to-query flow", () => {
  it("retains raw evidence, yields for foreground work, resumes frozen proposals and publishes source-backed lab results", async () => {
    const workspace = await createHostedRuntimeWorkspace("clinical-enrichment-flow-");
    const { vaultRoot } = workspace;
    try {
      await initializeVault({ vaultRoot, timezone: "UTC", createdAt: new Date().toISOString() });
      const job = await importSource(vaultRoot);
      const selection = {
        allowedRouteActions: ["apply-clinical-enrichment"] as const,
        runtime: runtime(), runtimeEnv: {}, vaultRoot,
      };
      expect(await listCanonicalEntities(vaultRoot, { family: "event", kinds: ["test"], limit: 10 })).toEqual([]);
      expect(await prepareHostedSystemMailboxItemForCheckpoint(selection)).toMatchObject({ status: "preempted", item: { status: "pending" } });

      const executeExtraction = vi.fn<NonNullable<HostedClinicalEnrichmentInput["executeExtraction"]>>(async (request) => {
        await request.beforeProviderEntry?.();
        expect(request.source).toEqual({ rawRef: job.rawRef, sha256: job.sha256, mediaType: "text/plain" });
        expect(request.extractedText).toBe(SOURCE_TEXT);
        return request.family !== "labs" ? empty : {
          status: "complete", records: [{ page: 1, excerpt: "Serum glucose 90 mg/dL.", payload: {
            kind: "test", occurredAt: OCCURRED_AT, title: "Synthetic serum glucose", note: null, testName: "Glucose",
            specimenType: "serum", resultStatus: "normal",
            results: [{ analyte: "Glucose", value: 90, unit: "mg/dL", referenceRange: { low: 70, high: 99 } }],
          } }],
        };
      });
      const runnerInput: HostedClinicalEnrichmentInput = {
        abortSignal: new AbortController().signal, codexHome: null, env: {}, vaultRoot,
        memberId: "synthetic-member", resolveProviderAuthority: async () => "current",
        onStateMutation() {},
        async onWorkUpdated(jobId) { await makeHostedClinicalEnrichmentWakeDue({ vaultRoot, jobId }); },
        executeExtraction,
      };
      expect(await runOneHostedClinicalEnrichment(runnerInput)).toBe("settled");
      expect(executeExtraction).toHaveBeenCalledTimes(3);
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "prepared" });
      expect(await listCanonicalEntities(vaultRoot, { family: "event", kinds: ["test"], limit: 10 })).toEqual([]);

      // A new runner instance after restart finds frozen proposals without another model call.
      expect(await runOneHostedClinicalEnrichment({ ...runnerInput, abortSignal: new AbortController().signal })).toBe("idle");
      expect(executeExtraction).toHaveBeenCalledTimes(3);
      const queued = (await readHostedSystemMailboxState(vaultRoot)).pending[0]!;
      if (queued.wake.kind !== "clinical-records.enrichment-requested") throw new Error("Synthetic enrichment wake missing.");
      expect(await executeHostedClinicalEnrichmentWake({ vaultRoot, wake: queued.wake, shouldYield: () => true })).toMatchObject({ backgroundMaintenanceYielded: true });
      expect(await prepareHostedSystemMailboxItemForCheckpoint({ ...selection, shouldYieldBackgroundMaintenance: () => true })).toMatchObject({ status: "preempted" });
      expect(await listCanonicalEntities(vaultRoot, { family: "event", kinds: ["test"], limit: 10 })).toEqual([]);
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "prepared" });

      // The actual mailbox handler performs the separate canonical write once foreground yields.
      expect(await prepareHostedSystemMailboxItemForCheckpoint(selection)).toMatchObject({ status: "preempted" });
      const tests = await listCanonicalEntities(vaultRoot, { family: "event", kinds: ["test"], limit: 10 });
      expect(tests).toHaveLength(1);
      expect(tests[0]?.attributes).toMatchObject({
        source: "import", rawRefs: [job.rawRef], specimenType: "serum",
        externalRef: { system: "clinical-document-extraction" },
        evidence: [{ rawRef: job.rawRef, page: 1, excerpt: "Serum glucose 90 mg/dL." }],
      });
      const points = await listMetricPoints(vaultRoot, { limit: 10 });
      expect(points).toEqual(expect.arrayContaining([expect.objectContaining({
        metricKey: "glucose", biomarkerKey: "biomarker:blood-glucose", value: 90, unit: "mg/dL",
        provenance: expect.objectContaining({ provider: "clinical-document-extraction", rawRefs: [job.rawRef] }),
      })]));
      expect(digest(await readFile(path.join(vaultRoot, job.rawRef)))).toBe(job.sha256);

      expect(await runOneHostedClinicalEnrichment(runnerInput)).toBe("settled");
      expect(await runOneHostedClinicalEnrichment(runnerInput)).toBe("idle");
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "complete", counts: { created: 1, documents: 1, pages: 1 } });
      await makeHostedClinicalEnrichmentWakeDue({ vaultRoot, jobId: job.jobId });
      expect(await prepareHostedSystemMailboxItemForCheckpoint(selection)).toMatchObject({ status: "processed" });
      expect((await readHostedSystemMailboxState(vaultRoot)).pending).toEqual([]);
      expect(executeExtraction).toHaveBeenCalledTimes(3);
      expect(await listCanonicalEntities(vaultRoot, { family: "event", kinds: ["test"], limit: 10 })).toHaveLength(1);
    } finally {
      await workspace.cleanup();
    }
  });
});
