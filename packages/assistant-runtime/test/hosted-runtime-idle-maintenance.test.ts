import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_SOURCE_PATH,
  ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_VERSION,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";

const compactWarmCodexThread = vi.fn();
const runAssistantTranscriptContentRetention = vi.fn();
vi.mock("@murphai/assistant-engine/assistant-codex", () => ({
  compactWarmCodexThread: (input: unknown) => compactWarmCodexThread(input),
}));
vi.mock("@murphai/assistant-engine/assistant-store", () => ({
  runAssistantTranscriptContentRetention: (input: unknown) =>
    runAssistantTranscriptContentRetention(input),
}));
const runInboxMediaRetention = vi.fn();
const runInboxTextRetention = vi.fn();
const runInboxEnvelopeMigration = vi.fn();
vi.mock("@murphai/inboxd/retention", () => ({
  runInboxEnvelopeMigration: (input: unknown) => runInboxEnvelopeMigration(input),
  runInboxMediaRetention: (input: unknown) => runInboxMediaRetention(input),
  runInboxTextRetention: (input: unknown) => runInboxTextRetention(input),
}));
const runHostedPendingAssistantInputContentRetention = vi.fn();
vi.mock("../src/hosted-runtime/pending-input-index.ts", () => ({
  runHostedPendingAssistantInputContentRetention: (input: unknown) =>
    runHostedPendingAssistantInputContentRetention(input),
}));
const archiveClosedIntegrationIngestShards = vi.fn();
const runGeneratedImageCaptureRetention = vi.fn();
vi.mock("@murphai/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@murphai/core")>()),
  archiveClosedIntegrationIngestShards: (input: unknown) =>
    archiveClosedIntegrationIngestShards(input),
  runGeneratedImageCaptureRetention: (input: unknown) =>
    runGeneratedImageCaptureRetention(input),
}));

import {
  HOSTED_GROUP_IDLE_COMPACT_MIN_THREAD_TOKENS,
  HOSTED_IDLE_COMPACT_MIN_THREAD_TOKENS,
  HOSTED_IDLE_COMPACT_TIMEOUT_MS,
  HOSTED_INTEGRATION_INGEST_ARCHIVE_TIMEOUT_MS,
  HOSTED_INBOX_MEDIA_RETENTION_RETRY_DELAY_MS,
  runHostedIdleCheckpointMaintenance,
} from "../src/hosted-runtime/idle-maintenance.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";

beforeEach(() => {
  compactWarmCodexThread.mockReset();
  runAssistantTranscriptContentRetention.mockReset();
  runAssistantTranscriptContentRetention.mockResolvedValue({
    entriesRedacted: 0,
    entriesTrimmed: 0,
    nextEligibleAt: null,
    transcriptsTrimmed: 0,
  });
  runInboxMediaRetention.mockReset();
  runInboxMediaRetention.mockResolvedValue({
    expiredAttachments: 0,
    expiredBytes: 0,
    hasMoreEligibleAttachments: false,
    nextEligibleAt: null,
    records: [],
  });
  runInboxTextRetention.mockReset();
  // Idle maintenance runs both retention passes; a quiet text pass keeps these
  // cases asserting the media wake they were written for.
  runInboxTextRetention.mockResolvedValue({
    expiredCaptures: 0,
    hasMoreEligibleCaptures: false,
    legacyCapturesSkipped: 0,
    nextEligibleAt: null,
  });
  runInboxEnvelopeMigration.mockReset();
  runInboxEnvelopeMigration.mockResolvedValue({
    activeOperationCount: 0,
    blockerCount: 0,
    candidateBytes: 0,
    candidateCount: 0,
    deletedBytes: 0,
    deletedCount: 0,
    hasMore: false,
    hasWork: false,
    mismatchCount: 0,
    missingLedgerCount: 0,
    mode: "apply",
    mutated: false,
    scannedEnvelopeCount: 0,
  });
  runHostedPendingAssistantInputContentRetention.mockReset();
  runHostedPendingAssistantInputContentRetention.mockResolvedValue({
    inputsRetired: 0,
    inputsSuppressed: 0,
    nextEligibleAt: null,
  });
  archiveClosedIntegrationIngestShards.mockReset();
  archiveClosedIntegrationIngestShards.mockResolvedValue({
    archivedByteCount: 0,
    archivedShardCount: 0,
    blockedShardCount: 0,
    repairedShardCount: 0,
    scannedShardCount: 0,
    sourceByteCount: 0,
  });
  runGeneratedImageCaptureRetention.mockReset();
  runGeneratedImageCaptureRetention.mockResolvedValue({
    blockedCaptureCount: 0,
    hasMoreEligibleCaptures: false,
    nextEligibleAt: null,
    retiredByteCount: 0,
    retiredCaptureCount: 0,
    scannedCaptureCount: 0,
  });
});

