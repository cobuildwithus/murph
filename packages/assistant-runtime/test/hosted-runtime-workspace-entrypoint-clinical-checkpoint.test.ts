import { setImmediate } from "node:timers/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { listMetricPoints } from "@murphai/query";
import { readClinicalEnrichmentStatus } from "@murphai/vault-usecases/clinical-enrichment";
import { expect, test, vi } from "vitest";
import * as clinicalEnrichment from "../src/hosted-runtime/clinical-enrichment.ts";
import type { HostedRuntimeUsageRecordPort } from "../src/hosted-runtime/platform.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime.ts";
import { importClinicalEnrichmentSource } from "./clinical-enrichment-source.fixture.ts";
import {
  createWorkspaceRunRequest,
  TEST_NOW, TEST_USER_ID, createDeferred, createMailboxItem, createMailboxPort, createPlatform,
  createSnapshotFixtureRef, createVaultSnapshotBundle, createWorkspacePort, createWorkspaceRuntimeJobInput,
  createWorkspaceState, removeTempRoot, runHostedWorkspaceRuntimeJobInProcess,
  withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

test("drains checkpoint-ready effects before restarting an unfinished clinical page", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-checkpoint-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const extractionStarted = createDeferred<void>();
  const successorAt = new Date(Date.now() + 600_000).toISOString();
  const actualRunOne = clinicalEnrichment.runOneHostedClinicalEnrichment;
  let queueReads = 0;
  const readNextClinicalEnrichment = vi.fn(async () => {
    queueReads += 1;
    events.push("queue:read");
    // The restarted reader finds an empty queue, so one snapshot ends the run.
    return queueReads > 1 ? null : {
      status: "extract" as const, jobId: "a".repeat(64), page: 2, timeZone: "UTC", failures: 0,
      source: { rawRef: "raw/clinical-records/synthetic/source.pdf", sha256: "b".repeat(64), mediaType: "application/pdf" },
      documentPath: "/synthetic-vault/raw/clinical-records/synthetic/source.pdf",
    };
  });
  const runOne = vi.spyOn(clinicalEnrichment, "runOneHostedClinicalEnrichment")
    .mockImplementation((input) => actualRunOne({
      ...input,
      state: {
        readNextClinicalEnrichment,
        persistClinicalEnrichmentProposals: vi.fn(),
        blockClinicalEnrichment: vi.fn(),
        deferClinicalEnrichment: vi.fn(),
      },
      async prepareDocument({ signal }) {
        if (!signal) throw new Error("Clinical extraction must carry its owner signal.");
        events.push("extraction:start");
        extractionStarted.resolve();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        events.push("extraction:joined");
        throw signal.reason;
      },
    }));
  const durableEffect = vi.fn(async () => { events.push("durable-effect"); });
  let snapshotCount = 0;
  try {
    await initializeVault({ vaultRoot, createdAt: TEST_NOW });
    const mailboxPort = createMailboxPort({ events, items: [] });
    const fetch = mailboxPort.fetch.bind(mailboxPort);
    mailboxPort.fetch = async (request) => {
      // Let a restarted local queue read win the post-checkpoint Web round trip.
      if (snapshotCount > 0) await setImmediate();
      return await fetch(request);
    };
    const result = await withRealTimeout(runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({ request: {
        attemptId: "attempt_synthetic_clinical_checkpoint_effects",
        leaseGeneration: "7",
      } }),
      {
        vaultRoot, runtimeWakeSignal,
        async createCheckpointSnapshot() {
          snapshotCount += 1;
          expect(snapshotCount, events.join(",")).toBe(1);
          return { snapshotRef: createSnapshotFixtureRef({ hash: "c".repeat(64), size: 512 }) };
        },
        async importItem() { return { status: "imported" }; },
        async runAssistantPhase() {
          await extractionStarted.promise;
          return {
            progressed: true, checkpointReason: "assistant_runtime_commit",
            afterCheckpoint: async () => ({
              afterDurableCheckpoint: durableEffect, checkpointReason: "assistant_runtime_commit",
            }),
            nextWakeAt: successorAt, nextWakeReason: "system-mailbox",
          };
        },
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({
            events, checkpointRequests, workspace: createWorkspaceState({ version: "0" }),
            checkpointWorkspace(request) {
              runtimeWakeSignal.notify();
              return createWorkspaceState({
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                snapshotRef: request.snapshotRef,
                nextWakeAt: request.nextWakeAt ?? null,
                nextWakeReason: request.nextWakeReason ?? null,
              });
            },
          }),
        }),
      },
    ), 15_000, () => events.join(","));
    expect(durableEffect).toHaveBeenCalledOnce();
    expect(readNextClinicalEnrichment).toHaveBeenCalledTimes(2);
    expect(events.indexOf("extraction:joined")).toBeLessThan(events.indexOf("durable-effect"));
    // The same invocation restarts the page only after the effect has run.
    expect(events.indexOf("durable-effect")).toBeLessThan(events.lastIndexOf("queue:read"));
    expect(checkpointRequests).toHaveLength(1);
    expect(result).toMatchObject({ status: "scheduled", nextWakeAt: successorAt });
  } finally {
    runOne.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});

