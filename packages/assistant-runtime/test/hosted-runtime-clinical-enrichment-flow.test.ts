import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { externalRefForFhir, hashClinicalFhirBaseUrl, hashClinicalFhirPatientId, type ClinicalDocumentExtractionOutput } from "@murphai/clinical-records";
import { initializeVault } from "@murphai/core";
import { listCanonicalEntities, listMetricPoints } from "@murphai/query";
import { importClinicalFhirSnapshot } from "@murphai/vault-usecases/clinical-records";
import { applyClinicalEnrichmentProposals, enqueueClinicalEnrichment, persistClinicalEnrichmentProposals, readClinicalEnrichmentStatus, readNextClinicalEnrichment } from "@murphai/vault-usecases/clinical-enrichment";
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

async function importSource(vaultRoot: string, parent: { resourceType: "DocumentReference" | "DiagnosticReport"; status: string; revision?: string; omitClinicalDate?: boolean } = { resourceType: "DocumentReference", status: "current" }) {
  const now = parent.revision ?? new Date().toISOString();
  const fetchedAt = new Date(now).toISOString();
  const bytes = Buffer.from(SOURCE_TEXT);
  const sha256 = digest(bytes);
  const resource = {
    resourceType: parent.resourceType, id: "synthetic-lab-document", status: parent.status,
    subject: { reference: "Patient/synthetic-patient" }, meta: { lastUpdated: now },
    ...(!parent.omitClinicalDate ? { date: OCCURRED_AT } : {}), type: { text: "Synthetic lab report" },
    ...(parent.resourceType === "DocumentReference"
      ? { content: [{ attachment: { contentType: "text/plain", url: "Binary/synthetic-lab-document" } }] }
      : { code: { text: "Synthetic lab report" }, ...(!parent.omitClinicalDate ? { effectiveDateTime: OCCURRED_AT } : {}), presentedForm: [{ contentType: "text/plain", url: "Binary/synthetic-lab-document" }] }),
  };
  const content = JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: [{ resource }] });
  const imported = await importClinicalFhirSnapshot({
    vaultRoot, connectionId: "synthetic-connection", retrievalJobId: `synthetic-retrieval-${digest(now).slice(0, 12)}`,
    retrievalProtocol: "query-slices-v2", sourceSystem: "epic-fhir", fetchedAt,
    fhirBaseUrlHash: hashClinicalFhirBaseUrl("https://ehr.example.test/fhir"),
    patientIdHash: hashClinicalFhirPatientId("synthetic-patient"),
    requestedScopes: [`patient/${parent.resourceType}.read`], grantedScopes: [`patient/${parent.resourceType}.read`],
    retrievalSlices: [{ queryScopeId: "documentreference", sliceId: "whole", resourceType: parent.resourceType, coverage: "whole-family", queryFingerprint: "a".repeat(64) }],
    completedRetrievalSlices: [{ queryScopeId: "documentreference", sliceId: "whole" }],
    pages: [{ queryScopeId: "documentreference", sliceId: "whole", resourceType: parent.resourceType, content }],
    documentAttachments: [{ parentPageSha256: digest(content), resourceType: parent.resourceType, resourceId: resource.id, attachmentIndex: 0, status: "downloaded", relativePath: `attachments/${sha256}.bin`, sha256, byteLength: bytes.length, mediaType: "text/plain" }],
    attachments: [{ relativePath: `attachments/${sha256}.bin`, contentBase64: bytes.toString("base64") }],
  });
  const job = await enqueueClinicalEnrichment({ vaultRoot, manifestPath: imported.manifestPath, manifestSha256: imported.manifestSha256 });
  await admitHostedClinicalEnrichmentWake({ vaultRoot, jobId: job.jobId, userId: "synthetic-member", occurredAt: fetchedAt });
  const parentExternalRef = externalRefForFhir({ fhirBaseUrlHash: hashClinicalFhirBaseUrl("https://ehr.example.test/fhir"),
    patientIdHash: hashClinicalFhirPatientId("synthetic-patient"), sourceSystem: "epic-fhir",
    resourceType: parent.resourceType, resourceId: resource.id, version: now });
  return { ...job, parentExternalRef, rawRef: path.posix.join(path.posix.dirname(imported.manifestPath), `attachments/${sha256}.bin`), sha256 };
}

