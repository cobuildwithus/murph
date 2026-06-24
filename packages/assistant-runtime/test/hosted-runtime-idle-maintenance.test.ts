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
const runInboxMediaRetention = vi.fn();
vi.mock("@murphai/inboxd", () => ({
  runInboxMediaRetention: (input: unknown) => runInboxMediaRetention(input),
}));

import {
  HOSTED_IDLE_COMPACT_MIN_THREAD_TOKENS,
  HOSTED_IDLE_COMPACT_TIMEOUT_MS,
  HOSTED_INBOX_MEDIA_RETENTION_RETRY_DELAY_MS,
  runHostedIdleCheckpointMaintenance,
} from "../src/hosted-runtime/idle-maintenance.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";

beforeEach(() => {
  compactWarmCodexThread.mockReset();
  runInboxMediaRetention.mockReset();
});

describe("runHostedIdleCheckpointMaintenance", () => {
  it("skips on shutdown, missing model, and missing provider without touching the engine", async () => {
    expect(
      await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.5",
        providerName: "hosted-openai",
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
        providerName: "hosted-openai",
        pendingWork: false,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        wakeSignal: null,
      }),
    ).toEqual({ kind: "skipped", reason: "missing_model", threadContextTokensBefore: null });

    expect(
      await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.5",
        providerName: " ",
        pendingWork: false,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        wakeSignal: null,
      }),
    ).toEqual({ kind: "skipped", reason: "missing_provider", threadContextTokensBefore: null });

    expect(compactWarmCodexThread).not.toHaveBeenCalled();
  });

  it("records provider compaction usage without the estimate marker", async () => {
    compactWarmCodexThread.mockResolvedValue({
      kind: "compacted",
      durationMs: 1_200,
      threadContextTokensBefore: 140_000,
      threadId: "thread_xyz",
      serviceTier: "flex",
      usage: {
        cachedInputTokens: 96_000,
        inputTokens: 140_000,
        outputTokens: 900,
        source: "provider",
        totalTokens: 140_900,
      },
    });
    const recorded: AssistantUsageRecord[] = [];

    const outcome = await runHostedIdleCheckpointMaintenance({
      credentialSource: "member",
      memberId: "member_1",
      model: "gpt-5.5",
      providerName: "hosted-openai",
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
      providerName: "hosted-openai",
      providerRequestId: "thread_xyz",
      requestedModel: "gpt-5.5",
      sessionId: "asst_real_session",
      tokenPricingBasis: "openai-flex",
      totalTokens: 140_900,
      triggerKind: "automation_idle_compact",
      usageExtractionSourcePath: null,
      usageExtractionVersion: "legacy",
    });
  });

  it("runs inbox media retention during idle maintenance and keeps compaction fail-open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));
    runInboxMediaRetention.mockRejectedValueOnce(new Error("retention unavailable"));
    compactWarmCodexThread.mockResolvedValue({
      kind: "skipped",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });

    try {
      const outcome = await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.5",
        providerName: "hosted-openai",
        pendingWork: false,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        vaultRoot: "/vault",
        wakeSignal: null,
      });

      expect(runInboxMediaRetention).toHaveBeenCalledWith({
        materializeCandidatePaths: undefined,
        protectedAttachmentIds: undefined,
        protectedCaptureIds: undefined,
        protectedStoredPaths: undefined,
        signal: expect.any(AbortSignal),
        vaultRoot: "/vault",
      });
      expect(outcome).toEqual({
        kind: "skipped",
        nextWakeAt: new Date(
          Date.parse("2026-07-05T00:00:00.000Z") + HOSTED_INBOX_MEDIA_RETENTION_RETRY_DELAY_MS,
        ).toISOString(),
        nextWakeReason: "inbox_media_retention",
        reason: "below_threshold",
        threadContextTokensBefore: 20_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reschedules inbox media retention when shutdown is already signaled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));

    try {
      const outcome = await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.5",
        providerName: "hosted-openai",
        pendingWork: false,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: AbortSignal.abort(new Error("Synthetic container shutdown.")),
        vaultRoot: "/vault",
        wakeSignal: null,
      });

      expect(outcome).toEqual({
        kind: "skipped",
        nextWakeAt: new Date(
          Date.parse("2026-07-05T00:00:00.000Z") + HOSTED_INBOX_MEDIA_RETENTION_RETRY_DELAY_MS,
        ).toISOString(),
        nextWakeReason: "inbox_media_retention",
        reason: "shutdown",
        threadContextTokensBefore: null,
      });
      expect(runInboxMediaRetention).not.toHaveBeenCalled();
      expect(compactWarmCodexThread).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reschedules inbox media retention when shutdown interrupts retention", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));
    const shutdownController = new AbortController();
    const shutdownReason = new Error("Synthetic container shutdown.");
    runInboxMediaRetention.mockImplementation((input: { signal: AbortSignal }) => {
      shutdownController.abort(shutdownReason);
      throw input.signal.reason;
    });

    try {
      const outcome = await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.5",
        providerName: "hosted-openai",
        pendingWork: false,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: shutdownController.signal,
        vaultRoot: "/vault",
        wakeSignal: null,
      });

      expect(outcome).toEqual({
        kind: "skipped",
        nextWakeAt: new Date(
          Date.parse("2026-07-05T00:00:00.000Z") + HOSTED_INBOX_MEDIA_RETENTION_RETRY_DELAY_MS,
        ).toISOString(),
        nextWakeReason: "inbox_media_retention",
        reason: "shutdown",
        threadContextTokensBefore: null,
      });
      expect(runInboxMediaRetention).toHaveBeenCalledWith({
        materializeCandidatePaths: undefined,
        protectedAttachmentIds: undefined,
        protectedCaptureIds: undefined,
        protectedStoredPaths: undefined,
        signal: expect.any(AbortSignal),
        vaultRoot: "/vault",
      });
      expect(compactWarmCodexThread).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes active pending attachment protections to inbox media retention", async () => {
    const materializeRetentionCandidatePaths = vi.fn(async () => {});
    runInboxMediaRetention.mockResolvedValue({
      expiredAttachments: 0,
      expiredBytes: 0,
      hasMoreEligibleAttachments: false,
      nextEligibleAt: null,
      records: [],
    });
    compactWarmCodexThread.mockResolvedValue({
      kind: "skipped",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });

    await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      materializeRetentionCandidatePaths,
      memberId: "member_1",
      model: "gpt-5.5",
      pendingWork: false,
      protectedAttachmentIds: ["att_pending"],
      protectedCaptureIds: ["cap_pending"],
      protectedStoredPaths: ["raw/inbox/linq/self/2026/06/cap_pending/attachments/01__photo.webp"],
      providerName: "hosted-openai",
      recordUsage: null,
      resolveAssistantSessionId: null,
      shutdownSignal: null,
      vaultRoot: "/vault",
      wakeSignal: null,
    });

    expect(runInboxMediaRetention).toHaveBeenCalledWith({
      materializeCandidatePaths: materializeRetentionCandidatePaths,
      protectedAttachmentIds: ["att_pending"],
      protectedCaptureIds: ["cap_pending"],
      protectedStoredPaths: ["raw/inbox/linq/self/2026/06/cap_pending/attachments/01__photo.webp"],
      signal: expect.any(AbortSignal),
      vaultRoot: "/vault",
    });
  });

  it("returns an immediate retention wake when the retention batch has more eligible work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));
    runInboxMediaRetention.mockResolvedValue({
      expiredAttachments: 1,
      expiredBytes: 512,
      hasMoreEligibleAttachments: true,
      nextEligibleAt: null,
      records: [],
    });
    compactWarmCodexThread.mockResolvedValue({
      kind: "skipped",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });

    try {
      const outcome = await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.5",
        providerName: "hosted-openai",
        pendingWork: false,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        vaultRoot: "/vault",
        wakeSignal: null,
      });

      expect(outcome).toEqual({
        kind: "skipped",
        nextWakeAt: "2026-07-05T00:00:00.000Z",
        nextWakeReason: "inbox_media_retention",
        reason: "below_threshold",
        threadContextTokensBefore: 20_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a future retention wake when protected media becomes eligible later", async () => {
    runInboxMediaRetention.mockResolvedValue({
      expiredAttachments: 0,
      expiredBytes: 0,
      hasMoreEligibleAttachments: false,
      nextEligibleAt: "2026-07-18T00:00:00.000Z",
      records: [],
    });
    compactWarmCodexThread.mockResolvedValue({
      kind: "skipped",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });

    const outcome = await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.5",
      providerName: "hosted-openai",
      pendingWork: false,
      recordUsage: null,
      resolveAssistantSessionId: null,
      shutdownSignal: null,
      vaultRoot: "/vault",
      wakeSignal: null,
    });

    expect(outcome).toEqual({
      kind: "skipped",
      nextWakeAt: "2026-07-18T00:00:00.000Z",
      nextWakeReason: "inbox_media_retention",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });
  });

  it("aborts inbox media retention on a pending wake and re-notifies the wake signal", async () => {
    vi.useFakeTimers();
    const wakeAt = new Date("2026-04-26T00:00:01.000Z");
    const wakeSignal = createCoalescingRuntimeWakeSignal();
    const retentionCall: { signal: AbortSignal | null } = { signal: null };
    runInboxMediaRetention.mockImplementation(async (input: { signal: AbortSignal }) => {
      retentionCall.signal = input.signal;
      vi.setSystemTime(wakeAt);
      wakeSignal.notify();
      await new Promise<void>((resolve) => {
        if (input.signal.aborted) {
          resolve();
          return;
        }
        input.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    });

    try {
      const outcome = await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.5",
        providerName: "hosted-openai",
        pendingWork: false,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        vaultRoot: "/vault",
        wakeSignal,
      });

      expect(outcome).toEqual({
        kind: "skipped",
        reason: "pending_work",
        threadContextTokensBefore: null,
      });
      expect(retentionCall.signal?.aborted).toBe(true);
      expect(compactWarmCodexThread).not.toHaveBeenCalled();
      expect(wakeSignal.consumePending()).toEqual({
        notifiedAtEpochMs: wakeAt.getTime(),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes active media protections to inbox media retention", async () => {
    runInboxMediaRetention.mockResolvedValue({
      expiredAttachments: 0,
      expiredBytes: 0,
      hasMoreEligibleAttachments: false,
      nextEligibleAt: null,
      records: [],
    });
    compactWarmCodexThread.mockResolvedValue({
      kind: "skipped",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });

    await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.5",
      pendingWork: false,
      protectedAttachmentIds: ["att_active_01"],
      protectedCaptureIds: ["cap_active"],
      protectedStoredPaths: [
        "raw/inbox/telegram/self/2026/04/cap_active/attachments/01__voice.m4a",
      ],
      providerName: "hosted-openai",
      recordUsage: null,
      resolveAssistantSessionId: null,
      shutdownSignal: null,
      vaultRoot: "/vault",
      wakeSignal: null,
    });

    expect(runInboxMediaRetention).toHaveBeenCalledWith(expect.objectContaining({
      protectedAttachmentIds: ["att_active_01"],
      protectedCaptureIds: ["cap_active"],
      protectedStoredPaths: [
        "raw/inbox/telegram/self/2026/04/cap_active/attachments/01__voice.m4a",
      ],
      vaultRoot: "/vault",
    }));
  });

  it("tags estimated compaction usage with explicit estimate provenance", async () => {
    compactWarmCodexThread.mockResolvedValue({
      kind: "compacted",
      durationMs: 1_200,
      threadContextTokensBefore: 140_000,
      threadId: "thread_xyz",
      serviceTier: null,
      usage: {
        cachedInputTokens: null,
        inputTokens: 140_000,
        outputTokens: null,
        source: "estimated",
        totalTokens: 140_000,
      },
    });
    const recorded: AssistantUsageRecord[] = [];

    const outcome = await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.5",
      providerName: "hosted-openai",
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      cachedInputTokens: null,
      credentialSource: "platform",
      featureKey: "assistant_idle_compact",
      inputTokens: 140_000,
      outputTokens: null,
      providerName: "hosted-openai",
      providerRequestId: "thread_xyz",
      requestedModel: "gpt-5.5",
      sessionId: "asst_real_session",
      surface: "hosted-runtime",
      tokenPricingBasis: "standard",
      totalTokens: 140_000,
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
      serviceTier: null,
      usage: {
        cachedInputTokens: 0,
        inputTokens: 120_000,
        outputTokens: 500,
        source: "provider",
        totalTokens: 120_500,
      },
    });

    const outcome = await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.5",
      providerName: "hosted-openai",
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
    vi.useFakeTimers();
    const firstWakeAt = new Date("2026-04-26T00:00:01.000Z");
    const requeueAt = new Date("2026-04-26T00:00:05.000Z");
    const wakeSignal = createCoalescingRuntimeWakeSignal();
    compactWarmCodexThread.mockImplementation(async (input: { signal: AbortSignal }) => {
      vi.setSystemTime(firstWakeAt);
      wakeSignal.notify();
      await new Promise<void>((resolve) => {
        input.signal.addEventListener("abort", () => {
          vi.setSystemTime(requeueAt);
          resolve();
        }, { once: true });
      });
      return {
        kind: "failed",
        reason: "aborted",
        threadContextTokensBefore: 130_000,
        threadId: "thread_xyz",
      };
    });

    try {
      const outcome = await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.5",
        providerName: "hosted-openai",
        pendingWork: false,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        wakeSignal,
      });

      expect(outcome).toMatchObject({ kind: "failed", reason: "aborted" });
      // The maintenance wait consumed the wake; the loop's pending-wake check
      // must still observe it afterwards with the original notification time.
      expect(wakeSignal.consumePending()).toEqual({
        notifiedAtEpochMs: firstWakeAt.getTime(),
      });
    } finally {
      vi.useRealTimers();
    }
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
      providerName: "hosted-openai",
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
        providerName: "hosted-openai",
        pendingWork: true,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        wakeSignal: null,
      }),
    ).toEqual({ kind: "skipped", reason: "pending_work", threadContextTokensBefore: null });
    expect(compactWarmCodexThread).not.toHaveBeenCalled();
  });

  it("runs a bounded inbox media retention slice when compaction is skipped for pending work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));
    runInboxMediaRetention.mockResolvedValue({
      expiredAttachments: 1,
      expiredBytes: 512,
      hasMoreEligibleAttachments: true,
      nextEligibleAt: null,
      records: [],
    });

    try {
      await expect(
        runHostedIdleCheckpointMaintenance({
          credentialSource: "platform",
          memberId: "member_1",
          model: "gpt-5.5",
          pendingWork: true,
          protectedCaptureIds: ["cap_pending"],
          providerName: "hosted-openai",
          recordUsage: null,
          resolveAssistantSessionId: null,
          shutdownSignal: null,
          vaultRoot: "/vault",
          wakeSignal: null,
        }),
      ).resolves.toEqual({
        kind: "skipped",
        nextWakeAt: "2026-07-05T00:00:00.000Z",
        nextWakeReason: "inbox_media_retention",
        reason: "pending_work",
        threadContextTokensBefore: null,
      });
      expect(runInboxMediaRetention).toHaveBeenCalledWith({
        materializeCandidatePaths: undefined,
        maxAttachments: 1,
        protectedAttachmentIds: undefined,
        protectedCaptureIds: ["cap_pending"],
        protectedStoredPaths: undefined,
        signal: expect.any(AbortSignal),
        vaultRoot: "/vault",
      });
      expect(compactWarmCodexThread).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips unpriced models so usage can never be unaccountable", async () => {
    expect(
      await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-unpriced-experimental",
        providerName: "hosted-openai",
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
        providerName: "hosted-openai",
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
      serviceTier: null,
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
      providerName: "hosted-openai",
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