describe("runHostedIdleCheckpointMaintenance", () => {
  it("keeps idle-shutdown compaction below the hosted Codex auto-compact ceiling", () => {
    expect(HOSTED_GROUP_IDLE_COMPACT_MIN_THREAD_TOKENS).toBe(50_000);
    expect(HOSTED_IDLE_COMPACT_MIN_THREAD_TOKENS).toBe(90_000);
    expect(HOSTED_GROUP_IDLE_COMPACT_MIN_THREAD_TOKENS).toBeLessThan(132_000);
    expect(HOSTED_IDLE_COMPACT_MIN_THREAD_TOKENS).toBeLessThan(132_000);
    expect(HOSTED_INTEGRATION_INGEST_ARCHIVE_TIMEOUT_MS).toBe(30_000);
  });

  it("skips on shutdown, missing model, and missing provider without touching the engine", async () => {
    expect(
      await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.6-terra",
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
        model: "gpt-5.6-terra",
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

  it("records local OpenAI compaction usage with hosted Flex evidence", async () => {
    compactWarmCodexThread.mockResolvedValue({
      kind: "compacted",
      durationMs: 1_200,
      threadContextTokensBefore: 140_000,
      threadId: "thread_xyz",
      serviceTier: "flex",
      model: "gpt-5.6-terra",
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
      model: "gpt-5.6-sol",
      providerName: "openai-local-test",
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
      canAccountForModel: expect.any(Function),
      groupMinThreadTokens: HOSTED_GROUP_IDLE_COMPACT_MIN_THREAD_TOKENS,
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
      requestedModel: "gpt-5.6-terra",
      sessionId: "asst_real_session",
      tokenPricingBasis: "openai-flex",
      totalTokens: 140_900,
      triggerKind: "automation_idle_compact",
      usageExtractionSourcePath: null,
      usageExtractionVersion: "legacy",
    });
  });

  it("does not compact or record usage for an unpriced warm-thread model", async () => {
    compactWarmCodexThread.mockResolvedValue({
      kind: "skipped",
      model: "gpt-unpriced-experimental",
      reason: "model_not_accountable",
      threadContextTokensBefore: 140_000,
    });
    const recordUsage = vi.fn();

    const outcome = await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.6-sol",
      pendingWork: false,
      providerName: "hosted-openai",
      recordUsage,
      resolveAssistantSessionId: async () => "asst_real_session",
      shutdownSignal: null,
      wakeSignal: null,
    });

    expect(outcome).toEqual({
      kind: "skipped",
      reason: "unpriced_model",
      threadContextTokensBefore: 140_000,
    });
    expect(recordUsage).not.toHaveBeenCalled();
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
        model: "gpt-5.6-terra",
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
        model: "gpt-5.6-terra",
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
        model: "gpt-5.6-terra",
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
      model: "gpt-5.6-terra",
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
    expect(runGeneratedImageCaptureRetention).toHaveBeenCalledWith({
      materializeCandidatePaths: materializeRetentionCandidatePaths,
      protectedCaptureIds: ["cap_pending"],
      protectedStoredPaths: ["raw/inbox/linq/self/2026/06/cap_pending/attachments/01__photo.webp"],
      signal: expect.any(AbortSignal),
      vaultRoot: "/vault",
    });
  });

  it("schedules generated-image cleanup on the shared retention wake", async () => {
    runGeneratedImageCaptureRetention.mockResolvedValue({
      blockedCaptureCount: 0,
      hasMoreEligibleCaptures: false,
      nextEligibleAt: "2026-07-10T00:00:00.000Z",
      retiredByteCount: 0,
      retiredCaptureCount: 0,
      scannedCaptureCount: 1,
    });
    runInboxMediaRetention.mockResolvedValue({
      expiredAttachments: 0,
      expiredBytes: 0,
      hasMoreEligibleAttachments: false,
      nextEligibleAt: "2026-07-20T00:00:00.000Z",
      records: [],
    });
    compactWarmCodexThread.mockResolvedValue({
      kind: "skipped",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });

    await expect(runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.6-terra",
      pendingWork: false,
      providerName: "hosted-openai",
      recordUsage: null,
      resolveAssistantSessionId: null,
      shutdownSignal: null,
      vaultRoot: "/vault",
      wakeSignal: null,
    })).resolves.toMatchObject({
      nextWakeAt: "2026-07-10T00:00:00.000Z",
      nextWakeReason: "inbox_media_retention",
    });
  });

  it("runs inbox text retention and wakes at the earlier of the two retention passes", async () => {
    runInboxMediaRetention.mockResolvedValue({
      expiredAttachments: 0,
      expiredBytes: 0,
      hasMoreEligibleAttachments: false,
      nextEligibleAt: "2026-07-20T00:00:00.000Z",
      records: [],
    });
    runInboxTextRetention.mockResolvedValue({
      expiredCaptures: 3,
      hasMoreEligibleCaptures: false,
      legacyCapturesSkipped: 0,
      nextEligibleAt: "2026-07-12T00:00:00.000Z",
    });
    compactWarmCodexThread.mockResolvedValue({
      kind: "skipped",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });

    const outcome = await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.6-terra",
      providerName: "hosted-openai",
      pendingWork: false,
      recordUsage: null,
      resolveAssistantSessionId: null,
      shutdownSignal: null,
      vaultRoot: "/vault",
      wakeSignal: null,
    });

    expect(runInboxTextRetention).toHaveBeenCalledWith(expect.objectContaining({
      vaultRoot: "/vault",
    }));
    // The text pass expires sooner, so its wake has to win; taking the media
    // wake would let message content sit past its window.
    expect(outcome).toEqual({
      kind: "skipped",
      nextWakeAt: "2026-07-12T00:00:00.000Z",
      nextWakeReason: "inbox_media_retention",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });
  });

  it("schedules pending assistant input content on the shared retention wake", async () => {
    runHostedPendingAssistantInputContentRetention.mockResolvedValue({
      inputsRetired: 0,
      inputsSuppressed: 0,
      nextEligibleAt: "2026-07-08T00:00:00.000Z",
    });
    compactWarmCodexThread.mockResolvedValue({
      kind: "skipped",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });

    const outcome = await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.6-terra",
      providerName: "hosted-openai",
      pendingWork: false,
      recordUsage: null,
      resolveAssistantSessionId: null,
      shutdownSignal: null,
      vaultRoot: "/vault",
      wakeSignal: null,
    });

    expect(runHostedPendingAssistantInputContentRetention).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      vaultRoot: "/vault",
    });
    expect(outcome).toMatchObject({
      nextWakeAt: "2026-07-08T00:00:00.000Z",
      nextWakeReason: "inbox_media_retention",
    });
  });

  it("schedules captureless transcript content on the shared retention wake", async () => {
    runAssistantTranscriptContentRetention.mockResolvedValue({
      entriesRedacted: 0,
      entriesTrimmed: 0,
      nextEligibleAt: "2026-07-10T00:00:00.000Z",
      transcriptsTrimmed: 0,
    });
    compactWarmCodexThread.mockResolvedValue({
      kind: "skipped",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });

    const outcome = await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.6-terra",
      providerName: "hosted-openai",
      pendingWork: false,
      recordUsage: null,
      resolveAssistantSessionId: null,
      shutdownSignal: null,
      vaultRoot: "/vault",
      wakeSignal: null,
    });

    expect(runAssistantTranscriptContentRetention).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      vault: "/vault",
    });
    expect(outcome).toMatchObject({
      nextWakeAt: "2026-07-10T00:00:00.000Z",
      nextWakeReason: "inbox_media_retention",
    });
  });

  it("bounds the inbox text retention slice when a checkpoint has pending work", async () => {
    compactWarmCodexThread.mockResolvedValue({
      kind: "skipped",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });

    await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.6-terra",
      providerName: "hosted-openai",
      pendingWork: true,
      recordUsage: null,
      resolveAssistantSessionId: null,
      shutdownSignal: null,
      vaultRoot: "/vault",
      wakeSignal: null,
    });

    expect(runInboxTextRetention).toHaveBeenCalledWith(expect.objectContaining({
      maxCaptures: 1,
    }));
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
        model: "gpt-5.6-terra",
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
      model: "gpt-5.6-terra",
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
        model: "gpt-5.6-terra",
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

  it("aborts envelope migration on a pending wake, re-notifies, and completes a later pass", async () => {
    vi.useFakeTimers();
    const wakeAt = new Date("2026-04-26T00:00:01.000Z");
    const wakeSignal = createCoalescingRuntimeWakeSignal();
    const migrationCall: { signal: AbortSignal | null } = { signal: null };
    runInboxEnvelopeMigration.mockImplementationOnce(
      async (input: { signal: AbortSignal }) => {
        migrationCall.signal = input.signal;
        vi.setSystemTime(wakeAt);
        wakeSignal.notify();
        await new Promise<void>((resolve) => {
          if (input.signal.aborted) {
            resolve();
            return;
          }
          input.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        input.signal.throwIfAborted();
      },
    );

    try {
      const interrupted = await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.6-terra",
        providerName: "hosted-openai",
        pendingWork: false,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        vaultRoot: "/vault",
        wakeSignal,
      });

      expect(interrupted).toEqual({
        kind: "skipped",
        reason: "pending_work",
        threadContextTokensBefore: null,
      });
      expect(migrationCall.signal?.aborted).toBe(true);
      expect(wakeSignal.consumePending()).toEqual({
        notifiedAtEpochMs: wakeAt.getTime(),
      });

      compactWarmCodexThread.mockResolvedValue({
        kind: "skipped",
        reason: "below_threshold",
        threadContextTokensBefore: 20_000,
      });
      const resumed = await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.6-terra",
        providerName: "hosted-openai",
        pendingWork: false,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        vaultRoot: "/vault",
        wakeSignal: null,
      });

      expect(resumed).toMatchObject({
        kind: "skipped",
        reason: "below_threshold",
      });
      expect(runInboxEnvelopeMigration).toHaveBeenLastCalledWith({
        apply: true,
        signal: expect.any(AbortSignal),
        vaultRoot: "/vault",
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
      model: "gpt-5.6-terra",
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
      model: "gpt-5.6-terra",
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
      model: "gpt-5.6-terra",
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
      requestedModel: "gpt-5.6-terra",
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
      model: "gpt-5.6-terra",
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
      model: "gpt-5.6-terra",
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
        model: "gpt-5.6-terra",
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
      model: "gpt-5.6-terra",
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
        model: "gpt-5.6-terra",
        providerName: "hosted-openai",
        pendingWork: true,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        wakeSignal: null,
      }),
    ).toEqual({ kind: "skipped", reason: "pending_work", threadContextTokensBefore: null });
    expect(compactWarmCodexThread).not.toHaveBeenCalled();
    expect(archiveClosedIntegrationIngestShards).not.toHaveBeenCalled();
  });

  it("archives closed integration ingest shards only on a true idle checkpoint", async () => {
    compactWarmCodexThread.mockResolvedValue({
      kind: "skipped",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });

    await runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.6-terra",
      pendingWork: false,
      providerName: "hosted-openai",
      recordUsage: null,
      resolveAssistantSessionId: null,
      shutdownSignal: null,
      vaultRoot: "/vault",
      wakeSignal: null,
    });

    expect(archiveClosedIntegrationIngestShards).toHaveBeenCalledOnce();
    expect(archiveClosedIntegrationIngestShards).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      vaultRoot: "/vault",
    });
  });

  it("keeps idle checkpoint maintenance fail-open when ingest archiving fails", async () => {
    archiveClosedIntegrationIngestShards.mockRejectedValue(
      new Error("synthetic ingest archive failure"),
    );
    compactWarmCodexThread.mockResolvedValue({
      kind: "skipped",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });

    await expect(runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.6-terra",
      pendingWork: false,
      providerName: "hosted-openai",
      recordUsage: null,
      resolveAssistantSessionId: null,
      shutdownSignal: null,
      vaultRoot: "/vault",
      wakeSignal: null,
    })).resolves.toEqual({
      kind: "skipped",
      reason: "below_threshold",
      threadContextTokensBefore: 20_000,
    });
    expect(compactWarmCodexThread).toHaveBeenCalledOnce();
  });

  it("aborts integration ingest archiving when a member-visible wake arrives", async () => {
    const wakeSignal = createCoalescingRuntimeWakeSignal();
    archiveClosedIntegrationIngestShards.mockImplementation(
      async (input: { signal: AbortSignal }) =>
        await new Promise((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(input.signal.reason), {
            once: true,
          });
          wakeSignal.notify(Date.now());
        }),
    );

    await expect(runHostedIdleCheckpointMaintenance({
      credentialSource: "platform",
      memberId: "member_1",
      model: "gpt-5.6-terra",
      pendingWork: false,
      providerName: "hosted-openai",
      recordUsage: null,
      resolveAssistantSessionId: null,
      shutdownSignal: null,
      vaultRoot: "/vault",
      wakeSignal,
    })).resolves.toEqual({
      kind: "skipped",
      reason: "pending_work",
      threadContextTokensBefore: null,
    });
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
          model: "gpt-5.6-terra",
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
      expect(runGeneratedImageCaptureRetention).toHaveBeenCalledWith({
        maxCaptures: 1,
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
    compactWarmCodexThread.mockResolvedValue({
      kind: "skipped",
      model: "gpt-unpriced-experimental",
      reason: "model_not_accountable",
      threadContextTokensBefore: 120_000,
    });
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
    ).toEqual({ kind: "skipped", reason: "unpriced_model", threadContextTokensBefore: 120_000 });
    expect(compactWarmCodexThread).toHaveBeenCalledOnce();
  });

  it("fails open when the engine helper throws", async () => {
    compactWarmCodexThread.mockRejectedValue(new Error("engine exploded"));
    expect(
      await runHostedIdleCheckpointMaintenance({
        credentialSource: "platform",
        memberId: "member_1",
        model: "gpt-5.6-terra",
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
      model: "gpt-5.6-terra",
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
      model: "gpt-5.6-terra",
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
