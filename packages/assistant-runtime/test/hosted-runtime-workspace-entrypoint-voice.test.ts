import {
  mockHostedPendingRetryCandidate,
  TEST_NOW, createDeferred, withRealTimeout, waitForFakeTimerScheduled, TEST_USER_ID, createMailboxItem, createSnapshotFixtureRef, createMailboxPort, createPlatform, createWorkspacePort,
  createWorkspaceRuntimeJobInput, createWorkspaceState, createResolvedRuntimeControlSystemMailboxItem, createVaultSnapshotBundle, removeTempRoot,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { mkdtemp } from "node:fs/promises";
import { setTimeout as sleepRealTime } from "node:timers/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import * as clinicalEnrichment from "../src/hosted-runtime/clinical-enrichment.ts";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { initializeVault } from "@murphai/core";
import { buildHostedExecutionRuntimeControlWake } from "@murphai/hosted-execution";
import type { CodexRealtimeClosure } from "@murphai/assistant-engine/assistant-runtime";
import { createCoalescingRuntimeWakeSignal, runHostedWorkspaceRuntimeJobInProcess } from "../src/hosted-runtime.ts";
import { createHostedRuntimeVoice, createHostedRuntimeVoiceCall } from "../src/hosted-runtime/voice-call.ts";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import { runHostedWorkspaceAssistantPhase } from "../src/hosted-runtime/workspace-assistant-phase.ts";

it.each(["call-close", "shutdown", "owner-handoff"] as const)("retains an empty invocation for reserved voice and fences new calls before %s return", async (stop) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-voice-invocation-"));
  const events: string[] = [];
  const wake = createCoalescingRuntimeWakeSignal();
  const waiting = vi.spyOn(wake, "wait");
  const abort = new AbortController();
  const shutdown = new AbortController();
  const voice = createHostedRuntimeVoice({
    notifyRuntime: () => wake.notify(),
    createCall: (callId) => createHostedRuntimeVoiceCall({
      callId, memberId: TEST_USER_ID, signal: abort.signal,
      notifyRuntime: () => wake.notify(), onError: vi.fn(),
      admitInput: async () => { throw new Error("No speech was sent."); },
      usagePort: { recordUsage: async () => { throw new Error("No provider was started."); } },
    }),
  });
  expect(voice.reserve("call_synthetic")).toBe(true);
  let returned = false;
  const invocation = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs: 120_000 } }), {
    voice, runtimeWakeSignal: wake, signal: abort.signal, shutdownSignal: shutdown.signal, vaultRoot,
    createCheckpointSnapshot: async () => { throw new Error("An empty call must not dirty the workspace."); },
    importItem: async () => { throw new Error("No mailbox input was sent."); },
    platform: createPlatform({
      mailboxPort: createMailboxPort({ events, items: [] }),
      workspacePort: createWorkspacePort({ checkpointRequests: [], events, workspace: createWorkspaceState() }),
    }),
  }).then((result) => { returned = true; return result; });
  try {
    await vi.waitFor(() => {
      expect(returned).toBe(false);
      expect(waiting).toHaveBeenCalled();
    });
    expect(events.filter((event) => event === "mailbox.fetch").length).toBeGreaterThan(0);
    // A foreground watcher also waits briefly. Prove the invocation itself
    // remains alive after that pass, rather than just observing any waiter.
    await expect(Promise.race([
      invocation.then(() => "returned"),
      new Promise<string>((resolve) => setTimeout(() => resolve("held"), 250)),
    ])).resolves.toBe("held");
    expect(voice.reserve("other_call")).toBe(false);
    if (stop === "shutdown") shutdown.abort();
    else if (stop === "owner-handoff") wake.notify({ requestedProcessingMode: "system_mailbox" });
    else await voice.closeCall("call_synthetic");
    await expect(Promise.race([
      invocation.then(() => "returned"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 1_000)),
    ])).resolves.toBe("returned");
    expect(returned).toBe(true);
    expect(voice.reserve("later_call")).toBe(false);
  } finally {
    abort.abort();
    await voice.close();
    await invocation.catch(() => {});
    await removeTempRoot(vaultRoot);
  }
});

