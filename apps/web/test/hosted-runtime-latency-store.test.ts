import {
  createHostedLinqDeliverySourceRefLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  linkHostedIngressLatencyTracesToAcceptedLinqDelivery,
  recordHostedIngressAcceptedFromMailboxItem,
  recordHostedIngressAssistantInputStaged,
  recordHostedIngressAssistantMilestone,
  recordHostedIngressDirectEnsureTiming,
  recordHostedIngressProviderStarted,
  recordHostedIngressRuntimeMilestone,
  recordHostedIngressTemporalSignalAccepted,
  readHostedIngressLatencyDashboard,
  readHostedLinqProductionCanaryLatencyDiagnostics,
  type HostedIngressLatencyDashboardInput,
} from "@/src/lib/hosted-runtime-latency/store";
import {
  HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS,
} from "@murphai/hosted-execution/runtime-control";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeLogMocks = vi.hoisted(() => ({
  isHostedRuntimeLogDatabaseConfigured: vi.fn(),
  listHostedRuntimeTurnTimingLogs: vi.fn(),
}));

vi.mock("@/src/lib/hosted-runtime-log/database", () => ({
  isHostedRuntimeLogDatabaseConfigured:
    runtimeLogMocks.isHostedRuntimeLogDatabaseConfigured,
}));

vi.mock("@/src/lib/hosted-runtime-log/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-runtime-log/store")>()),
  listHostedRuntimeTurnTimingLogs:
    runtimeLogMocks.listHostedRuntimeTurnTimingLogs,
}));

type LatencyDashboardPrisma = NonNullable<HostedIngressLatencyDashboardInput["prisma"]>;
type LatencyWritePrisma = NonNullable<
  Parameters<typeof recordHostedIngressAssistantInputStaged>[0]["prisma"]
>;
type HostedIngressLatencySetWriteProjectionRow = {
  assistantInputId: string;
  matched: boolean;
  traced: boolean;
};

type LatencyDashboardRow = {
  acceptedAt: Date;
  assistantInputStagedAt: Date | null;
  linqDelivery?: {
    acceptedAt: Date | null;
    attemptedAt: Date;
    deliveredAt: Date | null;
    lastReceiptAt: Date | null;
    sourceRef: string | null;
    status: string;
  } | null;
  linqDeliveryId?: string | null;
  phaseBreakdownJson?: unknown;
  providerRequestOrdinal?: number | null;
  providerStartAt: Date | null;
  replyRuntimeAttemptId?: string | null;
  runtimeAttemptId?: string | null;
  temporalSignalAcceptedAt: Date | null;
};

describe("fixed-canary recent latency observation", () => {
  const now = Date.parse("2026-09-10T12:01:00.000Z");
  const at = (offsetMs: number) => new Date(now + offsetMs);
  const row = () => ({
    webhookReceivedAt: at(-31_000), acceptedAt: at(-30_000),
    assistantInputStagedAt: at(-25_000), providerStartAt: at(-23_000),
    linqDelivery: {
      source: "runtime", attemptedAt: at(-5_000), acceptedAt: at(-4_000), deliveredAt: at(-2_000),
    },
  });
  const read = async (rows: unknown[]) => {
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = { hostedIngressLatencyTrace: { findMany } };
    const result = await readHostedLinqProductionCanaryLatencyDiagnostics({ prisma, memberId: "synthetic-canary" });
    return { result, findMany };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(now);
  });

  it("reads only four projected rows for the authorized member in an indexed server-owned window", async () => {
    const { result, findMany } = await read([row()]);
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: { userId: "synthetic-canary", source: "linq", acceptedAt: { gte: at(-600_000), lte: at(0) } },
      orderBy: { acceptedAt: "desc" }, take: 4,
      select: {
        webhookReceivedAt: true, acceptedAt: true, assistantInputStagedAt: true, providerStartAt: true,
        linqDelivery: { select: { source: true, attemptedAt: true, acceptedAt: true, deliveredAt: true } },
      },
    });
    expect(result).toEqual({
      status: "observed", failedTurnMatched: false, truncated: false,
      traces: [{
        stage: "delivery_observation", stale: false, incomplete: false, ageMs: 30_000,
        ingressMs: 1_000, preRuntimeMs: 5_000, runtimeToProviderMs: 2_000, providerToDeliveryMs: 18_000,
        deliveryAcceptMs: 1_000, deliveryReceiptMs: 2_000, deliveredAgeMs: 2_000,
      }],
    });
    expect(runtimeLogMocks.listHostedRuntimeTurnTimingLogs).not.toHaveBeenCalled();
  });

  it("omits private fields even if the database fixture supplies extra data", async () => {
    const value = row();
    const { result } = await read([{
      ...value, userId: "synthetic-private-member", mailboxItemId: "synthetic-private-mailbox",
      runtimeAttemptId: "synthetic-private-attempt", phaseBreakdownJson: { content: "synthetic-private-content" },
      linqDelivery: { ...value.linqDelivery, sourceRef: "synthetic-private-ref", providerMessageId: "synthetic-private-message" },
    }]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("synthetic-private");
    expect(serialized).not.toContain("2026-");
    expect(serialized).not.toContain(String(now));
  });

  it("keeps empty, multiple, truncated, stale, and incomplete evidence distinct", async () => {
    expect((await read([])).result).toEqual({ status: "empty", failedTurnMatched: false, truncated: false, traces: [] });
    expect((await read([row(), row()])).result).toMatchObject({ status: "ambiguous", truncated: false });
    const truncated = (await read([row(), row(), row(), row()])).result;
    expect(truncated).toMatchObject({ status: "ambiguous", truncated: true, failedTurnMatched: false });
    expect(truncated.traces).toHaveLength(3);
    const stale = { ...row(), acceptedAt: at(-121_000), webhookReceivedAt: at(-122_000) };
    expect((await read([stale])).result.traces[0]).toMatchObject({ stale: true, ageMs: 121_000 });
    const incomplete = { ...row(), assistantInputStagedAt: null, providerStartAt: null, linqDelivery: null };
    expect((await read([incomplete])).result.traces[0]).toEqual({
      stage: "pre_runtime", stale: false, incomplete: true, ageMs: 30_000, ingressMs: 1_000,
    });
    expect((await read([{ ...row(), linqDelivery: null }])).result.traces[0]).toMatchObject({
      stage: "runtime_provider", incomplete: true,
    });
  });

  it("recognizes instant delivery origin even when its continuation later starts a provider", async () => {
    const value = row();
    const { result } = await read([{
      ...value, providerStartAt: at(-2_000),
      linqDelivery: { ...value.linqDelivery, source: "hosted_web_instant_first_turn" },
    }]);
    expect(result.traces[0]).toEqual({
      stage: "instant_reply", stale: false, incomplete: false, ageMs: 30_000, ingressMs: 1_000,
      acceptedToDeliveryAttemptMs: 25_000, deliveryAcceptMs: 1_000, deliveryReceiptMs: 2_000, deliveredAgeMs: 2_000,
    });
    expect((await read([{ ...value, providerStartAt: null }])).result.traces[0]).toMatchObject({
      stage: "delivery_observation", incomplete: true,
    });
  });

  it.each([
    { label: "negative", start: -29_000 },
    { label: "overlong", start: -700_001 },
    { label: "invalid", start: Number.NaN },
  ])("omits $label intervals instead of fabricating zero-duration evidence", async ({ start }) => {
    const { result } = await read([{ ...row(), webhookReceivedAt: at(start) }]);
    expect(result.traces[0]).toMatchObject({ incomplete: true });
    expect(result.traces[0]).not.toHaveProperty("ingressMs");
  });

  it("does not confuse a failed trace query with an empty successful observation", async () => {
    const findMany = vi.fn().mockRejectedValue(new Error("synthetic-private-database-error"));
    const prisma = { hostedIngressLatencyTrace: { findMany } };
    await expect(readHostedLinqProductionCanaryLatencyDiagnostics({ prisma, memberId: "synthetic-canary" }))
      .rejects.toThrow("synthetic-private-database-error");
    expect(findMany).toHaveBeenCalledOnce();
  });
});

