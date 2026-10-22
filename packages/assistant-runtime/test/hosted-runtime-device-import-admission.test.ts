import {
  TEST_NOW, TEST_USER_ID, createDeferred, createDeviceSyncResolvedConfig,
  createMailboxItem, createMailboxPort, createPlatform, createSnapshotDeviceSyncPort,
  createWorkspacePort, createWorkspaceRuntimeJobInput, createWorkspaceState,
  createSnapshotFixtureRef, createResolvedDeviceSyncSystemMailboxItem,
  runHostedWorkspaceRuntimeJobInProcess, stagePendingLinqAssistantInputForMailboxItem,
  removeTempRoot, withRealTimeout, waitUntil,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { importDeviceBatch, initializeVault, inspectCanonicalWriteLock } from "@murphai/core";
import type { DeviceSyncJobTimingDiagnostic } from "@murphai/device-syncd/types";
import type { HostedRuntimeLogRequest, HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import * as deviceService from "../src/device-sync-service.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";

test.each([
  ["default", "partial-provider"], ["system_mailbox", "partial-provider"],
  ["default", "partial-failure"], ["system_mailbox", "partial-failure"],
  ["default", "partial-shutdown"], ["system_mailbox", "partial-shutdown"],
  ["default", "provider"], ["system_mailbox", "provider"],
  ["default", "no-provider"], ["system_mailbox", "no-provider"],
  ["default", "admission-cap"], ["system_mailbox", "admission-cap"],
  ["default", "failure"], ["system_mailbox", "failure"],
  ["default", "shutdown"], ["system_mailbox", "shutdown"],
  ["default", "abort"], ["system_mailbox", "abort"],
] as const)("%s admission defers preparation and resumes after %s", async (mode, scenario) => {
  const partialProgress = scenario.startsWith("partial-");
  const closeAt = scenario.replace("partial-", "");
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-import-admission-"));
  const controller = new AbortController();
  const shutdown = new AbortController();
  const wakeSignal = createCoalescingRuntimeWakeSignal();
  const events: string[] = [];
  const checkpoints: HostedWorkspaceCheckpointRequest[] = [];
  const logRequests: HostedRuntimeLogRequest[] = [];
  const importStarted = createDeferred<void>();
  const importYielded = createDeferred<void>();
  const importCompleted = createDeferred<void>();
  const conversationStaged = createDeferred<void>();
  const secondStaged = createDeferred<void>();
  let runtime: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | undefined;
  let shouldYieldImport: (() => boolean) | null | undefined;
  let phaseRan = false;
  let importCalls = 0;
  let acknowledgments = 0;
  const acknowledgedPayloads: string[] = [];
  const downloads: string[] = [];
  const imports: string[] = [];
  const diagnostics: DeviceSyncJobTimingDiagnostic[] = [];
  const deviceItem = createMailboxItem({
    id: "synthetic_admission_device", kind: "device-sync.wake", lane: "system", laneSeq: "1",
    dedupeKey: "device-sync.wake:synthetic-admission",
  });
  const items = [deviceItem];
  const realCreate = deviceService.createHostedRuntimeDeviceSyncService;
  const realClose = deviceService.closeHostedRuntimeDeviceSyncService;
  let seedPath = "";
  let seedBytes: Buffer;
  const observation = (resourceId: string) => ({
    kind: "observation" as const, occurredAt: TEST_NOW, recordedAt: TEST_NOW,
    title: "Synthetic observation",
    externalRef: { system: "synthetic", resourceType: "metric", resourceId },
    fields: { metric: "synthetic-metric", unit: "count", value: 1 },
  });
  const createSpy = vi.spyOn(deviceService, "createHostedRuntimeDeviceSyncService").mockImplementation((input) => {
    shouldYieldImport = input.config.shouldYieldImportPreparation;
    const service = realCreate({
      ...input,
      importer: {
        async importDeviceProviderSnapshot(input, options) {
          importCalls += 1;
          assert.ok(options?.signal);
          const snapshot = input.snapshot as { sleeps: { id: string }[] };
          const resourceId = snapshot.sleeps[0]!.id;
          imports.push(resourceId);
          const isEarlierJob = resourceId === "synthetic-admission-earlier";
          if (isEarlierJob) return { addedCount: 1, eventShardPaths: [] };
          if (!isEarlierJob && importCalls === (partialProgress ? 2 : 1)) {
            importStarted.resolve();
            await withRealTimeout(waitUntil(() => assert.equal(shouldYieldImport?.(), true)),
              5_000, () => "Conversation admission did not open");
          }
          try {
            const result = await importDeviceBatch({
              vaultRoot, provider: "synthetic", events: [observation(resourceId)],
            }, { signal: options.signal });
            assert.equal(shouldYieldImport?.(), false);
            events.push("import.completed");
            importCompleted.resolve();
            return result;
          } catch (error) {
            assert.equal(options.signal.aborted, true);
            assert.equal((await inspectCanonicalWriteLock(vaultRoot)).state, "unlocked");
            assert.deepEqual(await readFile(seedPath), seedBytes);
            events.push("import.yielded");
            importYielded.resolve();
            throw error;
          }
        },
      },
    });
    if (partialProgress) {
      const store = deviceService.requireHostedRuntimeDeviceSyncStore(service);
      const enqueueJob = store.enqueueJob.bind(store);
      // Both rows have the same synthetic clock; explicitly order A before B.
      store.enqueueJob = (job) => enqueueJob({
        ...job, priority: job.payload?.resourceId === "synthetic-admission-earlier" ? 61 : job.priority,
      });
    }
    return service;
  });
  const closeSpy = vi.spyOn(deviceService, "closeHostedRuntimeDeviceSyncService").mockImplementation((service) => {
    const timing = service.listJobTimingDiagnostics();
    diagnostics.push(...timing);
    for (const diagnostic of timing) {
      if (diagnostic.outcome !== "yielded") continue;
      for (const { jobId } of diagnostic.jobIdentities ?? []) {
        const job = deviceService.requireHostedRuntimeDeviceSyncStore(service).getJobById(jobId);
        assert.equal(job?.status, "queued");
        assert.equal(job?.attempts, 0);
        assert.equal(job?.leaseOwner, null);
      }
    }
    realClose(service);
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(TEST_NOW));
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
    const id = String(url).split("/").at(-1)!;
    downloads.push(id);
    return new Response(JSON.stringify({ id }), {
      headers: { "content-type": "application/json" },
    });
  }));
  try {
    runtime = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
      request: { processingMode: mode, runnerIdleTtlMs: 1_000 },
      resolvedConfig: createDeviceSyncResolvedConfig(),
    }), {
      vaultRoot, runtimeWakeSignal: wakeSignal, signal: controller.signal, shutdownSignal: shutdown.signal,
      async importItem({ item }) {
        if (item.lane === "system") {
          await initializeVault({ vaultRoot, createdAt: TEST_NOW });
          const seed = await importDeviceBatch({
            vaultRoot, provider: "synthetic",
            events: Array.from({ length: 8_000 }, (_, i) => observation(`seed-${i}`)),
          });
          seedPath = path.join(vaultRoot, seed.eventShardPaths[0]!);
          seedBytes = await readFile(seedPath);
          await enqueueHostedSystemMailboxItem({
            item: createResolvedDeviceSyncSystemMailboxItem(item), vaultRoot,
            wake: {
              connectionId: "synthetic-admission-connection", eventId: item.dedupeKey,
              expectedConnectedAt: TEST_NOW, kind: "device-sync.wake", occurredAt: TEST_NOW,
              provider: "whoop", reason: "webhook_hint", userId: TEST_USER_ID,
            },
          });
          return { status: "imported" };
        }
        assert.equal(shouldYieldImport?.(), true);
        const assistantInputId = await stagePendingLinqAssistantInputForMailboxItem({ item, vaultRoot });
        if (item.laneSeq === "1") conversationStaged.resolve();
        else secondStaged.resolve();
        return { status: "imported", assistantInputId };
      },
      async runAssistantPhase(input) {
        if (phaseRan) return { progressed: false };
        phaseRan = true;
        await conversationStaged.promise;
        await importYielded.promise;
        assert.equal(importCalls, partialProgress ? 2 : 1);
        assert.equal(shouldYieldImport?.(), true);
        if (closeAt === "provider") {
          input.onProviderRequestStarted?.();
          assert.equal(shouldYieldImport?.(), false);
          await importCompleted.promise;
        }
        if (closeAt === "admission-cap") {
          vi.setSystemTime(Date.now() + 29_000);
          assert.equal(shouldYieldImport?.(), true);
        }
        // A second real input opens admission again, including after provider start.
        items.push(createMailboxItem({ id: "synthetic_admission_second", laneSeq: "2" }));
        wakeSignal.notify();
        await secondStaged.promise;
        assert.equal(shouldYieldImport?.(), true);
        if (closeAt === "admission-cap") {
          // A new lane sequence re-arms the cap; no provider start or phase end
          // closes this window before the deferred import finishes.
          vi.setSystemTime(Date.now() + 29_999);
          assert.equal(shouldYieldImport?.(), true);
          vi.setSystemTime(Date.now() + 2);
          assert.equal(shouldYieldImport?.(), false);
          await importCompleted.promise;
        }
        if (closeAt === "provider") input.onProviderRequestStarted?.();
        if (closeAt === "failure") throw new Error("Synthetic admission phase failure");
        if (closeAt === "shutdown") shutdown.abort();
        if (closeAt === "abort") controller.abort(new Error("Synthetic admission abort"));
        return { progressed: false };
      },
      async createCheckpointSnapshot() {
        return { snapshotRef: createSnapshotFixtureRef({ hash: "e".repeat(64), size: 512 }) };
      },
      platform: createPlatform({
        artifactBytesByHash: new Map(),
        logRequests,
        mailboxPort: createMailboxPort({ events, items }),
        workspacePort: createWorkspacePort({ checkpointRequests: checkpoints, events, workspace: createWorkspaceState() }),
        deviceSyncPort: {
          ...createSnapshotDeviceSyncPort({
            connectionId: "synthetic-admission-connection", nextReconcileAt: "2099-01-01T00:00:00.000Z",
          }),
          async fetchDirtyStates() {
            return {
              hasMore: false, nextWakeAt: null, userId: TEST_USER_ID,
              items: acknowledgedPayloads.length === (partialProgress ? 2 : 1) ? [] : [{
                connectionId: "synthetic-admission-connection", dirtyRevision: "1", processedRevision: "0",
                dirtyResources: (partialProgress ? ["earlier", "sleep"] : ["sleep"])
                  .filter((id) => !acknowledgedPayloads.includes(`synthetic-admission-${id}`))
                  .map((id) => ({
                  count: 1, dirtyPayloadId: `synthetic-admission-${id}`, jobKind: "resource" as const,
                  payload: { resourceType: "sleep", resourceId: `synthetic-admission-${id}` },
                  resource: "sleep", resourceCategory: "summary" as const, sourceProviderSlug: "whoop",
                  windowEnd: null, windowStart: null,
                })),
                eventCount: "1", latestDirtyAt: TEST_NOW, provider: "whoop" as const,
                resourceCategoryCounts: { summary: 1 }, sourceProviderCounts: { whoop: 1 },
                userId: TEST_USER_ID, windowEnd: null, windowStart: null,
              }],
            };
          },
          async ackDirtyStateProcessed(request) {
            acknowledgments += 1;
            acknowledgedPayloads.push(...request.processedDirtyPayloadIds ?? []);
            return { ...request, dirtyRevision: "1", nextWakeAt: null, recorded: true,
              stillDirty: acknowledgedPayloads.length < (partialProgress ? 2 : 1), userId: TEST_USER_ID };
          },
        },
      }),
    });
    // Attach rejection handling before injecting a failure/abort into the phase.
    void runtime.catch(() => undefined);
    await withRealTimeout(importStarted.promise, 20_000, () => events.join(","));
    items.push(createMailboxItem({ id: "synthetic_admission_first", laneSeq: "1" }));
    wakeSignal.notify();
    if (closeAt === "failure" || closeAt === "shutdown" || closeAt === "abort") {
      if (closeAt === "shutdown") await withRealTimeout(runtime, 20_000, () => events.join(","));
      else await assert.rejects(withRealTimeout(runtime, 20_000, () => events.join(",")), /Synthetic admission/);
      assert.equal(shouldYieldImport?.(), false);
      assert.ok(events.includes("import.yielded"));
      const retained = (await readHostedSystemMailboxState(vaultRoot)).pending.find(
        (item) => item.itemId === deviceItem.id,
      );
      assert.ok(events.includes("import.completed") || retained !== undefined);
      if (retained?.status === "pending") assert.equal(retained.postCheckpointRecord, null);
      assert.equal(diagnostics.some((item) => item.outcome === "failed"), false);
      return;
    }
    await withRealTimeout(importCompleted.promise, 20_000, () => events.join(","));
    await withRealTimeout(secondStaged.promise, 5_000, () => events.join(","));
    await withRealTimeout(waitUntil(() => assert.equal(shouldYieldImport?.(), false)), 5_000, () => events.join(","));
    vi.setSystemTime(Date.now() + 2_000);
    wakeSignal.notify();
    await withRealTimeout(runtime, 20_000, () => events.join(","));
    const passLogs = logRequests.flatMap((request) => request.entries).filter(
      (entry) => entry.eventCode === "device-sync.pass_finished",
    );
    assert.equal(passLogs.filter((entry) => entry.redactedJson?.outcome === "yielded").length, 0);
    assert.equal(passLogs.filter((entry) => entry.redactedJson?.yieldReason === null
      && entry.redactedJson?.outcome === "completed").length, 1);
    const loggedTimings = passLogs[0]?.redactedJson?.deviceSyncJobTimingSummaries;
    assert.ok(Array.isArray(loggedTimings));
    const loggedDeferrals = loggedTimings.map((item) => {
      assert.ok(item !== null && typeof item === "object");
      assert.equal(item.snapshotImportCount, 1);
      return item.snapshotImportDeferredCount;
    });
    assert.equal(loggedDeferrals.filter((count) => count === 1).length, 1);
    if (partialProgress) {
      assert.equal(downloads.filter((id) => id === "synthetic-admission-earlier").length, 1);
      assert.equal(imports.filter((id) => id === "synthetic-admission-earlier").length, 1);
      assert.deepEqual(acknowledgedPayloads.sort(), ["synthetic-admission-earlier", "synthetic-admission-sleep"]);
    } else assert.equal(acknowledgments, 1);
    assert.equal(downloads.filter((id) => id === "synthetic-admission-sleep").length, 1);
    assert.equal(importCalls, partialProgress ? 3 : 2);
    assert.equal(diagnostics.filter((item) => item.outcome === "yielded").length, 0);
    assert.equal(diagnostics.filter((item) => item.outcome === "completed").length, partialProgress ? 2 : 1);
    assert.ok(diagnostics.every((item) => item.attempts === 1));
    assert.equal(diagnostics.some((item) => item.outcome === "failed"), false);
    assert.equal(diagnostics.reduce((total, item) => total + (item.snapshotImportDeferredCount ?? 0), 0), 1);
    assert.ok(diagnostics.every((item) => item.snapshotImportCount === 1));
    assert.ok(diagnostics.every((item) => Object.values(item.snapshotImportOutcomes)
      .reduce((total, count) => total + count, 0) === 1));
    assert.equal((await inspectCanonicalWriteLock(vaultRoot)).state, "unlocked");
  } finally {
    controller.abort();
    conversationStaged.resolve();
    secondStaged.resolve();
    importYielded.resolve();
    importCompleted.resolve();
    await runtime?.catch(() => undefined);
    createSpy.mockRestore();
    closeSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
}, 60_000);