it.each([false, true])("checkpoints and drains selected delivery while voice stays open (mailbox follow-up: %s)", async (mailboxFollowup) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-voice-checkpoint-"));
  const events: string[] = [];
  const wake = createCoalescingRuntimeWakeSignal();
  const abort = new AbortController();
  const mailboxItem = createMailboxItem({ laneSeq: "1" });
  const items: typeof mailboxItem[] = [];
  let finishNative!: (receipt: CodexRealtimeClosure) => void;
  const receipt: CodexRealtimeClosure = { providerConfirmed: true, providerSessionId: "rtc_synthetic", seconds: 0 };
  const native = {
    sdp: "synthetic-answer",
    closed: new Promise<CodexRealtimeClosure>((resolve) => { finishNative = resolve; }),
    speak: vi.fn(async (_message: string) => {}),
    close: vi.fn(async () => { finishNative(receipt); return receipt; }),
  };
  const voice = createHostedRuntimeVoice({
    notifyRuntime: () => wake.notify(),
    createCall: (callId) => createHostedRuntimeVoiceCall({
      callId, memberId: TEST_USER_ID, signal: abort.signal,
      notifyRuntime: () => wake.notify(), onError: vi.fn(),
      admitInput: async () => {
        items.push(mailboxItem);
        return { mailboxItemId: mailboxItem.id };
      },
      usagePort: { recordUsage: async () => { throw new Error("No provider was started."); } },
    }),
  });
  voice.reserve("call_synthetic");
  const start = vi.fn<Parameters<typeof voice.bindStart>[0]>(async () => native);
  voice.bindStart(start);
  await voice.connect("call_synthetic", "synthetic-offer");
  start.mock.calls[0]![0].onInput({ inputId: "input_synthetic", text: "Synthetic request" });
  await vi.waitFor(() => expect(items).toHaveLength(1));
  const delivered = vi.fn(async () => {
    expect(events).toContain("workspace.checkpoint");
    expect(voice.isHoldingRuntime()).toBe(true);
  });
  let progressed = false;
  let followupObserved = false;
  let returned = false;
  const invocation = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
    voice, runtimeWakeSignal: wake, signal: abort.signal, vaultRoot,
    createCheckpointSnapshot: async () => ({ snapshotRef: createSnapshotFixtureRef({ hash: "e".repeat(64), size: 512 }) }),
    importItem: async () => ({ status: "imported" }),
    platform: createPlatform({
      mailboxPort: createMailboxPort({ events, items }),
      workspacePort: createWorkspacePort({ checkpointRequests: [], events, workspace: createWorkspaceState() }),
    }),
    runAssistantPhase: async (phase) => {
      expect(phase.runtime.platform.voicePort).toBe(voice);
      if (progressed) {
        followupObserved = true;
        return {
          progressed: false,
          ...(mailboxFollowup ? { nextWakeAt: new Date().toISOString(), nextWakeReason: "mailbox" } : {}),
        };
      }
      progressed = true;
      return {
        progressed: true, checkpointReason: "assistant_runtime_commit",
        afterCheckpoint: async () => ({
          afterDurableCheckpoint: async () => {
            await delivered();
            await phase.runtime.platform.voicePort!.speak({
              callId: "call_synthetic", message: "Selected checkpointed reply", answeredMailboxItemIds: [mailboxItem.id],
            });
          },
          checkpointReason: "assistant_runtime_commit",
        }),
      };
    },
  }).then((result) => { returned = true; return result; });
  void invocation.catch(() => {});
  try {
    await vi.waitFor(() => expect(delivered).toHaveBeenCalledOnce());
    expect(voice.isHoldingRuntime()).toBe(true);
    expect(returned).toBe(false);
    await vi.waitFor(() => expect(native.speak).toHaveBeenCalledExactlyOnceWith("Selected checkpointed reply"));
    wake.notify();
    await vi.waitFor(() => expect(followupObserved).toBe(true));
    await expect(Promise.race([
      invocation.then(() => "returned"),
      new Promise<string>((resolve) => setTimeout(() => resolve("held"), 250)),
    ])).resolves.toBe("held");
    expect(native.close).not.toHaveBeenCalled();
    await voice.closeCall("call_synthetic");
    await invocation;
    expect(delivered).toHaveBeenCalledOnce();
    expect(native.close).toHaveBeenCalledOnce();
  } finally {
    abort.abort();
    await voice.close();
    await invocation.catch(() => {});
    await removeTempRoot(vaultRoot);
  }
});