describe("hosted runtime latency dashboard store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeLogMocks.isHostedRuntimeLogDatabaseConfigured.mockReturnValue(false);
    runtimeLogMocks.listHostedRuntimeTurnTimingLogs.mockResolvedValue([]);
  });

  it("counts missing staged rows independently of provider start", async () => {
    const prisma = createLatencyDashboardPrisma([
      {
        acceptedAt: instant("2026-05-27T12:00:00.000Z"),
        assistantInputStagedAt: null,
        providerStartAt: instant("2026-05-27T12:00:04.000Z"),
        providerRequestOrdinal: 0,
        temporalSignalAcceptedAt: null,
      },
    ]);

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-05-27T12:05:00.000Z"),
      prisma,
      source: "linq",
      windowHours: 1,
    });

    expect(dashboard.completedCount).toBe(1);
    expect(dashboard.missingProviderStartCount).toBe(0);
    expect(dashboard.missingStagedCount).toBe(1);
    expect(dashboard.recentSlowRows[0]?.acceptedToStagedMs).toBeNull();
  });

  it("counts negative stage ordering once per invalid row", async () => {
    const prisma = createLatencyDashboardPrisma([
      {
        acceptedAt: instant("2026-05-27T12:00:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:00:01.000Z"),
        providerStartAt: instant("2026-05-27T12:00:02.000Z"),
        temporalSignalAcceptedAt: instant("2026-05-27T11:59:59.000Z"),
      },
      {
        acceptedAt: instant("2026-05-27T12:01:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:00:59.000Z"),
        providerStartAt: instant("2026-05-27T12:01:02.000Z"),
        temporalSignalAcceptedAt: null,
      },
      {
        acceptedAt: instant("2026-05-27T12:02:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:02:05.000Z"),
        providerStartAt: instant("2026-05-27T12:02:03.000Z"),
        temporalSignalAcceptedAt: null,
      },
      {
        acceptedAt: instant("2026-05-27T12:03:00.000Z"),
        assistantInputStagedAt: null,
        providerStartAt: instant("2026-05-27T12:02:59.000Z"),
        temporalSignalAcceptedAt: null,
      },
    ]);

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-05-27T12:05:00.000Z"),
      prisma,
      source: "linq",
      windowHours: 1,
    });

    expect(dashboard.invalidNegativeLatencyCount).toBe(4);
    expect(dashboard.completedCount).toBe(3);
    expect(dashboard.stageLatencyMs.acceptedToTemporalSignalP50).toBeNull();
    expect(dashboard.stageLatencyMs.stagedToProviderStartP50).toBe(1_000);
  });

  it("reports exact typing and local Codex output boundaries separately", async () => {
    const prisma = createLatencyDashboardPrisma([
      {
        acceptedAt: instant("2026-05-27T12:00:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:00:02.000Z"),
        phaseBreakdownJson: {
          assistant: {
            linqTypingRequestStartedAtEpochMs: Date.parse("2026-05-27T12:00:01.000Z"),
            linqTypingAcceptedAtEpochMs: Date.parse("2026-05-27T12:00:01.200Z"),
            firstCodexOutputObservedAtEpochMs: Date.parse("2026-05-27T12:00:03.400Z"),
            firstCodexTextObservedAtEpochMs: Date.parse("2026-05-27T12:00:03.800Z"),
          },
          schemaVersion: 1,
        },
        providerStartAt: instant("2026-05-27T12:00:03.000Z"),
        temporalSignalAcceptedAt: null,
      },
    ]);

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-05-27T12:05:00.000Z"),
      prisma,
      source: "linq",
      windowHours: 1,
    });

    expect(dashboard.observedMilestoneLatency).toEqual({
      acceptedToTypingRequest: {
        observationCount: 1,
        p50Ms: 1_000,
      },
      codexStartToFirstOutput: {
        observationCount: 1,
        p50Ms: 400,
      },
      codexStartToFirstText: {
        observationCount: 1,
        p50Ms: 800,
      },
      typingRequestToAccepted: {
        observationCount: 1,
        p50Ms: 200,
      },
    });
  });

  it("counts invalid observed milestone chronology once and excludes it from p50s", async () => {
    const prisma = createLatencyDashboardPrisma([
      {
        acceptedAt: instant("2026-05-27T12:00:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:00:01.000Z"),
        phaseBreakdownJson: {
          assistant: {
            linqTypingRequestStartedAtEpochMs: Date.parse("2026-05-27T11:59:59.000Z"),
            linqTypingAcceptedAtEpochMs: Date.parse("2026-05-27T11:59:58.000Z"),
            firstCodexOutputObservedAtEpochMs: Date.parse("2026-05-27T12:00:01.500Z"),
            firstCodexTextObservedAtEpochMs: Date.parse("2026-05-27T12:00:01.700Z"),
          },
          schemaVersion: 1,
        },
        providerStartAt: instant("2026-05-27T12:00:02.000Z"),
        temporalSignalAcceptedAt: null,
      },
    ]);

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-05-27T12:05:00.000Z"),
      prisma,
      source: "linq",
      windowHours: 1,
    });

    expect(dashboard.invalidNegativeLatencyCount).toBe(1);
    expect(dashboard.observedMilestoneLatency).toEqual({
      acceptedToTypingRequest: { observationCount: 0, p50Ms: null },
      codexStartToFirstOutput: { observationCount: 0, p50Ms: null },
      codexStartToFirstText: { observationCount: 0, p50Ms: null },
      typingRequestToAccepted: { observationCount: 0, p50Ms: null },
    });
  });

  it("reports deduplicated cold and warm reply spans using first delivery, not the latest notification", async () => {
    const coldDelivery = {
      acceptedAt: instant("2026-05-27T12:00:11.000Z"),
      attemptedAt: instant("2026-05-27T12:00:10.000Z"),
      deliveredAt: instant("2026-05-27T12:00:12.000Z"),
      lastReceiptAt: instant("2026-05-27T12:10:12.000Z"),
      sourceRef: deliverySourceRef("intent_cold"),
      status: "delivered",
    };
    const prisma = createLatencyDashboardPrisma([
      {
        acceptedAt: instant("2026-05-27T12:00:01.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:00:02.000Z"),
        linqDelivery: coldDelivery,
        linqDeliveryId: "delivery_cold_grouped",
        phaseBreakdownJson: {
          schemaVersion: 1,
          boot: { nodeStartupMs: 2_000, restoreWasCold: true },
        },
        providerStartAt: instant("2026-05-27T12:00:04.000Z"),
        providerRequestOrdinal: 0,
        replyRuntimeAttemptId: "attempt_cold",
        runtimeAttemptId: "attempt_cold",
        temporalSignalAcceptedAt: null,
      },
      {
        acceptedAt: instant("2026-05-27T12:00:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:00:02.000Z"),
        linqDelivery: coldDelivery,
        linqDeliveryId: "delivery_cold_grouped",
        phaseBreakdownJson: {
          schemaVersion: 1,
          boot: { nodeStartupMs: 2_000, restoreWasCold: true },
        },
        providerStartAt: instant("2026-05-27T12:00:04.000Z"),
        replyRuntimeAttemptId: "attempt_cold",
        runtimeAttemptId: "attempt_cold",
        temporalSignalAcceptedAt: null,
      },
      {
        acceptedAt: instant("2026-05-27T12:01:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:01:01.000Z"),
        linqDelivery: {
          acceptedAt: instant("2026-05-27T12:01:09.000Z"),
          attemptedAt: instant("2026-05-27T12:01:08.000Z"),
          deliveredAt: null,
          lastReceiptAt: null,
          sourceRef: deliverySourceRef("intent_warm"),
          status: "accepted",
        },
        linqDeliveryId: "delivery_warm",
        phaseBreakdownJson: {
          schemaVersion: 1,
          boot: { restoreWasCold: false },
        },
        providerStartAt: instant("2026-05-27T12:01:05.000Z"),
        providerRequestOrdinal: 0,
        replyRuntimeAttemptId: "attempt_warm",
        runtimeAttemptId: "attempt_warm",
        temporalSignalAcceptedAt: null,
      },
      {
        acceptedAt: instant("2026-05-27T12:02:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:02:01.000Z"),
        linqDelivery: {
          acceptedAt: instant("2026-05-27T12:02:05.000Z"),
          attemptedAt: instant("2026-05-27T12:02:04.000Z"),
          deliveredAt: instant("2026-05-27T12:02:06.000Z"),
          lastReceiptAt: instant("2026-05-27T12:02:06.000Z"),
          sourceRef: deliverySourceRef("intent_unknown"),
          status: "delivered",
        },
        linqDeliveryId: "delivery_unknown_cold_state",
        phaseBreakdownJson: { schemaVersion: 1 },
        providerStartAt: instant("2026-05-27T12:02:03.000Z"),
        providerRequestOrdinal: 0,
        replyRuntimeAttemptId: "attempt_unknown",
        runtimeAttemptId: "attempt_unknown",
        temporalSignalAcceptedAt: null,
      },
      {
        acceptedAt: instant("2026-05-27T12:03:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:03:01.000Z"),
        linqDelivery: {
          acceptedAt: instant("2026-05-27T12:03:05.000Z"),
          attemptedAt: instant("2026-05-27T12:03:04.000Z"),
          deliveredAt: null,
          lastReceiptAt: null,
          sourceRef: deliverySourceRef("intent_handoff"),
          status: "accepted",
        },
        linqDeliveryId: "delivery_attempt_handoff",
        providerStartAt: instant("2026-05-27T12:03:03.000Z"),
        providerRequestOrdinal: 0,
        replyRuntimeAttemptId: "attempt_other",
        runtimeAttemptId: "attempt_staged",
        temporalSignalAcceptedAt: null,
      },
      {
        acceptedAt: instant("2026-05-27T12:04:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:04:01.000Z"),
        providerStartAt: instant("2026-05-27T12:04:03.000Z"),
        providerRequestOrdinal: 0,
        runtimeAttemptId: "attempt_without_delivery",
        temporalSignalAcceptedAt: null,
      },
    ], [
      ...createTurnTimingLogRows({
        deliveryIntentId: "intent_cold",
        providerRequestElapsedMs: 4_000,
        runtimeAttemptId: "attempt_cold",
        sinceProviderResultMs: 1_000,
      }),
      ...createTurnTimingLogRows({
        deliveryIntentId: "intent_warm",
        providerRequestElapsedMs: 2_000,
        runtimeAttemptId: "attempt_warm",
        sinceProviderResultMs: 1_000,
      }),
      ...createTurnTimingLogRows({
        deliveryIntentId: "intent_unknown",
        providerRequestElapsedMs: 1_000,
        runtimeAttemptId: "attempt_unknown",
        sinceProviderResultMs: 0,
      }),
      ...createTurnTimingLogRows({
        deliveryIntentId: "intent_handoff",
        providerRequestElapsedMs: 1_000,
        runtimeAttemptId: "attempt_staged",
        sinceProviderResultMs: 0,
      }),
    ]);

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-05-27T12:05:00.000Z"),
      prisma,
      source: "linq",
      windowHours: 1,
    });

    expect(dashboard.replyLatencyMs.acceptedToLinqAccepted).toEqual({
      count: 4,
      p50: 7_000,
      p95: 10_700,
    });
    expect(dashboard.replyLatencyMs.coldAcceptedToLinqAccepted).toEqual({
      count: 1,
      p50: 11_000,
      p95: 11_000,
    });
    expect(dashboard.replyLatencyMs.warmAcceptedToLinqAccepted).toEqual({
      count: 1,
      p50: 9_000,
      p95: 9_000,
    });
    expect(dashboard.replyLatencyMs.codexStartToLinqAttempted).toEqual({
      count: 4,
      p50: 2_000,
      p95: 5_550,
    });
    expect(dashboard.replyLatencyMs.linqAttemptedToAccepted).toEqual({
      count: 4,
      p50: 1_000,
      p95: 1_000,
    });
    expect(dashboard.replyLatencyMs.linqAcceptedToReceipt).toEqual({
      count: 2,
      p50: 1_000,
      p95: 1_000,
    });
    expect(dashboard.replyLatencyMs.providerRequest).toEqual({
      count: 4,
      p50: 1_500,
      p95: 3_700,
    });
    expect(dashboard.replyLatencyMs.providerResultToReplyIntent).toEqual({
      count: 4,
      p50: 500,
      p95: 1_000,
    });
    expect(dashboard.replyLatencyMs.replyIntentToLinqAttempted).toEqual({
      count: 4,
      p50: 0,
      p95: 850,
    });
    expect(dashboard.replyTraceQuality).toEqual({
      acceptedMissingReceiptCount: 2,
      ambiguousTimingCount: 0,
      deliveryAttemptHandoffCount: 1,
      invalidNegativeLatencyCount: 0,
      linkedDeliveryCount: 4,
      missingAcceptedDeliveryCount: 0,
      providerRowsWithoutAcceptedDeliveryLinkCount: 1,
      timingLogTruncated: false,
      unknownColdStateCount: 2,
    });
    expect(runtimeLogMocks.listHostedRuntimeTurnTimingLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptIds: [
          "attempt_cold",
          "attempt_warm",
          "attempt_unknown",
          "attempt_staged",
        ],
      }),
    );
  });

  it("uses terminal receipt truth and excludes group and skipped sends without receipts", async () => {
    const prisma = createLatencyDashboardPrisma([
      createLinkedDashboardRow({
        acceptedAt: "2026-05-27T12:00:00.000Z",
        attemptedAt: "2026-05-27T12:00:04.000Z",
        deliveryId: "delivery_failed_receipt",
        deliveryStatus: "failed",
        deliveredAt: "2026-05-27T12:00:05.000Z",
        intentId: "intent_failed_receipt",
        providerStartAt: "2026-05-27T12:00:01.000Z",
        receiptAt: "2026-05-27T12:00:07.000Z",
        runtimeAttemptId: "attempt_failed_receipt",
      }),
      createLinkedDashboardRow({
        acceptedAt: "2026-05-27T12:01:00.000Z",
        attemptedAt: "2026-05-27T12:01:04.000Z",
        deliveryId: "delivery_group",
        deliveryStatus: "sent_no_receipt_expected",
        intentId: "intent_group",
        providerStartAt: "2026-05-27T12:01:01.000Z",
        receiptAt: null,
        runtimeAttemptId: "attempt_group",
      }),
      createLinkedDashboardRow({
        acceptedAt: "2026-05-27T12:02:00.000Z",
        attemptedAt: "2026-05-27T12:02:04.000Z",
        deliveryId: "delivery_pending_direct",
        deliveryStatus: "accepted",
        intentId: "intent_pending_direct",
        providerStartAt: "2026-05-27T12:02:01.000Z",
        receiptAt: null,
        runtimeAttemptId: "attempt_pending_direct",
      }),
      createLinkedDashboardRow({
        acceptedAt: "2026-05-27T12:03:00.000Z",
        attemptedAt: "2026-05-27T12:03:04.000Z",
        deliveryAcceptedAt: null,
        deliveryId: "delivery_skipped",
        deliveryStatus: "skipped",
        intentId: "intent_skipped",
        providerStartAt: "2026-05-27T12:03:01.000Z",
        receiptAt: null,
        runtimeAttemptId: "attempt_skipped",
      }),
    ]);

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-05-27T12:05:00.000Z"),
      prisma,
      source: "linq",
      windowHours: 1,
    });

    expect(dashboard.replyLatencyMs.acceptedToLinqReceipt).toEqual({
      count: 1,
      p50: 7_000,
      p95: 7_000,
    });
    expect(dashboard.replyLatencyMs.linqAcceptedToReceipt).toEqual({
      count: 1,
      p50: 2_500,
      p95: 2_500,
    });
    expect(dashboard.replyTraceQuality.acceptedMissingReceiptCount).toBe(1);
  });

  it("keeps Linq reply delivery metrics out of Telegram dashboards", async () => {
    const prisma = createLatencyDashboardPrisma([
      {
        acceptedAt: instant("2026-05-27T12:00:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:00:01.000Z"),
        linqDelivery: {
          acceptedAt: instant("2026-05-27T12:00:05.000Z"),
          attemptedAt: instant("2026-05-27T12:00:04.000Z"),
          deliveredAt: instant("2026-05-27T12:00:06.000Z"),
          lastReceiptAt: instant("2026-05-27T12:00:06.000Z"),
          sourceRef: deliverySourceRef("intent_telegram"),
          status: "delivered",
        },
        linqDeliveryId: "delivery_wrong_channel",
        phaseBreakdownJson: {
          schemaVersion: 1,
          boot: { restoreWasCold: false },
        },
        providerRequestOrdinal: 0,
        providerStartAt: instant("2026-05-27T12:00:03.000Z"),
        replyRuntimeAttemptId: "attempt_telegram",
        runtimeAttemptId: "attempt_telegram",
        temporalSignalAcceptedAt: null,
      },
    ], createTurnTimingLogRows({
      deliveryIntentId: "intent_telegram",
      providerRequestElapsedMs: 500,
      runtimeAttemptId: "attempt_telegram",
      sinceProviderResultMs: 100,
    }));

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-05-27T12:05:00.000Z"),
      prisma,
      source: "telegram",
      windowHours: 1,
    });

    expect(dashboard.replyLatencyMs.acceptedToLinqAccepted.count).toBe(0);
    expect(dashboard.replyLatencyMs.providerRequest.count).toBe(0);
    expect(dashboard.replyTraceQuality.linkedDeliveryCount).toBe(0);
    expect(
      dashboard.replyTraceQuality.providerRowsWithoutAcceptedDeliveryLinkCount,
    ).toBe(0);
  });

  it("counts retry handoffs per delivery and keeps links without generation diagnostics", async () => {
    const handoffDelivery = {
      acceptedAt: instant("2026-05-27T12:00:06.000Z"),
      attemptedAt: instant("2026-05-27T12:00:05.000Z"),
      deliveredAt: instant("2026-05-27T12:00:07.000Z"),
      lastReceiptAt: instant("2026-05-27T12:00:07.000Z"),
      sourceRef: deliverySourceRef("intent_handoff_grouped"),
      status: "delivered",
    };
    const prisma = createLatencyDashboardPrisma([
      {
        acceptedAt: instant("2026-05-27T12:00:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:00:01.000Z"),
        linqDelivery: handoffDelivery,
        linqDeliveryId: "delivery_handoff_grouped",
        providerRequestOrdinal: 0,
        providerStartAt: instant("2026-05-27T12:00:02.000Z"),
        replyRuntimeAttemptId: "attempt_delivery",
        runtimeAttemptId: "attempt_generation",
        temporalSignalAcceptedAt: null,
      },
      {
        acceptedAt: instant("2026-05-27T12:00:01.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:00:01.500Z"),
        linqDelivery: handoffDelivery,
        linqDeliveryId: "delivery_handoff_grouped",
        providerRequestOrdinal: 0,
        providerStartAt: instant("2026-05-27T12:00:02.000Z"),
        replyRuntimeAttemptId: "attempt_delivery",
        runtimeAttemptId: "attempt_generation",
        temporalSignalAcceptedAt: null,
      },
      {
        acceptedAt: instant("2026-05-27T12:01:00.000Z"),
        assistantInputStagedAt: null,
        linqDelivery: {
          acceptedAt: instant("2026-05-27T12:01:05.000Z"),
          attemptedAt: instant("2026-05-27T12:01:04.000Z"),
          deliveredAt: instant("2026-05-27T12:01:06.000Z"),
          lastReceiptAt: instant("2026-05-27T12:01:06.000Z"),
          sourceRef: deliverySourceRef("intent_without_generation_diagnostics"),
          status: "delivered",
        },
        linqDeliveryId: "delivery_without_generation_diagnostics",
        providerStartAt: null,
        replyRuntimeAttemptId: "attempt_delivery_only",
        runtimeAttemptId: null,
        temporalSignalAcceptedAt: null,
      },
    ], createTurnTimingLogRows({
      deliveryIntentId: "intent_handoff_grouped",
      providerRequestElapsedMs: 2_000,
      runtimeAttemptId: "attempt_generation",
      sinceProviderResultMs: 1_000,
    }));

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-05-27T12:05:00.000Z"),
      prisma,
      source: "linq",
      windowHours: 1,
    });

    expect(dashboard.replyLatencyMs.acceptedToLinqAccepted.count).toBe(2);
    expect(dashboard.replyLatencyMs.providerRequest.count).toBe(1);
    expect(dashboard.replyTraceQuality.deliveryAttemptHandoffCount).toBe(1);
    expect(dashboard.replyTraceQuality.linkedDeliveryCount).toBe(2);
    expect(dashboard.replyTraceQuality.ambiguousTimingCount).toBe(1);
  });

  it("correlates separate reply intents that share one attempt and provider ordinal", async () => {
    const prisma = createLatencyDashboardPrisma([
      createLinkedDashboardRow({
        acceptedAt: "2026-05-27T12:00:00.000Z",
        attemptedAt: "2026-05-27T12:00:05.000Z",
        deliveryId: "delivery_same_attempt_1",
        intentId: "intent_same_attempt_1",
        providerStartAt: "2026-05-27T12:00:01.000Z",
        runtimeAttemptId: "attempt_shared",
      }),
      createLinkedDashboardRow({
        acceptedAt: "2026-05-27T12:02:00.000Z",
        attemptedAt: "2026-05-27T12:02:08.000Z",
        deliveryId: "delivery_ordinal_mismatch",
        intentId: "intent_ordinal_mismatch",
        providerStartAt: "2026-05-27T12:02:02.000Z",
        runtimeAttemptId: "attempt_shared",
      }),
      createLinkedDashboardRow({
        acceptedAt: "2026-05-27T12:01:00.000Z",
        attemptedAt: "2026-05-27T12:01:08.000Z",
        deliveryId: "delivery_same_attempt_2",
        intentId: "intent_same_attempt_2",
        providerStartAt: "2026-05-27T12:01:02.000Z",
        runtimeAttemptId: "attempt_shared",
      }),
    ], [
      ...createTurnTimingLogRows({
        deliveryIntentId: "intent_same_attempt_1",
        providerRequestElapsedMs: 2_000,
        runtimeAttemptId: "attempt_shared",
        sinceProviderResultMs: 1_000,
      }),
      ...createTurnTimingLogRows({
        deliveryIntentId: "intent_same_attempt_2",
        providerRequestElapsedMs: 3_000,
        runtimeAttemptId: "attempt_shared",
        sinceProviderResultMs: 2_000,
      }),
      ...createTurnTimingLogRows({
        deliveryIntentId: "intent_ordinal_mismatch",
        providerRequestElapsedMs: 3_000,
        providerRequestOrdinal: 1,
        runtimeAttemptId: "attempt_shared",
        sinceProviderResultMs: 2_000,
      }),
    ]);

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-05-27T12:05:00.000Z"),
      prisma,
      source: "linq",
      windowHours: 1,
    });

    expect(dashboard.replyLatencyMs.providerRequest).toEqual({
      count: 2,
      p50: 2_500,
      p95: 2_950,
    });
    expect(dashboard.replyLatencyMs.providerResultToReplyIntent.count).toBe(2);
    expect(dashboard.replyTraceQuality.ambiguousTimingCount).toBe(1);
  });

  it("bounds targeted reply-timing reads and suppresses biased spans when they truncate", async () => {
    const row = createLinkedDashboardRow({
      acceptedAt: "2026-05-27T12:00:00.000Z",
      attemptedAt: "2026-05-27T12:00:05.000Z",
      deliveryId: "delivery_truncated",
      intentId: "intent_truncated",
      providerStartAt: "2026-05-27T12:00:01.000Z",
      runtimeAttemptId: "attempt_truncated",
    });
    const timingLog = createTurnTimingLogRows({
      deliveryIntentId: "intent_truncated",
      providerRequestElapsedMs: 2_000,
      runtimeAttemptId: "attempt_truncated",
      sinceProviderResultMs: 1_000,
    })[0]!;
    const prisma = createLatencyDashboardPrisma(
      [row],
      Array.from({ length: 100_001 }, (_, index) => ({
        ...timingLog,
        id: `${timingLog.id}_${index}`,
      })),
    );

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-05-27T12:05:00.000Z"),
      prisma,
      source: "linq",
      windowHours: 1,
    });

    expect(runtimeLogMocks.listHostedRuntimeTurnTimingLogs).toHaveBeenCalledWith({
      attemptIds: ["attempt_truncated"],
      from: instant("2026-05-27T11:00:00.000Z"),
      limit: 100_001,
      to: instant("2026-05-27T12:10:00.000Z"),
    });
    expect(dashboard.replyTraceQuality.timingLogTruncated).toBe(true);
    expect(dashboard.replyLatencyMs.providerRequest.count).toBe(0);
    expect(dashboard.replyLatencyMs.providerResultToReplyIntent.count).toBe(0);
    expect(dashboard.replyLatencyMs.replyIntentToLinqAttempted.count).toBe(0);
  });

  it("reads reply timing from the isolated database after cutover", async () => {
    const row = createLinkedDashboardRow({
      acceptedAt: "2026-05-27T12:00:00.000Z",
      attemptedAt: "2026-05-27T12:00:05.000Z",
      deliveryId: "delivery_isolated",
      intentId: "intent_isolated",
      providerStartAt: "2026-05-27T12:00:01.000Z",
      runtimeAttemptId: "attempt_isolated",
    });
    runtimeLogMocks.isHostedRuntimeLogDatabaseConfigured.mockReturnValue(true);
    runtimeLogMocks.listHostedRuntimeTurnTimingLogs.mockResolvedValue(
      createTurnTimingLogRows({
        deliveryIntentId: "intent_isolated",
        providerRequestElapsedMs: 2_000,
        runtimeAttemptId: "attempt_isolated",
        sinceProviderResultMs: 1_000,
      }),
    );

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-05-27T12:05:00.000Z"),
      prisma: createLatencyDashboardPrisma([row]),
      source: "linq",
      windowHours: 1,
    });

    expect(dashboard.replyTraceQuality.timingLogTruncated).toBe(false);
    expect(dashboard.replyLatencyMs.providerRequest).toEqual({
      count: 1,
      p50: 2_000,
      p95: 2_000,
    });
    expect(runtimeLogMocks.listHostedRuntimeTurnTimingLogs).toHaveBeenCalledOnce();
  });

  it("suppresses biased reply timing when the isolated read is unavailable", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const row = createLinkedDashboardRow({
      acceptedAt: "2026-05-27T12:00:00.000Z",
      attemptedAt: "2026-05-27T12:00:05.000Z",
      deliveryId: "delivery_unavailable",
      intentId: "intent_unavailable",
      providerStartAt: "2026-05-27T12:00:01.000Z",
      runtimeAttemptId: "attempt_unavailable",
    });
    runtimeLogMocks.isHostedRuntimeLogDatabaseConfigured.mockReturnValue(true);
    runtimeLogMocks.listHostedRuntimeTurnTimingLogs.mockRejectedValueOnce(
      new Error("isolated database unavailable"),
    );

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-05-27T12:05:00.000Z"),
      prisma: createLatencyDashboardPrisma([row]),
      source: "linq",
      windowHours: 1,
    });

    expect(dashboard.replyTraceQuality.timingLogTruncated).toBe(true);
    expect(dashboard.replyLatencyMs.providerRequest.count).toBe(0);
    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted latency isolated timing-log read failed.",
      expect.objectContaining({
        errorCode: "HOSTED_RUNTIME_LATENCY_TIMING_LOG_READ_FAILED",
      }),
    );
    consoleWarn.mockRestore();
  });

  it("converges when accepted-delivery linking wins trace creation", async () => {
    const prisma = createLatencyWritePrisma({
      deliveryLinkMatches: [true, false],
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-02T18:36:52.229Z")),
    });

    await expect(linkHostedIngressLatencyTracesToAcceptedLinqDelivery({
      answeredMailboxItemIds: ["mailbox_latency_1"],
      authenticatedUserId: "member_latency_1",
      linqDeliveryId: "delivery_latency_1",
      prisma,
      replyRuntimeAttemptId: "attempt_delivery_1",
    })).resolves.toEqual({ matchedCount: 1, recorded: true });
    expect(prisma.readTrace()).toEqual(expect.objectContaining({
      linqDeliveryId: "delivery_latency_1",
      replyRuntimeAttemptId: "attempt_delivery_1",
      runtimeAttemptId: null,
    }));

    await expect(recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_latency_1",
      at: instant("2026-06-02T18:36:54.229Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      prisma,
      runtimeAttemptId: "attempt_generation_1",
      source: "linq",
    })).resolves.toEqual({ matchedCount: 1, recorded: true, unmatchedCount: 0 });

    await expect(recordHostedIngressProviderStarted({
      assistantInputIds: ["input_latency_1"],
      authenticatedUserId: "member_latency_1",
      prisma,
      providerRequestOrdinal: 0,
      runtimeAttemptId: "attempt_generation_1",
      source: "linq",
    })).resolves.toEqual({ matchedCount: 1, recorded: true, unmatchedCount: 0 });

    const linkedTrace = prisma.readTrace();
    expect(linkedTrace).toEqual(expect.objectContaining({
      assistantInputId: "input_latency_1",
      linqDeliveryId: "delivery_latency_1",
      providerRequestOrdinal: 0,
      replyRuntimeAttemptId: "attempt_delivery_1",
      runtimeAttemptId: "attempt_generation_1",
    }));
    const deliveryLinkSql = prisma.readDeliveryLinkSql();
    for (const guard of [
      "INNER JOIN hosted_mailbox_item AS mailbox",
      "AND mailbox.kind = 'conversation.message'",
      "ON CONFLICT (mailbox_item_id) DO UPDATE",
      "hosted_ingress_latency_trace.reply_runtime_attempt_id IS NULL",
      "hosted_ingress_latency_trace.linq_delivery_id IS NULL",
      "hosted_ingress_latency_trace.user_id = EXCLUDED.user_id",
      "hosted_ingress_latency_trace.source = EXCLUDED.source",
    ]) {
      expect(deliveryLinkSql).toContain(guard);
    }
    expect(deliveryLinkSql).not.toContain("runtime_attempt_id = COALESCE");
    expect(deliveryLinkSql).not.toContain("EXCLUDED.runtime_attempt_id");

    await expect(linkHostedIngressLatencyTracesToAcceptedLinqDelivery({
      answeredMailboxItemIds: ["mailbox_latency_1"],
      authenticatedUserId: "member_latency_1",
      linqDeliveryId: "delivery_latency_competing",
      prisma,
      replyRuntimeAttemptId: "attempt_delivery_1",
    })).resolves.toEqual({ matchedCount: 0, recorded: false });
    expect(prisma.readTrace()?.linqDeliveryId).toBe("delivery_latency_1");
  });

  it("links a Web instant reply without inventing a runtime attempt and retains the link through later ingress writes", async () => {
    const prisma = createLatencyWritePrisma({
      deliveryLinkMatches: [true],
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-02T18:36:52.229Z")),
    });
    await expect(linkHostedIngressLatencyTracesToAcceptedLinqDelivery({
      answeredMailboxItemIds: ["mailbox_latency_1"],
      authenticatedUserId: "member_latency_1",
      linqDeliveryId: "delivery_latency_1",
      prisma,
      replyRuntimeAttemptId: null,
    })).resolves.toEqual({ matchedCount: 1, recorded: true });
    await recordHostedIngressAcceptedFromMailboxItem({
      mailboxItemId: "mailbox_latency_1",
      prisma,
      source: "linq",
      webhookReceivedAt: instant("2026-06-02T18:36:50.000Z"),
    });
    expect(prisma.readTrace()).toMatchObject({
      linqDeliveryId: "delivery_latency_1",
      replyRuntimeAttemptId: null,
      runtimeAttemptId: null,
    });
  });

  it("links delivery after a restart without replacing the generation attempt", async () => {
    const prisma = createLatencyWritePrisma({
      deliveryLinkMatches: [true],
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-02T18:36:52.229Z")),
    });
    await recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_latency_other",
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      prisma,
      runtimeAttemptId: "attempt_other",
      source: "linq",
    });
    await recordHostedIngressProviderStarted({
      assistantInputIds: ["input_latency_other"],
      authenticatedUserId: "member_latency_1",
      prisma,
      providerRequestOrdinal: 0,
      runtimeAttemptId: "attempt_other",
      source: "linq",
    });

    await expect(linkHostedIngressLatencyTracesToAcceptedLinqDelivery({
      answeredMailboxItemIds: ["mailbox_latency_1"],
      authenticatedUserId: "member_latency_1",
      linqDeliveryId: "delivery_latency_1",
      prisma,
      replyRuntimeAttemptId: "attempt_latency_1",
    })).resolves.toEqual({ matchedCount: 1, recorded: true });
    expect(prisma.readTrace()).toEqual(expect.objectContaining({
      linqDeliveryId: "delivery_latency_1",
      providerRequestOrdinal: 0,
      replyRuntimeAttemptId: "attempt_latency_1",
      runtimeAttemptId: "attempt_other",
    }));
  });

  it("rejects unsafe delivery-link identifiers without creating traces", async () => {
    const prisma = createLatencyWritePrisma({
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-02T18:36:52.229Z")),
    });

    await expect(linkHostedIngressLatencyTracesToAcceptedLinqDelivery({
      answeredMailboxItemIds: [],
      authenticatedUserId: "member_latency_1",
      linqDeliveryId: "delivery_latency_1",
      prisma,
      replyRuntimeAttemptId: "attempt_latency_1",
    })).resolves.toEqual({ matchedCount: 0, recorded: false });
    await expect(linkHostedIngressLatencyTracesToAcceptedLinqDelivery({
      answeredMailboxItemIds: ["mailbox_latency_1"],
      authenticatedUserId: "member_latency_1",
      linqDeliveryId: "delivery_latency_1",
      prisma,
      replyRuntimeAttemptId: "attempt latency with spaces",
    })).rejects.toThrow("Hosted ingress latency reply runtime attempt id is invalid.");
    expect(prisma.readTrace()).toBeNull();
  });

  it("stores mailbox accepted timestamps as real instants when DB-local wall time differs from UTC", async () => {
    const prisma = createLatencyWritePrisma({
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-02T18:36:52.229Z")),
    });

    await recordHostedIngressAcceptedFromMailboxItem({
      mailboxItemId: "mailbox_latency_1",
      prisma,
      source: "linq",
    });
    await recordHostedIngressTemporalSignalAccepted({
      at: instant("2026-06-02T18:36:53.229Z"),
      expectedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      prisma,
      source: "linq",
    });
    await recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_latency_1",
      at: instant("2026-06-02T18:36:54.229Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      prisma,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });
    await recordHostedIngressProviderStarted({
      assistantInputIds: ["input_latency_1"],
      at: instant("2026-06-02T18:36:55.229Z"),
      authenticatedUserId: "member_latency_1",
      prisma,
      providerRequestOrdinal: 0,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });

    const trace = prisma.readTrace();
    expect(trace?.acceptedAt.toISOString()).toBe("2026-06-02T18:36:52.229Z");
    expect(trace?.temporalSignalAcceptedAt?.toISOString()).toBe("2026-06-02T18:36:53.229Z");
    expect(trace?.assistantInputStagedAt?.toISOString()).toBe("2026-06-02T18:36:54.229Z");
    expect(trace?.providerStartAt?.toISOString()).toBe("2026-06-02T18:36:55.229Z");
    expect(prisma.readMailboxQuerySql()).toContain(
      "EXTRACT(EPOCH FROM (created_at AT TIME ZONE current_setting('TimeZone')))",
    );
    expect(prisma.readMailboxQuerySql()).toContain('AS "acceptedAtEpochMs"');
    expect(prisma.readMailboxQuerySql()).not.toContain('AS "acceptedAt"');
    expect(prisma.readMailboxQueryValues()).toEqual([
      ["mailbox_latency_1"],
      ["mailbox_latency_1", "member_latency_1"],
      ["mailbox_latency_1", "member_latency_1"],
    ]);

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-06-02T18:40:00.000Z"),
      prisma,
      source: "linq",
      windowHours: 1,
    });

    expect(dashboard.completedCount).toBe(1);
    expect(dashboard.invalidNegativeLatencyCount).toBe(0);
    expect(dashboard.percentileMs.p50).toBe(3_000);
    expect(dashboard.stageLatencyMs.acceptedToTemporalSignalP50).toBe(1_000);
    expect(dashboard.stageLatencyMs.acceptedToStagedP50).toBe(2_000);
    expect(dashboard.stageLatencyMs.stagedToProviderStartP50).toBe(1_000);
  });

  it("persists direct ensure web-clock timing before runtime staging", async () => {
    const prisma = createLatencyWritePrisma({
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-09T10:00:00.000Z")),
    });

    await expect(recordHostedIngressDirectEnsureTiming({
      expectedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      phaseBreakdown: {
        schemaVersion: 1,
        orchestration: {
          tokenAcquireStartedAtEpochMs: 1_777_000_000_000,
          tokenAcquiredAtEpochMs: 1_777_000_000_010,
          directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
          directEnsureResponseReceivedAtEpochMs: 1_777_000_000_120,
          directEnsureOrchestrationAttemptId:
            "web-ingress-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          directEnsureResultKind: "runtime_processing_accepted",
          directEnsureAction: "woken",
          directEnsureRuntimeAttemptId: "runtime-attempt-direct",
        },
      },
      prisma,
      source: "linq",
    })).resolves.toEqual({
      matchedCount: 1,
      recorded: true,
      unmatchedCount: 0,
    });

    expect(prisma.readTrace()?.phaseBreakdownJson).toEqual({
      schemaVersion: 1,
      orchestration: {
        tokenAcquireStartedAtEpochMs: 1_777_000_000_000,
        tokenAcquiredAtEpochMs: 1_777_000_000_010,
        directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
        directEnsureResponseReceivedAtEpochMs: 1_777_000_000_120,
        directEnsureOrchestrationAttemptId:
          "web-ingress-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        directEnsureResultKind: "runtime_processing_accepted",
        directEnsureAction: "woken",
        directEnsureRuntimeAttemptId: "runtime-attempt-direct",
      },
    });

    await expect(recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_latency_1",
      at: instant("2026-06-09T10:00:01.000Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      phaseBreakdown: {
        orchestration: {
          cloudflareRouteReceivedAtEpochMs: 1_777_000_000_020,
          freshStartRequestedAtEpochMs: 1_777_000_000_030,
          runtimeInvocationOrchestrationAttemptId:
            "web-ingress-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          triggeredByWebDirect: true,
        },
        schemaVersion: 1,
      },
      prisma,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    })).resolves.toEqual({ matchedCount: 1, recorded: true, unmatchedCount: 0 });

    expect(prisma.readTrace()?.phaseBreakdownJson).toEqual({
      schemaVersion: 1,
      orchestration: {
        tokenAcquireStartedAtEpochMs: 1_777_000_000_000,
        tokenAcquiredAtEpochMs: 1_777_000_000_010,
        directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
        directEnsureResponseReceivedAtEpochMs: 1_777_000_000_120,
        directEnsureOrchestrationAttemptId:
          "web-ingress-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        directEnsureResultKind: "runtime_processing_accepted",
        directEnsureAction: "woken",
        directEnsureRuntimeAttemptId: "runtime-attempt-direct",
        cloudflareRouteReceivedAtEpochMs: 1_777_000_000_020,
        freshStartRequestedAtEpochMs: 1_777_000_000_030,
        runtimeInvocationOrchestrationAttemptId:
          "web-ingress-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        triggeredByWebDirect: true,
      },
    });
    expect(prisma.readTraceInsertSql()).toContain("ON CONFLICT (mailbox_item_id) DO UPDATE");
  });

  it("merges direct ensure timing when a trace row already won creation", async () => {
    const prisma = createLatencyWritePrisma({
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-09T10:00:00.000Z")),
    });

    await recordHostedIngressAcceptedFromMailboxItem({
      mailboxItemId: "mailbox_latency_1",
      prisma,
      source: "linq",
    });

    await expect(recordHostedIngressDirectEnsureTiming({
      expectedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      phaseBreakdown: {
        schemaVersion: 1,
        orchestration: {
          tokenAcquireStartedAtEpochMs: 1_777_000_000_000,
          tokenAcquiredAtEpochMs: 1_777_000_000_010,
          directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
          directEnsureResponseReceivedAtEpochMs: 1_777_000_000_120,
          directEnsureAuthDurationMs: 0,
          directEnsureHandlerDurationMs: 42,
        },
      },
      prisma,
      source: "linq",
    })).resolves.toEqual({
      matchedCount: 1,
      recorded: true,
      unmatchedCount: 0,
    });

    expect(prisma.readTrace()?.phaseBreakdownJson).toEqual({
      schemaVersion: 1,
      orchestration: {
        tokenAcquireStartedAtEpochMs: 1_777_000_000_000,
        tokenAcquiredAtEpochMs: 1_777_000_000_010,
        directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
        directEnsureResponseReceivedAtEpochMs: 1_777_000_000_120,
        directEnsureAuthDurationMs: 0,
        directEnsureHandlerDurationMs: 42,
      },
    });
    expect(prisma.readTraceInsertSql()).toContain("ON CONFLICT (mailbox_item_id) DO UPDATE");
  });

  it("stores retry_later as a bounded outcome without retry or error detail", async () => {
    const prisma = createLatencyWritePrisma({
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-09T10:00:00.000Z")),
    });

    await expect(recordHostedIngressDirectEnsureTiming({
      expectedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      phaseBreakdown: {
        schemaVersion: 1,
        orchestration: {
          directEnsureOrchestrationAttemptId:
            "web-ingress-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
          directEnsureResponseReceivedAtEpochMs: 1_777_000_000_120,
          directEnsureResultKind: "retry_later",
        },
      },
      prisma,
      source: "linq",
    })).resolves.toMatchObject({ recorded: true });

    expect(prisma.readTrace()?.phaseBreakdownJson).toEqual({
      schemaVersion: 1,
      orchestration: {
        directEnsureOrchestrationAttemptId:
          "web-ingress-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
        directEnsureResponseReceivedAtEpochMs: 1_777_000_000_120,
        directEnsureResultKind: "retry_later",
      },
    });
  });

  it("uses one set-based mutation at the maximum admitted assistant-input cardinality", async () => {
    const assistantInputIds = Array.from(
      { length: HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS },
      (_value, index) => `input_set_${index + 1}`,
    );
    const prisma = createLatencyWritePrisma({
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-02T21:00:00.000Z")),
      setBasedProjectionRows: assistantInputIds.map((assistantInputId) => ({
        assistantInputId,
        matched: true,
        traced: true,
      })),
    });

    await expect(recordHostedIngressProviderStarted({
      assistantInputIds,
      at: instant("2026-06-02T21:00:00.000Z"),
      authenticatedUserId: "member_latency_1",
      prisma,
      providerRequestOrdinal: 0,
      runtimeAttemptId: "attempt_set_1",
      source: "linq",
    })).resolves.toEqual({
      matchedCount: HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS,
      recorded: true,
      unmatchedCount: 0,
    });
    expect({
      candidateCount: assistantInputIds.length,
      mutationRoundTrips: prisma.readSetBasedMutationSql().length,
    }).toEqual({
      candidateCount: HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS,
      mutationRoundTrips: 1,
    });
    expect(prisma.readSetBasedMutationValues()[0]?.slice(-assistantInputIds.length))
      .toEqual([...assistantInputIds].sort());


    await expect(recordHostedIngressAssistantMilestone({
      assistantInputIds,
      at: instant("2026-06-02T21:00:01.000Z"),
      authenticatedUserId: "member_latency_1",
      milestone: "first_codex_output_observed",
      prisma,
      runtimeAttemptId: "attempt_set_1",
      runtimeLeaseGeneration: "1",
      source: "linq",
    })).resolves.toEqual({
      matchedCount: HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS,
      recorded: true,
      unmatchedCount: 0,
    });

    const mutationSql = prisma.readSetBasedMutationSql();
    expect({
      candidateCount: assistantInputIds.length,
      mutationRoundTrips: mutationSql.length - 1,
    }).toEqual({
      candidateCount: HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS,
      mutationRoundTrips: 1,
    });
    expect(prisma.readSetBasedMutationValues()[1]?.slice(-assistantInputIds.length))
      .toEqual([...assistantInputIds].sort());
    expect(prisma.readTransactionCallCount()).toBe(0);
  });

  it("persists conversation import phase timing with the staged input", async () => {
    const prisma = createLatencyWritePrisma({
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-02T19:30:20.000Z")),
    });
    const importPhase = {
      autoReplyPreparedAtEpochMs: 1_777_000_000_030,
      decodeDoneAtEpochMs: 1_777_000_000_020,
      decodeStartedAtEpochMs: 1_777_000_000_010,
      pendingIndexEnsuredAtEpochMs: 1_777_000_000_040,
      stagedAtEpochMs: 1_777_000_000_050,
    };

    await expect(recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_import_phase_1",
      at: instant("2026-06-02T19:30:21.000Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      phaseBreakdown: {
        import: importPhase,
        schemaVersion: 1,
      },
      prisma,
      runtimeAttemptId: "attempt_import_phase_1",
      source: "linq",
    })).resolves.toEqual({
      matchedCount: 1,
      recorded: true,
      unmatchedCount: 0,
    });

    expect(prisma.readTrace()?.phaseBreakdownJson).toEqual({
      import: importPhase,
      schemaVersion: 1,
    });
  });

  it("records runtime milestones only after the staged row owns the exact attempt", async () => {
    const prisma = createLatencyWritePrisma({
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-02T20:00:00.000Z")),
    });

    await recordHostedIngressAcceptedFromMailboxItem({
      mailboxItemId: "mailbox_latency_1",
      prisma,
      source: "linq",
    });
    const earlyMilestoneResult = await recordHostedIngressRuntimeMilestone({
      at: instant("2026-06-02T20:00:03.000Z"),
      authenticatedUserId: "member_latency_1",
      milestone: "runner_job_accepted",
      prisma,
      runtimeAttemptId: "attempt_latency_1",
      runtimeLeaseGeneration: "1",
      source: "linq",
    });

    expect(earlyMilestoneResult).toEqual({
      matchedCount: 0,
      recorded: false,
      unmatchedCount: 0,
    });
    expect(prisma.readTrace()?.runnerJobAcceptedAt).toBeNull();

    await recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_latency_1",
      at: instant("2026-06-02T20:00:05.000Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      prisma,
      runnerJobAcceptedAt: instant("2026-06-02T20:00:01.000Z"),
      runtimeAttemptId: "attempt_latency_1",
      runtimePhaseStartedAt: instant("2026-06-02T20:00:02.000Z"),
      source: "linq",
      workspaceRestoreDoneAt: instant("2026-06-02T20:00:04.000Z"),
    });

    const result = await recordHostedIngressRuntimeMilestone({
      at: instant("2026-06-02T20:00:06.000Z"),
      authenticatedUserId: "member_latency_1",
      milestone: "mailbox_import_done",
      prisma,
      runtimeAttemptId: "attempt_latency_1",
      runtimeLeaseGeneration: "1",
      source: "linq",
    });

    const trace = prisma.readTrace();
    expect(result).toEqual({
      matchedCount: 1,
      recorded: true,
      unmatchedCount: 0,
    });
    expect(trace?.runnerJobAcceptedAt?.toISOString()).toBe("2026-06-02T20:00:01.000Z");
    expect(trace?.runtimePhaseStartedAt?.toISOString()).toBe("2026-06-02T20:00:02.000Z");
    expect(trace?.workspaceRestoreDoneAt?.toISOString()).toBe("2026-06-02T20:00:04.000Z");
    expect(trace?.mailboxImportDoneAt?.toISOString()).toBe("2026-06-02T20:00:06.000Z");
    expect(trace?.runtimeAttemptId).toBe("attempt_latency_1");
  });

  it("merges restore+boot on staged and provider on provider_started without clobbering, idempotently", async () => {
    const prisma = createLatencyWritePrisma({
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-09T10:00:00.000Z")),
    });

    await recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_phase_1",
      at: instant("2026-06-09T10:00:01.000Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      phaseBreakdown: {
        schemaVersion: 1,
        orchestration: {
          temporalActivityStartedAtEpochMs: 1_777_000_000_000,
          temporalActivityRequestStartedAtEpochMs: 1_777_000_000_010,
          tokenAcquireStartedAtEpochMs: 1_777_000_000_011,
          tokenAcquiredAtEpochMs: 1_777_000_000_012,
          directEnsureRequestStartedAtEpochMs: 1_777_000_000_013,
          directEnsureResponseReceivedAtEpochMs: 1_777_000_000_014,
          runtimeControlAuthStartedAtEpochMs: 1_777_000_000_015,
          runtimeControlAuthFinishedAtEpochMs: 1_777_000_000_016,
          cloudflareRouteReceivedAtEpochMs: 1_777_000_000_020,
          activeWakeStartedAtEpochMs: 1_777_000_000_040,
          activeWakeFinishedAtEpochMs: 1_777_000_000_050,
          activeWakeAccepted: false,
          replacementFenceClearedAtEpochMs: 1_777_000_000_060,
          replacedStaleFence: true,
          freshStartRequestedAtEpochMs: 1_777_000_000_070,
          freshStartFenceBoundAtEpochMs: 1_777_000_000_080,
          freshStartInvocationPreparedAtEpochMs: 1_777_000_000_100,
          freshStartInvocationAcceptedAtEpochMs: 1_777_000_000_110,
        },
        dispatch: {
          invokeReceivedAtEpochMs: 1_777_000_000_000,
          containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
        },
        restore: {
          sizeGuardMs: 1,
          objectFetchResponseHeadersMs: 2,
          objectFetchBodyReadMs: 3,
          decryptMs: 5,
          extractMs: 7,
        },
        boot: { nodeStartupMs: 4200, restoreWasCold: true },
        wake: {
          runtimeWakeNotifiedAtEpochMs: 1_777_000_001_000,
          foregroundWaitResolvedAtEpochMs: 1_777_000_001_010,
          foregroundImportStartedAtEpochMs: 1_777_000_001_011,
        },
      },
      prisma,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });

    let trace = prisma.readTrace();
    expect(trace?.phaseBreakdownJson).toEqual({
      schemaVersion: 1,
      orchestration: {
        temporalActivityStartedAtEpochMs: 1_777_000_000_000,
        temporalActivityRequestStartedAtEpochMs: 1_777_000_000_010,
        tokenAcquireStartedAtEpochMs: 1_777_000_000_011,
        tokenAcquiredAtEpochMs: 1_777_000_000_012,
        directEnsureRequestStartedAtEpochMs: 1_777_000_000_013,
        directEnsureResponseReceivedAtEpochMs: 1_777_000_000_014,
        runtimeControlAuthStartedAtEpochMs: 1_777_000_000_015,
        runtimeControlAuthFinishedAtEpochMs: 1_777_000_000_016,
        cloudflareRouteReceivedAtEpochMs: 1_777_000_000_020,
        activeWakeStartedAtEpochMs: 1_777_000_000_040,
        activeWakeFinishedAtEpochMs: 1_777_000_000_050,
        activeWakeAccepted: false,
        replacementFenceClearedAtEpochMs: 1_777_000_000_060,
        replacedStaleFence: true,
        freshStartRequestedAtEpochMs: 1_777_000_000_070,
        freshStartFenceBoundAtEpochMs: 1_777_000_000_080,
        freshStartInvocationPreparedAtEpochMs: 1_777_000_000_100,
        freshStartInvocationAcceptedAtEpochMs: 1_777_000_000_110,
      },
      dispatch: {
        invokeReceivedAtEpochMs: 1_777_000_000_000,
        containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
      },
      restore: {
        sizeGuardMs: 1,
        objectFetchResponseHeadersMs: 2,
        objectFetchBodyReadMs: 3,
        decryptMs: 5,
        extractMs: 7,
      },
      boot: { nodeStartupMs: 4200, restoreWasCold: true },
      wake: {
        runtimeWakeNotifiedAtEpochMs: 1_777_000_001_000,
        foregroundWaitResolvedAtEpochMs: 1_777_000_001_010,
        foregroundImportStartedAtEpochMs: 1_777_000_001_011,
      },
    });

    // Idempotent re-send must not clobber already-populated staged diagnostics.
    await recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_phase_1",
      at: instant("2026-06-09T10:00:01.000Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      phaseBreakdown: {
        schemaVersion: 1,
        orchestration: {
          temporalActivityStartedAtEpochMs: 999,
          directEnsureResponseReceivedAtEpochMs: 999,
          runtimeControlAuthFinishedAtEpochMs: 999,
          activeWakeAccepted: true,
          freshStartInvocationAcceptedAtEpochMs: 999,
        },
        dispatch: { invokeReceivedAtEpochMs: 999 },
        restore: { sizeGuardMs: 999 },
        boot: { nodeStartupMs: 999 },
        wake: { foregroundImportStartedAtEpochMs: 999 },
      },
      prisma,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });
    trace = prisma.readTrace();
    expect(trace?.phaseBreakdownJson).toEqual({
      schemaVersion: 1,
      orchestration: {
        temporalActivityStartedAtEpochMs: 1_777_000_000_000,
        temporalActivityRequestStartedAtEpochMs: 1_777_000_000_010,
        tokenAcquireStartedAtEpochMs: 1_777_000_000_011,
        tokenAcquiredAtEpochMs: 1_777_000_000_012,
        directEnsureRequestStartedAtEpochMs: 1_777_000_000_013,
        directEnsureResponseReceivedAtEpochMs: 1_777_000_000_014,
        runtimeControlAuthStartedAtEpochMs: 1_777_000_000_015,
        runtimeControlAuthFinishedAtEpochMs: 1_777_000_000_016,
        cloudflareRouteReceivedAtEpochMs: 1_777_000_000_020,
        activeWakeStartedAtEpochMs: 1_777_000_000_040,
        activeWakeFinishedAtEpochMs: 1_777_000_000_050,
        activeWakeAccepted: false,
        replacementFenceClearedAtEpochMs: 1_777_000_000_060,
        replacedStaleFence: true,
        freshStartRequestedAtEpochMs: 1_777_000_000_070,
        freshStartFenceBoundAtEpochMs: 1_777_000_000_080,
        freshStartInvocationPreparedAtEpochMs: 1_777_000_000_100,
        freshStartInvocationAcceptedAtEpochMs: 1_777_000_000_110,
      },
      dispatch: {
        invokeReceivedAtEpochMs: 1_777_000_000_000,
        containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
      },
      restore: {
        sizeGuardMs: 1,
        objectFetchResponseHeadersMs: 2,
        objectFetchBodyReadMs: 3,
        decryptMs: 5,
        extractMs: 7,
      },
      boot: { nodeStartupMs: 4200, restoreWasCold: true },
      wake: {
        runtimeWakeNotifiedAtEpochMs: 1_777_000_001_000,
        foregroundWaitResolvedAtEpochMs: 1_777_000_001_010,
        foregroundImportStartedAtEpochMs: 1_777_000_001_011,
      },
    });

    // Provider sub-object merges in alongside the preserved staged diagnostics.
    await recordHostedIngressProviderStarted({
      assistantInputIds: ["input_phase_1"],
      at: instant("2026-06-09T10:00:03.000Z"),
      authenticatedUserId: "member_latency_1",
      phaseBreakdown: {
        schemaVersion: 1,
        provider: { sessionResolveMs: 11, promptBuildMs: 22, admissionMs: 33 },
      },
      prisma,
      providerRequestOrdinal: 0,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });
    trace = prisma.readTrace();
    expect(trace?.phaseBreakdownJson).toEqual({
      schemaVersion: 1,
      orchestration: {
        temporalActivityStartedAtEpochMs: 1_777_000_000_000,
        temporalActivityRequestStartedAtEpochMs: 1_777_000_000_010,
        tokenAcquireStartedAtEpochMs: 1_777_000_000_011,
        tokenAcquiredAtEpochMs: 1_777_000_000_012,
        directEnsureRequestStartedAtEpochMs: 1_777_000_000_013,
        directEnsureResponseReceivedAtEpochMs: 1_777_000_000_014,
        runtimeControlAuthStartedAtEpochMs: 1_777_000_000_015,
        runtimeControlAuthFinishedAtEpochMs: 1_777_000_000_016,
        cloudflareRouteReceivedAtEpochMs: 1_777_000_000_020,
        activeWakeStartedAtEpochMs: 1_777_000_000_040,
        activeWakeFinishedAtEpochMs: 1_777_000_000_050,
        activeWakeAccepted: false,
        replacementFenceClearedAtEpochMs: 1_777_000_000_060,
        replacedStaleFence: true,
        freshStartRequestedAtEpochMs: 1_777_000_000_070,
        freshStartFenceBoundAtEpochMs: 1_777_000_000_080,
        freshStartInvocationPreparedAtEpochMs: 1_777_000_000_100,
        freshStartInvocationAcceptedAtEpochMs: 1_777_000_000_110,
      },
      dispatch: {
        invokeReceivedAtEpochMs: 1_777_000_000_000,
        containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
      },
      restore: {
        sizeGuardMs: 1,
        objectFetchResponseHeadersMs: 2,
        objectFetchBodyReadMs: 3,
        decryptMs: 5,
        extractMs: 7,
      },
      boot: { nodeStartupMs: 4200, restoreWasCold: true },
      wake: {
        runtimeWakeNotifiedAtEpochMs: 1_777_000_001_000,
        foregroundWaitResolvedAtEpochMs: 1_777_000_001_010,
        foregroundImportStartedAtEpochMs: 1_777_000_001_011,
      },
      provider: { sessionResolveMs: 11, promptBuildMs: 22, admissionMs: 33 },
    });

    // Idempotent provider re-send preserves the populated provider sub-object.
    await recordHostedIngressProviderStarted({
      assistantInputIds: ["input_phase_1"],
      at: instant("2026-06-09T10:00:03.000Z"),
      authenticatedUserId: "member_latency_1",
      phaseBreakdown: {
        schemaVersion: 1,
        provider: { sessionResolveMs: 999 },
      },
      prisma,
      providerRequestOrdinal: 0,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });
    trace = prisma.readTrace();
    expect((trace?.phaseBreakdownJson as { provider: { sessionResolveMs: number } }).provider.sessionResolveMs)
      .toBe(11);
    expect((trace?.phaseBreakdownJson as { schemaVersion: number }).schemaVersion).toBe(1);
  });

  it("persists sanitized stored phaseBreakdown when incoming diagnostics are idempotent", async () => {
    const prisma = createLatencyWritePrisma({
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-09T10:00:00.000Z")),
    });

    // Establish the trace with a valid populated boot sub-object first.
    await recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_phase_guard",
      at: instant("2026-06-09T10:00:01.000Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      phaseBreakdown: {
        schemaVersion: 1,
        boot: { nodeStartupMs: 4200, restoreWasCold: true },
      },
      prisma,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });

    // Simulate a corrupted/secret-shaped value that somehow reached storage out of
    // band (e.g. a prior bad write). The next valid diagnostic write must not
    // fail because of stale diagnostic JSON.
    const stored = prisma.readTrace();
    expect(stored).not.toBeNull();
    (stored as { phaseBreakdownJson: unknown }).phaseBreakdownJson = {
      schemaVersion: 1,
      boot: { nodeStartupMs: "leak", restoreWasCold: true },
    };

    await recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_phase_guard",
      at: instant("2026-06-09T10:00:02.000Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      phaseBreakdown: {
        schemaVersion: 1,
        boot: { restoreWasCold: true },
      },
      prisma,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });

    expect(prisma.readTrace()?.phaseBreakdownJson).toEqual({
      schemaVersion: 1,
      boot: { restoreWasCold: true },
    });
  });

  it("drops unknown and mistyped stored phaseBreakdown leaves before merging", async () => {
    const prisma = createLatencyWritePrisma({
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-09T10:00:00.000Z")),
    });

    await recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_phase_leaf_guard",
      at: instant("2026-06-09T10:00:01.000Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      phaseBreakdown: {
        schemaVersion: 1,
        wake: { runtimeWakeNotifiedAtEpochMs: 1_777_000_001_000 },
      },
      prisma,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });

    const stored = prisma.readTrace();
    expect(stored).not.toBeNull();
    (stored as { phaseBreakdownJson: unknown }).phaseBreakdownJson = {
      schemaVersion: 1,
      wake: {
        runtimeWakeNotifiedAtEpochMs: 1_777_000_001_000,
        foregroundImportStartedAtEpochMs: true,
        threadId: 1,
      },
    };

    await recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_phase_leaf_guard",
      at: instant("2026-06-09T10:00:02.000Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      phaseBreakdown: {
        schemaVersion: 1,
        boot: { nodeStartupMs: 4200 },
      },
      prisma,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });

    expect(prisma.readTrace()?.phaseBreakdownJson).toEqual({
      schemaVersion: 1,
      wake: {
        runtimeWakeNotifiedAtEpochMs: 1_777_000_001_000,
      },
      boot: { nodeStartupMs: 4200 },
    });
  });

  it("fills missing phaseBreakdown leaves without clobbering existing leaves", async () => {
    const prisma = createLatencyWritePrisma({
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-09T10:00:00.000Z")),
    });

    await recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_phase_leaf_merge",
      at: instant("2026-06-09T10:00:01.000Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      phaseBreakdown: {
        schemaVersion: 1,
        wake: { runtimeWakeNotifiedAtEpochMs: 1_777_000_001_000 },
      },
      prisma,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });

    await recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_phase_leaf_merge",
      at: instant("2026-06-09T10:00:02.000Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      phaseBreakdown: {
        schemaVersion: 1,
        wake: {
          runtimeWakeNotifiedAtEpochMs: 999,
          foregroundWaitResolvedAtEpochMs: 1_777_000_001_010,
          foregroundImportStartedAtEpochMs: 1_777_000_001_011,
          foregroundWakeOrdinal: 1,
          activeRuntimePassOrdinal: 3,
          activeRuntimePassStartedAtEpochMs: 1_777_000_000_900,
          activeRuntimePassForeground: false,
        },
      },
      prisma,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });

    expect(prisma.readTrace()?.phaseBreakdownJson).toEqual({
      schemaVersion: 1,
      wake: {
        runtimeWakeNotifiedAtEpochMs: 1_777_000_001_000,
        foregroundWaitResolvedAtEpochMs: 1_777_000_001_010,
        foregroundImportStartedAtEpochMs: 1_777_000_001_011,
        foregroundWakeOrdinal: 1,
        activeRuntimePassOrdinal: 3,
        activeRuntimePassStartedAtEpochMs: 1_777_000_000_900,
        activeRuntimePassForeground: false,
      },
    });
  });

  it("merges phaseBreakdown against the locked current trace row", async () => {
    let injectedConcurrentProviderPhase = false;
    const prisma = createLatencyWritePrisma({
      beforeLatencyTraceLock: (trace) => {
        if (injectedConcurrentProviderPhase) {
          return;
        }
        injectedConcurrentProviderPhase = true;
        trace.phaseBreakdownJson = {
          schemaVersion: 1,
          provider: { promptBuildMs: 22 },
        };
      },
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-09T10:00:00.000Z")),
    });

    await recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_phase_locked_merge",
      at: instant("2026-06-09T10:00:01.000Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      phaseBreakdown: {
        schemaVersion: 1,
        wake: { foregroundImportStartedAtEpochMs: 1_777_000_001_011 },
      },
      prisma,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });

    expect(prisma.readTrace()?.phaseBreakdownJson).toEqual({
      schemaVersion: 1,
      provider: { promptBuildMs: 22 },
      wake: { foregroundImportStartedAtEpochMs: 1_777_000_001_011 },
    });
  });
});