test("resumes clinical work when fresh input continues the invocation after a checkpoint", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-continuation-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const mailboxItems: ReturnType<typeof createMailboxItem>[] = [];
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const extractionStarted = createDeferred<void>();
  let extractionActive = false;
  let extractionCount = 0;
  let assistantPass = 0;
  const durableEffect = vi.fn(async () => { events.push("durable-effect"); });
  const runOne = vi.spyOn(clinicalEnrichment, "runOneHostedClinicalEnrichment")
    .mockImplementation(async (input) => {
      extractionCount += 1;
      extractionActive = true;
      if (extractionCount === 1) {
        input.onExtractionStarted?.();
        extractionStarted.resolve();
        await new Promise<void>((resolve) => {
          if (input.abortSignal.aborted) resolve();
          else input.abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
        events.push("extraction:requeued");
      } else {
        events.push("extraction:completed");
      }
      extractionActive = false;
      input.onStateMutation();
      return "idle";
    });
  try {
    await initializeVault({ vaultRoot, createdAt: TEST_NOW });
    await withRealTimeout(runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({ request: {
        attemptId: "attempt_synthetic_clinical_continuation",
        leaseGeneration: "7",
      } }),
      {
        vaultRoot, runtimeWakeSignal,
        async createCheckpointSnapshot() {
          expect(extractionActive).toBe(false);
          events.push("snapshot");
          return { snapshotRef: createSnapshotFixtureRef({ hash: "c".repeat(64), size: 512 }) };
        },
        async importItem() { return { status: "imported" }; },
        async runAssistantPhase() {
          assistantPass += 1;
          if (assistantPass === 1) {
            await extractionStarted.promise;
            return {
              progressed: true, checkpointReason: "assistant_runtime_commit",
              afterCheckpoint: async () => ({
                afterDurableCheckpoint: durableEffect, checkpointReason: "assistant_runtime_commit",
              }),
            };
          }
          await setImmediate();
          expect(extractionCount, "Continued work must not leave the extractor paused").toBe(2);
          return { progressed: false, nextWakeAt: null, nextWakeReason: null };
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: mailboxItems }),
          workspacePort: createWorkspacePort({
            events, checkpointRequests, workspace: createWorkspaceState({ version: "0" }),
            checkpointWorkspace(request) {
              if (request.expectedWorkspaceVersion === "0") {
                mailboxItems.push(createMailboxItem());
                runtimeWakeSignal.notify();
              }
              return createWorkspaceState({
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                snapshotRef: request.snapshotRef,
                nextWakeAt: request.nextWakeAt ?? null,
                nextWakeReason: request.nextWakeReason ?? null,
              });
            },
          }),
        }),
      },
    ), 15_000, () => events.join(","));
    expect(assistantPass).toBeGreaterThan(1);
    expect(events.indexOf("extraction:requeued")).toBeLessThan(events.indexOf("snapshot"));
    expect(events.indexOf("snapshot")).toBeLessThan(events.indexOf("extraction:completed"));
    expect(durableEffect).toHaveBeenCalledOnce();
  } finally {
    runOne.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});

