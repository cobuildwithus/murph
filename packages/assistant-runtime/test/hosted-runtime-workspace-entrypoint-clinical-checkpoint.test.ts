import { setImmediate } from "node:timers/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import type { ClinicalDocumentExtractionOutput } from "@murphai/clinical-records";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { listMetricPoints } from "@murphai/query";
import { readClinicalEnrichmentStatus, type ClinicalExtractionUnit } from "@murphai/vault-usecases/clinical-enrichment";
import { OCCURRED_AT } from "./clinical-enrichment-source.fixture.ts";
import { expect, test, vi } from "vitest";
import * as clinicalEnrichment from "../src/hosted-runtime/clinical-enrichment.ts";
import type { HostedRuntimeUsageRecordPort } from "../src/hosted-runtime/platform.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime.ts";
import { importClinicalEnrichmentSource, importClinicalStructuredSources } from "./clinical-enrichment-source.fixture.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import { isHostedClinicalEnrichmentWakeItem } from "../src/hosted-runtime/clinical-enrichment-wake.ts";
import {
  createWorkspaceRunRequest,
  TEST_NOW, TEST_USER_ID, createDeferred, createMailboxItem, createMailboxPort, createPlatform,
  createSnapshotFixtureRef, createVaultSnapshotBundle, createWorkspacePort, createWorkspaceRuntimeJobInput,
  createWorkspaceState, removeTempRoot, runHostedWorkspaceRuntimeJobInProcess,
  withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

const EMPTY: ClinicalDocumentExtractionOutput = { status: "complete", records: [] };
const syntheticUsage = (ordinal: number) => ({ stage: "answer" as const, usage: {
  occurredAt: TEST_NOW, provider: "codex-cli", providerRequestOrdinal: ordinal, providerRequestOutcome: "succeeded" as const,
  usage: {
    apiKeyEnv: null, baseUrl: null, cacheWriteTokens: null, cachedInputTokens: null, inputTokens: 10, outputTokens: 2,
    providerMetadataJson: null, providerName: "OpenAI", providerRequestId: null, rawUsageJson: null, reasoningTokens: null,
    requestedModel: "gpt-synthetic", servedModel: "gpt-synthetic", tokenPricingBasis: "standard" as const, totalTokens: 12,
    turnProfileJson: null, usageExtractionSourcePath: "test.clinical-units", usageExtractionVersion: "test-v1",
  },
} });
const usageRecordPort = (events: string[]): HostedRuntimeUsageRecordPort => ({ async recordUsage(record) {
  events.push(`page-${record.providerRequestOrdinal}:usage`);
  return { recorded: true, usageId: record.usageId, platformAiUsageAllowedAfter: true };
} });

/**
 * Synthetic queue of `total` units: planning, provider work and cache saves are
 * fakes; the runtime, controller, checkpoints and effects are real. `hold`
 * keeps a unit's provider call open until it resolves or is aborted.
 */
function mockClinicalUnits(events: string[], total: number, hold?: (page: number, signal: AbortSignal) => Promise<void>) {
  const saved: number[] = [];
  const signals = new Map<number, AbortSignal>();
  let inFlight = 0;
  let maxInFlight = 0;
  const unit = (page: number): ClinicalExtractionUnit => ({
    key: `synthetic/${page}.json`, jobId: "a".repeat(64), cursor: page === saved.length + 1, cursorRef: `0:0:${page}`,
    locator: { attachmentIndex: 0 }, cacheSha256: "c".repeat(64), page, failures: 0, timeZone: "UTC",
    source: { rawRef: "raw/clinical-records/synthetic/source.pdf", sha256: "b".repeat(64), mediaType: "application/pdf" },
    documentPath: "/synthetic-vault/raw/clinical-records/synthetic/source.pdf",
  });
  const actual = clinicalEnrichment.createHostedClinicalEnrichmentRunner;
  const runner = vi.spyOn(clinicalEnrichment, "createHostedClinicalEnrichmentRunner").mockImplementation((input) => actual({
    ...input,
    async onWorkUpdated() {},
    state: {
      async planClinicalExtractionUnits({ limit, exclude }) {
        return Array.from({ length: total }, (_, index) => unit(index + 1))
          .filter((candidate) => !saved.includes(candidate.page) && !exclude?.(candidate)).slice(0, limit);
      },
      async saveClinicalExtraction({ unit: done }) {
        saved.push(done.page);
        events.push(`page-${done.page}:done`);
        return "saved" as const;
      },
      blockClinicalEnrichment: vi.fn(),
      deferClinicalEnrichment: vi.fn(),
    },
    async prepareDocument({ page, signal }) {
      if (!signal) throw new Error("Clinical extraction must carry its owner signal.");
      signals.set(page, signal);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      events.push(`page-${page}:start`);
      try {
        await (hold ? hold(page, signal) : setImmediate());
      } finally {
        inFlight -= 1;
      }
      signal.throwIfAborted();
      return { totalPages: total, renderedPages: [{ page, path: "/synthetic-scratch/page.png" }], scratchRoots: [], async cleanup() {} };
    },
    async executeExtraction(request) {
      request.onProviderUsage?.(syntheticUsage(request.renderedPages?.[0]?.page ?? 0));
      return EMPTY;
    },
  }));
  return { runner, saved, signals, inFlight: () => inFlight, maxInFlight: () => maxInFlight };
}

const untilAborted = (signal: AbortSignal) => new Promise<void>((resolve) => {
  if (signal.aborted) resolve();
  else signal.addEventListener("abort", () => resolve(), { once: true });
});

async function runClinicalPagesInvocation(input: {
  attemptId: string;
  events: string[];
  onSnapshot?(): void;
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
        input.onSnapshot?.();
        input.events.push("snapshot");
        return { snapshotRef: createSnapshotFixtureRef({ hash: "c".repeat(64), size: 512 }) };
      },
      async importItem() { return { status: "imported" }; },
      async runAssistantPhase() {
        await input.foregroundHeldUntil;
        input.foregroundHeldUntil = undefined;
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

test("keeps a clinical provider call running across a checkpoint while durable effects drain", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-checkpoint-"));
  const events: string[] = [];
  const started = createDeferred<void>();
  const released = createDeferred<void>();
  const units = mockClinicalUnits(events, 1, async (_page, signal) => {
    started.resolve();
    await Promise.race([released.promise, untilAborted(signal)]);
  });
  const abortedAtSnapshot: boolean[] = [];
  const durableEffect = vi.fn(async () => {
    events.push("durable-effect");
    released.resolve();
  });
  try {
    await initializeVault({ vaultRoot, createdAt: TEST_NOW });
    await runClinicalPagesInvocation({
      attemptId: "attempt_synthetic_clinical_checkpoint_effects", events, vaultRoot,
      foregroundHeldUntil: started.promise,
      replyEffect: durableEffect,
      onSnapshot: () => { abortedAtSnapshot.push(units.signals.get(1)?.aborted ?? false); },
      usageRecordPort: usageRecordPort(events),
    });
    expect(durableEffect).toHaveBeenCalledOnce();
    // The checkpoint neither aborted the call nor published its result early.
    expect(abortedAtSnapshot[0], events.join(",")).toBe(false);
    expect(events.indexOf("snapshot")).toBeLessThan(events.indexOf("page-1:done"));
    expect(events.indexOf("durable-effect")).toBeLessThan(events.indexOf("page-1:done"));
    expect(units.saved).toEqual([1]);
    expect(events.lastIndexOf("snapshot")).toBeGreaterThan(events.indexOf("page-1:done"));
  } finally {
    units.runner.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});

test("publishes a held clinical result when fresh input continues the invocation after a checkpoint", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-continuation-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const mailboxItems: ReturnType<typeof createMailboxItem>[] = [];
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const started = createDeferred<void>();
  const released = createDeferred<void>();
  const units = mockClinicalUnits(events, 1, async (_page, signal) => {
    started.resolve();
    await Promise.race([released.promise, untilAborted(signal)]);
  });
  let assistantPass = 0;
  const durableEffect = vi.fn(async () => { events.push("durable-effect"); });
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
          events.push("snapshot");
          return { snapshotRef: createSnapshotFixtureRef({ hash: "c".repeat(64), size: 512 }) };
        },
        async importItem() { return { status: "imported" }; },
        async runAssistantPhase() {
          assistantPass += 1;
          if (assistantPass === 1) {
            await started.promise;
            return {
              progressed: true, checkpointReason: "assistant_runtime_commit",
              afterCheckpoint: async () => ({
                afterDurableCheckpoint: durableEffect, checkpointReason: "assistant_runtime_commit",
              }),
            };
          }
          // Fresh input continues this invocation; the held result must still publish.
          released.resolve();
          await setImmediate();
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
    expect(units.signals.get(1)?.aborted).toBe(false);
    expect(units.saved, events.join(",")).toEqual([1]);
    expect(events.indexOf("snapshot")).toBeLessThan(events.indexOf("page-1:done"));
    expect(durableEffect).toHaveBeenCalledOnce();
  } finally {
    units.runner.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});

test("extracts clinical units concurrently and batches them into one checkpoint", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-pages-"));
  const events: string[] = [];
  const allStarted = createDeferred<void>();
  let starts = 0;
  const units = mockClinicalUnits(events, 3, async () => {
    starts += 1;
    if (starts === 3) allStarted.resolve();
    await allStarted.promise;
  });
  try {
    await initializeVault({ vaultRoot, createdAt: TEST_NOW });
    await runClinicalPagesInvocation({
      attemptId: "attempt_synthetic_clinical_pages", events, vaultRoot,
      foregroundHeldUntil: allStarted.promise, usageRecordPort: usageRecordPort(events),
    });
    expect(units.saved.sort(), events.join(",")).toEqual([1, 2, 3]);
    expect(units.maxInFlight()).toBe(3);
    // Finished units share one snapshot; each call's usage was recorded as it ended.
    const progress = pageProgress(events);
    expect(progress.filter((event) => event === "snapshot")).toHaveLength(1);
    expect(progress.at(-1)).toBe("snapshot");
    for (const page of [1, 2, 3]) expect(events.indexOf(`page-${page}:usage`)).toBeLessThan(events.indexOf(`page-${page}:done`));
  } finally {
    units.runner.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});

test("aborts unfinished clinical units and leaves them to the durable successor once shutdown starts", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-pages-shutdown-"));
  const events: string[] = [];
  const shutdown = new AbortController();
  const units = mockClinicalUnits(events, 4, async (page, signal) => {
    if (page <= 2) return;
    // Later units are still extracting when the container is told to stop.
    while (units.saved.length < 2) await setImmediate();
    shutdown.abort(new DOMException("Synthetic container SIGTERM.", "AbortError"));
    await untilAborted(signal);
  });
  try {
    await initializeVault({ vaultRoot, createdAt: TEST_NOW });
    await runClinicalPagesInvocation({
      attemptId: "attempt_synthetic_clinical_pages_shutdown", events,
      shutdownSignal: shutdown.signal, vaultRoot, usageRecordPort: usageRecordPort(events),
    });
    expect(units.saved.sort(), events.join(",")).toEqual([1, 2]);
    expect([3, 4].filter((page) => units.signals.has(page)).every((page) => units.signals.get(page)!.aborted)).toBe(true);
    expect(events.filter((event) => /^page-[34]:done$/u.test(event))).toEqual([]);
  } finally {
    units.runner.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});

test("batches real clinical page applies into the job's checkpoints", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-real-pages-"));
  const events: string[] = [];
  const glucose = [91, 92, 93];
  const collectedAt = (page: number) => `2026-04-0${page}T12:00:00.000Z`;
  const allStarted = createDeferred<void>();
  let extracting = 0;
  let maxExtracting = 0;
  let snapshots = 0;
  // Only the provider is synthetic. Rendering, planning, cache, mailbox apply and vault state are real.
  const executeExtraction = vi.fn<NonNullable<clinicalEnrichment.HostedClinicalEnrichmentInput["executeExtraction"]>>(async (request) => {
    await request.beforeProviderEntry?.();
    const page = request.textWindow?.index ?? 1;
    extracting += 1;
    maxExtracting = Math.max(maxExtracting, extracting);
    // All three pages are in flight at once before any finishes.
    if (extracting === 3) allStarted.resolve();
    await allStarted.promise.finally(() => { extracting -= 1; });
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
  const actualRunner = clinicalEnrichment.createHostedClinicalEnrichmentRunner;
  const runner = vi.spyOn(clinicalEnrichment, "createHostedClinicalEnrichmentRunner")
    .mockImplementation((input) => actualRunner({ ...input, executeExtraction }));
  try {
    await initializeVault({ vaultRoot, timezone: "UTC", createdAt: TEST_NOW });
    // Text windows are 12,000 characters at an 11,000 character stride: three pages.
    const text = glucose.map((value, index) =>
      `Synthetic page ${index + 1}. Collected ${collectedAt(index + 1)}. Serum glucose ${value} mg/dL.`.padEnd(11_000, ".")).join("");
    // Like production query-slices-v2 imports, the wake carries no change run.
    const job = await importClinicalEnrichmentSource(vaultRoot, undefined, { bytes: Buffer.from(text), mediaType: "text/plain" });
    await runClinicalPagesInvocation({
      attemptId: "attempt_synthetic_clinical_real_pages", events, vaultRoot,
      onSnapshot: () => { snapshots += 1; },
      // The startup units must own the invocation before an idle foreground pass can release it.
      foregroundHeldUntil: allStarted.promise,
      snapshot: await createVaultSnapshotBundle({ vaultRoot }),
      usageRecordPort: usageRecordPort(events),
    });
    expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId }), events.join(","))
      .toMatchObject({ status: "complete", counts: { created: 3, held: 0, pages: 3 } });
    const points = await listMetricPoints(vaultRoot, { limit: 10 });
    expect(points.map((point) => point.value)).toEqual(expect.arrayContaining(glucose));
    expect(points).toHaveLength(glucose.length);
    expect(executeExtraction.mock.calls.map(([request]) => `${request.textWindow?.index}:${request.family}`).sort())
      .toEqual(["1:all", "2:all", "3:all"]);
    expect(maxExtracting).toBe(3);
    expect(events.filter((event) => event.endsWith(":requeued")), events.join(",")).toEqual([]);
    // The cursor applies the cached pages in order; usage was recorded per call.
    expect(snapshots, events.join(",")).toBeLessThanOrEqual(2);
    expect(events.filter((event) => event.endsWith(":usage")).sort()).toEqual(["page-1:usage", "page-2:usage", "page-3:usage"]);
  } finally {
    runner.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});

test("batches several one-page clinical jobs into the window's checkpoints", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-real-jobs-"));
  const events: string[] = [];
  const glucose = [94, 95, 96];
  const collectedAt = (document: number) => `2026-05-0${document}T12:00:00.000Z`;
  const allStarted = createDeferred<void>();
  let extracting = 0;
  let maxExtracting = 0;
  let snapshots = 0;
  // Only the provider is synthetic. Each document is its own import batch, so its own job.
  const executeExtraction = vi.fn<NonNullable<clinicalEnrichment.HostedClinicalEnrichmentInput["executeExtraction"]>>(async (request) => {
    await request.beforeProviderEntry?.();
    const document = Number(/Synthetic document (\d)/u.exec(request.extractedText ?? "")?.[1]);
    extracting += 1;
    maxExtracting = Math.max(maxExtracting, extracting);
    if (extracting === 3) allStarted.resolve();
    await allStarted.promise.finally(() => { extracting -= 1; });
    if (request.abortSignal?.aborted) {
      events.push(`page-${document}:requeued`);
      throw request.abortSignal.reason;
    }
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
  const actualRunner = clinicalEnrichment.createHostedClinicalEnrichmentRunner;
  const runner = vi.spyOn(clinicalEnrichment, "createHostedClinicalEnrichmentRunner")
    .mockImplementation((input) => actualRunner({ ...input, executeExtraction }));
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
      attemptId: "attempt_synthetic_clinical_real_jobs", events, vaultRoot,
      onSnapshot: () => { snapshots += 1; },
      foregroundHeldUntil: allStarted.promise,
      snapshot: await createVaultSnapshotBundle({ vaultRoot }),
      usageRecordPort: usageRecordPort(events),
    });
    for (const job of jobs) {
      expect(await readClinicalEnrichmentStatus({ vaultRoot, jobId: job.jobId }), events.join(","))
        .toMatchObject({ status: "complete", counts: { created: 1, held: 0, pages: 1 } });
    }
    const points = await listMetricPoints(vaultRoot, { limit: 10 });
    expect(points.map((point) => point.value).sort()).toEqual(glucose);
    expect(events.filter((event) => event.endsWith(":requeued")), events.join(",")).toEqual([]);
    // Three jobs extract at once and their applies share one snapshot.
    expect(maxExtracting).toBe(3);
    expect(snapshots, events.join(",")).toBe(1);
  } finally {
    runner.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});