function createLatencyDashboardPrisma(
  rows: LatencyDashboardRow[],
  timingLogRows: readonly {
    at: Date;
    attemptId: string | null;
    id: string;
    redactedJson: unknown;
  }[] = [],
): LatencyDashboardPrisma {
  if (timingLogRows.length > 0) {
    runtimeLogMocks.isHostedRuntimeLogDatabaseConfigured.mockReturnValue(true);
    runtimeLogMocks.listHostedRuntimeTurnTimingLogs.mockResolvedValue(
      [...timingLogRows],
    );
  }

  const normalizedRows = rows.map((row) => ({
    linqDelivery: null,
    linqDeliveryId: null,
    phaseBreakdownJson: null,
    providerRequestOrdinal: null,
    replyRuntimeAttemptId: null,
    runtimeAttemptId: null,
    ...row,
  }));
  return {
    hostedIngressLatencyTrace: {
      findMany: vi.fn(async () => normalizedRows),
    },
  };
}

function createLinkedDashboardRow(input: {
  acceptedAt: string;
  attemptedAt: string;
  deliveryAcceptedAt?: string | null;
  deliveredAt?: string | null;
  deliveryId: string;
  deliveryStatus?: string;
  intentId: string;
  providerStartAt: string;
  receiptAt?: string | null;
  runtimeAttemptId: string;
}): LatencyDashboardRow {
  const acceptedAt = instant(input.acceptedAt);
  const attemptedAt = instant(input.attemptedAt);
  const receiptAt = input.receiptAt === null
    ? null
    : input.receiptAt
      ? instant(input.receiptAt)
      : new Date(attemptedAt.getTime() + 1_000);
  return {
    acceptedAt,
    assistantInputStagedAt: new Date(acceptedAt.getTime() + 500),
    linqDelivery: {
      acceptedAt: input.deliveryAcceptedAt === null
        ? null
        : input.deliveryAcceptedAt
          ? instant(input.deliveryAcceptedAt)
          : new Date(attemptedAt.getTime() + 500),
      attemptedAt,
      deliveredAt: input.deliveredAt === undefined
        ? receiptAt
        : input.deliveredAt === null ? null : instant(input.deliveredAt),
      lastReceiptAt: receiptAt,
      sourceRef: deliverySourceRef(input.intentId),
      status: input.deliveryStatus ?? "delivered",
    },
    linqDeliveryId: input.deliveryId,
    phaseBreakdownJson: {
      schemaVersion: 1,
      boot: { restoreWasCold: false },
    },
    providerRequestOrdinal: 0,
    providerStartAt: instant(input.providerStartAt),
    replyRuntimeAttemptId: input.runtimeAttemptId,
    runtimeAttemptId: input.runtimeAttemptId,
    temporalSignalAcceptedAt: null,
  };
}