it.each(["assistant", "device-sync.reconcile", "synthetic.other-wake"])("services a clean %s projection while voice retains the invocation", async (wakeReason) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-voice-projected-wake-"));
  const events: string[] = [];
  const wake = createCoalescingRuntimeWakeSignal();
  const abort = new AbortController();
  const firstPass = createDeferred<void>();
  const duePass = createDeferred<void>();
  const wakeAt = new Date(Date.parse(TEST_NOW) + 10_000).toISOString();
  let phaseCalls = 0;
  const voice = createHostedRuntimeVoice({
    notifyRuntime: () => wake.notify(),
    createCall: (callId) => createHostedRuntimeVoiceCall({
      callId, memberId: TEST_USER_ID, signal: abort.signal,
      notifyRuntime: () => wake.notify(), onError: vi.fn(),
      admitInput: async () => { throw new Error("No speech was sent."); },
      usagePort: { recordUsage: async () => { throw new Error("No provider was started."); } },
    }),
  });
  voice.reserve("call_synthetic_projected");
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(TEST_NOW));
  const invocation = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs: 20_000 } }), {
    voice, runtimeWakeSignal: wake, signal: abort.signal, vaultRoot,
    createCheckpointSnapshot: async () => { throw new Error("A clean projection must not checkpoint."); },
    importItem: async () => { throw new Error("No mailbox input was sent."); },
    platform: createPlatform({
      mailboxPort: createMailboxPort({ events, items: [] }),
      workspacePort: createWorkspacePort({ checkpointRequests: [], events, workspace: createWorkspaceState({ nextWakeAt: wakeAt, nextWakeReason: wakeReason }) }),
    }),
    async runAssistantPhase(input) {
      phaseCalls += 1;
      if (phaseCalls === 1) firstPass.resolve();
      else {
        expect(input.workspace?.nextWakeAt).toBe(wakeAt);
        expect(input.workspace?.nextWakeReason).toBe(wakeReason);
        duePass.resolve();
      }
      return { progressed: false };
    },
  });
  // Attach a rejection handler during the clock-controlled portion as well.
  void invocation.catch(() => {});
  try {
    await withRealTimeout(firstPass.promise, 5_000, () => events.join(","));
    await waitForFakeTimerScheduled(() => events.join(","));
    await vi.advanceTimersByTimeAsync(10_000);
    await withRealTimeout(duePass.promise, 5_000, () => events.join(","));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(phaseCalls).toBe(2);
    await voice.closeCall("call_synthetic_projected");
    await withRealTimeout(invocation, 5_000, () => events.join(","));
  } finally {
    abort.abort();
    await voice.close();
    await invocation.catch(() => {});
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});

it("stops repeated no-progress service of a due mailbox item while voice retains the invocation", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-voice-mailbox-wake-"));
  const events: string[] = [];
  const wake = createCoalescingRuntimeWakeSignal();
  const abort = new AbortController();
  const duePass = createDeferred<void>();
  let phaseCalls = 0;
  const voice = createHostedRuntimeVoice({
    notifyRuntime: () => wake.notify(),
    createCall: (callId) => createHostedRuntimeVoiceCall({
      callId, memberId: TEST_USER_ID, signal: abort.signal,
      notifyRuntime: () => wake.notify(), onError: vi.fn(),
      admitInput: async () => { throw new Error("No speech was sent."); },
      usagePort: { recordUsage: async () => { throw new Error("No provider was started."); } },
    }),
  });
  voice.reserve("call_synthetic_mailbox");
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(TEST_NOW));
  await initializeVault({ createdAt: TEST_NOW, vaultRoot });
  const mailboxItem = createMailboxItem({
    id: "mailbox_synthetic_browser_refresh", lane: "system", laneSeq: "1",
    kind: "runtime.browser-vault-refresh-requested",
    dedupeKey: "runtime.browser-vault-refresh-requested:synthetic-voice",
  });
  await enqueueHostedSystemMailboxItem({
    vaultRoot,
    item: createResolvedRuntimeControlSystemMailboxItem(mailboxItem),
    wake: buildHostedExecutionRuntimeControlWake({
      eventId: mailboxItem.dedupeKey, kind: "runtime.browser-vault-refresh-requested",
      occurredAt: TEST_NOW, userId: TEST_USER_ID,
    }),
  });
  const restored = await createVaultSnapshotBundle({ vaultRoot });
  const invocation = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs: 20_000 } }), {
    voice, runtimeWakeSignal: wake, signal: abort.signal, vaultRoot,
    createCheckpointSnapshot: async () => { throw new Error("No-progress service must not checkpoint."); },
    importItem: async () => { throw new Error("The mailbox item is already local."); },
    platform: createPlatform({
      artifactBytesByHash: new Map([[restored.hash, restored.bytes]]),
      mailboxPort: createMailboxPort({ events, items: [] }),
      workspacePort: createWorkspacePort({ checkpointRequests: [], events, workspace: createWorkspaceState({ snapshotRef: restored.snapshotRef, nextWakeAt: TEST_NOW, nextWakeReason: "mailbox" }) }),
    }),
    async runAssistantPhase(input) {
      phaseCalls += 1;
      // Bound the unfixed loop and make every fresh due timestamp distinct.
      if (phaseCalls > 5) throw new Error("Repeated no-progress mailbox service.");
      vi.setSystemTime(Date.now() + 1);
      const result = await runHostedWorkspaceAssistantPhase(input);
      expect(result).toMatchObject({ progressed: false, nextWakeAt: new Date().toISOString(), nextWakeReason: "mailbox" });
      if (phaseCalls === 2) duePass.resolve();
      return result;
    },
  });
  void invocation.catch(() => {});
  try {
    await withRealTimeout(Promise.race([duePass.promise, invocation.then(() => {})]), 5_000, () => events.join(","));
    await Promise.race([waitForFakeTimerScheduled(() => events.join(",")), invocation]);
    for (let window = 0; window < 3; window += 1) {
      await vi.advanceTimersByTimeAsync(20_000);
    }
    expect(phaseCalls).toBe(2);
    expect(voice.isHoldingRuntime()).toBe(true);
    expect((await readHostedSystemMailboxState(vaultRoot)).pending).toMatchObject([
      { itemId: mailboxItem.id, attemptCount: 0 },
    ]);
    await voice.closeCall("call_synthetic_mailbox");
    await withRealTimeout(invocation, 5_000, () => events.join(","));
  } finally {
    abort.abort();
    await voice.close();
    await invocation.catch(() => {});
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});


