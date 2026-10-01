import {
  TEST_USER_ID, createMailboxItem, createSnapshotFixtureRef, createMailboxPort, createPlatform, createWorkspacePort,
  createWorkspaceRuntimeJobInput, createWorkspaceState, removeTempRoot,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import type { CodexRealtimeClosure } from "@murphai/assistant-engine/assistant-runtime";
import { createCoalescingRuntimeWakeSignal, runHostedWorkspaceRuntimeJobInProcess } from "../src/hosted-runtime.ts";
import { createHostedRuntimeVoice, createHostedRuntimeVoiceCall } from "../src/hosted-runtime/voice-call.ts";

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
