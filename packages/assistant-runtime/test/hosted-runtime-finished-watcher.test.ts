import {
  TEST_NOW, TEST_USER_ID, createDeferred, createMailboxItem, createMailboxPort,
  createPlatform, createSnapshotFixtureRef, createWorkspacePort,
  createWorkspaceRuntimeJobInput, createWorkspaceState, mocks, removeTempRoot,
  readCapturedRuntimePhaseLogs, stageAssistantInputEventForMailboxItem, withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { initializeVault } from "@murphai/core";
import * as core from "@murphai/core";
import {
  createAssistantOutboxIntent, readAssistantOutboxIntent, saveAssistantOutboxIntent,
  saveAssistantAutomationState, type RunAssistantAutomationPassInput,
} from "@murphai/assistant-engine";
import { writeAssistantAutoReplyReplyTerminalEvidence } from "@murphai/assistant-engine/assistant-automation";
import type { HostedRuntimeLatencyTraceRequest } from "@murphai/hosted-execution/runtime-control";
import {
  createCoalescingRuntimeWakeSignal, createHostedWorkspaceCheckpointRequestBuilder,
  runHostedWorkspaceRuntimeJobInProcess, runHostedWorkspaceUntilIdleOrBudget,
} from "../src/hosted-runtime.ts";
import { normalizeHostedAssistantRuntimeConfig } from "../src/hosted-runtime/environment.ts";
import { enqueueHostedPendingAssistantInputId } from "../src/hosted-runtime/pending-input-index.ts";
import { runHostedWorkspaceAssistantPhase } from "../src/hosted-runtime/workspace-assistant-phase.ts";
import type {
  HostedWorkspaceRunnerDeferredUsageCapture, HostedWorkspaceRunnerInput,
} from "../src/hosted-runtime/workspace-runner.ts";

async function createFixture() {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-finished-watcher-"));
  await initializeVault({ createdAt: TEST_NOW, vaultRoot });
  await saveAssistantAutomationState(vaultRoot, {
    version: 1, updatedAt: TEST_NOW,
    autoReply: [{ channel: "telegram", enabledAt: TEST_NOW, eligibleAfter: null }],
  });
  const events: string[] = [];
  const receivedAt = new Date().toISOString();
  const items = [createMailboxItem({ id: "mailbox_watcher_first",
    createdAt: receivedAt, occurredAt: receivedAt, updatedAt: receivedAt })];
  const inputIds: string[] = [];
  const accepted: string[][] = [];
  const intentIds: string[] = [];
  const traces: HostedRuntimeLatencyTraceRequest[] = [];
  const wake = createCoalescingRuntimeWakeSignal();
  const wait = vi.spyOn(wake, "wait");
  const abort = new AbortController();
  const providerFetch = vi.fn(async () => new Response(JSON.stringify({
    ok: true, result: { message_id: 42, chat: { id: 123 } },
  }), { headers: { "content-type": "application/json" } }));
  const mailboxPort = createMailboxPort({ events, items });
  const workspacePort = createWorkspacePort({ events, checkpointRequests: [], workspace: createWorkspaceState() });
  const platform = {
    ...createPlatform({
      mailboxPort, workspacePort,
      latencyTraceRequests: traces,
    }),
    mailboxPort, workspacePort, providerFetch,
  };
  const jobInput = createWorkspaceRuntimeJobInput({
    platformEnv: { TELEGRAM_BOT_TOKEN: "synthetic-token", TELEGRAM_API_BASE_URL: "https://telegram.test" },
    resolvedConfig: {
      channelCapabilities: { emailSendReady: false, telegramBotConfigured: true },
      deviceSync: null,
      managedAutoReplyChannels: [{ capabilityReady: true, channel: "telegram", memberChannel: "telegram" }],
    },
  });
  const runtime = normalizeHostedAssistantRuntimeConfig(jobInput.runtime, platform);
  const originalAutomation = mocks.runAssistantAutomationPass.getMockImplementation()!;
  mocks.runAssistantAutomationPass.mockImplementation(async (input: RunAssistantAutomationPassInput) => {
    const candidates = await input.inputSource?.listInputCandidates({
      afterCursor: null, limit: 10, sourceId: "telegram",
    });
    const ids = candidates?.inputs.map(({ event }) => event.inputId) ?? [];
    if (ids.length === 0) return { progressed: false, currentTurnDeliveryIntentIds: [], nextWakeAt: null };
    const release = await input.beforeProviderAcceptedInputs?.({
      turnId: "turn_synthetic_watcher", acceptedInputs: ids.map((id) => ({ id, source: "assistant-input" as const })),
    });
    accepted.push(ids);
    const intent = await createAssistantOutboxIntent({
      channel: "telegram", explicitTarget: "123", threadId: "123", threadIsDirect: true,
      identityId: "synthetic_actor", sessionId: "synthetic_session",
      turnId: `turn_${ids[0]}`, turnTrigger: "automation-auto-reply",
      dedupeToken: `watcher:${ids[0]}`, message: "Synthetic reply.", vault: vaultRoot,
    });
    // A retry claim requires durable publication through the real effect collector.
    await saveAssistantOutboxIntent(vaultRoot, {
      ...intent, status: "retryable", attemptCount: 1, nextAttemptAt: null,
      deliveryTransportIdempotent: false,
    });
    intentIds.push(intent.intentId);
    await writeAssistantAutoReplyReplyTerminalEvidence({
      captureIds: [], inputIds: ids, deliveryIntentId: intent.intentId,
      outcome: "deferred", recordedAt: new Date().toISOString(),
      sessionId: intent.sessionId, terminalKind: "reply_intent_committed", vault: vaultRoot,
    });
    await release?.();
    return { progressed: true, currentTurnDeliveryIntentIds: [intent.intentId], nextWakeAt: null,
      replies: { considered: ids.length, failed: 0, replied: ids.length, skipped: 0 } };
  });
  const importItem: HostedWorkspaceRunnerInput["importItem"] = async ({ item }) => {
    const inputId = await stageAssistantInputEventForMailboxItem({
      item, channel: "telegram", threadId: "123", vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({ inputId, vaultRoot });
    inputIds.push(inputId);
    return { status: "imported", assistantInputId: inputId };
  };
  const runnerInput: HostedWorkspaceRunnerInput = {
    checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
      attemptId: jobInput.request.attemptId, expectedWorkspaceVersion: "0", leaseGeneration: "1",
      nextWakeAt: null, nextWakeReason: null, snapshotRef: null,
    }),
    expectedUserId: TEST_USER_ID, importItem, limitPerLane: 10, platform,
    requestId: "request_synthetic_finished_watcher", runtimeWakeSignal: wake,
    signal: abort.signal, vaultRoot, workspace: createWorkspaceState(),
    runAssistantPhase: (phase) => runHostedWorkspaceAssistantPhase({
      ...phase, request: jobInput.request, runtime, runtimeEnv: runtime.forwardedEnv,
      restored: { vaultRoot, operatorHomeRoot: vaultRoot, assistantStateRoot: path.join(vaultRoot, ".assistant") },
      signal: abort.signal,
    }),
  };
  return {
    vaultRoot, events, items, inputIds, accepted, intentIds, traces, wake, wait,
    abort, platform, providerFetch, jobInput, importItem, runnerInput,
    liveWaiters: () => wait.mock.calls.filter(([signal]) => !signal?.aborted),
    async cleanup() {
      abort.abort();
      mocks.runAssistantAutomationPass.mockImplementation(originalAutomation);
      wait.mockRestore();
      await removeTempRoot(vaultRoot);
    },
  };
}

test("rejecting maintenance barrier closes the watcher and settles deferred usage", async () => {
  const f = await createFixture();
  const captures: HostedWorkspaceRunnerDeferredUsageCapture[] = [];
  const completions: Promise<void>[] = [];
  const failure = new Error("Synthetic maintenance barrier failure.");
  const barrier = vi.fn(async () => {
    expect(f.liveWaiters()).toHaveLength(1);
    throw failure;
  });
  try {
    await expect(runHostedWorkspaceUntilIdleOrBudget({
      ...f.runnerInput,
      awaitBackgroundMaintenanceBarrier: barrier,
      trackDeferredUsageCapture: (capture) => { captures.push(capture); },
      trackLocalWorkspaceMutationCompletion: (completion) => {
        if (completion) completions.push(completion);
      },
    })).rejects.toBe(failure);
    expect(barrier).toHaveBeenCalledOnce();
    expect(captures).toHaveLength(1);
    expect(completions.length).toBeGreaterThan(0);
    expect.soft(f.liveWaiters(), "barrier rejection must stop the watcher").toHaveLength(0);
    await withRealTimeout(Promise.all([
      ...completions, ...captures.map((capture) => capture.completion),
    ]), 1_000, () => "Watcher or deferred usage completion did not settle after barrier rejection.");
    expect(f.abort.signal.aborted).toBe(false);
  } finally {
    f.abort.abort();
    await Promise.all(captures.map((capture) => capture.drainForProcessFatal()));
    await Promise.all(completions);
    await f.cleanup();
  }
});

test.each(["idle_window", "shutdown_signal"] as const)(
  "deferred delivery allows the later %s checkpoint to finish quiescing",
  async (trigger) => {
    const f = await createFixture();
    const shutdown = new AbortController();
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubEnv("MURPH_HOSTED_EXECUTION_STDIO_LOGS", "1");
    const fetch = f.providerFetch.getMockImplementation()!;
    let logCountAtDelivery = 0;
    const snapshotsAfterDelivery: string[] = [];
    const deferredPreparationWaitCounts: number[] = [];
    f.providerFetch.mockImplementation(async () => {
      const response = await fetch();
      logCountAtDelivery = consoleInfo.mock.calls.length;
      if (trigger === "shutdown_signal") shutdown.abort();
      return response;
    });
    const job = runHostedWorkspaceRuntimeJobInProcess(f.jobInput, {
      vaultRoot: f.vaultRoot, platform: f.platform, importItem: f.importItem,
      runtimeWakeSignal: f.wake, signal: f.abort.signal, shutdownSignal: shutdown.signal,
      async runAssistantPhase(input) {
        let phaseReturned = false;
        try {
          return await runHostedWorkspaceAssistantPhase({
            ...input,
            async prepareAutoReplyDelivery() {
              const waitsBefore = f.wait.mock.calls.length;
              await input.prepareAutoReplyDelivery?.();
              if (phaseReturned) {
                deferredPreparationWaitCounts.push(f.wait.mock.calls.length - waitsBefore);
              }
            },
          });
        } finally {
          phaseReturned = true;
        }
      },
      async createCheckpointSnapshot(input) {
        if (f.providerFetch.mock.calls.length > 0) {
          snapshotsAfterDelivery.push(input.idleCheckpointTrigger ?? "missing");
        }
        return { snapshotRef: createSnapshotFixtureRef({ hash: "b".repeat(64), size: 512 }) };
      },
    });
    void job.catch(() => undefined);
    try {
      await withRealTimeout(job, 10_000, () => "Post-delivery checkpoint did not finish quiescing.");
      expect(f.providerFetch).toHaveBeenCalledOnce();
      expect(deferredPreparationWaitCounts, "deferred delivery must not start another watcher").toEqual([0]);
      expect((await readAssistantOutboxIntent(f.vaultRoot, f.intentIds[0]!))?.status).toBe("sent");
      expect(snapshotsAfterDelivery).toContain(trigger);
      const phaseLogs = readCapturedRuntimePhaseLogs({
        attemptId: f.jobInput.request.attemptId,
        spy: { mock: { calls: consoleInfo.mock.calls.slice(logCountAtDelivery) } },
      });
      // The real checkpoint awaits workspaceSystemWork.quiesce() before its
      // snapshot and done log; an orphaned tracked watcher blocks both.
      expect(phaseLogs.some((entry) =>
        entry.details.runtimePhase === "workspace.checkpoint.idle_shutdown"
        && entry.details.runtimePhaseStatus === "done"
        && entry.details.idleCheckpointTrigger === trigger
      )).toBe(true);
      expect(f.abort.signal.aborted).toBe(false);
      expect(f.liveWaiters()).toHaveLength(0);
    } finally {
      f.abort.abort();
      await job.catch(() => undefined);
      consoleInfo.mockRestore();
      vi.unstubAllEnvs();
      await f.cleanup();
    }
  },
);

test("returned durable delivery cannot reopen a completed foreground runner watcher", async () => {
  const f = await createFixture();
  const completions = new Set<Promise<void>>();
  f.runnerInput.trackLocalWorkspaceMutationCompletion = (completion) => {
    if (!completion) return;
    completions.add(completion);
    void completion.finally(() => completions.delete(completion));
  };
  try {
    const result = await runHostedWorkspaceUntilIdleOrBudget(f.runnerInput);
    expect(result.afterDurableCheckpoint).toHaveLength(1);
    expect(f.providerFetch).not.toHaveBeenCalled();
    expect(completions.size).toBe(0);
    expect(f.liveWaiters()).toHaveLength(0);
    await result.afterDurableCheckpoint[0]!();
    const delivered = await readAssistantOutboxIntent(f.vaultRoot, f.intentIds[0]!);
    expect(delivered?.status, JSON.stringify(delivered?.lastError)).toBe("sent");
    expect(f.providerFetch).toHaveBeenCalledOnce();
    expect(completions.size, "deferred delivery must not resurrect the completed runner").toBe(0);
    expect(f.liveWaiters()).toHaveLength(0);
  } finally {
    f.abort.abort();
    await Promise.all(completions);
    await f.cleanup();
  }
});

test("closing while the foreground watcher is starting stops the late-started watcher", async () => {
  const f = await createFixture();
  const startupHeld = createDeferred<void>();
  const releaseStartup = createDeferred<void>();
  const completions: Promise<void>[] = [];
  let preparation: Promise<void> | undefined;
  f.runnerInput.trackLocalWorkspaceMutationCompletion = (completion) => {
    if (completion) completions.push(completion);
  };
  const withCanonicalWritePort = core.withHostedCanonicalWritePort;
  const canonicalWrite = vi.spyOn(core, "withHostedCanonicalWritePort").mockImplementation(
    async <T>(port: Parameters<typeof withCanonicalWritePort>[0], run: () => Promise<T>): Promise<T> => {
      const waitsBefore = f.wait.mock.calls.length;
      const result = withCanonicalWritePort(port, run);
      // Only watcher startup synchronously adds a wait. Hold the second startup
      // across runner close, after creating its real loop but before storing it.
      if (waitsBefore === 1 && f.wait.mock.calls.length === 2) {
        await result;
        startupHeld.resolve();
        await releaseStartup.promise;
      }
      return result;
    },
  );
  const job = runHostedWorkspaceUntilIdleOrBudget({
    ...f.runnerInput,
    async runAssistantPhase(phase) {
      preparation = phase.prepareAutoReplyDelivery!();
      void preparation.catch(() => undefined);
      await startupHeld.promise;
      return { progressed: false };
    },
  });
  void job.catch(() => undefined);
  try {
    await withRealTimeout(job, 5_000, () => f.events.join(","));
    expect(f.abort.signal.aborted).toBe(false);
    expect(f.wait).toHaveBeenCalledTimes(2);
    expect(f.liveWaiters()).toHaveLength(1);
    const completionsBeforeRelease = completions.length;
    releaseStartup.resolve();
    await withRealTimeout(preparation!, 5_000, () => f.events.join(","));
    expect(completions).toHaveLength(completionsBeforeRelease + 1);
    expect(f.liveWaiters()).toHaveLength(0);
    await withRealTimeout(Promise.all(completions), 5_000, () => f.events.join(","));
    expect(f.abort.signal.aborted).toBe(false);
  } finally {
    releaseStartup.resolve();
    f.abort.abort();
    await job.catch(() => undefined);
    await preparation?.catch(() => undefined);
    await Promise.all(completions);
    canonicalWrite.mockRestore();
    await f.cleanup();
  }
});

test("one message and wake during the next idle checkpoint start a new foreground pass", async () => {
  const f = await createFixture();
  const checkpointHeld = createDeferred<void>();
  const releaseCheckpoint = createDeferred<void>();
  let held = false;
  const job = runHostedWorkspaceRuntimeJobInProcess(f.jobInput, {
    vaultRoot: f.vaultRoot, platform: f.platform, importItem: f.importItem,
    runtimeWakeSignal: f.wake, signal: f.abort.signal,
    async createCheckpointSnapshot(input) {
      if (!held && f.providerFetch.mock.calls.length === 1) {
        held = true;
        expect(input.reason).toBe("idle_shutdown");
        expect(f.providerFetch).toHaveBeenCalledOnce();
        checkpointHeld.resolve();
        await releaseCheckpoint.promise;
      }
      return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 512 }) };
    },
  });
  void job.catch(() => undefined);
  try {
    await withRealTimeout(Promise.race([checkpointHeld.promise, job.then(async (result) => {
      throw new Error(`Invocation returned before checkpoint hold: ${result.status}`);
    })]), 10_000, () => f.events.join(","));
    const receivedAt = new Date().toISOString();
    f.items.push(createMailboxItem({ id: "mailbox_watcher_next", laneSeq: "2",
      createdAt: receivedAt, occurredAt: receivedAt, updatedAt: receivedAt }));
    f.wake.notify();
    releaseCheckpoint.resolve();
    await withRealTimeout(job, 15_000, () => f.events.join(","));
    expect(f.inputIds).toHaveLength(2);
    expect(f.accepted).toEqual([[f.inputIds[0]], [f.inputIds[1]]]);
    expect(f.providerFetch).toHaveBeenCalledTimes(2);
    for (const inputId of f.inputIds) {
      expect(await mocks.hasCompleteAssistantAutoReplyDeliveryTerminalEvidence({ inputId, vault: f.vaultRoot })).toBe(true);
      expect(f.traces.some(({ event }) => event.type === "assistant_milestone"
        && event.assistantInputIds.includes(inputId)
        && event.milestone === "assistant_input_accepted_for_execution")).toBe(true);
    }
  } finally {
    releaseCheckpoint.resolve();
    f.abort.abort();
    await job.catch(() => undefined);
    await f.cleanup();
  }
});