it.each(["no-progress", "backoff", "held-background", "budget", "shutdown"] as const)(
  "checkpoints an inherited retry in place before voice service (%s)", async (outcome) => {
    const restorePendingRetry = mockHostedPendingRetryCandidate(true);
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-voice-inherited-retry-"));
    const events: string[] = [];
    const checkpoints: HostedWorkspaceCheckpointRequest[] = [];
    const wake = createCoalescingRuntimeWakeSignal();
    const abort = new AbortController();
    const shutdown = new AbortController();
    const foreground = createDeferred<void>();
    const published = createDeferred<void>();
    const serviced = createDeferred<void>();
    const extractionStarted = createDeferred<void>();
    const retryAt = new Date(Date.parse(TEST_NOW) + 1_000).toISOString();
    const backoffAt = new Date(Date.parse(TEST_NOW) + 60_000).toISOString();
    let phases = 0;
    const clinical = outcome === "held-background"
      ? vi.spyOn(clinicalEnrichment, "runOneHostedClinicalEnrichment").mockImplementation(async (input) => {
          input.onExtractionStarted?.();
          extractionStarted.resolve();
          await new Promise<void>((resolve) => {
            if (input.abortSignal.aborted) resolve();
            else input.abortSignal.addEventListener("abort", () => resolve(), { once: true });
          });
          events.push("background:joined");
          return "idle";
        })
      : null;
    const voice = createHostedRuntimeVoice({
      notifyRuntime: () => wake.notify(),
      createCall: (callId) => createHostedRuntimeVoiceCall({
        callId, memberId: TEST_USER_ID, signal: abort.signal,
        notifyRuntime: () => wake.notify(), onError: vi.fn(),
        admitInput: async () => { throw new Error("No speech was sent."); },
        usagePort: { recordUsage: async () => { throw new Error("No provider was started."); } },
      }),
    });
    voice.reserve("call_synthetic_retry");
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(TEST_NOW));
    const invocation = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({ request: {
      runnerIdleTtlMs: 600_000,
      ...(outcome === "budget" ? { budget: { maxMailboxItems: 1 } } : {}),
    } }), {
      voice, runtimeWakeSignal: wake, signal: abort.signal, shutdownSignal: shutdown.signal, vaultRoot,
      async createCheckpointSnapshot() {
        expect(Date.now()).toBe(Date.parse(retryAt));
        expect(voice.isHoldingRuntime()).toBe(true);
        if (clinical) expect(events).toContain("background:joined");
        events.push("snapshot");
        return { snapshotRef: createSnapshotFixtureRef({ hash: "d".repeat(64), size: 640 }) };
      },
      importItem: async () => ({ status: "imported" }),
      platform: createPlatform({
        mailboxPort: createMailboxPort({ events, items: [createMailboxItem(), ...(outcome === "budget" ? [createMailboxItem({ id: "mailbox_item_budget_second", laneSeq: "2", createdAt: "9999-01-01T00:00:00.000Z" })] : [])] }),
        workspacePort: createWorkspacePort({ events, checkpointRequests: checkpoints,
          workspace: createWorkspaceState({ nextWakeAt: retryAt, nextWakeReason: "assistant" }),
          checkpointWorkspace(request) {
            events.push("published");
            if (outcome === "shutdown") shutdown.abort();
            published.resolve();
            return createWorkspaceState({
              version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
              snapshotRef: request.snapshotRef,
              nextWakeAt: request.nextWakeAt ?? null, nextWakeReason: request.nextWakeReason ?? null,
            });
          },
        }),
      }),
      async runAssistantPhase(input) {
        phases += 1;
        if (phases === 1) {
          if (clinical) await extractionStarted.promise;
          foreground.resolve();
          return {
            progressed: true, checkpointReason: "assistant_runtime_commit",
            nextWakeAt: retryAt, nextWakeReason: "assistant",
            ...(clinical ? {} : { afterCheckpoint: async () => ({
              checkpointReason: "assistant_runtime_commit" as const,
              afterDurableCheckpoint: async () => { events.push("effect"); },
            }) }),
          };
        }
        if (phases > 2) {
          // Closing voice can probe again; the future retry must stay unserviced.
          expect(outcome).toBe("backoff");
          expect(voice.isHoldingRuntime()).toBe(false);
          expect(input.workspace?.nextWakeAt).toBe(backoffAt);
          expect(Date.now()).toBeLessThan(Date.parse(backoffAt));
          return { progressed: false };
        }
        expect(events).toContain("published");
        if (!clinical) expect(events).toContain("effect");
        expect(voice.isHoldingRuntime()).toBe(true);
        expect(input.workspace?.nextWakeAt).toBe(retryAt);
        events.push("retry");
        serviced.resolve();
        return outcome === "backoff"
          ? { progressed: true, checkpointReason: "assistant_runtime_commit", nextWakeAt: backoffAt, nextWakeReason: "assistant" }
          : { progressed: false };
      },
    });
    void invocation.catch(() => {});
    try {
      await withRealTimeout(foreground.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(999);
      expect(checkpoints).toHaveLength(0);
      expect(phases).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      if (outcome === "held-background") {
        // A checkpoint return would abort detached work, so a due retry waits.
        // Publication does real I/O, so give it real time to prove it stays held.
        await vi.advanceTimersByTimeAsync(60_000);
        const publishedWhileHeld = await Promise.race([
          published.promise.then(() => true),
          sleepRealTime(1_500).then(() => false),
        ]);
        expect(publishedWhileHeld).toBe(false);
        expect(events).not.toContain("background:joined");
        return;
      }
      await withRealTimeout(published.promise, 5_000, () => events.join(","));
      if (outcome === "budget" || outcome === "shutdown") {
        const result = await withRealTimeout(invocation, 5_000, () => events.join(","));
        expect(phases).toBe(1);
        expect(result.nextWakeAt).toBe(retryAt);
        if (outcome === "budget") expect(result.status).toBe("budget_exhausted");
      } else {
        await withRealTimeout(serviced.promise, 5_000, () => events.join(","));
        // Let publication and the clean voice wait settle before moving time.
        await withRealTimeout((async () => {
          while (outcome === "backoff" && checkpoints.length < 2) {
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
        })(), 5_000, () => events.join(","));
        await vi.advanceTimersByTimeAsync(2_000);
        expect(phases).toBe(2);
        expect(voice.isHoldingRuntime()).toBe(true);
        await voice.closeCall("call_synthetic_retry");
        const result = await withRealTimeout(invocation, 5_000, () => events.join(","));
        expect(result.nextWakeAt).toBe(outcome === "backoff" ? backoffAt : retryAt);
        expect(checkpoints.at(-1)?.nextWakeAt).toBe(outcome === "backoff" ? backoffAt : retryAt);
        if (!clinical) expect(events.indexOf("published")).toBeLessThan(events.indexOf("effect"));
      }
    } finally {
      restorePendingRetry();
      abort.abort();
      await voice.close();
      await invocation.catch(() => {});
      clinical?.mockRestore();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  },
);
