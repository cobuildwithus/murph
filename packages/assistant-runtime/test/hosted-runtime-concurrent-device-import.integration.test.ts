import {
  TEST_NOW,
  TEST_USER_ID,
  createSnapshotFixtureRef,
  createDeferred,
  createDeviceSyncResolvedConfig,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createResolvedDeviceSyncSystemMailboxItem,
  createSnapshotDeviceSyncPort,
  buildJunctionSleepFixtureResponse,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  createVaultSnapshotBundle,
  listHostedCanonicalWriteReceiptLogArtifacts,
  mocks,
  removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess,
  stagePendingLinqAssistantInputForMailboxItem,
  withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import assert from "node:assert/strict";
import { mkdtemp, readdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { importDeviceBatch, withCanonicalWriteLock, initializeVault, patchAutomation, upsertAutomation } from "@murphai/core";
import { EVENT_LEDGER_DIRECTORY, eventRecordSchema } from "@murphai/contracts";
import { prepareSyntheticFinalization } from "./device-import-finalization.fixture.ts";
import { createDefaultImporterPort } from "@murphai/device-syncd/service";
import * as deviceService from "../src/device-sync-service.ts";
import { listCanonicalEntities } from "@murphai/query";
import { createAssistantOutboxIntent, listAssistantOutboxIntents, type RunAssistantAutomationPassInput } from "@murphai/assistant-engine";
import { writeAssistantAutoReplyReplyTerminalEvidence } from "@murphai/assistant-engine/assistant-automation";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import type { HostedRuntimeDeviceSyncPort } from "../src/hosted-runtime/platform.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";
import * as maintenanceCancellation from "../src/hosted-runtime/background-maintenance-cancellation.ts";
import { HOSTED_DEVICE_SYNC_PASS_TIMEOUT_MS } from "../src/hosted-runtime/device-sync-maintenance-limits.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";

// Each step does real CPU work, so its duration says more about the host than the product.
// One deadline per test, set inside vitest's 60-second timeout so `finally` still unwinds.
function createTestDeadline(events: string[]) {
  const deadlineAt = performance.now() + 50_000;
  const remainingMs = () => Math.max(deadlineAt - performance.now(), 0);
  return {
    remainingMs,
    within: <T>(step: Promise<T>) => withRealTimeout(step, remainingMs(), () => events.join(",")),
  };
}

test.each(["completed", "stalled", "absent", "persistent", "cold", "reminder", "acknowledgment", "empty-wake", "finalization", "long-finalization"] as const)("preserves foreground delivery with a %s concurrent device import", async (scenario) => {
  const finalization = scenario === "finalization" || scenario === "long-finalization";
  const completesBeforeReply = scenario === "completed" || scenario === "acknowledgment" || scenario === "empty-wake";
  const cold = scenario === "cold" || scenario === "reminder";
  const persistent = scenario === "persistent" || cold;
  const reminderId = "automation_01JQ8PWXP5A68SQM1W0GYM41WZ";
  const reminderAt = new Date(Date.parse(TEST_NOW) + 1_000).toISOString();
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-concurrent-device-import-"));
  const controller = new AbortController();
  const replyDispatched = createDeferred<void>();
  let idleClock: ReturnType<typeof setInterval> | undefined;
  let runtimeCompletion: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
  const events: string[] = [];
  const { remainingMs, within } = createTestDeadline(events);
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const artifactBytesByHash = new Map<string, Uint8Array>();
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const imported = createDeferred<void>();
  const providerStarted = createDeferred<void>();
  const secondReply = createDeferred<void>();
  const releaseSnapshot = createDeferred<void>();
  const releaseDownload = createDeferred<void>();
  const dirtyAcks: Parameters<HostedRuntimeDeviceSyncPort["ackDirtyStateProcessed"]>[0][] = [];
  let replySent = false;
  let idleSnapshotCount = 0;
  const indexing = createDeferred<void>();
  let identityRows = 0;
  let importAttempts = 0;
  let preparationAborts = 0;
  let snapshot: unknown;
  const realCreateService = deviceService.createHostedRuntimeDeviceSyncService;
  const createSpy = vi.spyOn(deviceService, "createHostedRuntimeDeviceSyncService").mockImplementation(input => {
    if (!finalization) return realCreateService(input);
    const importer = createDefaultImporterPort();
    return realCreateService({ ...input, importer: {
      ...importer,
      async importDeviceProviderSnapshot(request, options) {
        importAttempts += 1;
        if (importAttempts === 1) snapshot = request.snapshot;
        else assert.equal(request.snapshot, snapshot, "Retry must retain the fetched snapshot");
        try { return await importer.importDeviceProviderSnapshot(request, options); }
        catch (error) {
          assert.equal(options?.signal?.aborted, true);
          preparationAborts += 1;
          throw error;
        }
      },
    } });
  });
  const parse = eventRecordSchema.safeParse.bind(eventRecordSchema);
  const parseSpy = vi.spyOn(eventRecordSchema, "safeParse").mockImplementation((...args) => {
    const record = args[0];
    if (finalization && record && typeof record === "object" && "title" in record
      && record.title === "Synthetic identity history" && importAttempts > 0) {
      identityRows += 1;
      if (identityRows === 256) indexing.resolve();
    }
    return parse(...args);
  });
  const connectionId = "synthetic-concurrent-connection";
  const deviceItem = createMailboxItem({
    id: "mailbox_item_concurrent_device",
    dedupeKey: "device-sync.wake:concurrent-import",
    kind: "device-sync.wake", lane: "system", laneSeq: "1",
  });
  const items = cold ? [deviceItem]
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
      replyDispatched.resolve();
      if (completesBeforeReply || persistent) {
        if (replySent) {
          secondReply.resolve();
        } else {
          items.push(createMailboxItem({ id: "mailbox_item_concurrent_followup", laneSeq: scenario === "reminder" ? "1" : "2" }));
          runtimeWakeSignal.notify();
        }
      }
      replySent = true;
      return new Response(JSON.stringify({ message: { id: "synthetic-concurrent-reply" } }), {
        headers: { "content-type": "application/json" }, status: 200,
      });
    }
    events.push(`provider.fetch:${pathname}`);
    if (pathname.includes("/summary/sleep/")) {
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
    return new Response(JSON.stringify(buildJunctionSleepFixtureResponse(pathname, {
      id: "synthetic-concurrent-sleep",
      start: "2026-04-26T00:30:00.000Z", end: "2026-04-26T07:30:00.000Z",
      updated_at: "2026-04-26T08:00:00.000Z",
    })), { headers: { "content-type": "application/json" }, status: 200 });
  }));
  try {
    mocks.runAssistantAutomationPass.mockImplementation(async (input: RunAssistantAutomationPassInput) => {
      const scheduledOccurrence = scenario === "reminder" && !inputId;
      const currentInputId = scheduledOccurrence ? `${reminderId}:${reminderAt}` : inputId;
      if (!currentInputId || handledInputIds.has(currentInputId)) return { currentTurnDeliveryIntentIds: [], nextWakeAt: null, progressed: false };
      if (scheduledOccurrence) assert.ok(Date.now() >= Date.parse(reminderAt));
      handledInputIds.add(currentInputId);
      const finalize = finalization ? await prepareSyntheticFinalization(vaultRoot, TEST_NOW) : null;
      const release = finalization ? await input.beforeProviderAcceptedInputs?.({
        acceptedInputs: [{ id: currentInputId, source: "assistant-input" }], turnId: "synthetic-finalization",
      }) : null;
      events.push("model.started");
      await input.onProviderRequestStarted?.({
        assistantInputIds: scheduledOccurrence ? [] : [currentInputId], providerRequestOrdinal: 0,
        source: "linq", startedAt: TEST_NOW,
      });
      if (scenario !== "absent" && !cold && handledInputIds.size === 1) {
        items.push(deviceItem);
        runtimeWakeSignal.notify();
        await within(
          finalization ? indexing.promise : completesBeforeReply ? imported.promise : providerStarted.promise,
        );
      }
      if (completesBeforeReply) {
        const rows = await listCanonicalEntities(vaultRoot, { family: "event" });
        assert.deepEqual(rows.filter((row) => row.kind === "sleep_session").map((row) => ({
          occurredAt: row.occurredAt, startAt: row.attributes.startAt,
          endAt: row.attributes.endAt, durationMinutes: row.attributes.durationMinutes,
          dataOrigin: row.attributes.dataOrigin,
        })), [{
          occurredAt: "2026-04-26T07:30:00.000Z", startAt: "2026-04-26T00:30:00.000Z",
          endAt: "2026-04-26T07:30:00.000Z", durationMinutes: 420,
          dataOrigin: { version: 1, aggregatorProvider: "junction", sourceProviderSlug: "whoop-v2",
            normalizerVersion: "junction-normalizer.v1", observedAtRaw: "2026-04-26T00:00:00.000Z", timestampSemantics: "utc" },
        }]);
        events.push("model.reads.imported.data");
        if (handledInputIds.size === 2) {
          assert.equal(dirtyAcks.length, 0);
          assert.equal(events.includes("snapshot.completed"), false);
          assert.ok((await readHostedSystemMailboxState(vaultRoot)).pending.some(
            (item) => item.itemId === deviceItem.id,
          ));
        }
      }
      if (finalization) {
        assert.ok(identityRows >= 256 && identityRows < 32_000, "Provider must return during real indexing");
        if (scenario === "long-finalization") vi.setSystemTime(Date.now() + 31_000);
        await release?.();
        await finalize?.();
        await withCanonicalWriteLock(vaultRoot, async () => {
          events.push("foreground.lock.acquired");
        });
      }
      const intent = await createAssistantOutboxIntent({
        channel: "linq", createdAt: TEST_NOW,
        dedupeToken: `synthetic-concurrent-reply:${currentInputId}`,
        explicitTarget: "thread_1", identityId: "synthetic-member",
        message: "Your message is received.", sessionId: "synthetic-concurrent-session",
        threadId: "thread_1", threadIsDirect: true,
        turnId: scheduledOccurrence ? "turn_synthetic_reminder" : `turn_${currentInputId}`,
        ...(scheduledOccurrence ? {} : { turnTrigger: "automation-auto-reply" as const }), vault: vaultRoot,
      });
      if (scheduledOccurrence) {
        // The model stand-in completes this one occurrence; runtime admission,
        // provider dispatch, import persistence and acknowledgment stay real.
        await patchAutomation({ lookup: reminderId, now: new Date(), status: "archived", vaultRoot });
      } else await writeAssistantAutoReplyReplyTerminalEvidence({
        captureIds: [], deliveryIntentId: intent.intentId, inputIds: [currentInputId],
        outcome: "deferred", recordedAt: TEST_NOW, sessionId: intent.sessionId,
        terminalKind: "reply_intent_committed", vault: vaultRoot,
      });
      events.push("model.finished");
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
              payload: { resource: "sleep", resourceCategory: "summary", sourceProviderSlug: "whoop_v2", objectId: "synthetic-concurrent-sleep" },
              resource: "sleep", resourceCategory: "summary", sourceProviderSlug: "whoop",
              windowEnd: null, windowStart: null,
            }],
            eventCount: "1", latestDirtyAt: TEST_NOW, provider: "junction",
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
      ...(scenario === "empty-wake" ? {
        vaultSharePort: {
          async listActiveProjectionScopes() {
            vi.setSystemTime(Date.now() + 1_000);
            runtimeWakeSignal.notify();
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { projectionKinds: [], projectionScopes: [] };
          },
          async deliver() { throw new Error("No projection scopes are active."); },
        },
      } : {}),
      mailboxPort: createMailboxPort({ events, items }),
      workspacePort: createWorkspacePort({ checkpointRequests, events, workspace: createWorkspaceState() }),
      deviceSyncPort,
    });
    runtimeCompletion = runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({
        request: {
          attemptId: "attempt_synthetic_concurrent_import", runnerIdleTtlMs: finalization ? 60_000 : 1,
          ...(cold ? { processingMode: "system_mailbox" as const } : {}),
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
          idleSnapshotCount += 1;
          if (scenario === "empty-wake") {
            assert.ok(idleSnapshotCount <= 3, "Empty wakes starved the device completion acknowledgment.");
          }
          if (completesBeforeReply || persistent) await releaseSnapshot.promise;
          events.push("snapshot.completed");
          return { snapshotRef: createSnapshotFixtureRef({
            hash: "d".repeat(64), size: 512,
          }) };
        },
        async importItem(item) {
          if (item.item.lane === "conversation") {
            if (!inputId && !cold) {
              await initializeVault({ createdAt: TEST_NOW, vaultRoot });
              if (finalization) {
                for (let batch = 0; batch < 4; batch += 1) {
                  await importDeviceBatch({ vaultRoot, provider: "synthetic",
                    events: Array.from({ length: 8_000 }, (_, i) => ({
                      kind: "observation" as const, occurredAt: "2026-01-01T00:00:00.000Z",
                      recordedAt: TEST_NOW, title: "Synthetic identity history",
                      externalRef: { system: "synthetic", resourceType: "metric", resourceId: `history-${batch}-${i}` },
                      fields: { metric: "synthetic", unit: "count", value: 1 },
                    })),
                  });
                }
                // Model a fresh restore: shard metadata this process never observed
                // invalidates the warm identity cache, forcing the cold build.
                const restoredAt = new Date(Date.parse(TEST_NOW) + 60_000);
                for (const entry of await readdir(path.join(vaultRoot, EVENT_LEDGER_DIRECTORY), { recursive: true, withFileTypes: true })) {
                  if (entry.isFile()) await utimes(path.join(entry.parentPath, entry.name), restoredAt, restoredAt);
                }
              }
            }
            inputId = await stagePendingLinqAssistantInputForMailboxItem({ item: item.item, vaultRoot });
            return { assistantInputId: inputId, status: "imported" };
          }
          if (cold) await initializeVault({ createdAt: TEST_NOW, vaultRoot });
          if (scenario === "reminder") {
            await upsertAutomation({
              automationId: reminderId, continuityPolicy: "fresh",
              instructions: "Send one synthetic scheduled reminder.", now: new Date(TEST_NOW),
              route: { channel: "linq", deliveryTarget: "thread_1", identityId: null,
                participantId: null, threadId: "thread_1", threadIsDirect: true },
              schedule: { at: reminderAt, kind: "at" }, status: "active",
              title: "Synthetic concurrent reminder", vaultRoot,
            });
          }
          await enqueueHostedSystemMailboxItem({
            item: createResolvedDeviceSyncSystemMailboxItem(item.item), vaultRoot,
            wake: {
              connectionId, eventId: deviceItem.dedupeKey, expectedConnectedAt: TEST_NOW,
              hint: { occurredAt: TEST_NOW, reason: "webhook_dirty_transition" },
              kind: "device-sync.wake", occurredAt: TEST_NOW, provider: "junction", reason: "webhook_hint", userId: TEST_USER_ID,
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
    if (cold) {
      await within(providerStarted.promise);
      if (scenario === "reminder") {
        // No conversation or external wake announces this local deadline.
        vi.setSystemTime(new Date(reminderAt));
      } else {
        items.push(createMailboxItem({ id: "mailbox_item_concurrent_conversation", laneSeq: "1" }));
        runtimeWakeSignal.notify();
      }
    }
    if (completesBeforeReply || persistent) {
      await within(Promise.race([
        secondReply.promise,
        runtimeCompletion.then(() => assert.fail("Runtime exited before the second reply.")),
      ]));
      assert.equal(dirtyAcks.length, 0);
      if (persistent) {
        assert.equal(events.includes("provider.aborted"), false, events.join(","));
        assert.equal(events.filter((event) => event.includes("/summary/sleep/")).length, 1);
        assert.equal(events.includes("device.receipt.uploaded"), false, events.join(","));
        releaseDownload.resolve();
        await within(imported.promise);
      }
      assert.equal(events.filter((event) => event === "device.receipt.uploaded").length, 1);
      releaseSnapshot.resolve();
    }
    if (finalization) {
      // Keep this invocation alive through the retry. A 1-ms idle fixture can
      // legitimately shut down between dispatch and resumed preparation.
      await within(replyDispatched.promise);
      assert.equal(preparationAborts, 1);
      assert.ok(events.includes("foreground.lock.acquired"));
      await vi.waitFor(async () => {
        const item = (await readHostedSystemMailboxState(vaultRoot)).pending.find(item => item.itemId === deviceItem.id);
        assert.equal(item?.status, "recording");
      }, { timeout: remainingMs(), interval: 25 });
      // Advance the fake idle clock only after the retained import is durable. Each tick expires
      // one idle window. A wake cancels an idle checkpoint in flight, so ticks stay far apart.
      idleClock = setInterval(() => {
        vi.setSystemTime(Date.now() + 61_000);
        runtimeWakeSignal.notify();
      }, 500);
    }
    await within(runtimeCompletion);
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
          (checkpoint) => checkpoint.reason === "canonical_runtime_commit"
            && checkpoint.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
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
        const rows = await listCanonicalEntities(vaultRoot, { family: "event" });
        assert.deepEqual(rows.filter((row) => row.kind === "sleep_session").map((row) => ({
          occurredAt: row.occurredAt, startAt: row.attributes.startAt,
          endAt: row.attributes.endAt, durationMinutes: row.attributes.durationMinutes,
          dataOrigin: row.attributes.dataOrigin,
        })), [{
          occurredAt: "2026-04-26T07:30:00.000Z", startAt: "2026-04-26T00:30:00.000Z",
          endAt: "2026-04-26T07:30:00.000Z", durationMinutes: 420,
          dataOrigin: { version: 1, aggregatorProvider: "junction", sourceProviderSlug: "whoop-v2",
            normalizerVersion: "junction-normalizer.v1", observedAtRaw: "2026-04-26T00:00:00.000Z", timestampSemantics: "utc" },
        }]);
      }
    } else if (finalization) {
      assert.equal(events.filter(event => event === "reply.sent").length, 1);
      assert.equal(importAttempts, 2);
      assert.equal(preparationAborts, 1);
      assert.equal(events.filter(event => event.includes("/summary/sleep/")).length, 1);
      assert.equal(events.slice(events.indexOf("model.started")).filter(event => event === "device.receipt.uploaded").length, 1);
      assert.equal(dirtyAcks.length, 1);
      assert.equal(dirtyAcks[0]?.processedRevision, "7");
      assert.deepEqual(dirtyAcks[0]?.processedDirtyPayloadIds, ["synthetic-concurrent-payload"]);
      // Each maintenance pass sets a retry fence and clears it on completion.
      // A later pass that yields at shutdown can leave its fence pending.
      assert.ok(!(await readHostedSystemMailboxState(vaultRoot)).pending.some(item => item.itemId === deviceItem.id));
      assert.ok(events.indexOf("reply.sent") < events.lastIndexOf("device.receipt.uploaded"));
      const rows = await listCanonicalEntities(vaultRoot, { family: "event" });
      assert.equal(rows.filter(row => row.kind === "sleep_session").length, 1);
    } else if (scenario === "stalled") {
      assert.ok(events.includes("provider.aborted"), events.join(","));
      assert.ok(events.indexOf("reply.sent") < events.indexOf("provider.aborted"), events.join(","));
      assert.ok(!events.includes("device.receipt.uploaded")
        || events.indexOf("reply.sent") < events.indexOf("device.receipt.uploaded"), events.join(","));
    }
  } finally {
    if (idleClock) clearInterval(idleClock);
    releaseDownload.resolve();
    releaseSnapshot.resolve();
    controller.abort();
    await runtimeCompletion?.catch(() => undefined);
    if (originalAutomation) mocks.runAssistantAutomationPass.mockImplementation(originalAutomation);
    parseSpy.mockRestore();
    createSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});


test.each(["workspace boundary", "pass timeout"] as const)("retains unstarted device work after %s and imports it after restore", async (scenario) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-preload-retry-"));
  const controller = new AbortController();
  let runtimeCompletion: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
  const preloadStarted = createDeferred<void>();
  const preloadAborted = createDeferred<void>();
  const events: string[] = [];
  const { within } = createTestDeadline(events);
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const artifactBytesByHash = new Map<string, Uint8Array>();
  const connectionId = "synthetic-preload-connection";
  const deviceItem = createMailboxItem({
    id: "mailbox_item_preload_retry", dedupeKey: "device-sync.wake:preload-retry",
    kind: "device-sync.wake", lane: "system", laneSeq: "1",
  });
  const wake = {
    connectionId, eventId: deviceItem.dedupeKey, expectedConnectedAt: TEST_NOW,
    hint: { occurredAt: TEST_NOW, reason: "webhook_dirty_transition" },
    kind: "device-sync.wake" as const, occurredAt: TEST_NOW, provider: "junction" as const,
    reason: "webhook_hint" as const, userId: TEST_USER_ID,
  };
  let firstInvocation = true;
  let snapshots = 0;
  let acknowledgments = 0;
  let preloadAbortReason: unknown;
  const originalCancellation = maintenanceCancellation.createHostedBackgroundMaintenanceCancellation;
  const cancellationSpy = vi.spyOn(maintenanceCancellation, "createHostedBackgroundMaintenanceCancellation")
    .mockImplementation((input) => {
      if (input.timeoutMs !== HOSTED_DEVICE_SYNC_PASS_TIMEOUT_MS) return originalCancellation(input);
      assert.equal(input.shouldYield?.() ?? false, false);
      return originalCancellation({
        ...input,
        timeoutMs: firstInvocation && scenario === "pass timeout" ? 200 : input.timeoutMs,
      });
    });
  const baseDevicePort = createSnapshotDeviceSyncPort({
    connectionId, nextReconcileAt: "2099-01-01T00:00:00.000Z",
    async onFetchSnapshot(signal) {
      if (!firstInvocation) return;
      assert.ok(signal);
      preloadStarted.resolve();
      await new Promise<void>((_, reject) => {
        const abort = () => {
          preloadAbortReason = signal.reason;
          events.push("preload.aborted");
          preloadAborted.resolve();
          reject(signal.reason);
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    },
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
        items: acknowledgments ? [] : [{
          connectionId, dirtyRevision: "7", processedRevision: "0",
          dirtyResources: [{
            count: 1, dirtyPayloadId: "synthetic-preload-payload", jobKind: "resource",
            payload: { resource: "sleep", resourceCategory: "summary", sourceProviderSlug: "whoop_v2", objectId: "synthetic-preload-sleep" },
            resource: "sleep", resourceCategory: "summary", sourceProviderSlug: "whoop",
            windowEnd: null, windowStart: null,
          }],
          eventCount: "1", latestDirtyAt: TEST_NOW, provider: "junction",
          resourceCategoryCounts: { summary: 1 }, sourceProviderCounts: { whoop: 1 },
          userId: TEST_USER_ID, windowEnd: null, windowStart: null,
        }],
      };
    },
    async ackDirtyStateProcessed(request) {
      assert.equal(firstInvocation, false);
      const rows = await listCanonicalEntities(vaultRoot, { family: "event" });
      assert.deepEqual(rows.filter((row) => row.kind === "sleep_session").map((row) => ({
          occurredAt: row.occurredAt, startAt: row.attributes.startAt,
          endAt: row.attributes.endAt, durationMinutes: row.attributes.durationMinutes,
          dataOrigin: row.attributes.dataOrigin,
        })), [{
          occurredAt: "2026-04-26T07:30:00.000Z", startAt: "2026-04-26T00:30:00.000Z",
          endAt: "2026-04-26T07:30:00.000Z", durationMinutes: 420,
          dataOrigin: { version: 1, aggregatorProvider: "junction", sourceProviderSlug: "whoop-v2",
            normalizerVersion: "junction-normalizer.v1", observedAtRaw: "2026-04-26T00:00:00.000Z", timestampSemantics: "utc" },
        }]);
      assert.ok(checkpointRequests.some((request) => request.reason === "idle_shutdown"));
      assert.deepEqual(request.processedDirtyPayloadIds, ["synthetic-preload-payload"]);
      assert.equal(request.processedRevision, "7");
      acknowledgments += 1;
      return { ...request, dirtyRevision: "7", nextWakeAt: null, recorded: true, stillDirty: false, userId: TEST_USER_ID };
    },
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(TEST_NOW));
  vi.stubGlobal("fetch", vi.fn(async (request: string | URL | Request) => new Response(JSON.stringify(buildJunctionSleepFixtureResponse(new URL(request instanceof Request ? request.url : String(request)).pathname, {
    id: "synthetic-preload-sleep",
    start: "2026-04-26T00:30:00.000Z", end: "2026-04-26T07:30:00.000Z",
    updated_at: "2026-04-26T08:00:00.000Z",
  })), { headers: { "content-type": "application/json" } })));
  try {
    let workspace = createWorkspaceState();
    const run = () => runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
      request: {
        attemptId: firstInvocation ? "attempt_preload_initial" : "attempt_preload_restore",
        runnerIdleTtlMs: 1, workspace, workspaceVersion: workspace.version,
        ...(firstInvocation ? {} : { processingMode: "system_mailbox" as const }),
      },
      resolvedConfig: createDeviceSyncResolvedConfig(),
    }), {
      vaultRoot, signal: controller.signal,
      async createCheckpointSnapshot() {
        const snapshot = await createVaultSnapshotBundle({
          vaultRoot,
        });
        artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
        return { snapshotRef: snapshot.snapshotRef };
      },
      async importItem(item) {
        await initializeVault({ createdAt: TEST_NOW, vaultRoot });
        await enqueueHostedSystemMailboxItem({ item: createResolvedDeviceSyncSystemMailboxItem(item.item), wake, vaultRoot });
        return { status: "imported" };
      },
      async runAssistantPhase() {
        assert.equal(firstInvocation, true);
        await preloadStarted.promise;
        if (scenario === "pass timeout") await preloadAborted.promise;
        return { progressed: false };
      },
      platform: createPlatform({
        artifactBytesByHash, deviceSyncPort,
        mailboxPort: createMailboxPort({ events, items: firstInvocation ? [deviceItem] : [] }),
        workspacePort: createWorkspacePort({ events, checkpointRequests, workspace }),
      }),
    });
    runtimeCompletion = run();
    await within(runtimeCompletion);
    assert.equal(controller.signal.aborted, false);
    assert.ok(preloadAbortReason instanceof Error);
    assert.equal(preloadAbortReason.message, scenario === "workspace boundary"
      ? "Workspace boundary paused background work."
      : "Background maintenance exceeded its time budget.");
    assert.equal(acknowledgments, 0);
    const pending = (await readHostedSystemMailboxState(vaultRoot)).pending;
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.itemId, deviceItem.id);
    assert.deepEqual(pending[0]?.wake, wake);
    assert.equal(pending[0]?.status, "pending");
    assert.equal(pending[0]?.postCheckpointRecord, null);
    const retryAt = "2026-04-27T00:00:30.000Z";
    assert.equal(pending[0]?.nextAttemptAt, retryAt);
    const checkpoint = checkpointRequests.at(-1);
    assert.ok(checkpoint);
    assert.equal(checkpoint.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "0");
    assert.equal(checkpoint.nextWakeAt, retryAt);
    workspace = createWorkspaceState({
      snapshotRef: checkpoint.snapshotRef, redactedStatus: checkpoint.redactedStatus,
      nextWakeAt: checkpoint.nextWakeAt, nextWakeReason: checkpoint.nextWakeReason,
      systemMailboxProgressGeneration: checkpoint.systemMailboxProgressGeneration,
      version: String(BigInt(checkpoint.expectedWorkspaceVersion) + 1n),
    });
    firstInvocation = false;
    checkpointRequests.length = 0;
    vi.setSystemTime(new Date(retryAt));
    runtimeCompletion = run();
    await within(runtimeCompletion);
    assert.equal(acknowledgments, 1, JSON.stringify({ events, pending: (await readHostedSystemMailboxState(vaultRoot)).pending.map((item) => ({ status: item.status, error: item.lastErrorCode })) }));
    assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);
    assert.equal(checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "1");
  } finally {
    controller.abort();
    await runtimeCompletion?.catch(() => undefined);
    cancellationSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});
