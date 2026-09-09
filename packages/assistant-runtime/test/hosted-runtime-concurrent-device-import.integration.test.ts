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
import { initializeVault } from "@murphai/core";
import { listCanonicalEntities } from "@murphai/query";
import { createAssistantOutboxIntent, listAssistantOutboxIntents, type RunAssistantAutomationPassInput } from "@murphai/assistant-engine";
import { writeAssistantAutoReplyReplyTerminalEvidence } from "@murphai/assistant-engine/assistant-automation";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";

test.each(["completed", "stalled", "absent"] as const)("preserves foreground delivery with a %s concurrent device import", async (scenario) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-concurrent-device-import-"));
  const controller = new AbortController();
  let runtimeCompletion: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const imported = createDeferred<void>();
  const providerStarted = createDeferred<void>();
  let replySent = false;
  let modelFinishedAt = 0;
  let replySentAt = 0;
  const connectionId = "synthetic-concurrent-connection";
  const deviceItem = createMailboxItem({
    id: "mailbox_item_concurrent_device",
    dedupeKey: "device-sync.wake:concurrent-import",
    kind: "device-sync.wake", lane: "system", laneSeq: "1",
  });
  const items = [createMailboxItem({ id: "mailbox_item_concurrent_conversation", laneSeq: "1" })];
  const baseDevicePort = createSnapshotDeviceSyncPort({
    connectionId,
    nextReconcileAt: "2099-01-01T00:00:00.000Z",
  });
  const originalAutomation = mocks.runAssistantAutomationPass.getMockImplementation();
  let inputId: string | null = null;
  let modelStarted = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(TEST_NOW));
  vi.stubGlobal("fetch", vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
    const pathname = new URL(request instanceof Request ? request.url : String(request)).pathname;
    if (pathname.includes("/messages")) {
      events.push("reply.sent");
      replySentAt = performance.now();
      replySent = true;
      return new Response(JSON.stringify({ message: { id: "synthetic-concurrent-reply" } }), {
        headers: { "content-type": "application/json" }, status: 200,
      });
    }
    events.push(`provider.fetch:${pathname}`);
    if (pathname.endsWith("/synthetic-concurrent-sleep")) {
      providerStarted.resolve();
      if (scenario === "stalled" && !replySent) {
        const signal = init?.signal ?? (request instanceof Request ? request.signal : null);
        assert.ok(signal);
        await new Promise<never>((_, reject) => {
          const abort = () => {
            events.push("provider.aborted");
            reject(signal.reason);
          };
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
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
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    mocks.runAssistantAutomationPass.mockImplementation(async (input: RunAssistantAutomationPassInput) => {
      if (!inputId || modelStarted) return { currentTurnDeliveryIntentIds: [], nextWakeAt: null, progressed: false };
      modelStarted = true;
      events.push("model.started");
      await input.onProviderRequestStarted?.({
        assistantInputIds: [inputId], providerRequestOrdinal: 0,
        source: "linq", startedAt: TEST_NOW,
      });
      if (scenario !== "absent") {
        items.push(deviceItem);
        runtimeWakeSignal.notify();
        await withRealTimeout(
          scenario === "completed" ? imported.promise : providerStarted.promise,
          10_000, () => JSON.stringify({events}),
        );
      }
      if (scenario === "completed") {
        const rows = await listCanonicalEntities(vaultRoot, { family: "event" });
        assert.ok(rows.some((row) => JSON.stringify(row.attributes).includes("synthetic-concurrent-sleep")));
        events.push("model.reads.imported.data");
      }
      const intent = await createAssistantOutboxIntent({
        channel: "linq", createdAt: TEST_NOW,
        dedupeToken: `synthetic-concurrent-reply:${inputId}`,
        explicitTarget: "thread_1", identityId: "synthetic-member",
        message: "Your message is received.", sessionId: "synthetic-concurrent-session",
        threadId: "thread_1", threadIsDirect: true,
        turnId: `turn_${inputId}`, turnTrigger: "automation-auto-reply", vault: vaultRoot,
      });
      await writeAssistantAutoReplyReplyTerminalEvidence({
        captureIds: [], deliveryIntentId: intent.intentId, inputIds: [inputId],
        outcome: "deferred", recordedAt: TEST_NOW, sessionId: intent.sessionId,
        terminalKind: "reply_intent_committed", vault: vaultRoot,
      });
      events.push("model.finished");
      modelFinishedAt = performance.now();
      return { currentTurnDeliveryIntentIds: [intent.intentId], nextWakeAt: null, progressed: true };
    });
    const basePlatform = createPlatform({
      mailboxPort: createMailboxPort({ events, items }),
      workspacePort: createWorkspacePort({ checkpointRequests, events, workspace: createWorkspaceState() }),
      deviceSyncPort: baseDevicePort,
    });
    runtimeCompletion = runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({
        request: { attemptId: "attempt_synthetic_concurrent_import", idleCheckpointDelayMs: 1 },
        forwardedEnv: { LINQ_API_TOKEN: "synthetic-linq-token" },
        resolvedConfig: {
          ...createDeviceSyncResolvedConfig(),
          managedAutoReplyChannels: [{ capabilityReady: true, channel: "linq", memberChannel: "linq" }],
        },
      }),
      {
        vaultRoot, runtimeWakeSignal, signal: controller.signal,
        async createCheckpointSnapshot() {
          return { snapshotRef: createBundleRef({
            hash: "d".repeat(64), key: "users/bundles/member-synthetic/concurrent-import.bundle.json", size: 512,
          }) };
        },
        async importItem(item) {
          if (item.item.lane === "conversation") {
            await initializeVault({ createdAt: TEST_NOW, vaultRoot });
            inputId = await stagePendingLinqAssistantInputForMailboxItem({ item: item.item, vaultRoot });
            return { assistantInputId: inputId, status: "imported" };
          }
          await enqueueHostedSystemMailboxItem({
            item: createResolvedDeviceSyncSystemMailboxItem(item.item), vaultRoot,
            wake: {
              connectionId, eventId: deviceItem.dedupeKey, expectedConnectedAt: TEST_NOW,
              hint: { occurredAt: TEST_NOW, reason: "webhook_dirty_transition", jobs: [{
                availableAt: TEST_NOW, dedupeKey: "synthetic-concurrent-resource", kind: "resource", maxAttempts: 1, priority: 30,
                payload: { resourceType: "sleep", resourceId: "synthetic-concurrent-sleep" },
              }] },
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
    await withRealTimeout(runtimeCompletion, 20_000, () => events.join(","));
    assert.ok(replySent, JSON.stringify({ events, intents: await listAssistantOutboxIntents(vaultRoot) }));
    assert.ok(replySentAt - modelFinishedAt < 2_000, events.join(","));
    if (scenario === "completed") {
      assert.ok(events.indexOf("device.receipt.uploaded") > events.indexOf("model.started"));
      assert.ok(events.indexOf("model.reads.imported.data") < events.indexOf("model.finished"));
    } else if (scenario === "stalled") {
      assert.ok(events.includes("provider.aborted"), events.join(","));
      assert.ok(!events.includes("device.receipt.uploaded")
        || events.indexOf("reply.sent") < events.indexOf("device.receipt.uploaded"), events.join(","));
    }
  } finally {
    controller.abort();
    await runtimeCompletion?.catch(() => undefined);
    if (originalAutomation) mocks.runAssistantAutomationPass.mockImplementation(originalAutomation);
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});