function createTurnTimingLogRows(input: {
  deliveryIntentId: string;
  providerRequestElapsedMs: number;
  providerRequestOrdinal?: number;
  runtimeAttemptId: string;
  sinceProviderResultMs: number;
}): Array<{
  at: Date;
  attemptId: string;
  id: string;
  redactedJson: Record<string, unknown>;
}> {
  return [
    {
      at: instant("2026-05-27T12:00:02.000Z"),
      attemptId: input.runtimeAttemptId,
      id: `timing_${input.runtimeAttemptId}_${input.deliveryIntentId}_${input.providerRequestOrdinal ?? 0}`,
      redactedJson: {
        deliveryIntentPresent: true,
        deliveryOutcomeKind: "queued",
        finalReplySelected: true,
        providerRequestOrdinal: input.providerRequestOrdinal ?? 0,
        schema: "murph.assistant-turn-timing.v1",
        turnTimingDeliveryIntentId: input.deliveryIntentId,
        turnTimingProviderRequestElapsedMs: input.providerRequestElapsedMs,
        turnTimingSinceProviderResultMs: input.sinceProviderResultMs,
        turnTimingStage: "reply-dispatched",
        type: "assistant.turn.timing",
      },
    },
  ];
}

function deliverySourceRef(intentId: string): string {
  const sourceRef = createHostedLinqDeliverySourceRefLookupKey(intentId);
  if (!sourceRef) {
    throw new Error("Expected a Linq delivery source reference.");
  }
  return sourceRef;
}

