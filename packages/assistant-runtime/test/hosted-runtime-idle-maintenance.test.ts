import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_SOURCE_PATH,
  ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_VERSION,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";

const compactWarmCodexThread = vi.fn();
vi.mock("@murphai/assistant-engine/assistant-codex", () => ({
  compactWarmCodexThread: (input: unknown) => compactWarmCodexThread(input),
}));

import {
  HOSTED_IDLE_COMPACT_MIN_THREAD_TOKENS,
  HOSTED_IDLE_COMPACT_TIMEOUT_MS,
  runHostedIdleCheckpointMaintenance,
} from "../src/hosted-runtime/idle-maintenance.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";

beforeEach(() => {
  compactWarmCodexThread.mockReset();
});

describe("runHostedIdleCheckpointMaintenance", () => {
  it("skips on shutdown and on a missing model without touching the engine", async () => {
    expect(
      await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.5",
        pendingWork: false,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: AbortSignal.abort(),
        wakeSignal: null,
      }),
    ).toEqual({ kind: "skipped", reason: "shutdown", threadContextTokensBefore: null });

    expect(
      await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: null,
        pendingWork: false,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        wakeSignal: null,
      }),
    ).toEqual({ kind: "skipped", reason: "missing_model", threadContextTokensBefore: null });

    expect(compactWarmCodexThread).not.toHaveBeenCalled();
  });

  it("records compaction usage with the maintenance trigger kind", async () => {
    compactWarmCodexThread.mockResolvedValue({
      kind: "compacted",
      durationMs: 1_200,
      threadContextTokensBefore: 140_000,
      threadId: "thread_xyz",
      usage: {
        cachedInputTokens: 96_000,
        inputTokens: 140_000,
        outputTokens: 900,
        totalTokens: 140_900,
      },
    });
    const recorded: AssistantUsageRecord[] = [];

    const outcome = await runHostedIdleCheckpointMaintenance({
      credentialSource: "member",
      memberId: "member_1",
      model: "gpt-5.5",
      pendingWork: false,
      recordUsage: async (record) => {
        recorded.push(record);
      },
      resolveAssistantSessionId: async (codexThreadId) =>
        codexThreadId === "thread_xyz" ? "asst_real_session" : null,
      shutdownSignal: null,
      wakeSignal: null,
    });

    expect(outcome.kind).toBe("compacted");
    // Recording is fire-and-forget; flush the microtask queue before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(compactWarmCodexThread).toHaveBeenCalledWith({
      minThreadTokens: HOSTED_IDLE_COMPACT_MIN_THREAD_TOKENS,
      signal: expect.any(AbortSignal),
      timeoutMs: HOSTED_IDLE_COMPACT_TIMEOUT_MS,
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      cachedInputTokens: 96_000,
      credentialSource: "member",
      featureKey: "assistant_idle_compact",
      inputTokens: 140_000,
      memberId: "member_1",
      outputTokens: 900,
      providerRequestId: "thread_xyz",
      requestedModel: "gpt-5.5",
      sessionId: "asst_real_session",
      totalTokens: 140_900,
      triggerKind: "automation_idle_compact",
      usageExtractionSourcePath: ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_SOURCE_PATH,
      usageExtractionVersion: ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_VERSION,
    });
  });

  it("survives usage recording failures fail-open", async () => {
    compactWarmCodexThread.mockResolvedValue({
      kind: "compacted",
      durationMs: 800,
      threadContextTokensBefore: 120_000,
      threadId: "thread_xyz",
      usage: {
        cachedInputTokens: 0,
        inputTokens: 120_000,
        outputTokens: 500,
        totalTokens: 120_500,
      },
    });

    const outcome = await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.5",
      pendingWork: false,
      recordUsage: async () => {
        throw new Error("record endpoint down");
      },
      resolveAssistantSessionId: async () => "asst_real_session",
      shutdownSignal: null,
      wakeSignal: null,
    });

    expect(outcome.kind).toBe("compacted");
  });

  it("aborts compaction on a pending wake and re-notifies the wake signal", async () => {
    const wakeSignal = createCoalescingRuntimeWakeSignal();
    compactWarmCodexThread.mockImplementation(async (input: { signal: AbortSignal }) => {
      wakeSignal.notify();
      await new Promise<void>((resolve) => {
        input.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return {
        kind: "failed",
        reason: "aborted",
        threadContextTokensBefore: 130_000,
        threadId: "thread_xyz",
      };
    });

    const outcome = await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.5",
      pendingWork: false,
      recordUsage: null,
      resolveAssistantSessionId: null,
      shutdownSignal: null,
      wakeSignal,
    });

    expect(outcome).toMatchObject({ kind: "failed", reason: "aborted" });
    // The maintenance wait consumed the wake; the loop's pending-wake check
    // must still observe it afterwards.
    expect(wakeSignal.consumePending()).toBe(true);
  });

  it("aborts compaction when deploy shutdown arrives mid-compact", async () => {
    const shutdownController = new AbortController();
    compactWarmCodexThread.mockImplementation(async (input: { signal: AbortSignal }) => {
      shutdownController.abort();
      await new Promise<void>((resolve) => {
        if (input.signal.aborted) {
          resolve();
          return;
        }
        input.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return {
        kind: "failed",
        reason: "aborted",
        threadContextTokensBefore: 130_000,
        threadId: "thread_xyz",
      };
    });

    const outcome = await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.5",
      pendingWork: false,
      recordUsage: null,
      resolveAssistantSessionId: null,
      shutdownSignal: shutdownController.signal,
      wakeSignal: null,
    });

    expect(outcome).toMatchObject({ kind: "failed", reason: "aborted" });
  });

  it("skips when member-visible work is pending so replies are never delayed", async () => {
    expect(
      await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.5",
        pendingWork: true,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        wakeSignal: null,
      }),
    ).toEqual({ kind: "skipped", reason: "pending_work", threadContextTokensBefore: null });
    expect(compactWarmCodexThread).not.toHaveBeenCalled();
  });

  it("skips unpriced models so usage can never be unaccountable", async () => {
    expect(
      await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-unpriced-experimental",
        pendingWork: false,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        wakeSignal: null,
      }),
    ).toEqual({ kind: "skipped", reason: "unpriced_model", threadContextTokensBefore: null });
    expect(compactWarmCodexThread).not.toHaveBeenCalled();
  });

  it("fails open when the engine helper throws", async () => {
    compactWarmCodexThread.mockRejectedValue(new Error("engine exploded"));
    expect(
      await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.5",
        pendingWork: false,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        wakeSignal: null,
      }),
    ).toEqual({ kind: "failed", reason: "exception", threadContextTokensBefore: null });
  });

  it("skips recording when no assistant session matches the thread", async () => {
    compactWarmCodexThread.mockResolvedValue({
      kind: "compacted",
      durationMs: 700,
      threadContextTokensBefore: 110_000,
      threadId: "thread_orphan",
      usage: {
        cachedInputTokens: 0,
        inputTokens: 110_000,
        outputTokens: 400,
        totalTokens: 110_400,
      },
    });
    const recorded: unknown[] = [];

    const outcome = await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.5",
      pendingWork: false,
      recordUsage: async (record) => {
        recorded.push(record);
      },
      resolveAssistantSessionId: async () => null,
      shutdownSignal: null,
      wakeSignal: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(outcome.kind).toBe("compacted");
    // No ambiguous identity ever reaches the ledger.
    expect(recorded).toHaveLength(0);
  });
});
