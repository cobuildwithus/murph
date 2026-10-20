import {
  TEST_NOW,
  TEST_USER_ID,
  createBrowserVaultReplicaRef,
  createDeferred,
  createDeviceSyncResolvedConfig,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createResolvedDeviceSyncSystemMailboxItem,
  createSnapshotDeviceSyncPort,
  createVaultSnapshotBundle,
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
import type { HostedRuntimeLatencyTraceRequest, HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { parseBrowserVaultReplica } from "@murphai/query/browser";
import {
  applyMurphManagedAutomations,
  createAssistantOutboxIntent,
  readAssistantInputEvent,
  type RunAssistantAutomationPassInput,
} from "@murphai/assistant-engine";
import { writeAssistantAutoReplyReplyTerminalEvidence } from "@murphai/assistant-engine/assistant-automation";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";
import { runHostedWorkspaceAssistantPhase } from "../src/hosted-runtime/workspace-assistant-phase.ts";
import { readHostedAssistantInputCurrentDeliveryRoute } from "../src/hosted-runtime/current-delivery-route.ts";
import { readHostedProviderCleanupCheckpoint } from "../src/hosted-runtime/provider-cleanup.ts";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";
import { readHostedSystemMailboxState, resolveHostedSystemMailboxWakeCandidates } from "../src/hosted-runtime/system-mailbox-state.ts";
import * as systemWork from "../src/hosted-runtime/workspace-system-work.ts";

const CONNECTION_ID = "synthetic-recording-connection";
const SLEEP_ID = "synthetic-recording-sleep";
const SLEEP_END = "2026-04-26T07:30:00.000Z";

test.each([
  "success",
  "projection-error",
  "fresh-foreground",
  "checkpoint-hint",
  "checkpoint-foreground",
  "scheduler-refresh",
  "refresh-foreground",
  "refresh-read-error",
  "refresh-incomplete",
] as const)("settles a checkpointed system recording in the foreground replacement: %s", async (scenario) => {
  let vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-interrupted-system-recording-"));
  const roots = [vaultRoot];
  const replacementError = new Error("Synthetic foreground replacement released the system owner.");
  let initialSystemOwner = true;
  const effectContexts: string[] = [];
  let projectionFailureActive = scenario === "projection-error";
  let projectionInterrupted = false;
  let refreshWakeSent = false;
  let refreshReadFault: "error" | "incomplete" | null = null;
  let completeRefreshWakeRead: (() => void) | null = null;
  let writesAtFirstPublication: number | null = null;
  let effectStartedAt = 0;
  const latencyTraceRequests: HostedRuntimeLatencyTraceRequest[] = [];
  const checkpointExpectationCount = () => latencyTraceRequests.filter((request) =>
    request.event.type === "runtime_milestone"
    && request.event.milestone === "checkpoint_publication_expected_by"
  ).length;
  let checkpointHintInjected = false;
  let expectationsAtCheckpointHint = 0;
  let expectationsAtFirstEffect = 0;
  const createSystemWork = systemWork.createHostedWorkspaceSystemWork;
  const systemWorkObserver = vi.spyOn(systemWork, "createHostedWorkspaceSystemWork").mockImplementation((input) => createSystemWork({
    ...input,
    onCompleted(completion, notify) {
      const effects = completion.afterDurableCheckpoint;
      const observe = (effect: Exclude<typeof effects, undefined | null | readonly unknown[]>) => Object.assign(async (context: Parameters<typeof effect>[0]) => {
        effectContexts.push(context?.vaultShareProjectionResult?.outcome ?? "absent");
        if (effectContexts.length === 1) expectationsAtFirstEffect = checkpointExpectationCount();
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
  const projectionRelease = createDeferred<void>();
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  let assistantPasses = 0;
  let idleCheckpoints = 0;
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const attemptId = "attempt_synthetic_system_recording_followup";
  const originalAutomation = mocks.runAssistantAutomationPass.getMockImplementation();
  let controller = new AbortController();
  let runtimeCompletion: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
  let inputId: string | null = null;
  const repliedInputIds = new Set<string>();
  let recordedRetainUntil: string | null = null;
  const deviceItem = createMailboxItem({
    id: "mailbox_item_synthetic_device_followup",
    dedupeKey: "device-sync.wake:synthetic-followup",
    kind: "device-sync.wake", lane: "system", laneSeq: "1",
  });
  const items = [deviceItem];
  const deviceSyncPort = createSnapshotDeviceSyncPort({ connectionId: CONNECTION_ID, nextReconcileAt: TEST_NOW });
  const facts = () => JSON.stringify({
    events: events.filter((event) => !event.startsWith("artifact.")), effectContexts, inputStaged: inputId !== null, replies: repliedInputIds.size,
    assistantPasses,
    idleCheckpoints,
    checkpointReasons: checkpointRequests.map((request) => request.reason),
    replySent: events.includes("reply.sent"),
    replicaPublished: events.includes("replica.publish"),
  });
  vi.stubGlobal("fetch", vi.fn(async (request: string | URL | Request) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    const pathname = url.pathname;
    if (url.hostname === "whoop.example.test") {
      // The reconcile pass reads each scoped WHOOP collection once; only sleep has a record.
      events.push("device.provider:" + pathname);
      return new Response(JSON.stringify({
        next_token: null,
        records: pathname.endsWith("/v2/activity/sleep") ? [{
          id: SLEEP_ID, nap: false, score_state: "SCORED",
          start: "2026-04-26T00:30:00.000Z", end: SLEEP_END,
          updated_at: "2026-04-26T08:00:00.000Z",
        }] : [],
      }), { headers: { "content-type": "application/json" }, status: 200 });
    }
    if (pathname.includes("/messages/synthetic-system-recording-reply")) return new Response(null, { status: 204 });
    assert.ok(pathname.endsWith("/messages"));
    events.push("reply.sent");
    return new Response(JSON.stringify({ message: { id: "synthetic-system-recording-reply" } }), {
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
      // A completed reconcile holds only its completion fence until recorded.
      const record = retained[0]?.postCheckpointRecord;
      assert.equal(record?.kind, "device-sync.dirty-processed-batch");
      assert.deepEqual(record.records, []);
      assert.equal(record.retainedWake?.eventId, deviceItem.dedupeKey);
      recordedRetainUntil = record.retainMailboxItemUntil ?? null;
      assert.equal(retained[0]?.lastErrorCode, null);
      assert.equal(retained[0]?.nextAttemptAt, null);
      events.push("foreground.provider");
      if (repliedInputIds.size === 2) projectionRelease.resolve();
      const intent = await createAssistantOutboxIntent({
        channel: "linq", createdAt: TEST_NOW, dedupeToken: "synthetic-system-recording-reply-" + repliedInputIds.size,
        explicitTarget: "thread_1", identityId: "synthetic-member", message: "Your message is received.",
        sessionId: "synthetic-system-recording-session", threadId: "thread_1", threadIsDirect: true,
        turnId: "synthetic-system-recording-turn", turnTrigger: "automation-auto-reply", vault: vaultRoot,
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

    const mailboxPort = createMailboxPort({ events, items });
    const basePlatform = createPlatform({
      events, artifactBytesByHash, latencyTraceRequests, deviceSyncPort,
      mailboxPort: {
        ...mailboxPort,
        async fetch(request, context) {
          const fault = refreshReadFault;
          refreshReadFault = null;
          if (fault === "error") throw new Error("Synthetic mailbox classification unavailable.");
          const response = await mailboxPort.fetch(request, context);
          if (completeRefreshWakeRead) {
            events.push("refresh.mailbox_read");
            completeRefreshWakeRead();
            completeRefreshWakeRead = null;
          }
          return fault === "incomplete" ? {
            ...response,
            maxSeqByLane: response.maxSeqByLane.map((entry) => entry.lane === "system"
              ? { ...entry, maxSeq: String(BigInt(entry.maxSeq) + 1n) }
              : entry),
          } : response;
        },
      },
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
          if (initialSystemOwner) {
            const retained = (await readHostedSystemMailboxState(vaultRoot)).pending;
            events.push("system.checkpoint:" + request.reason + ":" + (retained[0]?.status ?? "none"));
          }
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
        async write({ replica, signal }) {
          events.push("replica.write.attempt");
          assert.ok(events.includes("reply.sent"), "Foreground reply precedes system recording publication. " + facts());
          // Browser replicas redact device attributes; the imported sleep stays a dated ledger event.
          const sleep = parseBrowserVaultReplica(replica).entities.find((entity) =>
            entity.family === "event" && entity.kind === "sleep_session"
            && entity.occurredAt === SLEEP_END && entity.date === "2026-04-26");
          assert.ok(sleep, "The browser replica carries the device-imported WHOOP sleep. " + facts());
          events.push("replica.write");
          if ((scenario === "scheduler-refresh" || scenario.startsWith("refresh-")) && !refreshWakeSent) {
            refreshWakeSent = true;
            if (scenario === "refresh-foreground") {
              items.push(createMailboxItem({ id: "mailbox_item_synthetic_refresh_foreground", laneSeq: "2" }));
              events.push("foreground.queued_during_refresh");
            } else if (scenario === "refresh-read-error") {
              refreshReadFault = "error";
            } else if (scenario === "refresh-incomplete") {
              refreshReadFault = "incomplete";
            }
            // Same-owner container wakes omit requestedProcessingMode.
            for (let hint = 0; hint < (scenario === "scheduler-refresh" ? 3 : 1); hint += 1) {
              const wakeRead = scenario === "scheduler-refresh"
                ? new Promise<void>((resolve) => { completeRefreshWakeRead = resolve; })
                : null;
              events.push("refresh.wake_hint");
              runtimeWakeSignal.notify();
              if (wakeRead) await withRealTimeout(wakeRead, 1_000, facts);
              // Let the completed mailbox read reach the classifier before the next hint.
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
            if (scenario !== "scheduler-refresh") {
              assert.ok(signal);
              await withRealTimeout(new Promise<void>((resolve) => {
                if (signal.aborted) resolve();
                else signal.addEventListener("abort", () => resolve(), { once: true });
              }), 1_000, facts);
            }
            signal?.throwIfAborted();
          }
          return createBrowserVaultReplicaRef(replica);
        },
        async publishRef({ replicaRef }) {
          writesAtFirstPublication ??= events.filter((event) => event === "replica.write").length;
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
            await projectionRelease.promise;
            assert.equal(signal.aborted, false, "Foreground work must not cancel projection scopes.");
          }
          return { projectionKinds: [], projectionScopes: [] };
        },
        async deliver() { throw new Error("No projection scopes are active."); },
      },
    });
    const runInvocation = (processingMode: "system_mailbox" | "default") => runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
      request: { attemptId: attemptId + "-" + processingMode, runnerIdleTtlMs: 1_500, processingMode, workspaceVersion: currentWorkspace.version },
      forwardedEnv: { LINQ_API_TOKEN: "synthetic-linq-token" },
      resolvedConfig: {
        ...createDeviceSyncResolvedConfig(),
        managedAutoReplyChannels: [{ capabilityReady: true, channel: "linq", memberChannel: "linq" }],
      },
    }), {
      vaultRoot, runtimeWakeSignal, signal: controller.signal,
      async createCheckpointSnapshot(snapshotInput, context) {
        assert.ok(idleCheckpoints < 8, facts());
        const checkpointSnapshot = await createVaultSnapshotBundle({ vaultRoot });
        artifactBytesByHash.set(checkpointSnapshot.hash, checkpointSnapshot.bytes);
        if ((scenario === "checkpoint-hint" || scenario === "checkpoint-foreground")
          && !initialSystemOwner && !checkpointHintInjected
          && snapshotInput.reason === "idle_shutdown") {
          assert.ok(events.includes("reply.sent"), "Checkpoint hint follows the foreground reply.");
          assert.equal(effectContexts.length, 0, "Recording still awaits this checkpoint.");
          checkpointHintInjected = true;
          expectationsAtCheckpointHint = checkpointExpectationCount();
          events.push("checkpoint.default-hint");
          if (scenario === "checkpoint-foreground") {
            items.push(createMailboxItem({ id: "mailbox_item_synthetic_checkpoint_foreground", laneSeq: "2" }));
          }
          runtimeWakeSignal.notify({ requestedProcessingMode: "default" });
          const signal = context?.signal;
          assert.ok(signal);
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", () => resolve(), { once: true });
          });
          signal.throwIfAborted();
        }
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
        // The shared system-work owner runs the device import, then holds the
        // item in recording until its checkpoint, projection, and publication.
        await enqueueHostedSystemMailboxItem({
          item: createResolvedDeviceSyncSystemMailboxItem(item.item), vaultRoot,
          wake: {
            connectionId: CONNECTION_ID, eventId: deviceItem.dedupeKey, expectedConnectedAt: TEST_NOW,
            hint: { nextReconcileAt: TEST_NOW, occurredAt: TEST_NOW },
            kind: "device-sync.wake", occurredAt: TEST_NOW, provider: "whoop", reason: "reconcile_due", userId: TEST_USER_ID,
          },
        });
        events.push("device.staged");
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
    await assert.rejects(withRealTimeout(runtimeCompletion, 10_000, facts), (error) => {
      assert.equal(error, replacementError, facts());
      return true;
    });
    assert.ok(events.includes("system.recording.checkpoint"));
    assert.equal(events.includes("replica.publish"), false);
    const providerReads = () => events.filter((event) => event.startsWith("device.provider:"));
    const admittedProviderReads = providerReads();
    assert.ok(admittedProviderReads.includes("device.provider:/developer/v2/activity/sleep"), facts());
    assert.ok(events.indexOf("device.provider:/developer/v2/activity/sleep") < events.indexOf("system.recording.checkpoint"), facts());
    initialSystemOwner = false;
    vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-system-recording-foreground-replacement-"));
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
      const cleanupRetryAt = Date.parse((await readHostedProviderCleanupCheckpoint(vaultRoot))?.nextWakeAt ?? "");
      const futureRetryNow = Math.min(retryAt, Number.isFinite(cleanupRetryAt) ? cleanupRetryAt : retryAt) - 1;
      projectionFailureActive = false;
      vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-system-recording-future-retry-"));
      roots.push(vaultRoot);
      const effectContextsBeforeFutureRetry = [...effectContexts];
      // This invocation observes future wakes. Hold Date before the first due
      // wake even when real I/O stalls; due cleanup correctly returns "now".
      // Keep timers real so runtime liveness and the timeout still run normally.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(futureRetryNow);
      try {
        runtimeCompletion = runInvocation("system_mailbox");
        result = await withRealTimeout(runtimeCompletion, 10_000, facts);
      } finally {
        vi.useRealTimers();
      }
      const futureRetryState = await readHostedSystemMailboxState(vaultRoot);
      assert.deepEqual(futureRetryState.pending, retained);
      assert.deepEqual(effectContexts, effectContextsBeforeFutureRetry);
      assert.equal(result.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "0");
      const mailboxWake = await resolveHostedSystemMailboxWakeCandidates({ state: futureRetryState, vaultRoot });
      assert.equal(mailboxWake.next.at, new Date(retryAt).toISOString());
      assert.ok(Date.parse(result.nextWakeAt ?? "") <= retryAt, facts());
      // Provider cleanup can wake the default owner before the recording retry is due.
      if (result.nextWakeAt !== new Date(retryAt).toISOString()) {
        assert.equal(result.nextWakeReason, "assistant");
        assert.equal(result.nextWakeAt, (await readHostedProviderCleanupCheckpoint(vaultRoot))?.nextWakeAt);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, retryAt - Date.now())));
      vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-system-recording-due-retry-"));
      roots.push(vaultRoot);
      runtimeCompletion = runInvocation("system_mailbox");
      result = await withRealTimeout(runtimeCompletion, 10_000, facts);
    }
    // Cold restores record the checkpointed import; they never re-read the provider.
    assert.deepEqual(providerReads(), admittedProviderReads, facts());
    assert.equal(deviceSyncPort.fetchSnapshotCalls, 1, facts());
    if (scenario === "scheduler-refresh" || scenario.startsWith("refresh-")) {
      assert.ok(refreshWakeSent, facts());
    }
    if (scenario.startsWith("refresh-")) {
      assert.equal(events.filter((event) => event === "replica.write").length, 1, facts());
      assert.equal(events.includes("replica.publish"), false, facts());
      assert.equal(result.status, "scheduled", facts());
      assert.ok(Date.parse(result.nextWakeAt ?? "") <= Date.now(), facts());
      assert.equal(result.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "1", facts());
      assert.equal(events.filter((event) => event === "reply.sent").length, 1, facts());
      return;
    }
    if (scenario === "scheduler-refresh") {
      // An unfinished wake classification can be replayed after publication.
      // Prove the original write completes without restart across the hints.
      assert.equal(writesAtFirstPublication, 1, facts());
      assert.equal(events.filter((event) => event === "refresh.wake_hint").length, 3, facts());
      assert.equal(events.filter((event) => event === "refresh.mailbox_read").length, 3, facts());
    }
    // The recording settled. A restored owner did not admit the pass, so it
    // keeps the device owner pending behind its completion fence.
    const pending = (await readHostedSystemMailboxState(vaultRoot)).pending;
    assert.ok(recordedRetainUntil, facts());
    assert.deepEqual(pending.map(({ itemId, status, postCheckpointRecord, lastErrorCode, nextAttemptAt }) =>
      ({ itemId, status, postCheckpointRecord, lastErrorCode, nextAttemptAt })), [{
      itemId: deviceItem.id, status: "pending", postCheckpointRecord: null, lastErrorCode: null,
      nextAttemptAt: recordedRetainUntil,
    }], facts());
    const retainedWake = pending[0]?.wake;
    assert.equal(retainedWake?.kind === "device-sync.wake" ? retainedWake.hint?.reason : null, "retained_completion_fence");
    assert.ok(events.includes("reply.sent"), facts());
    assert.equal(result.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "1", facts());
    assert.ok(events.includes("replica.publish"), facts());
    assert.equal(events.filter((event) => event === "reply.sent").length,
      scenario === "fresh-foreground" || scenario === "checkpoint-foreground" ? 2 : 1, facts());
    if (scenario !== "projection-error") assert.ok(!effectContexts.includes("error"), facts());
    if (scenario === "checkpoint-hint") {
      assert.ok(checkpointHintInjected, facts());
      assert.equal(expectationsAtFirstEffect, expectationsAtCheckpointHint,
        "A caught-up checkpoint wake must not start another idle window before recording completes.");
    }
    if (scenario === "checkpoint-foreground") {
      assert.ok(checkpointHintInjected, facts());
      assert.ok(expectationsAtFirstEffect > expectationsAtCheckpointHint,
        "Fresh foreground work still restarts its full idle window before recording completes.");
    }
  } finally {
    systemWorkObserver.mockRestore();
    controller.abort();
    projectionRelease.resolve();
    await runtimeCompletion?.catch(() => undefined);
    if (originalAutomation) mocks.runAssistantAutomationPass.mockImplementation(originalAutomation);
    vi.unstubAllGlobals();
    await Promise.all(roots.map(removeTempRoot));
  }
}, 90_000);
