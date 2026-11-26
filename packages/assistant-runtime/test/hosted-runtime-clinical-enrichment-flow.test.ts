import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ClinicalDocumentExtractionOutput } from "@murphai/clinical-records";
import { initializeVault } from "@murphai/core";
import { listCanonicalEntities, listMetricPoints } from "@murphai/query";
import { minimizeClinicalDocumentImages } from "@murphai/vault-usecases/clinical-records";
import { applyClinicalEnrichmentProposals, persistClinicalEnrichmentProposals, planClinicalExtractionUnits, readClinicalEnrichmentStatus, readNextClinicalEnrichment, saveClinicalExtraction } from "@murphai/vault-usecases/clinical-enrichment";
import { describe, expect, it, vi } from "vitest";

import { countClinicalEnrichmentDocumentPages, prepareClinicalEnrichmentDocument } from "../src/hosted-runtime/clinical-enrichment-document.ts";
import type { HostedClinicalEnrichmentInput } from "../src/hosted-runtime/clinical-enrichment.ts";
import { makeHostedClinicalEnrichmentWakeDue } from "../src/hosted-runtime/clinical-enrichment-wake.ts";
import { executeHostedClinicalEnrichmentWake } from "../src/hosted-runtime/events/clinical-enrichment.ts";
import { readHostedSystemMailboxState, updateHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import { prepareHostedSystemMailboxItemForCheckpoint, type HostedSystemMailboxRuntime } from "../src/hosted-runtime/system-mailbox.ts";
import { importClinicalEnrichmentSource, OCCURRED_AT, runCursorClinicalEnrichment, SOURCE_TEXT } from "./clinical-enrichment-source.fixture.ts";
import { createHostedRuntimeResolvedConfig, createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

// Bootstrap/environment loading is unrelated to this deterministic data path.
// The real mailbox dispatcher, enrichment handler, renderer and vault owners run.
vi.mock("../src/hosted-runtime/context.ts", () => ({
  prepareHostedWakeContext: async () => null,
  hydrateHostedExecutionDefaultTarget: async (context: unknown) => context,
  applyHostedMemberPreferences: vi.fn(),
}));

const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
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

describe("clinical enrichment import-to-query flow", () => {
  it.each([false, true])("waits for source publication during image repair (previous repair: %s)", async (previousRepair) => {
    const workspace = await createHostedRuntimeWorkspace("clinical-enrichment-repair-");
    const { vaultRoot } = workspace;
    const firstImage = Buffer.alloc(3000, 1);
    const secondImage = Buffer.alloc(3000, 2);
    let release!: () => void;
    const published = new Promise<void>((resolve) => { release = resolve; });
    let repair: Promise<unknown> | undefined;
    let preparation: ReturnType<typeof prepareClinicalEnrichmentDocument> | undefined;
    let renameSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      await initializeVault({ vaultRoot, timezone: "UTC", createdAt: OCCURRED_AT });
      const html = `<p>${SOURCE_TEXT}</p><img src="data:image/png;base64,${firstImage.toString("base64")}"><img src="data:image/png;base64,${secondImage.toString("base64")}">`;
      const job = await importClinicalEnrichmentSource(vaultRoot, { resourceType: "DocumentReference", status: "current" }, { bytes: Buffer.from(html), mediaType: "text/html" });
      const repairInput = { vaultRoot, manifestPath: job.manifestPath, manifestSha256: job.manifestSha256, attachmentRelativePath: path.posix.relative(path.posix.dirname(job.manifestPath), job.rawRef) };
      if (previousRepair) await minimizeClinicalDocumentImages({ ...repairInput, reviewedImageSha256s: [digest(firstImage)] });
      const work = await readNextClinicalEnrichment({ vaultRoot });
      if (work?.status !== "extract") throw new Error("Expected queued extraction work.");
      let quarantined = false;
      const originalRename = fs.rename.bind(fs);
      renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        await originalRename(from, to);
        if (String(from) === work.documentPath) {
          quarantined = true;
          await published;
        }
      });
      repair = minimizeClinicalDocumentImages({ ...repairInput, reviewedImageSha256s: [digest(previousRepair ? secondImage : firstImage)] });
      void repair.catch(() => {});
      await vi.waitFor(() => expect(quarantined).toBe(true));
      await expect(fs.stat(work.documentPath)).rejects.toMatchObject({ code: "ENOENT" });
      let settled = false;
      preparation = prepareClinicalEnrichmentDocument({ vaultRoot, documentPath: work.documentPath, mediaType: work.source.mediaType, page: work.page });
      void preparation.then(() => { settled = true; }, () => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(settled).toBe(false);
      release();
      await repair;
      const prepared = await preparation;
      expect(prepared.extractedText).toBe(SOURCE_TEXT);
      await prepared.cleanup();
      renameSpy.mockRestore();
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "pending", counts: { held: 0 } });
      const retainedDigest = digest(await readFile(work.documentPath));
      const executeExtraction = vi.fn<NonNullable<HostedClinicalEnrichmentInput["executeExtraction"]>>(async (request) => {
        expect(request.source.sha256).toBe(retainedDigest);
        expect(request.extractedText).toBe(SOURCE_TEXT);
        return { status: "complete", records: [{ dateBasis: "document", dateEvidence: "Collected 2020-03-12T12:00:00Z", payload: {
          kind: "test", occurredAt: OCCURRED_AT, title: "Synthetic glucose", note: null, testName: "Glucose", specimenType: "serum", resultStatus: "normal",
          results: [{ analyte: "Glucose", value: 90, unit: "mg/dL" }],
        } }] };
      });
      const input: HostedClinicalEnrichmentInput = { codexHome: null, env: {}, vaultRoot,
        memberId: "synthetic-member", resolveRuntimeAuthority: async () => "current", onStateMutation() {}, executeExtraction };
      expect(await runCursorClinicalEnrichment(input)).toBe("settled");
      // Retained image tags still leave visual coverage unresolved; supported text survives.
      expect(await applyClinicalEnrichmentProposals({ vaultRoot, jobId: job.jobId })).toMatchObject({ counts: { created: 1, held: 1 } });
      expect((await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).holdReasons)
        .toContain("history: Embedded document media has not been visually reviewed.");
    } finally {
      release();
      await Promise.allSettled([repair, preparation]);
      renameSpy?.mockRestore();
      await workspace.cleanup();
    }
  });

  it("drains a job's cached pages in order in one wake and keeps an interrupted drain due", async () => {
    const workspace = await createHostedRuntimeWorkspace("clinical-enrichment-drain-");
    const { vaultRoot } = workspace;
    try {
      await initializeVault({ vaultRoot, timezone: "UTC", createdAt: OCCURRED_AT });
      const at = (page: number) => `2020-03-1${page}T12:00:00Z`;
      const text = [1, 2, 3].map((page) => `Synthetic page ${page}. Collected ${at(page)}. Serum glucose ${90 + page} mg/dL.`.padEnd(11_000, ".")).join("");
      const job = await importClinicalEnrichmentSource(vaultRoot, undefined, { bytes: Buffer.from(text), mediaType: "text/plain" });
      const units = await planClinicalExtractionUnits({ vaultRoot, limit: 10,
        countPages: (document) => countClinicalEnrichmentDocumentPages({ vaultRoot, ...document }) });
      expect(units.map((unit) => unit.page)).toEqual([1, 2, 3]);
      for (const unit of units) {
        await saveClinicalExtraction({ vaultRoot, unit, totalPages: 3, outputs: { labs: { status: "complete", records: [{
          dateBasis: "document", dateEvidence: `Collected ${at(unit.page)}`, payload: { kind: "test", occurredAt: at(unit.page), title: `Synthetic glucose ${unit.page}`,
            note: null, testName: "Glucose", specimenType: "serum", resultStatus: "normal", results: [{ analyte: "Glucose", value: 90 + unit.page, unit: "mg/dL" }] } }] },
        measurements: empty, history: empty } });
      }
      const wake = (await readHostedSystemMailboxState(vaultRoot)).pending[0]!.wake;
      if (wake.kind !== "clinical-records.enrichment-requested") throw new Error("Expected the clinical wake.");
      // A cooperative yield after the first page stops the drain but leaves the wake due now.
      let steps = 0;
      const interrupted = await executeHostedClinicalEnrichmentWake({ wake, vaultRoot, shouldYield: () => steps++ > 0 });
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).toMatchObject({ counts: { pages: 1 } });
      expect(Date.parse(interrupted.nextWakeAt ?? "")).toBeLessThanOrEqual(Date.now());
      // The next wake applies the remaining cached pages back to back and finishes the job.
      await executeHostedClinicalEnrichmentWake({ wake, vaultRoot });
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "complete", counts: { pages: 3, created: 3 } });
      expect((await listMetricPoints(vaultRoot, { limit: 10 })).map((point) => point.value).sort()).toEqual([91, 92, 93]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("applies prepared work when mailbox order differs from the extraction queue", async () => {
    const workspace = await createHostedRuntimeWorkspace("clinical-enrichment-queue-order-");
    const { vaultRoot } = workspace;
    try {
      await initializeVault({ vaultRoot, timezone: "UTC", createdAt: OCCURRED_AT });
      const prepared = await importClinicalEnrichmentSource(vaultRoot, {
        resourceType: "DocumentReference", status: "current", revision: "2020-03-12T12:00:00.000Z",
      });
      // Distinct bytes: an identical document would reuse the ready job's extraction.
      const waiting = await importClinicalEnrichmentSource(vaultRoot, {
        resourceType: "DiagnosticReport", status: "final", revision: "2020-03-13T12:00:00.000Z",
      }, { bytes: Buffer.from(`${SOURCE_TEXT} Second report.`), mediaType: "text/plain" });
      // The queues have independent durable order: application can encounter
      // an unextracted job before the extractor's prepared head.
      await updateHostedSystemMailboxState(vaultRoot, state => ({ pending: [...state.pending].reverse() }));
      expect(await readNextClinicalEnrichment({ vaultRoot })).toMatchObject({ status: "extract", jobId: prepared.jobId });
      await persistClinicalEnrichmentProposals({
        vaultRoot, jobId: prepared.jobId, sourceSha256: prepared.sha256, page: 1, totalPages: 1,
        outputs: { measurements: empty, history: empty, labs: { status: "complete", records: [{ dateBasis: "document", dateEvidence: "Collected 2020-03-12T12:00:00Z", payload: {
          kind: "test", occurredAt: OCCURRED_AT, title: "Synthetic serum glucose", note: null,
          testName: "Glucose", specimenType: "serum", resultStatus: "normal",
          results: [{ analyte: "Glucose", value: 90, unit: "mg/dL" }],
        } }] } },
      });
      expect(await readNextClinicalEnrichment({ vaultRoot })).toEqual({ status: "apply", jobId: prepared.jobId });
      const attempt = () => prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-clinical-enrichment"], vaultRoot,
        runtime: runtime(), runtimeEnv: {}, retainProcessedItemUntilRecorded: true,
      });
      expect(await attempt()).toMatchObject({ status: "preempted", item: { wake: { jobId: waiting.jobId } } });
      const waitingItem = (await readHostedSystemMailboxState(vaultRoot)).pending[0];
      // The waiting head has a retry delay. The ready job must still apply now.
      expect(await attempt()).toMatchObject({ item: { wake: { jobId: prepared.jobId } } });
      expect((await readHostedSystemMailboxState(vaultRoot)).pending[0]).toEqual(waitingItem);
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: prepared.jobId }))
        .toMatchObject({ counts: { created: 1, pages: 1 } });
      expect((await listMetricPoints(vaultRoot, { limit: 10 })).map(point => point.value)).toEqual([90]);
      // The same drain finished the prepared job; the waiting job is next.
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: prepared.jobId })).toMatchObject({ status: "complete" });
      expect(await readNextClinicalEnrichment({ vaultRoot })).toMatchObject({ status: "extract", jobId: waiting.jobId });
    } finally { await workspace.cleanup(); }
  });

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
      const job = await importClinicalEnrichmentSource(vaultRoot, parent);
      const executeExtraction = vi.fn<NonNullable<HostedClinicalEnrichmentInput["executeExtraction"]>>(async (request) => {
        await request.beforeProviderEntry?.();
        expect(request.source.rawRef).toBe(job.rawRef);
        expect(request.extractedText).toBe(SOURCE_TEXT);
        return {
          status: "complete", records: [{ dateBasis: "document", dateEvidence: "Collected 2020-03-12T12:00:00Z", page: 1, payload: {
            kind: "test", occurredAt: OCCURRED_AT, title: "Synthetic serum glucose", note: null,
            testName: "Glucose", specimenType: "serum", resultStatus: "normal",
            results: [{ analyte: "Glucose", value: 90, unit: "mg/dL" }],
          } }],
        };
      });
      const input: HostedClinicalEnrichmentInput = {
        codexHome: null, env: {}, vaultRoot,
        memberId: "synthetic-member", resolveRuntimeAuthority: async () => "current",
        onStateMutation() {}, async onWorkUpdated() {}, executeExtraction,
      };
      expect(await runCursorClinicalEnrichment(input)).toBe("settled");
      expect(executeExtraction).toHaveBeenCalledOnce();
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "prepared" });
      expect(await applyClinicalEnrichmentProposals({ vaultRoot, jobId: job.jobId })).toMatchObject({ counts: { created: 1 }, readback: { verifiedCount: 1 } });
      const tests = await listCanonicalEntities(vaultRoot, { family: "event", kinds: ["test"], limit: 10 });
      expect(tests).toHaveLength(1);
      expect(tests[0]?.attributes).toMatchObject({
        externalRef: { ...job.parentExternalRef, version: parent.revision, facet: expect.stringMatching(/^document-extraction-/u) },
        rawRefs: [job.rawRef], evidence: [{ rawRef: job.rawRef }],
      });
      expect(tests[0]?.attributes.evidence).toEqual([expect.not.objectContaining({ page: expect.anything() })]);
      expect((await listMetricPoints(vaultRoot, { limit: 10 })).map((point) => point.value)).toEqual([90]);
      expect(await runCursorClinicalEnrichment(input)).toBe("settled");
      expect(await runCursorClinicalEnrichment(input)).toBe("idle");
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "complete", counts: { created: 1, documents: 1, pages: 1 } });
      expect(executeExtraction).toHaveBeenCalledOnce();
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
      const old = await importClinicalEnrichmentSource(vaultRoot, { resourceType, status: activeStatus, revision: oldRevision, omitClinicalDate });
      const prepare = async (job: Awaited<ReturnType<typeof importClinicalEnrichmentSource>>) => {
        expect(await readNextClinicalEnrichment({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "extract" });
        await persistClinicalEnrichmentProposals({ vaultRoot, jobId: job.jobId, sourceSha256: job.sha256, page: 1, totalPages: 1,
          outputs: { measurements: empty, history: empty, labs: { status: "complete", records: [{ dateBasis: "document", dateEvidence: "Collected 2020-03-12T12:00:00Z", payload: {
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
      await importClinicalEnrichmentSource(vaultRoot, { resourceType, status: nextStatus, revision: nextRevision, omitClinicalDate });
      expect(await listMetricPoints(vaultRoot, { limit: 10 })).toEqual([]);
      if (!applyBeforeWithdrawal) {
        expect((await applyClinicalEnrichmentProposals({ vaultRoot, jobId: old.jobId })).counts).toMatchObject({ created: 0, held: 1 });
        await readNextClinicalEnrichment({ vaultRoot, jobId: old.jobId });
        expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: old.jobId })).toMatchObject({ status: "blocked" });
      }
      const restored = await importClinicalEnrichmentSource(vaultRoot, { resourceType, status: activeStatus, revision: restoredRevision, omitClinicalDate });
      // Identical bytes reuse proposals, but the restored parent owns publication.
      expect(await readNextClinicalEnrichment({ vaultRoot, jobId: restored.jobId })).toMatchObject({ status: "apply" });
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
      const job = await importClinicalEnrichmentSource(vaultRoot, parent);
      const executeExtraction = vi.fn<NonNullable<HostedClinicalEnrichmentInput["executeExtraction"]>>(async () => empty);
      const input: HostedClinicalEnrichmentInput = {
        codexHome: null, env: {}, vaultRoot,
        memberId: "synthetic-member", resolveRuntimeAuthority: async () => "current",
        onStateMutation() {}, async onWorkUpdated() {}, executeExtraction,
      };
      await runCursorClinicalEnrichment(input);
      await runCursorClinicalEnrichment(input);
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
      const job = await importClinicalEnrichmentSource(vaultRoot);
      const selection = {
        allowedRouteActions: ["apply-clinical-enrichment"] as const,
        runtime: runtime(), runtimeEnv: {}, vaultRoot,
      };
      expect(await listCanonicalEntities(vaultRoot, { family: "event", kinds: ["test"], limit: 10 })).toEqual([]);
      expect(await prepareHostedSystemMailboxItemForCheckpoint(selection)).toMatchObject({ status: "preempted", item: { status: "pending" } });

      const executeExtraction = vi.fn<NonNullable<HostedClinicalEnrichmentInput["executeExtraction"]>>(async (request) => {
        await request.beforeProviderEntry?.();
        expect(request.source).toEqual({ rawRef: job.rawRef, sha256: job.sha256, mediaType: "text/plain", clinicalOccurredAt: OCCURRED_AT, recordedAt: job.fetchedAt });
        expect(request.extractedText).toBe(SOURCE_TEXT);
        return {
          status: "complete", records: [{ dateBasis: "document", dateEvidence: "Collected 2020-03-12T12:00:00Z", page: 1, excerpt: "Serum glucose 90 mg/dL.", payload: {
            kind: "test", occurredAt: OCCURRED_AT, title: "Synthetic serum glucose", note: null, testName: "Glucose",
            specimenType: "serum", resultStatus: "normal",
            results: [{ analyte: "Glucose", value: 90, unit: "mg/dL", referenceRange: { low: 70, high: 99 } }],
          } }],
        };
      });
      const runnerInput: HostedClinicalEnrichmentInput = {
        codexHome: null, env: {}, vaultRoot,
        memberId: "synthetic-member", resolveRuntimeAuthority: async () => "current",
        onStateMutation() {},
        async onWorkUpdated(jobId) { await makeHostedClinicalEnrichmentWakeDue({ vaultRoot, jobId }); },
        executeExtraction,
      };
      expect(await runCursorClinicalEnrichment(runnerInput)).toBe("settled");
      expect(executeExtraction).toHaveBeenCalledOnce();
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "prepared" });
      expect(await listCanonicalEntities(vaultRoot, { family: "event", kinds: ["test"], limit: 10 })).toEqual([]);

      // A new runner instance after restart finds frozen proposals without another model call.
      expect(await runCursorClinicalEnrichment(runnerInput)).toBe("idle");
      expect(executeExtraction).toHaveBeenCalledOnce();
      const queued = (await readHostedSystemMailboxState(vaultRoot)).pending[0]!;
      if (queued.wake.kind !== "clinical-records.enrichment-requested") throw new Error("Synthetic enrichment wake missing.");
      expect(await executeHostedClinicalEnrichmentWake({ vaultRoot, wake: queued.wake, shouldYield: () => true })).toMatchObject({ backgroundMaintenanceYielded: true });
      expect(await prepareHostedSystemMailboxItemForCheckpoint({ ...selection, shouldYieldBackgroundMaintenance: () => true })).toMatchObject({ status: "preempted" });
      expect(await listCanonicalEntities(vaultRoot, { family: "event", kinds: ["test"], limit: 10 })).toEqual([]);
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "prepared" });

      // The actual mailbox handler performs the separate canonical write once foreground
      // yields, and its cursor drain finishes the one-page job in the same pass.
      expect(await prepareHostedSystemMailboxItemForCheckpoint(selection)).toMatchObject({ status: "processed" });
      // A replay after the private write recovers proof against the original run shard.
      const changeRun = { runId: job.retrievalJobId, generation: 2 };
      expect(await executeHostedClinicalEnrichmentWake({ vaultRoot, wake: { ...queued.wake, changeRun } }))
        .toMatchObject({ postCheckpointRecord: { request: { kind: "change-receipt", ...changeRun } } });
      const tests = await listCanonicalEntities(vaultRoot, { family: "event", kinds: ["test"], limit: 10 });
      expect(tests).toHaveLength(1);
      expect(tests[0]?.attributes).toMatchObject({
        source: "import", rawRefs: [job.rawRef], specimenType: "serum",
        externalRef: { ...job.parentExternalRef, facet: expect.stringMatching(/^document-extraction-/u) },
        evidence: [{ rawRef: job.rawRef, excerpt: "Collected 2020-03-12T12:00:00Z · Serum glucose 90 mg/dL." }],
      });
      const points = await listMetricPoints(vaultRoot, { limit: 10 });
      expect(points).toEqual(expect.arrayContaining([expect.objectContaining({
        metricKey: "glucose", biomarkerKey: "biomarker:blood-glucose", value: 90, unit: "mg/dL",
        provenance: expect.objectContaining({ provider: job.parentExternalRef.system, rawRefs: [job.rawRef] }),
      })]));
      expect(digest(await readFile(path.join(vaultRoot, job.rawRef)))).toBe(job.sha256);

      // The drain already finished the job and removed its pointer with the final apply.
      expect(await runCursorClinicalEnrichment(runnerInput)).toBe("idle");
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId })).toMatchObject({ status: "complete", counts: { created: 1, documents: 1, pages: 1 } });
      expect((await readHostedSystemMailboxState(vaultRoot)).pending).toEqual([]);
      expect(executeExtraction).toHaveBeenCalledOnce();
      expect(await listCanonicalEntities(vaultRoot, { family: "event", kinds: ["test"], limit: 10 })).toHaveLength(1);
    } finally {
      await workspace.cleanup();
    }
  });
});