test("delivery preparation restarts the live watcher so late input can preempt delivery", async () => {
  const f = await createFixture();
  const imported = createDeferred<void>();
  const importItem = f.runnerInput.importItem;
  f.runnerInput.importItem = async (...args) => {
    const result = await importItem(...args);
    if (args[0].item.laneSeq === "2") imported.resolve();
    return result;
  };
  try {
    const result = await runHostedWorkspaceUntilIdleOrBudget({
      ...f.runnerInput,
      async runAssistantPhase(phase) {
        const initialWait = f.wait.mock.calls[0]![0]!;
        await phase.prepareAutoReplyDelivery!();
        expect(initialWait.aborted).toBe(true);
        expect(f.liveWaiters()).toHaveLength(1);
        f.items.push(createMailboxItem({ id: "mailbox_watcher_late", laneSeq: "2" }));
        f.wake.notify();
        await withRealTimeout(imported.promise, 5_000, () => f.events.join(","));
        await phase.prepareAutoReplyDelivery!();
        expect(phase.shouldYieldBackgroundMaintenance!()).toBe(true);
        expect(phase.latestAssistantInputBatch!()?.assistantInputIds).toContain(f.inputIds[1]);
        return { progressed: false };
      },
    });
    expect(result.latestAssistantInputBatch?.assistantInputIds).toContain(f.inputIds[1]);
    expect(f.liveWaiters()).toHaveLength(0);
    expect(f.providerFetch).not.toHaveBeenCalled();
  } finally { await f.cleanup(); }
});