// Each synthetic page leaves deferred usage like production; a checkpoint
// boundary aborts a page still extracting.
function mockClinicalPages(events: string[], totalPages: number, onPageDone?: (page: number) => void) {
  let completedPages = 0;
  let extracting = false;
  const runOne = vi.spyOn(clinicalEnrichment, "runOneHostedClinicalEnrichment")
    .mockImplementation(async (input) => {
      if (input.abortSignal.aborted || completedPages === totalPages) return "idle";
      const page = completedPages + 1;
      input.onStateMutation();
      input.onExtractionStarted?.();
      extracting = true;
      events.push(`page-${page}:start`);
      const aborted = await new Promise<boolean>((resolve) => {
        input.abortSignal.addEventListener("abort", () => resolve(true), { once: true });
        void setImmediate().then(() => resolve(input.abortSignal.aborted));
      });
      extracting = false;
      if (aborted) {
        events.push(`page-${page}:requeued`);
        return "idle";
      }
      completedPages = page;
      events.push(`page-${page}:done`);
      input.deferUsageUntilAfterDurableCheckpoint?.(async () => {
        events.push(`page-${page}:usage`);
      });
      input.onStateMutation();
      onPageDone?.(page);
      return "settled";
    });
  return { runOne, completedPages: () => completedPages, extracting: () => extracting };
}

async function runClinicalPagesInvocation(input: {
  attemptId: string;
  events: string[];
  extracting(): boolean;
  // Foreground passes wait for this, so the invocation cannot finish first.
  foregroundHeldUntil?: Promise<void>;
  // The held foreground pass then commits a reply whose effect follows its checkpoint.
  replyEffect?: () => Promise<void>;
  shutdownSignal?: AbortSignal;
  // Restores this vault instead of bootstrapping an empty one.
  snapshot?: Awaited<ReturnType<typeof createVaultSnapshotBundle>>;
  usageRecordPort?: HostedRuntimeUsageRecordPort;
  vaultRoot: string;
}) {
  return await withRealTimeout(runHostedWorkspaceRuntimeJobInProcess(
    createWorkspaceRuntimeJobInput({ request: { attemptId: input.attemptId, leaseGeneration: "7" } }),
    {
      vaultRoot: input.vaultRoot,
      runtimeWakeSignal: createCoalescingRuntimeWakeSignal(),
      ...(input.shutdownSignal ? { shutdownSignal: input.shutdownSignal } : {}),
      async createCheckpointSnapshot() {
        expect(input.extracting(), input.events.join(",")).toBe(false);
        input.events.push("snapshot");
        return { snapshotRef: createSnapshotFixtureRef({ hash: "c".repeat(64), size: 512 }) };
      },
      async importItem() { return { status: "imported" }; },
      async runAssistantPhase() {
        await input.foregroundHeldUntil;
        const replyEffect = input.replyEffect;
        if (!replyEffect) return { progressed: false, nextWakeAt: null, nextWakeReason: null };
        input.replyEffect = undefined;
        return { progressed: true, checkpointReason: "assistant_runtime_commit" as const,
          afterCheckpoint: async () => ({ afterDurableCheckpoint: replyEffect, checkpointReason: "assistant_runtime_commit" as const }) };
      },
      platform: {
        ...createPlatform({
          artifactBytesByHash: new Map(input.snapshot ? [[input.snapshot.hash, input.snapshot.bytes]] : []),
          mailboxPort: createMailboxPort({ events: input.events, items: [] }),
          workspacePort: createWorkspacePort({
            events: input.events, checkpointRequests: [],
            workspace: createWorkspaceState({ version: "0", snapshotRef: input.snapshot?.snapshotRef ?? null }),
            checkpointWorkspace(request) {
              return createWorkspaceState({
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                snapshotRef: request.snapshotRef,
                nextWakeAt: request.nextWakeAt ?? null,
                nextWakeReason: request.nextWakeReason ?? null,
              });
            },
          }),
        }),
        ...(input.usageRecordPort ? { usageRecordPort: input.usageRecordPort } : {}),
      },
    },
  ), 15_000, () => input.events.join(","));
}

