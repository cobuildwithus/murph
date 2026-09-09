import {
  TEST_NOW,
  TEST_USER_ID,
  createBundleRef,
  createDeferred,
  createDeviceSyncResolvedConfig,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createResolvedDeviceSyncSystemMailboxItem,
  createSnapshotDeviceSyncPort,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  enqueueEnvironmentInterviewSystemMailboxItemForTest,
  listHostedCanonicalWriteReceiptLogArtifacts,
  mocks,
  removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess,
  stagePendingLinqAssistantInputForMailboxItem,
  withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { initializeVault, readHabitatAspect } from "@murphai/core";
import { listCanonicalEntities } from "@murphai/query";
import { createAssistantOutboxIntent, listAssistantOutboxIntents, type RunAssistantAutomationPassInput } from "@murphai/assistant-engine";
import { writeAssistantAutoReplyReplyTerminalEvidence } from "@murphai/assistant-engine/assistant-automation";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import type { HostedRuntimeDeviceSyncPort } from "../src/hosted-runtime/platform.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";

test.each(["completed", "stalled", "absent", "persistent", "cold", "acknowledgment"] as const)("preserves foreground delivery with a %s concurrent device import", async (scenario) => {
  const completesBeforeReply = scenario === "completed" || scenario === "acknowledgment";
  const persistent = scenario === "persistent" || scenario === "cold";
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-concurrent-device-import-"));
  const controller = new AbortController();
  let runtimeCompletion: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const artifactBytesByHash = new Map<string, Uint8Array>();
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const imported = createDeferred<void>();
  const environmentImported = createDeferred<void>();
  const providerStarted = createDeferred<void>();
  const secondReply = createDeferred<void>();
  const releaseSnapshot = createDeferred<void>();
  const releaseDownload = createDeferred<void>();
  const dirtyAcks: Parameters<HostedRuntimeDeviceSyncPort["ackDirtyStateProcessed"]>[0][] = [];
  let replySent = false;
  let modelFinishedAt = 0;
  const connectionId = "synthetic-concurrent-connection";
  const deviceItem = createMailboxItem({
    id: "mailbox_item_concurrent_device",
    dedupeKey: "device-sync.wake:concurrent-import",
    kind: "device-sync.wake", lane: "system", laneSeq: "1",
  });
  const environmentItem = createMailboxItem({
    id: "mailbox_item_concurrent_environment",
    dedupeKey: "environment-interview.completed:concurrent-import",
    kind: "environment-interview.completed", lane: "system", laneSeq: "2",
  });
  const items = scenario === "cold" ? [deviceItem, environmentItem]
    : [createMailboxItem({ id: "mailbox_item_concurrent_conversation", laneSeq: "1" })];
  const baseDevicePort = createSnapshotDeviceSyncPort({
    connectionId,
    nextReconcileAt: "2099-01-01T00:00:00.000Z",
  });
  const originalAutomation = mocks.runAssistantAutomationPass.getMockImplementation();
  let inputId: string | null = null;
  const handledInputIds = new Set<string>();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(TEST_NOW));
  vi.stubGlobal("fetch", vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
    const pathname = new URL(request instanceof Request ? request.url : String(request)).pathname;
    if (pathname.includes("/messages")) {
      events.push("reply.sent");
      assert.ok(performance.now() - modelFinishedAt < 2_000, events.join(","));
      if (completesBeforeReply || persistent) {
        if (replySent) {
          secondReply.resolve();
        } else {
          items.push(createMailboxItem({ id: "mailbox_item_concurrent_followup", laneSeq: "2" }));
          runtimeWakeSignal.notify();
        }
      }
      replySent = true;
      return new Response(JSON.stringify({ message: { id: "synthetic-concurrent-reply" } }), {
        headers: { "content-type": "application/json" }, status: 200,
      });
    }
    events.push(`provider.fetch:${pathname}`);
    if (pathname.endsWith("/synthetic-concurrent-sleep")) {
      providerStarted.resolve();
      if (persistent || (scenario === "stalled" && !replySent)) {
        const signal = init?.signal ?? (request instanceof Request ? request.signal : null);
        assert.ok(signal);
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            events.push("provider.aborted");
            reject(signal.reason);
          };
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
          if (persistent) {
            void releaseDownload.promise.then(() => {
              signal.removeEventListener("abort", abort);
              resolve();
            });
          }
        });
      }
    }
    return new Response(JSON.stringify(pathname.endsWith("/synthetic-concurrent-sleep") ? {
      id: "synthetic-concurrent-sleep", nap: false,
      start: "2026-04-26T00:30:00.000Z", end: "2026-04-26T07:30:00.000Z",
      updated_at: "2026-04-26T08:00:00.000Z",
    } : { records: [] }), { headers: { "content-type": "application/json" }, status: 200 });
  }));
  try {
    mocks.runAssistantAutomationPass.mockImplementation(async (input: RunAssistantAutomationPassInput) => {
      const currentInputId = inputId;
      if (!currentInputId || handledInputIds.has(currentInputId)) return { currentTurnDeliveryIntentIds: [], nextWakeAt: null, progressed: false };
      handledInputIds.add(currentInputId);
      events.push("model.started");
      await input.onProviderRequestStarted?.({
        assistantInputIds: [currentInputId], providerRequestOrdinal: 0,
        source: "linq", startedAt: TEST_NOW,
      });
      if (scenario !== "absent" && scenario !== "cold" && handledInputIds.size === 1) {
        items.push(deviceItem);
        if (persistent) items.push(environmentItem);
        runtimeWakeSignal.notify();
        await withRealTimeout(
          completesBeforeReply ? imported.promise : providerStarted.promise,
          10_000, () => JSON.stringify({events}),
        );
      }
      if (completesBeforeReply) {
        const rows = await listCanonicalEntities(vaultRoot, { family: "event" });
        assert.ok(rows.some((row) => JSON.stringify(row.attributes).includes("synthetic-concurrent-sleep")));
        events.push("model.reads.imported.data");
        if (handledInputIds.size === 2) {
          assert.equal(dirtyAcks.length, 0);
          assert.equal(events.includes("snapshot.completed"), false);
          assert.ok((await readHostedSystemMailboxState(vaultRoot)).pending.some(
            (item) => item.itemId === deviceItem.id,
          ));
        }
      }
      const intent = await createAssistantOutboxIntent({
        channel: "linq", createdAt: TEST_NOW,
        dedupeToken: `synthetic-concurrent-reply:${currentInputId}`,
        explicitTarget: "thread_1", identityId: "synthetic-member",
        message: "Your message is received.", sessionId: "synthetic-concurrent-session",
        threadId: "thread_1", threadIsDirect: true,
        turnId: `turn_${currentInputId}`, turnTrigger: "automation-auto-reply", vault: vaultRoot,
      });
      await writeAssistantAutoReplyReplyTerminalEvidence({
        captureIds: [], deliveryIntentId: intent.intentId, inputIds: [currentInputId],
        outcome: "deferred", recordedAt: TEST_NOW, sessionId: intent.sessionId,
        terminalKind: "reply_intent_committed", vault: vaultRoot,
      });
      events.push("model.finished");
      modelFinishedAt = performance.now();
      return { currentTurnDeliveryIntentIds: [intent.intentId], nextWakeAt: null, progressed: true };
    });
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...baseDevicePort,
      async applyUpdates(request) {
        return {
          appliedAt: request.occurredAt ?? TEST_NOW,
          updates: request.updates.map((update) => ({
            connection: null, connectionId: update.connectionId, status: "updated" as const,
            tokenUpdate: "unchanged" as const, writeUpdate: "applied" as const,
          })),
          userId: TEST_USER_ID,
        };
      },
      async fetchDirtyStates() {
        return {
          hasMore: false, nextWakeAt: null, userId: TEST_USER_ID,
          items: dirtyAcks.length ? [] : [{
            connectionId, dirtyRevision: "7", processedRevision: "0",
            dirtyResources: [{
              count: 1, dirtyPayloadId: "synthetic-concurrent-payload", jobKind: "resource",
              payload: { resourceType: "sleep", resourceId: "synthetic-concurrent-sleep" },
              resource: "sleep", resourceCategory: "summary", sourceProviderSlug: "whoop",
              windowEnd: null, windowStart: null,
            }],
            eventCount: "1", latestDirtyAt: TEST_NOW, provider: "whoop",
            resourceCategoryCounts: { summary: 1 }, sourceProviderCounts: { whoop: 1 },
            userId: TEST_USER_ID, windowEnd: null, windowStart: null,
          }],
        };
      },
      async ackDirtyStateProcessed(request) {
        assert.ok(events.includes("snapshot.completed"));
        assert.ok(checkpointRequests.some((checkpoint) => checkpoint.reason === "idle_shutdown"));
        dirtyAcks.push(request);
        if (scenario === "acknowledgment" && dirtyAcks.length === 1) {
          items.push(createMailboxItem({ id: "mailbox_item_during_acknowledgment", laneSeq: "3" }));
          runtimeWakeSignal.notify();
          assert.ok(request.signal);
          const signal = request.signal;
          await new Promise<void>((_resolve, reject) => {
            const abort = () => reject(signal.reason);
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          });
        }
        return {
          connectionId, dirtyRevision: request.processedRevision,
          processedRevision: request.processedRevision, recorded: true,
          stillDirty: false, nextWakeAt: null, userId: TEST_USER_ID,
        };
      },
    };
    const basePlatform = createPlatform({
      artifactBytesByHash,
      mailboxPort: createMailboxPort({ events, items }),
      workspacePort: createWorkspacePort({ checkpointRequests, events, workspace: createWorkspaceState() }),
      deviceSyncPort,
    });
    runtimeCompletion = runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({
        request: {
          attemptId: "attempt_synthetic_concurrent_import", idleCheckpointDelayMs: 1,
          ...(scenario === "cold" ? { processingMode: "system_mailbox" as const } : {}),
        },
        forwardedEnv: { LINQ_API_TOKEN: "synthetic-linq-token" },
        resolvedConfig: {
          ...createDeviceSyncResolvedConfig(),
          managedAutoReplyChannels: [{ capabilityReady: true, channel: "linq", memberChannel: "linq" }],
        },
      }),
      {
        vaultRoot, runtimeWakeSignal, signal: controller.signal,
        async createCheckpointSnapshot() {
          if (completesBeforeReply || persistent) await releaseSnapshot.promise;
          events.push("snapshot.completed");
          return { snapshotRef: createBundleRef({
            hash: "d".repeat(64), key: "users/bundles/member-synthetic/concurrent-import.bundle.json", size: 512,
          }) };
        },
        async importItem(item) {
          if (item.item.lane === "conversation") {
            if (!inputId && scenario !== "cold") await initializeVault({ createdAt: TEST_NOW, vaultRoot });
            inputId = await stagePendingLinqAssistantInputForMailboxItem({ item: item.item, vaultRoot });
            return { assistantInputId: inputId, status: "imported" };
          }
          if (item.item.kind === "environment-interview.completed") {
            await enqueueEnvironmentInterviewSystemMailboxItemForTest({ item: item.item, vaultRoot });
            events.push("environment.staged");
            return { status: "imported" };
          }
          if (scenario === "cold") await initializeVault({ createdAt: TEST_NOW, vaultRoot });
          await enqueueHostedSystemMailboxItem({
            item: createResolvedDeviceSyncSystemMailboxItem(item.item), vaultRoot,
            wake: {
              connectionId, eventId: deviceItem.dedupeKey, expectedConnectedAt: TEST_NOW,
              hint: { occurredAt: TEST_NOW, reason: "webhook_dirty_transition" },
              kind: "device-sync.wake", occurredAt: TEST_NOW, provider: "whoop", reason: "webhook_hint", userId: TEST_USER_ID,
            },
          });
          events.push("device.staged");
          return { status: "imported" };
        },
        platform: {
          ...basePlatform,
          artifactStore: {
            ...basePlatform.artifactStore,
            async put(artifact) {
              await basePlatform.artifactStore.put(artifact);
              if (new TextDecoder().decode(artifact.bytes).includes('"habitat_upsert"')) {
                events.push("environment.receipt.uploaded");
                environmentImported.resolve();
              }
              if (new TextDecoder().decode(artifact.bytes).includes('"device_batch_import"')) {
                events.push("device.receipt.uploaded");
                imported.resolve();
              }
            },
          },
          providerFetch: fetch,
          effectsPort: {
            async readRawEmailMessage() { return null; },
            async sendEmail() {},
            async assertLinqRecentInboundEngagement() {
              return {
                providerDispatchClaimed: true,
                resolvedRoute: {
                  conversationThreadId: null, directRecipientPhoneNumber: null,
                  fromPhoneNumber: null, target: "thread_1", targetKind: "thread", threadIsDirect: true,
                },
              };
            },
            async recordLinqDeliveryOutcome() {},
          },
        },
      },
    );
    if (scenario === "cold") {
      await withRealTimeout(providerStarted.promise, 5_000, () => events.join(","));
      items.push(createMailboxItem({ id: "mailbox_item_concurrent_conversation", laneSeq: "1" }));
      runtimeWakeSignal.notify();
    }
    if (completesBeforeReply || persistent) {
      await withRealTimeout(Promise.race([
        secondReply.promise,
        runtimeCompletion.then(() => assert.fail("Runtime exited before the second reply.")),
      ]), 5_000, () => events.join(","));
      assert.equal(dirtyAcks.length, 0);
      if (persistent) {
        assert.equal(events.includes("provider.aborted"), false, events.join(","));
        assert.equal(events.filter((event) => event.endsWith("/synthetic-concurrent-sleep")).length, 1);
        await withRealTimeout(environmentImported.promise, 5_000, () => events.join(","));
        assert.equal(events.includes("device.receipt.uploaded"), false, events.join(","));
        const environment = await readHabitatAspect({ slug: "sleep-environment", vaultRoot });
        assert.equal(environment.indicators.night_temp_c, 19);
        releaseDownload.resolve();
        await withRealTimeout(imported.promise, 5_000, () => events.join(","));
      }
      assert.equal(events.filter((event) => event === "device.receipt.uploaded").length, 1);
      releaseSnapshot.resolve();
    }
    await withRealTimeout(runtimeCompletion, 20_000, () => events.join(","));
    assert.ok(replySent, JSON.stringify({ events, intents: await listAssistantOutboxIntents(vaultRoot) }));
    if (completesBeforeReply || persistent) {
      assert.equal(handledInputIds.size, scenario === "acknowledgment" ? 3 : 2);
      assert.equal(events.filter((event) => event === "reply.sent").length, scenario === "acknowledgment" ? 3 : 2);
      assert.equal(dirtyAcks.length, scenario === "acknowledgment" ? 2 : 1, JSON.stringify({events, pending: (await readHostedSystemMailboxState(vaultRoot)).pending}));
      assert.equal(dirtyAcks[0]?.processedRevision, "7");
      assert.deepEqual(dirtyAcks[0]?.processedDirtyPayloadIds, ["synthetic-concurrent-payload"]);
      if (scenario !== "acknowledgment") {
        assert.ok(events.lastIndexOf("reply.sent") < events.indexOf("snapshot.completed"));
      }
      assert.ok(events.indexOf("device.receipt.uploaded") > events.indexOf("model.started"));
      if (completesBeforeReply) {
        assert.ok(events.indexOf("model.reads.imported.data") < events.indexOf("model.finished"));
      } else {
        assert.ok(events.indexOf("device.receipt.uploaded") > events.lastIndexOf("reply.sent"));
        const lastCanonicalCheckpoint = checkpointRequests.filter(
          (checkpoint) => checkpoint.reason === "canonical_runtime_commit",
        ).at(-1);
        const receiptLog = listHostedCanonicalWriteReceiptLogArtifacts(artifactBytesByHash).find(
          (log) => log.sha256 === lastCanonicalCheckpoint?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        );
        assert.ok(receiptLog);
        const operations = receiptLog.entries.map((entry) => {
          assert.ok(entry && typeof entry === "object" && "sha256" in entry && typeof entry.sha256 === "string");
          const bytes = artifactBytesByHash.get(entry.sha256);
          assert.ok(bytes);
          return (JSON.parse(new TextDecoder().decode(bytes)) as { operationType: string }).operationType;
        });
        assert.equal(operations.filter((operation) => operation === "device_batch_import").length, 1);
        assert.equal(operations.filter((operation) => operation === "habitat_upsert").length, 1, JSON.stringify({ events, operations, checkpoints: checkpointRequests.map((request) => ({ reason: request.reason, version: request.expectedWorkspaceVersion, receipt: request.redactedStatus?.hostedCanonicalWriteReceiptLogSha256 })) }));
        const rows = await listCanonicalEntities(vaultRoot, { family: "event" });
        assert.ok(rows.some((row) => JSON.stringify(row.attributes).includes("synthetic-concurrent-sleep")));
      }
    } else if (scenario === "stalled") {
      assert.ok(events.includes("provider.aborted"), events.join(","));
      assert.ok(!events.includes("device.receipt.uploaded")
        || events.indexOf("reply.sent") < events.indexOf("device.receipt.uploaded"), events.join(","));
    }
  } finally {
    releaseDownload.resolve();
    releaseSnapshot.resolve();
    controller.abort();
    await runtimeCompletion?.catch(() => undefined);
    if (originalAutomation) mocks.runAssistantAutomationPass.mockImplementation(originalAutomation);
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});
