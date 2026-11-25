import { setImmediate } from "node:timers/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { expect, test, vi } from "vitest";
import * as clinicalEnrichment from "../src/hosted-runtime/clinical-enrichment.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime.ts";
import {
  createWorkspaceRunRequest,
  TEST_NOW, TEST_USER_ID, createDeferred, createMailboxItem, createMailboxPort, createPlatform,
  createSnapshotFixtureRef, createWorkspacePort, createWorkspaceRuntimeJobInput,
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
      status: "extract" as const, jobId: "a".repeat(64), page: 2, timeZone: "UTC",
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

// Each synthetic page leaves deferred usage like production. Provider pages
// outlast a checkpoint, so a page finishes only after its predecessor's
// usage, which runs after the snapshot that made the predecessor durable.
function mockClinicalPages(events: string[], totalPages: number, onUsage?: (page: number) => void) {
  let completedPages = 0;
  let extracting = false;
  const usageRecorded = Array.from({ length: totalPages + 1 }, () => createDeferred<void>());
  usageRecorded[0]?.resolve();
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
        void usageRecorded[page - 1]?.promise.then(() => resolve(input.abortSignal.aborted));
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
        usageRecorded[page]?.resolve();
        onUsage?.(page);
      });
      input.onStateMutation();
      return "settled";
    });
  return { runOne, completedPages: () => completedPages, extracting: () => extracting };
}

async function runClinicalPagesInvocation(input: {
  attemptId: string;
  events: string[];
  extracting(): boolean;
  shutdownSignal?: AbortSignal;
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
      async runAssistantPhase() { return { progressed: false, nextWakeAt: null, nextWakeReason: null }; },
      platform: createPlatform({
        mailboxPort: createMailboxPort({ events: input.events, items: [] }),
        workspacePort: createWorkspacePort({
          events: input.events, checkpointRequests: [], workspace: createWorkspaceState({ version: "0" }),
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
    },
  ), 15_000, () => input.events.join(","));
}

const pageProgress = (events: readonly string[]) =>
  events.filter((event) => event === "snapshot" || /^page-\d+:(done|usage)$/u.test(event));

test("keeps extracting later clinical pages after each page checkpoint in one invocation", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-pages-"));
  const events: string[] = [];
  const pages = mockClinicalPages(events, 3);
  try {
    await initializeVault({ vaultRoot, createdAt: TEST_NOW });
    await runClinicalPagesInvocation({
      attemptId: "attempt_synthetic_clinical_pages", events, extracting: pages.extracting, vaultRoot,
    });
    expect(pages.completedPages(), events.join(",")).toBe(3);
    // Usage stays behind the snapshot that made its page durable.
    expect(pageProgress(events)).toEqual([
      "page-1:done", "snapshot", "page-1:usage",
      "page-2:done", "snapshot", "page-2:usage",
      "page-3:done", "snapshot", "page-3:usage",
    ]);
    // No page pays for a provider call that its predecessor's snapshot aborts.
    expect(events.filter((event) => event.endsWith(":requeued")), events.join(",")).toEqual([]);
    const snapshots = events.flatMap((event, index) => event === "snapshot" ? [index] : []);
    for (const page of [2, 3]) {
      expect(events.indexOf(`page-${page}:start`), events.join(",")).toBeGreaterThan(snapshots[page - 2] ?? Infinity);
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
  const pages = mockClinicalPages(events, 3, () => {
    shutdown.abort(new DOMException("Synthetic container SIGTERM.", "AbortError"));
  });
  try {
    await initializeVault({ vaultRoot, createdAt: TEST_NOW });
    await runClinicalPagesInvocation({
      attemptId: "attempt_synthetic_clinical_pages_shutdown", events, extracting: pages.extracting,
      shutdownSignal: shutdown.signal, vaultRoot,
    });
    expect(pages.completedPages(), events.join(",")).toBe(1);
    expect(pageProgress(events)).toEqual(["page-1:done", "snapshot", "page-1:usage"]);
  } finally {
    pages.runOne.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});