const glucoseResult = (page: number, value: number, at: string): ClinicalDocumentExtractionOutput => ({ status: "complete", records: [{
  dateBasis: "document", dateEvidence: `Collected ${at}`, page, payload: {
    kind: "test", occurredAt: at, title: `Synthetic glucose ${page}`, note: null, testName: "Glucose",
    specimenType: "serum", resultStatus: "normal", results: [{ analyte: "Glucose", value, unit: "mg/dL" }],
  },
}] });
const multiPageText = (values: readonly number[], at: (page: number) => string) => values.map((value, index) =>
  `Synthetic page ${index + 1}. Collected ${at(index + 1)}. Serum glucose ${value} mg/dL.`.padEnd(11_000, ".")).join("");

interface DurableRuntimeState {
  artifacts: Map<string, Uint8Array>;
  workspace: ReturnType<typeof createWorkspaceState>;
  /** A killed container's later writes never reach the durable state. */
  frozen: boolean;
  snapshots: number;
}

async function createDurableRuntimeState(vaultRoot: string): Promise<DurableRuntimeState> {
  const bundle = await createVaultSnapshotBundle({ vaultRoot });
  return { artifacts: new Map([[bundle.hash, bundle.bytes]]), frozen: false, snapshots: 0,
    workspace: createWorkspaceState({ version: "0", snapshotRef: bundle.snapshotRef }) };
}

