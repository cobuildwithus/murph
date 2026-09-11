import {
  TEST_NOW,
  createBrowserVaultReplicaRef,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createSnapshotFixtureRef,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  enqueueEnvironmentInterviewSystemMailboxItemForTest,
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
import { parseBrowserVaultReplica } from "@murphai/query/browser";
import {
  applyMurphManagedAutomations,
  createAssistantOutboxIntent,
  readAssistantInputEvent,
  type RunAssistantAutomationPassInput,
} from "@murphai/assistant-engine";
import { writeAssistantAutoReplyReplyTerminalEvidence } from "@murphai/assistant-engine/assistant-automation";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";
import { runHostedWorkspaceAssistantPhase } from "../src/hosted-runtime/workspace-assistant-phase.ts";
import { readHostedAssistantInputCurrentDeliveryRoute } from "../src/hosted-runtime/current-delivery-route.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";

test.each([false, true])("publishes durable Environment completion before maintenance (foreground interruption: %s)", async (interruptPublication) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-environment-followup-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  let assistantPasses = 0;
  let idleCheckpoints = 0;
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const attemptId = "attempt_synthetic_environment_followup";
  const originalAutomation = mocks.runAssistantAutomationPass.getMockImplementation();
  const controller = new AbortController();
  let runtimeCompletion: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
  let inputId: string | null = null;
  let replied = false;
  const environmentItem = createMailboxItem({
    id: "mailbox_item_synthetic_environment_followup",
    dedupeKey: "environment-interview.completed:synthetic-followup",
    kind: "environment-interview.completed", lane: "system", laneSeq: "1",
  });
  const items = [createMailboxItem({ id: "mailbox_item_synthetic_foreground", laneSeq: "1" })];
  const facts = () => JSON.stringify({
    assistantPasses,
    idleCheckpoints,
    replySent: events.includes("reply.sent"),
    replicaPublished: events.includes("replica.publish"),
  });
  vi.stubGlobal("fetch", vi.fn(async (request: string | URL | Request) => {
    const pathname = new URL(request instanceof Request ? request.url : String(request)).pathname;
    if (pathname.endsWith("/messages/synthetic-environment-reply")) return new Response(null, { status: 204 });
    assert.ok(pathname.endsWith("/messages"));
    events.push("reply.sent");
    return new Response(JSON.stringify({ message: { id: "synthetic-environment-reply" } }), {
      headers: { "content-type": "application/json" }, status: 200,
    });
  }));
  try {
    mocks.runAssistantAutomationPass.mockImplementation(async (input: RunAssistantAutomationPassInput) => {
      if (!inputId || replied) return { currentTurnDeliveryIntentIds: [], nextWakeAt: null, progressed: false };
      replied = true;
      await input.onProviderRequestStarted?.({ assistantInputIds: [inputId], providerRequestOrdinal: 0, source: "linq", startedAt: TEST_NOW });
      items.push(environmentItem);
      runtimeWakeSignal.notify();
      events.push("environment.queued");
      const intent = await createAssistantOutboxIntent({
        channel: "linq", createdAt: TEST_NOW, dedupeToken: "synthetic-environment-reply",
        explicitTarget: "thread_1", identityId: "synthetic-member", message: "Your message is received.",
        sessionId: "synthetic-environment-session", threadId: "thread_1", threadIsDirect: true,
        turnId: "synthetic-environment-turn", turnTrigger: "automation-auto-reply", vault: vaultRoot,
      });
      await writeAssistantAutoReplyReplyTerminalEvidence({
        captureIds: [], deliveryIntentId: intent.intentId, inputIds: [inputId], outcome: "deferred",
        recordedAt: TEST_NOW, sessionId: intent.sessionId, terminalKind: "reply_intent_committed", vault: vaultRoot,
      });
      return { currentTurnDeliveryIntentIds: [intent.intentId], nextWakeAt: null, progressed: true };
    });
    let currentWorkspace = createWorkspaceState();
    const workspacePort = createWorkspacePort({ checkpointRequests, events, workspace: currentWorkspace });
    let checkpointWakeSent = false;
    const basePlatform = createPlatform({
      events, artifactBytesByHash: new Map<string, Uint8Array>(),
      mailboxPort: createMailboxPort({ events, items }),
      workspacePort: {
        ...workspacePort,
        async read() { return { fetchedAt: TEST_NOW, workspace: currentWorkspace }; },
        async checkpoint(request) {
          const result = await workspacePort.checkpoint(request);
          currentWorkspace = {
            ...result.workspace,
            browserVaultReplicaRef: currentWorkspace.browserVaultReplicaRef,
          };
          if (request.reason === "idle_shutdown") idleCheckpoints += 1;
          if (request.reason === "idle_shutdown" && !checkpointWakeSent) {
            checkpointWakeSent = true;
            runtimeWakeSignal.notify();
          }
          return { ...result, workspace: currentWorkspace };
        },
      },
      browserVaultReplicaPort: {
        async write({ replica }) {
          assert.ok(idleCheckpoints >= 2, "Publish only after Environment recording is checkpointed.");
          assert.equal(currentWorkspace.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "1");
          const habitat = parseBrowserVaultReplica(replica).entities.find((entity) => entity.family === "habitat" && entity.attributes.aspect === "sleep-environment");
          const indicators = habitat?.attributes.indicators;
          assert.ok(indicators && typeof indicators === "object" && "night_temp_c" in indicators);
          assert.equal(indicators.night_temp_c, 19);
          events.push("replica.write");
          return createBrowserVaultReplicaRef(replica);
        },
        async publishRef({ replicaRef, signal }) {
          if (interruptPublication) {
            items.push(createMailboxItem({ id: "mailbox_item_synthetic_new_foreground", laneSeq: "2" }));
            runtimeWakeSignal.notify();
            assert.ok(signal);
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else signal.addEventListener("abort", () => resolve(), { once: true });
            });
            signal.throwIfAborted();
          }
          events.push("replica.publish");
          currentWorkspace = { ...currentWorkspace, browserVaultReplicaRef: replicaRef };
          return { published: true, workspace: currentWorkspace };
        },
      },
      vaultSharePort: {
        async listActiveProjectionScopes() { return { projectionKinds: [], projectionScopes: [] }; },
        async deliver() { throw new Error("No projection scopes are active."); },
      },
    });
    runtimeCompletion = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
      request: { attemptId, idleCheckpointDelayMs: 1_500 },
      forwardedEnv: { LINQ_API_TOKEN: "synthetic-linq-token" },
      resolvedConfig: {
        channelCapabilities: { emailSendReady: false, telegramBotConfigured: false },
        deviceSync: null,
        managedAutoReplyChannels: [{ capabilityReady: true, channel: "linq", memberChannel: "linq" }],
      },
    }), {
      vaultRoot, runtimeWakeSignal, signal: controller.signal,
      async createCheckpointSnapshot() {
        assert.ok(idleCheckpoints < 8, facts());
        return { snapshotRef: createSnapshotFixtureRef({ hash: "e".repeat(64), size: 512 }) };
      },
      async importItem(item) {
        if (item.item.lane === "conversation") {
          if (!inputId) await initializeVault({ createdAt: TEST_NOW, vaultRoot });
          inputId = await stagePendingLinqAssistantInputForMailboxItem({ item: item.item, vaultRoot });
          const event = await readAssistantInputEvent({ inputId, vault: vaultRoot });
          assert.ok(event);
          const route = readHostedAssistantInputCurrentDeliveryRoute({ conversation: event.conversation ?? null, replyTarget: event.replyTarget ?? null });
          assert.ok(route);
          await applyMurphManagedAutomations({
            vaultRoot, now: new Date(), routeValidationProfile: "hosted",
            defaultRoute: {
              ...route,
              deliverySource: null,
              identityId: route.identityId ?? null,
              participantId: route.participantId ?? null,
              threadId: route.threadId ?? null,
            },
            runtimeEnv: { MURPH_HOSTED_RUNTIME_PROCESS: "1", LINQ_API_TOKEN: "synthetic-linq-token" },
          });
          return { assistantInputId: inputId, status: "imported" };
        }
        await enqueueEnvironmentInterviewSystemMailboxItemForTest({ item: item.item, vaultRoot });
        return { status: "imported" };
      },
      async runAssistantPhase(input) {
        if (idleCheckpoints >= 2 && (input.initialMailboxImport.importResult.conversationImportedCount ?? 0) === 0) {
          const environmentState = await readHostedSystemMailboxState(vaultRoot);
          assert.equal(environmentState.pending.length, 0, "Environment durable recording must complete before the next maintenance pass.");
          assert.equal(interruptPublication, false, "Return the consumed foreground wake before starting maintenance.");
          assert.ok(events.includes("replica.publish"), "Publish the committed Environment result before starting another due assistant maintenance pass.");
        }
        assistantPasses += 1;
        return await runHostedWorkspaceAssistantPhase(input);
      },
      platform: {
        ...basePlatform,
        providerFetch: fetch,
        effectsPort: {
          async readRawEmailMessage() { return null; },
          async sendEmail() {},
          async assertLinqRecentInboundEngagement() {
            return { providerDispatchClaimed: true, resolvedRoute: {
              conversationThreadId: null, directRecipientPhoneNumber: null, fromPhoneNumber: null,
              target: "thread_1", targetKind: "thread", threadIsDirect: true,
            } };
          },
          async recordLinqDeliveryOutcome() {},
        },
      },
    });
    const result = await withRealTimeout(runtimeCompletion, 10_000, facts);
    const pending = (await readHostedSystemMailboxState(vaultRoot)).pending;
    assert.equal(pending.length, 0, facts());
    assert.ok(events.includes("reply.sent"), facts());
    assert.equal(result.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "1", facts());
    if (interruptPublication) {
      assert.equal(events.includes("replica.publish"), false, facts());
      assert.equal(result.status, "scheduled", facts());
      assert.ok(result.nextWakeAt && Date.parse(result.nextWakeAt) <= Date.now(), facts());
      assert.equal(assistantPasses, 1, facts());
    } else {
      assert.ok(events.includes("replica.publish"), facts());
    }
  } finally {
    controller.abort();
    await runtimeCompletion?.catch(() => undefined);
    if (originalAutomation) mocks.runAssistantAutomationPass.mockImplementation(originalAutomation);
    vi.unstubAllGlobals();
    await removeTempRoot(vaultRoot);
  }
});