function createLatencyWritePrisma(input: {
  beforeLatencyTraceLock?: (trace: MutableLatencyTrace) => void;
  deliveryLinkMatches?: readonly boolean[];
  mailboxAcceptedAtEpochMs: bigint | number | string;
  setBasedProjectionRows?: readonly HostedIngressLatencySetWriteProjectionRow[];
}): LatencyWritePrisma & LatencyDashboardPrisma & {
  readDeliveryLinkSql: () => string;
  readMailboxQuerySql: () => string;
  readMailboxQueryValues: () => readonly (readonly unknown[])[];
  readSetBasedMutationSql: () => readonly string[];
  readSetBasedMutationValues: () => readonly (readonly unknown[])[];
  readTrace: () => MutableLatencyTrace | null;
  readTraceInsertSql: () => string;
  readTransactionCallCount: () => number;
} {
  let trace: MutableLatencyTrace | null = null;
  let deliveryLinkSql = "";
  let mailboxQueryTemplate: TemplateStringsArray | null = null;
  let traceInsertTemplate: TemplateStringsArray | null = null;
  let deliveryLinkCallCount = 0;
  let transactionCallCount = 0;
  const mailboxQueryValues: unknown[][] = [];
  const setBasedMutationSql: string[] = [];
  const setBasedMutationValues: unknown[][] = [];
  const queryRaw = vi.fn(
    async (
      query: TemplateStringsArray | PrismaSqlQuery,
      ...taggedValues: readonly unknown[]
    ) => {
      if ("strings" in query) {
        const sql = query.strings.join("");
        if (
          sql.includes("hosted_ingress_provider_started_set_based")
          || sql.includes("hosted_ingress_assistant_milestone_set_based")
          || sql.includes(
            "hosted_ingress_checkpoint_publication_expected_by_lock",
          )
          || sql.includes(
            "hosted_ingress_checkpoint_publication_expected_by_set_based",
          )
        ) {
          setBasedMutationSql.push(sql);
          setBasedMutationValues.push([...query.values]);
          if (input.setBasedProjectionRows) {
            return [...input.setBasedProjectionRows];
          }
          if (sql.includes("hosted_ingress_provider_started_set_based")) {
            return applyHostedIngressProviderStartedSetBasedMutation(
              trace,
              query.values,
            );
          }
          throw new Error("SQL mutation behavior belongs in the PostgreSQL suite.");
        }
        if (
          !sql.includes("INSERT INTO hosted_ingress_latency_trace")
          || !sql.includes("linq_delivery_id")
        ) {
          throw new Error("Unexpected Prisma SQL object in latency test fake.");
        }
        deliveryLinkSql = sql;
        const matched = input.deliveryLinkMatches?.[deliveryLinkCallCount] ?? false;
        deliveryLinkCallCount += 1;
        if (!matched) {
          return [];
        }
        const replyRuntimeAttemptId = query.values[0];
        const linqDeliveryId = query.values[1];
        const traceId = query.values[2];
        const mailboxItemId = query.values[3];
        if (
          (replyRuntimeAttemptId !== null && typeof replyRuntimeAttemptId !== "string")
          || typeof linqDeliveryId !== "string"
          || typeof traceId !== "string"
          || typeof mailboxItemId !== "string"
        ) {
          throw new Error("Delivery-link test stub received invalid SQL values.");
        }
        trace ??= createMutableLatencyTrace({
          acceptedAt: new Date(Number(input.mailboxAcceptedAtEpochMs)),
          id: traceId,
          linqDeliveryId,
          mailboxItemId,
          mailboxLane: "conversation",
          mailboxLaneSeq: 1n,
          replyRuntimeAttemptId,
          runtimeAttemptId: null,
          source: "linq",
          userId: "member_latency_1",
        });
        trace.replyRuntimeAttemptId = replyRuntimeAttemptId;
        trace.linqDeliveryId = linqDeliveryId;
        return [{ mailboxItemId }];
      }
      const sql = query.join("");
      if (sql.includes("FOR UPDATE")) {
        if (trace) {
          input.beforeLatencyTraceLock?.(trace);
        }
        return trace ? [readLockedLatencyTraceRow(trace)] : [];
      }

      mailboxQueryTemplate = query;
      mailboxQueryValues.push([...taggedValues]);
      return [
        {
          acceptedAtEpochMs: input.mailboxAcceptedAtEpochMs,
          id: "mailbox_latency_1",
          lane: "conversation",
          laneSeq: 1n,
          userId: "member_latency_1",
        },
      ];
    },
  );
  const executeRaw = vi.fn(
    async (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
      const sql = strings.join("");
      if (!sql.includes("INSERT INTO hosted_ingress_latency_trace")) {
        return 0;
      }
      traceInsertTemplate = strings;
      if (trace) {
        return 0;
      }
      const [
        id,
        userId,
        source,
        mailboxItemId,
        mailboxLane,
        mailboxLaneSeq,
        _ingressTypingAcceptedAt,
        _webhookReceivedAt,
        _phaseBreakdownJson,
        acceptedAt,
      ] = values;
      trace = createMutableLatencyTrace({
        acceptedAt: acceptedAt as Date,
        id: id as string,
        mailboxItemId: mailboxItemId as string,
        mailboxLane: mailboxLane as string,
        mailboxLaneSeq: mailboxLaneSeq as bigint,
        source: source as string,
        userId: userId as string,
      });
      return 1;
    },
  );
  const findMany = vi.fn(async () => trace ? [trace] : []);
  const findUnique = vi.fn(async (args: LatencyTraceFindUniqueInput) => {
    if (!trace || trace.mailboxItemId !== args.where.mailboxItemId) {
      return null;
    }
    return trace;
  });
  const updateMany = vi.fn(async (args: LatencyTraceUpdateManyInput) => {
    if (!trace || !matchesLatencyTraceUpdateManyWhere(trace, args.where)) {
      return { count: 0 };
    }
    trace = {
      ...trace,
      ...args.data,
      updatedAt: instant("2026-06-02T12:00:00.000Z"),
    };
    return { count: 1 };
  });
  const update = vi.fn(async (args: LatencyTraceUpdateInput) => {
    if (!trace) {
      throw new Error("Trace update called before insert.");
    }
    trace = {
      ...trace,
      ...args.data,
      updatedAt: instant("2026-06-02T12:00:00.000Z"),
    };
    return trace;
  });
  type LatencyPrismaFake = {
    $executeRaw: typeof executeRaw;
    $queryRaw: typeof queryRaw;
    $transaction: <T>(
      callback: (tx: LatencyPrismaFake) => Promise<T>,
      options?: { isolationLevel?: string },
    ) => Promise<T>;
    hostedIngressLatencyTrace: {
      findMany: typeof findMany;
      findUnique: typeof findUnique;
      update: typeof update;
      updateMany: typeof updateMany;
    };
    readMailboxQuerySql: () => string;
    readMailboxQueryValues: () => readonly (readonly unknown[])[];
    readSetBasedMutationSql: () => readonly string[];
    readSetBasedMutationValues: () => readonly (readonly unknown[])[];
    readTrace: () => MutableLatencyTrace | null;
    readTraceInsertSql: () => string;
    readTransactionCallCount: () => number;
    readDeliveryLinkSql: () => string;
  };
  const prisma: LatencyPrismaFake = {
    $transaction: async <T>(
      callback: (tx: LatencyPrismaFake) => Promise<T>,
      options?: { isolationLevel?: string },
    ): Promise<T> => {
      void options;
      transactionCallCount += 1;
      return await callback(prisma);
    },
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    hostedIngressLatencyTrace: {
      findUnique,
      findMany,
      updateMany,
      update,
    },
    readDeliveryLinkSql: () => deliveryLinkSql,
    readMailboxQuerySql: () => {
      if (!mailboxQueryTemplate) {
        return "";
      }
      return mailboxQueryTemplate.join("");
    },
    readMailboxQueryValues: () => mailboxQueryValues,
    readSetBasedMutationSql: () => setBasedMutationSql,
    readSetBasedMutationValues: () => setBasedMutationValues,
    readTrace: () => trace,
    readTraceInsertSql: () => {
      if (!traceInsertTemplate) {
        return "";
      }
      return traceInsertTemplate.join("");
    },
    readTransactionCallCount: () => transactionCallCount,
  };

  return prisma as unknown as LatencyWritePrisma & LatencyDashboardPrisma & {
    readDeliveryLinkSql: () => string;
    readMailboxQuerySql: () => string;
    readMailboxQueryValues: () => readonly (readonly unknown[])[];
    readSetBasedMutationSql: () => readonly string[];
    readSetBasedMutationValues: () => readonly (readonly unknown[])[];
    readTrace: () => MutableLatencyTrace | null;
    readTraceInsertSql: () => string;
    readTransactionCallCount: () => number;
  };
}