describe("clinical enrichment import-to-query flow", () => {
  it.each([
    { resourceType: "DocumentReference" as const, status: "current", revision: "2020-03-12T12:00:00.123456Z" },
    { resourceType: "DocumentReference" as const, status: "current", revision: "2020-03-12T12:00:00.123456789Z" },
    { resourceType: "DiagnosticReport" as const, status: "final", revision: "2020-03-12T12:00:00.123456Z" },
    { resourceType: "DiagnosticReport" as const, status: "final", revision: "2020-03-12T12:00:00.123456789Z" },
  ])("completes $resourceType enrichment preserving exact source revision $revision", async (parent) => {
    const workspace = await createHostedRuntimeWorkspace("clinical-enrichment-precision-");
    const { vaultRoot } = workspace;
    try {
      await initializeVault({ vaultRoot, timezone: "UTC", createdAt: OCCURRED_AT });
      const job = await importSource(vaultRoot, parent);
      const executeExtraction = vi.fn<NonNullable<HostedClinicalEnrichmentInput["executeExtraction"]>>(async (request) => {
        await request.beforeProviderEntry?.();
        expect(request.source.rawRef).toBe(job.rawRef);
        expect(request.extractedText).toBe(SOURCE_TEXT);
        return request.family !== "labs" ? empty : {
          status: "complete", records: [{ page: 1, payload: {
            kind: "test", occurredAt: OCCURRED_AT, title: "Synthetic serum glucose", note: null,
            testName: "Glucose", specimenType: "serum", resultStatus: "normal",
            results: [{ analyte: "Glucose", value: 90, unit: "mg/dL" }],
          } }],
        };
      });
      const input: HostedClinicalEnrichmentInput = {
        abortSignal: new AbortController().signal, codexHome: null, env: {}, vaultRoot,
        memberId: "synthetic-member", resolveProviderAuthority: async () => "current",
        onStateMutation() {}, async onWorkUpdated() {}, executeExtraction,
      };
      expect(await runOneHostedClinicalEnrichment(input)).toBe("settled");
      expect(executeExtraction).toHaveBeenCalledTimes(3);
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "prepared" });
      expect(await applyClinicalEnrichmentProposals({ vaultRoot, jobId: job.jobId })).toMatchObject({ counts: { created: 1 }, readback: { verifiedCount: 1 } });
      const tests = await listCanonicalEntities(vaultRoot, { family: "event", kinds: ["test"], limit: 10 });
      expect(tests).toHaveLength(1);
      expect(tests[0]?.attributes).toMatchObject({
        externalRef: { ...job.parentExternalRef, version: parent.revision, facet: expect.stringMatching(/^document-extraction-/u) },
        rawRefs: [job.rawRef], evidence: [{ rawRef: job.rawRef, page: 1 }],
      });
      expect((await listMetricPoints(vaultRoot, { limit: 10 })).map((point) => point.value)).toEqual([90]);
      expect(await runOneHostedClinicalEnrichment(input)).toBe("settled");
      expect(await runOneHostedClinicalEnrichment(input)).toBe("idle");
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "complete", counts: { created: 1, documents: 1, pages: 1 } });
      expect(executeExtraction).toHaveBeenCalledTimes(3);
    } finally { await workspace.cleanup(); }
  });

  it.each<{
    applyBeforeWithdrawal: boolean;
    nextStatus: string;
    omitClinicalDate?: boolean;
    resourceType?: "DocumentReference" | "DiagnosticReport";
    oldRevision?: string;
    nextRevision?: string;
    restoredRevision?: string;
  }>([
    { applyBeforeWithdrawal: false, nextStatus: "entered-in-error" },
    { applyBeforeWithdrawal: true, nextStatus: "entered-in-error" },
    { applyBeforeWithdrawal: false, nextStatus: "current" },
    { applyBeforeWithdrawal: true, nextStatus: "current" },
    { applyBeforeWithdrawal: true, nextStatus: "current", omitClinicalDate: true },
    ...(["DocumentReference", "DiagnosticReport"] as const).flatMap((resourceType) => [false, true].flatMap((applyBeforeWithdrawal) => [false, true].map((withdrawn) => ({
      resourceType, applyBeforeWithdrawal,
      nextStatus: resourceType === "DocumentReference" ? withdrawn ? "entered-in-error" : "current" : withdrawn ? "cancelled" : "corrected",
      oldRevision: "2020-03-12T12:00:00.123456Z",
      nextRevision: "2020-03-12T12:00:00.123456001Z",
      restoredRevision: "2020-03-12T12:00:00.123456002Z",
    })))),
  ])("retires prior source facts for $nextStatus and prevents stale re-publication (applied=$applyBeforeWithdrawal, revision=$nextRevision)", async ({ applyBeforeWithdrawal, nextStatus, omitClinicalDate, resourceType = "DocumentReference", oldRevision = "2020-03-12T12:00:00.000Z", nextRevision = "2020-03-13T12:00:00.000Z", restoredRevision = "2020-03-14T12:00:00.000Z" }) => {
    const workspace = await createHostedRuntimeWorkspace("clinical-enrichment-revision-");
    const { vaultRoot } = workspace;
    try {
      await initializeVault({ vaultRoot, timezone: "UTC", createdAt: OCCURRED_AT });
      const activeStatus = resourceType === "DocumentReference" ? "current" : "final";
      const old = await importSource(vaultRoot, { resourceType, status: activeStatus, revision: oldRevision, omitClinicalDate });
      const prepare = async (job: Awaited<ReturnType<typeof importSource>>) => {
        expect(await readNextClinicalEnrichment({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "extract" });
        await persistClinicalEnrichmentProposals({ vaultRoot, jobId: job.jobId, sourceSha256: job.sha256, page: 1, totalPages: 1,
          outputs: { measurements: empty, history: empty, labs: { status: "complete", records: [{ payload: {
            kind: "test", occurredAt: OCCURRED_AT, title: "Synthetic serum glucose", note: null,
            testName: "Glucose", specimenType: "serum", resultStatus: "normal", results: [{ analyte: "Glucose", value: 90, unit: "mg/dL" }],
          } }] } },
        });
      };
      await prepare(old);
      if (applyBeforeWithdrawal) {
        await applyClinicalEnrichmentProposals({ vaultRoot, jobId: old.jobId });
        expect((await listMetricPoints(vaultRoot, { limit: 10 })).map((point) => point.value)).toEqual([90]);
      }
      await importSource(vaultRoot, { resourceType, status: nextStatus, revision: nextRevision, omitClinicalDate });
      expect(await listMetricPoints(vaultRoot, { limit: 10 })).toEqual([]);
      if (!applyBeforeWithdrawal) {
        expect((await applyClinicalEnrichmentProposals({ vaultRoot, jobId: old.jobId })).counts).toMatchObject({ created: 0, held: 1 });
        await readNextClinicalEnrichment({ vaultRoot, jobId: old.jobId });
        expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: old.jobId })).toMatchObject({ status: "blocked" });
      }
      const restored = await importSource(vaultRoot, { resourceType, status: activeStatus, revision: restoredRevision, omitClinicalDate });
      await prepare(restored);
      await applyClinicalEnrichmentProposals({ vaultRoot, jobId: restored.jobId });
      expect((await listMetricPoints(vaultRoot, { limit: 10 })).map((point) => point.value)).toEqual([90]);
      expect(digest(await readFile(path.join(vaultRoot, old.rawRef)))).toBe(old.sha256);
    } finally { await workspace.cleanup(); }
  });

  it.each([
    { resourceType: "DocumentReference" as const, status: "entered-in-error" },
    { resourceType: "DiagnosticReport" as const, status: "cancelled" },
  ])("retains withdrawn $resourceType evidence without extracting active facts", async (parent) => {
    const workspace = await createHostedRuntimeWorkspace("clinical-enrichment-withdrawn-");
    const { vaultRoot } = workspace;
    try {
      await initializeVault({ vaultRoot, timezone: "UTC", createdAt: new Date().toISOString() });
      const job = await importSource(vaultRoot, parent);
      const executeExtraction = vi.fn<NonNullable<HostedClinicalEnrichmentInput["executeExtraction"]>>(async () => empty);
      const input: HostedClinicalEnrichmentInput = {
        abortSignal: new AbortController().signal, codexHome: null, env: {}, vaultRoot,
        memberId: "synthetic-member", resolveProviderAuthority: async () => "current",
        onStateMutation() {}, async onWorkUpdated() {}, executeExtraction,
      };
      await runOneHostedClinicalEnrichment(input);
      await runOneHostedClinicalEnrichment(input);
      expect(executeExtraction).not.toHaveBeenCalled();
      expect(await listMetricPoints(vaultRoot, { limit: 10 })).toEqual([]);
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "blocked" });
      expect(digest(await readFile(path.join(vaultRoot, job.rawRef)))).toBe(job.sha256);
    } finally { await workspace.cleanup(); }
  });

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
        externalRef: { ...job.parentExternalRef, facet: expect.stringMatching(/^document-extraction-/u) },
        evidence: [{ rawRef: job.rawRef, page: 1, excerpt: "Serum glucose 90 mg/dL." }],
      });
      const points = await listMetricPoints(vaultRoot, { limit: 10 });
      expect(points).toEqual(expect.arrayContaining([expect.objectContaining({
        metricKey: "glucose", biomarkerKey: "biomarker:blood-glucose", value: 90, unit: "mg/dL",
        provenance: expect.objectContaining({ provider: job.parentExternalRef.system, rawRefs: [job.rawRef] }),
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