const pageProgress = (events: readonly string[]) =>
  events.filter((event) => event === "snapshot" || /^page-\d+:(done|usage)$/u.test(event));

test("batches later clinical pages into one checkpoint in one invocation", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-pages-"));
  const events: string[] = [];
  const pages = mockClinicalPages(events, 3);
  try {
    await initializeVault({ vaultRoot, createdAt: TEST_NOW });
    await runClinicalPagesInvocation({
      attemptId: "attempt_synthetic_clinical_pages", events, extracting: pages.extracting, vaultRoot,
    });
    expect(pages.completedPages(), events.join(",")).toBe(3);
    // Finished pages share one snapshot; usage stays behind it.
    expect(pageProgress(events)).toEqual([
      "page-1:done", "page-2:done", "page-3:done",
      "snapshot", "page-1:usage", "page-2:usage", "page-3:usage",
    ]);
    // No page pays for a provider call that a checkpoint aborts.
    expect(events.filter((event) => event.endsWith(":requeued")), events.join(",")).toEqual([]);
  } finally {
    pages.runOne.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});

test("delivers a reply's durable effect before the window's batched page accounting", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-pages-reply-"));
  const events: string[] = [];
  const pagesDone = createDeferred<void>();
  const pages = mockClinicalPages(events, 3, (page) => { if (page === 3) pagesDone.resolve(); });
  try {
    await initializeVault({ vaultRoot, createdAt: TEST_NOW });
    await runClinicalPagesInvocation({
      attemptId: "attempt_synthetic_clinical_pages_reply", events, extracting: pages.extracting, vaultRoot,
      foregroundHeldUntil: pagesDone.promise,
      replyEffect: async () => { events.push("reply-effect"); },
    });
    expect(pages.completedPages(), events.join(",")).toBe(3);
    const reply = events.indexOf("reply-effect");
    expect(reply, events.join(",")).toBeGreaterThan(events.indexOf("snapshot"));
    for (const page of [1, 2, 3]) {
      expect(reply, events.join(",")).toBeLessThan(events.indexOf(`page-${page}:usage`));
    }
  } finally {
    pages.runOne.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});

test("leaves later clinical pages to the durable successor once shutdown starts", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-pages-shutdown-"));
  const events: string[] = [];
  const shutdown = new AbortController();
  const pages = mockClinicalPages(events, 4, (page) => {
    if (page === 2) shutdown.abort(new DOMException("Synthetic container SIGTERM.", "AbortError"));
  });
  try {
    await initializeVault({ vaultRoot, createdAt: TEST_NOW });
    await runClinicalPagesInvocation({
      attemptId: "attempt_synthetic_clinical_pages_shutdown", events, extracting: pages.extracting,
      shutdownSignal: shutdown.signal, vaultRoot,
    });
    expect(pages.completedPages(), events.join(",")).toBe(2);
    expect(pageProgress(events)).toEqual([
      "page-1:done", "page-2:done", "snapshot", "page-1:usage", "page-2:usage",
    ]);
  } finally {
    pages.runOne.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});