function applyHostedIngressProviderStartedSetBasedMutation(
  trace: MutableLatencyTrace | null,
  values: readonly unknown[],
): HostedIngressLatencySetWriteProjectionRow[] {
  const userId = readSqlString(values[0], "provider user id");
  const source = readSqlString(values[1], "provider source");
  const runtimeAttemptId = readNullableSqlString(values[2], "provider runtime attempt id");
  const at = new Date(readSqlNumber(values[3], "provider start epoch milliseconds"));
  const providerRequestOrdinal = readSqlNumber(values[4], "provider request ordinal");
  const schemaVersion = readNullableSqlNumber(values[5], "provider phase schema version");
  const preProvider = readNullableSqlJsonRecord(values[6], "provider preProvider phase");
  const provider = readNullableSqlJsonRecord(values[7], "provider phase");
  const assistantInputIds = values.slice(9).map((value) =>
    readSqlString(value, "provider assistant input id")
  );

  return assistantInputIds.map((assistantInputId) => {
    const traced = trace !== null
      && trace.assistantInputId === assistantInputId
      && trace.userId === userId
      && trace.source === source;
    const matched = traced
      && (
        trace.runtimeAttemptId === null
        || runtimeAttemptId === null
        || trace.runtimeAttemptId === runtimeAttemptId
      );
    if (!matched || !trace) {
      return { assistantInputId, matched: false, traced };
    }

    const before = JSON.stringify({
      phaseBreakdownJson: trace.phaseBreakdownJson,
      providerRequestOrdinal: trace.providerRequestOrdinal,
      providerStartAt: trace.providerStartAt,
      runtimeAttemptId: trace.runtimeAttemptId,
    });
    if (trace.providerStartAt === null || trace.providerStartAt > at) {
      trace.providerStartAt = at;
      trace.providerRequestOrdinal = providerRequestOrdinal;
    }
    if (trace.runtimeAttemptId === null && runtimeAttemptId !== null) {
      trace.runtimeAttemptId = runtimeAttemptId;
    }
    if (schemaVersion !== null) {
      const phaseBreakdown = readJsonRecord(trace.phaseBreakdownJson) ?? {};
      const nextPhaseBreakdown: Record<string, unknown> = { ...phaseBreakdown };
      if (!isSafeLatencyJsonInteger(nextPhaseBreakdown.schemaVersion)) {
        nextPhaseBreakdown.schemaVersion = schemaVersion;
      }
      mergeLatencyPhaseRecord(nextPhaseBreakdown, "preProvider", preProvider);
      mergeLatencyPhaseRecord(nextPhaseBreakdown, "provider", provider);
      trace.phaseBreakdownJson = nextPhaseBreakdown;
    }
    if (before !== JSON.stringify({
      phaseBreakdownJson: trace.phaseBreakdownJson,
      providerRequestOrdinal: trace.providerRequestOrdinal,
      providerStartAt: trace.providerStartAt,
      runtimeAttemptId: trace.runtimeAttemptId,
    })) {
      trace.updatedAt = instant("2026-06-02T12:00:00.000Z");
    }
    return { assistantInputId, matched: true, traced: true };
  });
}

