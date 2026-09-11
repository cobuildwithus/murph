import {
  TEST_NOW,
  createBrowserVaultReplicaRef,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createVaultSnapshotBundle,
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
import * as systemWork from "../src/hosted-runtime/workspace-system-work.ts";

test.each(["success", "projection-error", "fresh-foreground"] as const)("settles checkpointed Environment recording in the foreground replacement: %s", async (scenario) => {
  let vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-environment-interrupted-recording-"));
  const roots = [vaultRoot];
  const replacementError = new Error("Synthetic foreground replacement released the system owner.");
  let initialSystemOwner = true;
  const effectContexts: string[] = [];
  let projectionFailureActive = scenario === "projection-error";
  let projectionInterrupted = false;
  let effectStartedAt = 0;
  const createSystemWork = systemWork.createHostedWorkspaceSystemWork;
  const systemWorkObserver = vi.spyOn(systemWork, "createHostedWorkspaceSystemWork").mockImplementation((input) => createSystemWork({
    ...input,
    onCompleted(completion, notify) {
      const effects = completion.afterDurableCheckpoint;
      const observe = (effect: Exclude<typeof effects, undefined | null | readonly unknown[]>) => Object.assign(async (context: Parameters<typeof effect>[0]) => {
        effectContexts.push(context?.vaultShareProjectionResult?.outcome ?? "absent");
        effectStartedAt = Date.now();
        return await effect(context);
      }, effect);
      input.onCompleted({
        ...completion,
        ...(effects ? { afterDurableCheckpoint: typeof effects === "function" ? observe(effects) : effects.map(observe) } : {}),
      }, notify);
    },
  }));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  let assistantPasses = 0;
  let idleCheckpoints = 0;
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const attemptId = "attempt_synthetic_environment_followup";
  const originalAutomation = mocks.runAssistantAutomationPass.getMockImplementation();
  let controller = new AbortController();
  let runtimeCompletion: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
  let inputId: string | null = null;
  const repliedInputIds = new Set<string>();
  const environmentItem = createMailboxItem({
    id: "mailbox_item_synthetic_environment_followup",
    dedupeKey: "environment-interview.completed:synthetic-followup",
    kind: "environment-interview.completed", lane: "system", laneSeq: "1",
  });
  const items = [environmentItem];
  const facts = () => JSON.stringify({
    events: events.filter((event) => !event.startsWith("artifact.")), effectContexts, inputStaged: inputId !== null, replies: repliedInputIds.size,
    assistantPasses,
    idleCheckpoints,
    replySent: events.includes("reply.sent"),
    replicaPublished: events.includes("replica.publish"),
  });
  vi.stubGlobal("fetch", vi.fn(async (request: string | URL | Request) => {
    const pathname = new URL(request instanceof Request ? request.url : String(request)).pathname;
    if (pathname.includes("/messages/synthetic-environment-reply")) return new Response(null, { status: 204 });
    assert.ok(pathname.endsWith("/messages"));
    events.push("reply.sent");
    return new Response(JSON.stringify({ message: { id: "synthetic-environment-reply" } }), {
      headers: { "content-type": "application/json" }, status: 200,
    });
  }));
  try {
    mocks.runAssistantAutomationPass.mockImplementation(async (input: RunAssistantAutomationPassInput) => {
      if (!inputId || repliedInputIds.has(inputId)) return { currentTurnDeliveryIntentIds: [], nextWakeAt: null, progressed: false };
      repliedInputIds.add(inputId);
      await input.onProviderRequestStarted?.({ assistantInputIds: [inputId], providerRequestOrdinal: 0, source: "linq", startedAt: TEST_NOW });
      const retained = (await readHostedSystemMailboxState(vaultRoot)).pending;
      assert.equal(retained[0]?.status, "recording");
      assert.equal(retained[0]?.postCheckpointRecord, null);
      assert.equal(retained[0]?.lastErrorCode, null);
      assert.equal(retained[0]?.nextAttemptAt, null);
      events.push("foreground.provider");
      const intent = await createAssistantOutboxIntent({
        channel: "linq", createdAt: TEST_NOW, dedupeToken: "synthetic-environment-reply-" + repliedInputIds.size,
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
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    const snapshot = await createVaultSnapshotBundle({ vaultRoot });
    const artifactBytesByHash = new Map([[snapshot.hash, snapshot.bytes]]);
    let currentWorkspace = createWorkspaceState({ snapshotRef: snapshot.snapshotRef });
    const workspacePort = createWorkspacePort({ checkpointRequests, events, workspace: currentWorkspace });

    const basePlatform = createPlatform({
      events, artifactBytesByHash,
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
          if (request.reason === "idle_shutdown" && initialSystemOwner) {
            const retained = (await readHostedSystemMailboxState(vaultRoot)).pending;
            assert.equal(retained[0]?.status, "recording");
            assert.equal(retained[0]?.nextAttemptAt, null);
            events.push("system.recording.checkpoint");
            controller.abort(replacementError);
          }
          return { ...result, workspace: currentWorkspace };
        },
      },
      browserVaultReplicaPort: {
        async write({ replica }) {
          assert.ok(events.includes("reply.sent"), "Foreground reply precedes Environment publication.");
          const habitat = parseBrowserVaultReplica(replica).entities.find((entity) => entity.family === "habitat" && entity.attributes.aspect === "sleep-environment");
          const indicators = habitat?.attributes.indicators;
          assert.ok(indicators && typeof indicators === "object" && "night_temp_c" in indicators);
          assert.equal(indicators.night_temp_c, 19);
          events.push("replica.write");
          return createBrowserVaultReplicaRef(replica);
        },
        async publishRef({ replicaRef }) {
          events.push("replica.publish");
          currentWorkspace = { ...currentWorkspace, browserVaultReplicaRef: replicaRef };
          return { published: true, workspace: currentWorkspace };
        },
      },
      vaultSharePort: {
        async listActiveProjectionScopes(request) {
          events.push("share.scopes");
          if (projectionFailureActive) throw new Error("Synthetic projection scope read failed.");
          if (scenario === "fresh-foreground" && !projectionInterrupted) {
            projectionInterrupted = true;
            items.push(createMailboxItem({ id: "mailbox_item_synthetic_new_foreground", laneSeq: "2" }));
            events.push("foreground.interruption");
            runtimeWakeSignal.notify({ requestedProcessingMode: "default" });
            const signal = request?.signal;
            assert.ok(signal);
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else signal.addEventListener("abort", () => resolve(), { once: true });
            });
            signal.throwIfAborted();
          }
          return { projectionKinds: [], projectionScopes: [] };
        },
        async deliver() { throw new Error("No projection scopes are active."); },
      },
    });
    const runInvocation = (processingMode: "system_mailbox" | "default") => runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
      request: { attemptId: attemptId + "-" + processingMode, idleCheckpointDelayMs: 1_500, processingMode, workspaceVersion: currentWorkspace.version },
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
        const checkpointSnapshot = await createVaultSnapshotBundle({ vaultRoot });
        artifactBytesByHash.set(checkpointSnapshot.hash, checkpointSnapshot.bytes);
        return { snapshotRef: checkpointSnapshot.snapshotRef };
      },
      async importItem(item) {
        if (item.item.lane === "conversation") {

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
    runtimeCompletion = runInvocation("system_mailbox");
    await assert.rejects(withRealTimeout(runtimeCompletion, 10_000, facts), replacementError);
    assert.ok(events.includes("system.recording.checkpoint"));
    assert.equal(events.includes("replica.publish"), false);
    initialSystemOwner = false;
    vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-environment-foreground-replacement-"));
    roots.push(vaultRoot);
    controller = new AbortController();
    items.push(createMailboxItem({ id: "mailbox_item_synthetic_foreground", laneSeq: "1" }));
    events.push("foreground.queued");
    runtimeCompletion = runInvocation("default");
    let result = await withRealTimeout(runtimeCompletion, 10_000, facts);
    if (scenario === "projection-error") {
      const retained = (await readHostedSystemMailboxState(vaultRoot)).pending;
      assert.equal(retained.length, 1, facts());
      assert.equal(retained[0]?.status, "recording");
      assert.equal(retained[0]?.lastErrorCode, "HOSTED_VAULT_SHARE_PROJECTION_FAILED");
      const retryAt = Date.parse(retained[0]?.nextAttemptAt ?? "");
      assert.ok(retryAt >= effectStartedAt + 60_000 && retryAt <= Date.now() + 60_000);
      assert.equal(result.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "0");
      assert.equal(result.status, "scheduled");
      projectionFailureActive = false;
      vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-environment-future-retry-"));
      roots.push(vaultRoot);
      runtimeCompletion = runInvocation("system_mailbox");
      result = await withRealTimeout(runtimeCompletion, 10_000, facts);
      assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending[0]?.nextAttemptAt, new Date(retryAt).toISOString());
      assert.equal(result.nextWakeAt, new Date(retryAt).toISOString(), facts());
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, retryAt - Date.now())));
      vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-environment-due-retry-"));
      roots.push(vaultRoot);
      runtimeCompletion = runInvocation("system_mailbox");
      result = await withRealTimeout(runtimeCompletion, 10_000, facts);
    }
    const pending = (await readHostedSystemMailboxState(vaultRoot)).pending;
    assert.equal(pending.length, 0, JSON.stringify({ retry: pending.map(({ status, lastErrorCode, nextAttemptAt }) => ({ status, lastErrorCode, nextAttemptAt })), ...JSON.parse(facts()) }));
    assert.ok(events.includes("reply.sent"), facts());
    assert.equal(result.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "1", facts());
    assert.ok(events.includes("replica.publish"), facts());
    assert.equal(events.filter((event) => event === "reply.sent").length, scenario === "fresh-foreground" ? 2 : 1, facts());
    if (scenario !== "projection-error") assert.ok(!effectContexts.includes("error"), facts());
  } finally {
    systemWorkObserver.mockRestore();
    controller.abort();
    await runtimeCompletion?.catch(() => undefined);
    if (originalAutomation) mocks.runAssistantAutomationPass.mockImplementation(originalAutomation);
    vi.unstubAllGlobals();
    await Promise.all(roots.map(removeTempRoot));
  }
}, 90_000);