test("batches real clinical page applies into the job's checkpoints", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-real-pages-"));
  const events: string[] = [];
  const glucose = [91, 92, 93];
  const collectedAt = (page: number) => `2026-04-0${page}T12:00:00.000Z`;
  const extractionStarted = createDeferred<void>();
  let extracting = 0;
  // Only the provider is synthetic. Rendering, proposals, mailbox apply and vault state are real.
  const executeExtraction = vi.fn<NonNullable<clinicalEnrichment.HostedClinicalEnrichmentInput["executeExtraction"]>>(async (request) => {
    await request.beforeProviderEntry?.();
    const page = request.textWindow?.index ?? 1;
    extractionStarted.resolve();
    extracting += 1;
    await setImmediate().finally(() => { extracting -= 1; });
    if (request.abortSignal?.aborted) {
      events.push(`page-${page}:requeued`);
      throw request.abortSignal.reason;
    }
    request.onProviderUsage?.({ stage: "answer", usage: {
      occurredAt: TEST_NOW, provider: "codex-cli", providerRequestOrdinal: page, providerRequestOutcome: "succeeded",
      usage: {
        apiKeyEnv: null, baseUrl: null, cacheWriteTokens: null, cachedInputTokens: null, inputTokens: 10, outputTokens: 2,
        providerMetadataJson: null, providerName: "OpenAI", providerRequestId: null, rawUsageJson: null, reasoningTokens: null,
        requestedModel: "gpt-synthetic", servedModel: "gpt-synthetic", tokenPricingBasis: "standard", totalTokens: 12,
        turnProfileJson: null, usageExtractionSourcePath: "test.clinical-pages", usageExtractionVersion: "test-v1",
      },
    } });
    events.push(`page-${page}:done`);
    return { status: "complete", records: [{
      dateBasis: "document", dateEvidence: `Collected ${collectedAt(page)}`, page, payload: {
        kind: "test", occurredAt: collectedAt(page), title: `Synthetic glucose ${page}`, note: null, testName: "Glucose",
        specimenType: "serum", resultStatus: "normal", results: [{ analyte: "Glucose", value: glucose[page - 1]!, unit: "mg/dL" }],
      },
    }] };
  });
  const actualRunOne = clinicalEnrichment.runOneHostedClinicalEnrichment;
  const runOne = vi.spyOn(clinicalEnrichment, "runOneHostedClinicalEnrichment")
    .mockImplementation((input) => actualRunOne({ ...input, executeExtraction }));
  try {
    await initializeVault({ vaultRoot, timezone: "UTC", createdAt: TEST_NOW });
    // Text windows are 12,000 characters at an 11,000 character stride: three pages.
    const text = glucose.map((value, index) =>
      `Synthetic page ${index + 1}. Collected ${collectedAt(index + 1)}. Serum glucose ${value} mg/dL.`.padEnd(11_000, ".")).join("");
    // Like production query-slices-v2 imports, the wake carries no change run.
    const job = await importClinicalEnrichmentSource(vaultRoot, undefined, { bytes: Buffer.from(text), mediaType: "text/plain" });
    await runClinicalPagesInvocation({
      attemptId: "attempt_synthetic_clinical_real_pages", events, extracting: () => extracting > 0, vaultRoot,
      // The startup page must own the invocation before an idle foreground pass can release it.
      foregroundHeldUntil: extractionStarted.promise,
      snapshot: await createVaultSnapshotBundle({ vaultRoot }),
      usageRecordPort: { async recordUsage(record) {
        events.push(`page-${record.providerRequestOrdinal}:usage`);
        return { recorded: true, usageId: record.usageId, platformAiUsageAllowedAfter: true };
      } },
    });
    expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId }), events.join(","))
      .toMatchObject({ status: "complete", counts: { created: 3, held: 0, pages: 3 } });
    const points = await listMetricPoints(vaultRoot, { limit: 10 });
    expect(points.map((point) => point.value)).toEqual(expect.arrayContaining(glucose));
    expect(points).toHaveLength(glucose.length);
    expect(executeExtraction.mock.calls.map(([request]) => `${request.textWindow?.index}:${request.family}`))
      .toEqual(["1:all", "2:all", "3:all"]);
    expect(events.filter((event) => event.endsWith(":requeued")), events.join(",")).toEqual([]);
    // Every apply, the job's last included, leaves only usage and receipts, so
    // the pages share one snapshot and usage follows it.
    expect(pageProgress(events)).toEqual([
      "page-1:done", "page-2:done", "page-3:done",
      "snapshot", "page-1:usage", "page-2:usage", "page-3:usage",
    ]);
  } finally {
    runOne.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});