function mergeLatencyPhaseRecord(
  phaseBreakdown: Record<string, unknown>,
  phase: "preProvider" | "provider",
  incoming: Record<string, unknown> | null,
): void {
  if (!incoming) {
    return;
  }
  phaseBreakdown[phase] = {
    ...incoming,
    ...(readJsonRecord(phaseBreakdown[phase]) ?? {}),
  };
}

function readJsonRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readNullableSqlJsonRecord(value: unknown, label: string): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be serialized JSON.`);
  }
  const parsed: unknown = JSON.parse(value);
  const record = readJsonRecord(parsed);
  if (!record) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return record;
}

function readSqlString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function readNullableSqlString(value: unknown, label: string): string | null {
  return value === null ? null : readSqlString(value, label);
}

function readSqlNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer.`);
  }
  return value;
}

function readNullableSqlNumber(value: unknown, label: string): number | null {
  return value === null ? null : readSqlNumber(value, label);
}

function isSafeLatencyJsonInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readLockedLatencyTraceRow(trace: MutableLatencyTrace): LockedLatencyTraceRow {
  return {
    assistantInputId: trace.assistantInputId,
    assistantInputStagedAt: trace.assistantInputStagedAt,
    id: trace.id,
    phaseBreakdownJson: trace.phaseBreakdownJson,
    providerStartAt: trace.providerStartAt,
    runnerJobAcceptedAt: trace.runnerJobAcceptedAt,
    runtimeAttemptId: trace.runtimeAttemptId,
    runtimePhaseStartedAt: trace.runtimePhaseStartedAt,
    workspaceRestoreDoneAt: trace.workspaceRestoreDoneAt,
  };
}

