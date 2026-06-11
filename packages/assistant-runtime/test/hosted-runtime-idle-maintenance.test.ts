import { describe, expect, it, vi, beforeEach } from "vitest";

import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";

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
        shutdownSignal: null,
        wakeSignal: null,
      }),
    ).toEqual({ kind: "skipped", reason: "no_model", threadContextTokensBefore: null });

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
      shutdownSignal: null,
      wakeSignal: null,
    });

    expect(outcome.kind).toBe("compacted");
    expect(compactWarmCodexThread).toHaveBeenCalledWith({
      minThreadTokens: HOSTED_IDLE_COMPACT_MIN_THREAD_TOKENS,
      signal: expect.any(AbortSignal),
      timeoutMs: HOSTED_IDLE_COMPACT_TIMEOUT_MS,
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      credentialSource: "member",
      featureKey: "assistant_idle_compact",
      inputTokens: 140_000,
      memberId: "member_1",
      requestedModel: "gpt-5.5",
      sessionId: "thread_xyz",
      triggerKind: "automation_idle_compact",
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
        shutdownSignal: null,
        wakeSignal: null,
      }),
    ).toEqual({ kind: "skipped", reason: "no_model", threadContextTokensBefore: null });
    expect(compactWarmCodexThread).not.toHaveBeenCalled();
  });
});