/** One container invocation against durable state that survives it: real snapshots, receipt log and status. */
async function runDurableClinicalInvocation(input: {
  attemptId: string;
  events: string[];
  vaultRoot: string;
  state: DurableRuntimeState;
  shutdownSignal?: AbortSignal;
  signal?: AbortSignal;
  usageRecordPort: HostedRuntimeUsageRecordPort;
}) {
  return await withRealTimeout(runHostedWorkspaceRuntimeJobInProcess(
    createWorkspaceRuntimeJobInput({ request: {
      attemptId: input.attemptId, leaseGeneration: "7", workspaceVersion: input.state.workspace.version,
    } }),
    {
      vaultRoot: input.vaultRoot,
      runtimeWakeSignal: createCoalescingRuntimeWakeSignal(),
      ...(input.shutdownSignal ? { shutdownSignal: input.shutdownSignal } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      async createCheckpointSnapshot() {
        const bundle = await createVaultSnapshotBundle({ vaultRoot: input.vaultRoot });
        if (!input.state.frozen) {
          input.state.artifacts.set(bundle.hash, bundle.bytes);
          input.state.snapshots += 1;
        }
        input.events.push("snapshot");
        return { snapshotRef: bundle.snapshotRef };
      },
      async importItem() { return { status: "imported" }; },
      async runAssistantPhase() { return { progressed: false, nextWakeAt: null, nextWakeReason: null }; },
      platform: {
        ...createPlatform({
          artifactBytesByHash: input.state.artifacts,
          mailboxPort: createMailboxPort({ events: input.events, items: [] }),
          workspacePort: createWorkspacePort({
            events: input.events, checkpointRequests: [], workspace: input.state.workspace,
            checkpointWorkspace(request) {
              const next = createWorkspaceState({
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                snapshotRef: request.snapshotRef,
                nextWakeAt: request.nextWakeAt ?? null,
                nextWakeReason: request.nextWakeReason ?? null,
                redactedStatus: request.redactedStatus ?? null,
              });
              if (!input.state.frozen) input.state.workspace = next;
              return next;
            },
          }),
        }),
        usageRecordPort: input.usageRecordPort,
      },
    },
  ), 60_000, () => input.events.join(","));
}

const recordingUsage = (events: string[], usageIds: string[]): HostedRuntimeUsageRecordPort => ({ async recordUsage(record) {
  usageIds.push(record.usageId);
  events.push(`page-${record.providerRequestOrdinal}:usage`);
  return { recorded: true, usageId: record.usageId, platformAiUsageAllowedAfter: true };
} });

test("completes a multi-job import of pages and resources in one invocation", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-one-invocation-"));
  const events: string[] = [];
  const usageIds: string[] = [];
  const at = (page: number) => `2026-06-0${page}T12:00:00.000Z`;
  const glucose = [101, 102, 103, 104];
  let extracting = 0;
  let maxExtracting = 0;
  let snapshots = 0;
  const executeExtraction = vi.fn<NonNullable<clinicalEnrichment.HostedClinicalEnrichmentInput["executeExtraction"]>>(async (request) => {
    await request.beforeProviderEntry?.();
    extracting += 1;
    maxExtracting = Math.max(maxExtracting, extracting);
    await setImmediate().finally(() => { extracting -= 1; });
    if (request.source.resource) {
      request.onProviderUsage?.(syntheticUsage(100 + Number(request.source.resource.resourceId.slice(-1))));
      const excerpt = `Resting heart rate ${70 + Number(request.source.resource.resourceId.slice(-1))} bpm.`;
      return { status: "complete", records: [{ dateBasis: "source", excerpt, payload: { kind: "measurement", occurredAt: request.source.clinicalOccurredAt ?? OCCURRED_AT,
        note: undefined, title: "Resting heart rate", measurements: [{ metric: "resting-heart-rate", value: 70 + Number(request.source.resource.resourceId.slice(-1)), unit: "bpm" }] } }] };
    }
    const page = request.textWindow?.index ?? 1;
    const reading = request.textWindow ? page : 4;
    request.onProviderUsage?.(syntheticUsage(reading));
    return glucoseResult(page, glucose[reading - 1]!, at(reading));
  });
  const actualRunner = clinicalEnrichment.createHostedClinicalEnrichmentRunner;
  const runner = vi.spyOn(clinicalEnrichment, "createHostedClinicalEnrichmentRunner")
    .mockImplementation((input) => actualRunner({ ...input, executeExtraction }));
  try {
    await initializeVault({ vaultRoot, timezone: "UTC", createdAt: TEST_NOW });
    // Three jobs, as one import makes from separate fetched pages: a three-page
    // document, a one-page document and a page of three narrative observations.
    const jobs = [
      await importClinicalEnrichmentSource(vaultRoot, { resourceType: "DocumentReference", status: "current", resourceId: "synthetic-long", revision: "2026-06-10T13:00:00.000Z" },
        { bytes: Buffer.from(multiPageText(glucose.slice(0, 3), at)), mediaType: "text/plain" }),
      await importClinicalEnrichmentSource(vaultRoot, { resourceType: "DocumentReference", status: "current", resourceId: "synthetic-short", revision: "2026-06-11T13:00:00.000Z" },
        { bytes: Buffer.from(`Synthetic single report. Collected ${at(4)}. Serum glucose ${glucose[3]} mg/dL.`), mediaType: "text/plain" }),
      await importClinicalStructuredSources(vaultRoot, [1, 2, 3].map((index) => ({
        id: `synthetic-vital-${index}`, text: `Resting heart rate ${70 + index} bpm.`, occurredAt: `2020-03-1${index}T12:00:00.000Z`,
      }))),
    ];
    const state = await createDurableRuntimeState(vaultRoot);
    const containerRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-one-invocation-container-"));
    try {
      await runDurableClinicalInvocation({
        attemptId: "attempt_synthetic_clinical_one_invocation", events, vaultRoot: containerRoot,
        state, usageRecordPort: recordingUsage(events, usageIds),
      });
      snapshots = state.snapshots;
      // Everything finished in this one container start: every job is done and no clinical wake is left for a successor.
      const statuses = await Promise.all(jobs.map((job) => readClinicalEnrichmentStatus({ vaultRoot: containerRoot, jobId: job.jobId })));
      for (const status of statuses) {
        expect(status, JSON.stringify(statuses)).toMatchObject({ status: "complete", counts: { held: 0 } });
      }
      expect((await readHostedSystemMailboxState(containerRoot)).pending.filter(isHostedClinicalEnrichmentWakeItem)).toEqual([]);
      expect(executeExtraction).toHaveBeenCalledTimes(7);
      expect(maxExtracting).toBeGreaterThan(1);
      expect(new Set(usageIds).size).toBe(7);
      expect(snapshots, events.join(",")).toBeLessThanOrEqual(2);
    } finally {
      await removeTempRoot(containerRoot);
    }
  } finally {
    runner.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});

test("resumes an import after a graceful rollout stop without losing, duplicating or re-extracting applied work", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-rollout-"));
  const events: string[] = [];
  const usageIds: string[] = [];
  const at = (page: number) => `2026-07-0${page}T12:00:00.000Z`;
  const glucose = [111, 112, 113, 114];
  const shutdown = new AbortController();
  const extractedPages: number[] = [];
  let invocation = 1;
  const executeExtraction = vi.fn<NonNullable<clinicalEnrichment.HostedClinicalEnrichmentInput["executeExtraction"]>>(async (request) => {
    await request.beforeProviderEntry?.();
    const page = request.textWindow?.index ?? 1;
    if (invocation === 1 && page > 2) {
      // The rollout stops the container while these calls are in flight.
      shutdown.abort(new DOMException("Synthetic rollout SIGTERM.", "AbortError"));
      await untilAborted(request.abortSignal!);
      throw request.abortSignal!.reason;
    }
    await setImmediate();
    extractedPages.push(page);
    request.onProviderUsage?.(syntheticUsage(page));
    return glucoseResult(page, glucose[page - 1]!, at(page));
  });
  const actualRunner = clinicalEnrichment.createHostedClinicalEnrichmentRunner;
  const runner = vi.spyOn(clinicalEnrichment, "createHostedClinicalEnrichmentRunner")
    .mockImplementation((input) => actualRunner({ ...input, executeExtraction }));
  const roots = [vaultRoot];
  try {
    await initializeVault({ vaultRoot, timezone: "UTC", createdAt: TEST_NOW });
    const job = await importClinicalEnrichmentSource(vaultRoot, undefined, { bytes: Buffer.from(multiPageText(glucose, at)), mediaType: "text/plain" });
    const state = await createDurableRuntimeState(vaultRoot);
    const first = await mkdtemp(path.join(tmpdir(), "murph-clinical-rollout-old-"));
    roots.push(first);
    await runDurableClinicalInvocation({ attemptId: "attempt_synthetic_clinical_rollout_old", events, vaultRoot: first, state,
      shutdownSignal: shutdown.signal, usageRecordPort: recordingUsage(events, usageIds) });
    expect(shutdown.signal.aborted).toBe(true);
    // The stopped container published a final snapshot inside its grace period.
    expect(state.snapshots, events.join(",")).toBeGreaterThanOrEqual(1);
    invocation = 2;
    const second = await mkdtemp(path.join(tmpdir(), "murph-clinical-rollout-new-"));
    roots.push(second);
    await runDurableClinicalInvocation({ attemptId: "attempt_synthetic_clinical_rollout_new", events, vaultRoot: second, state,
      usageRecordPort: recordingUsage(events, usageIds) });
    expect(await readClinicalEnrichmentStatus({ vaultRoot: second, jobId: job.jobId }), events.join(","))
      .toMatchObject({ status: "complete", counts: { pages: 4, held: 0 } });
    const points = await listMetricPoints(second, { limit: 20 });
    expect(points.map((point) => point.value).sort()).toEqual(glucose);
    // Pages finished before the stop are never extracted again; only aborted calls are.
    expect(extractedPages.filter((page) => page <= 2).sort()).toEqual([1, 2]);
    expect(extractedPages.filter((page) => page > 2).sort()).toEqual([3, 4]);
    expect(new Set(usageIds).size).toBe(usageIds.length);
    expect(usageIds).toHaveLength(4);
  } finally {
    runner.mockRestore();
    for (const root of roots) await removeTempRoot(root);
  }
});