test("batches several one-page clinical jobs into the window's checkpoints", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-real-jobs-"));
  const events: string[] = [];
  const glucose = [94, 95, 96];
  const collectedAt = (document: number) => `2026-05-0${document}T12:00:00.000Z`;
  const empty: ClinicalDocumentExtractionOutput = { status: "complete", records: [] };
  const extractionStarted = createDeferred<void>();
  let extracting = 0;
  // Only the provider is synthetic. Each document is its own import batch, so its own job.
  const executeExtraction = vi.fn<NonNullable<clinicalEnrichment.HostedClinicalEnrichmentInput["executeExtraction"]>>(async (request) => {
    await request.beforeProviderEntry?.();
    const document = Number(/Synthetic document (\d)/u.exec(request.extractedText ?? "")?.[1]);
    extractionStarted.resolve();
    extracting += 1;
    await setImmediate().finally(() => { extracting -= 1; });
    if (request.abortSignal?.aborted) {
      events.push(`page-${document}:requeued`);
      throw request.abortSignal.reason;
    }
    if (request.family !== "labs") return empty;
    request.onProviderUsage?.({ stage: "answer", usage: {
      occurredAt: TEST_NOW, provider: "codex-cli", providerRequestOrdinal: document, providerRequestOutcome: "succeeded",
      usage: {
        apiKeyEnv: null, baseUrl: null, cacheWriteTokens: null, cachedInputTokens: null, inputTokens: 10, outputTokens: 2,
        providerMetadataJson: null, providerName: "OpenAI", providerRequestId: null, rawUsageJson: null, reasoningTokens: null,
        requestedModel: "gpt-synthetic", servedModel: "gpt-synthetic", tokenPricingBasis: "standard", totalTokens: 12,
        turnProfileJson: null, usageExtractionSourcePath: "test.clinical-jobs", usageExtractionVersion: "test-v1",
      },
    } });
    events.push(`page-${document}:done`);
    return { status: "complete", records: [{
      dateBasis: "document", dateEvidence: `Collected ${collectedAt(document)}`, payload: {
        kind: "test", occurredAt: collectedAt(document), title: `Synthetic glucose ${document}`, note: null, testName: "Glucose",
        specimenType: "serum", resultStatus: "normal", results: [{ analyte: "Glucose", value: glucose[document - 1]!, unit: "mg/dL" }],
      },
    }] };
  });
  const actualRunOne = clinicalEnrichment.runOneHostedClinicalEnrichment;
  const runOne = vi.spyOn(clinicalEnrichment, "runOneHostedClinicalEnrichment")
    .mockImplementation((input) => actualRunOne({ ...input, executeExtraction }));
  try {
    await initializeVault({ vaultRoot, timezone: "UTC", createdAt: TEST_NOW });
    const jobs = [];
    for (const [index, value] of glucose.entries()) {
      const document = index + 1;
      const text = `Synthetic document ${document}. Collected ${collectedAt(document)}. Serum glucose ${value} mg/dL.`;
      // Like production query-slices-v2 imports, the wake carries no change run.
      jobs.push(await importClinicalEnrichmentSource(vaultRoot, {
        resourceType: "DocumentReference", status: "current", resourceId: `synthetic-lab-document-${document}`,
        revision: `2026-05-0${document}T13:00:00.000Z`,
      }, { bytes: Buffer.from(text), mediaType: "text/plain" }));
    }
    await runClinicalPagesInvocation({
      attemptId: "attempt_synthetic_clinical_real_jobs", events, extracting: () => extracting > 0, vaultRoot,
      foregroundHeldUntil: extractionStarted.promise,
      snapshot: await createVaultSnapshotBundle({ vaultRoot }),
      usageRecordPort: { async recordUsage(record) {
        events.push(`page-${record.providerRequestOrdinal}:usage`);
        return { recorded: true, usageId: record.usageId, platformAiUsageAllowedAfter: true };
      } },
    });
    for (const job of jobs) {
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId }), events.join(","))
        .toMatchObject({ status: "complete", counts: { created: 1, held: 0, pages: 1 } });
    }
    const points = await listMetricPoints(vaultRoot, { limit: 10 });
    expect(points.map((point) => point.value).sort()).toEqual(glucose);
    expect(events.filter((event) => event.endsWith(":requeued")), events.join(",")).toEqual([]);
    // Each job end leaves only usage and receipts: its pointer leaves with the
    // final apply. Main took three snapshots per one-page job here.
    expect(pageProgress(events)).toEqual([
      "page-1:done", "snapshot", "page-1:usage",
      "page-2:done", "snapshot", "page-2:usage",
      "page-3:done", "snapshot", "page-3:usage", "snapshot",
    ]);
  } finally {
    runOne.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});