function instant(value: string): Date {
  return new Date(value);
}

type MutableLatencyTrace = LatencyTraceCreateInput & {
  assistantInputId: string | null;
  assistantInputStagedAt: Date | null;
  createdAt: Date;
  linqDeliveryId: string | null;
  mailboxImportDoneAt: Date | null;
  phaseBreakdownJson: unknown;
  providerRequestOrdinal: number | null;
  providerStartAt: Date | null;
  replyRuntimeAttemptId: string | null;
  runnerJobAcceptedAt: Date | null;
  runtimeAttemptId: string | null;
  runtimePhaseStartedAt: Date | null;
  temporalSignalAcceptedAt: Date | null;
  updatedAt: Date;
  workspaceRestoreDoneAt: Date | null;
};

type PrismaSqlQuery = {
  readonly strings: readonly string[];
  readonly values: readonly unknown[];
};

function createMutableLatencyTrace(
  input: LatencyTraceCreateInput & {
    linqDeliveryId?: string | null;
    replyRuntimeAttemptId?: string | null;
    runtimeAttemptId?: string | null;
  },
): MutableLatencyTrace {
  return {
    acceptedAt: input.acceptedAt,
    assistantInputId: null,
    assistantInputStagedAt: null,
    createdAt: instant("2026-06-02T12:00:00.000Z"),
    id: input.id,
    linqDeliveryId: input.linqDeliveryId ?? null,
    mailboxImportDoneAt: null,
    mailboxItemId: input.mailboxItemId,
    mailboxLane: input.mailboxLane,
    mailboxLaneSeq: input.mailboxLaneSeq,
    phaseBreakdownJson: null,
    providerRequestOrdinal: null,
    providerStartAt: null,
    replyRuntimeAttemptId: input.replyRuntimeAttemptId ?? null,
    runnerJobAcceptedAt: null,
    runtimeAttemptId: input.runtimeAttemptId ?? null,
    runtimePhaseStartedAt: null,
    source: input.source,
    temporalSignalAcceptedAt: null,
    updatedAt: instant("2026-06-02T12:00:00.000Z"),
    userId: input.userId,
    workspaceRestoreDoneAt: null,
  };
}

type LockedLatencyTraceRow = Pick<
  MutableLatencyTrace,
  | "assistantInputId"
  | "assistantInputStagedAt"
  | "id"
  | "phaseBreakdownJson"
  | "providerStartAt"
  | "runnerJobAcceptedAt"
  | "runtimeAttemptId"
  | "runtimePhaseStartedAt"
  | "workspaceRestoreDoneAt"
>;

type LatencyTraceCreateInput = {
  acceptedAt: Date;
  id: string;
  mailboxItemId: string;
  mailboxLane: string;
  mailboxLaneSeq: bigint;
  source: string;
  userId: string;
};

type LatencyTraceUpdateInput = {
  data: Partial<Omit<MutableLatencyTrace, "id">>;
  where: {
    id: string;
  };
};

type LatencyTraceUpdateManyInput = {
  data: Partial<Omit<MutableLatencyTrace, "id">>;
  where: unknown;
};

type LatencyTraceFindUniqueInput = {
  where: {
    mailboxItemId: string;
  };
};

function matchesLatencyTraceUpdateManyWhere(
  trace: MutableLatencyTrace,
  where: unknown,
): boolean {
  if (!where || typeof where !== "object") {
    return false;
  }
  const record = where as Record<string, unknown>;
  return record.runtimeAttemptId === trace.runtimeAttemptId
    && record.source === trace.source
    && record.userId === trace.userId;
}