test("recovers an import after a hard kill from the last snapshot plus the receipt log", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-kill-"));
  const events: string[] = [];
  const usageIds: string[] = [];
  const at = (page: number) => `2026-08-0${page}T12:00:00.000Z`;
  const glucose = [121, 122, 123, 124];
  const kill = new AbortController();
  const extractedPages: number[] = [];
  let state!: DurableRuntimeState;
  let first = "";
  let jobId: string | undefined;
  let invocation = 1;
  const executeExtraction = vi.fn<NonNullable<clinicalEnrichment.HostedClinicalEnrichmentInput["executeExtraction"]>>(async (request) => {
    await request.beforeProviderEntry?.();
    const page = request.textWindow?.index ?? 1;
    if (invocation === 1 && page > 2) {
      // Pages 1 and 2 apply: each canonical write's receipt reaches the durable
      // log before the write returns. Then the container dies with no checkpoint.
      while ((await readClinicalEnrichmentStatus({ vaultRoot: first, jobId: jobId! })).counts.pages < 2 && !request.abortSignal!.aborted) await setImmediate();
      // The last write's receipt is acknowledged asynchronously; let its status checkpoint land.
      const version = BigInt(state.workspace.version);
      for (let turn = 0; turn < 200 && BigInt(state.workspace.version) <= version; turn += 1) await setImmediate();
      state.frozen = true;
      kill.abort(new DOMException("Synthetic SIGKILL.", "AbortError"));
      await untilAborted(request.abortSignal!);
      throw request.abortSignal!.reason;
    }
    await setImmediate();
    extractedPages.push(page);
    request.onProviderUsage?.(syntheticUsage(page));
    return glucoseResult(page, glucose[page - 1]!, at(page));
  });
  const actualRunner = clinicalEnrichment.createHostedClinicalEnrichmentRunner;
  const runner = vi.spyOn(clinicalEnrichment, "createHostedClinicalEnrichmentRunner")
    .mockImplementation((input) => actualRunner({ ...input, executeExtraction }));
  const roots = [vaultRoot];
  try {
    await initializeVault({ vaultRoot, timezone: "UTC", createdAt: TEST_NOW });
    const job = await importClinicalEnrichmentSource(vaultRoot, undefined, { bytes: Buffer.from(multiPageText(glucose, at)), mediaType: "text/plain" });
    jobId = job.jobId;
    state = await createDurableRuntimeState(vaultRoot);
    first = await mkdtemp(path.join(tmpdir(), "murph-clinical-kill-old-"));
    roots.push(first);
    await runDurableClinicalInvocation({ attemptId: "attempt_synthetic_clinical_kill_old", events, vaultRoot: first, state,
      signal: kill.signal, usageRecordPort: recordingUsage(events, usageIds) }).catch(() => undefined);
    // No snapshot survived the kill; only the initial one and the receipt log are durable.
    expect(state.snapshots).toBe(0);
    invocation = 2;
    const second = await mkdtemp(path.join(tmpdir(), "murph-clinical-kill-new-"));
    roots.push(second);
    await runDurableClinicalInvocation({ attemptId: "attempt_synthetic_clinical_kill_new", events, vaultRoot: second, state,
      usageRecordPort: recordingUsage(events, usageIds) });
    expect(await readClinicalEnrichmentStatus({ vaultRoot: second, jobId: job.jobId }), events.join(","))
      .toMatchObject({ status: "complete", counts: { pages: 4, held: 0 } });
    const points = await listMetricPoints(second, { limit: 20 });
    expect(points.map((point) => point.value).sort()).toEqual(glucose);
    // Durably applied pages replay from their receipts without another model call.
    expect(extractedPages.filter((page) => page <= 2).sort()).toEqual([1, 2]);
    expect(new Set(usageIds).size).toBe(usageIds.length);
    expect(usageIds).toHaveLength(extractedPages.length);
  } finally {
    runner.mockRestore();
    for (const root of roots) await removeTempRoot(root);
  }
});
