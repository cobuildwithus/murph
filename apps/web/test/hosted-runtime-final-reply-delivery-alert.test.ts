import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedLinqDeliverySourceRefLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  buildHostedFinalReplyDeliveryAlertId,
  evaluateHostedFinalReplyDeliveryLatency,
  HOSTED_FINAL_REPLY_DELIVERY_READ_LIMIT,
  runHostedRuntimeFinalReplyDeliveryAlertMonitor,
  type HostedFinalReplyDeliveryRow,
  type HostedFinalReplyTimingLogRow,
} from "@/src/lib/hosted-runtime-latency/final-reply-delivery-alert-monitor";

const mocks = vi.hoisted(() => ({
  isHostedRuntimeLogDatabaseConfigured: vi.fn(() => true),
  sendPendingHostedLinqAlertsBestEffort: vi.fn(async () => undefined),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-alert-email", () => ({
  sendPendingHostedLinqAlertsBestEffort: mocks.sendPendingHostedLinqAlertsBestEffort,
}));

vi.mock("@/src/lib/hosted-runtime-log/database", () => ({
  isHostedRuntimeLogDatabaseConfigured: mocks.isHostedRuntimeLogDatabaseConfigured,
}));

const NOW = new Date("2026-01-10T12:00:00.000Z");
const ACCEPTED_AT_MS = NOW.getTime() - 10 * 60_000;
const ATTEMPT_TO_ACCEPTED_MS = 100;
const TIMING_HORIZON = new Date(NOW.getTime() - 7 * 86_400_000);

type CaseInput = {
  acceptedAtMs?: number;
  alertRecorded?: boolean;
  attemptedAtMs?: number;
  completedToResultMs?: number;
  completion?: string;
  deliveryId?: string;
  earliestTraceAcceptedAt?: Date | null;
  intentId?: string;
  providerResultAtEpochMs?: number | null;
  providerResultToAcceptedMs?: number;
  replyAttemptId?: string;
  replyRuntimeAttemptIds?: string[];
  threadIsDirect?: boolean | null;
};

function sourceRef(intentId: string): string {
  return createHostedLinqDeliverySourceRefLookupKey(intentId)!;
}

function buildCase(input: CaseInput = {}): {
  delivery: HostedFinalReplyDeliveryRow;
  reply: HostedFinalReplyTimingLogRow;
} {
  const intentId = input.intentId ?? "intent_synthetic_1";
  const acceptedAtMs = input.acceptedAtMs ?? ACCEPTED_AT_MS;
  const resultAtMs = input.providerResultAtEpochMs === undefined
    ? acceptedAtMs - (input.providerResultToAcceptedMs ?? 1_000)
    : input.providerResultAtEpochMs;
  return {
    delivery: {
      acceptedAt: new Date(acceptedAtMs),
      alertRecorded: input.alertRecorded ?? false,
      attemptedAt: new Date(input.attemptedAtMs ?? acceptedAtMs - ATTEMPT_TO_ACCEPTED_MS),
      earliestTraceAcceptedAt: input.earliestTraceAcceptedAt === undefined
        ? new Date(acceptedAtMs - 60_000)
        : input.earliestTraceAcceptedAt,
      id: input.deliveryId ?? "delivery_synthetic_1",
      replyRuntimeAttemptIds: input.replyRuntimeAttemptIds ?? ["attempt_synthetic_1"],
      runtimeAttemptIds: ["attempt_synthetic_1"],
      sourceRef: sourceRef(intentId),
      threadIsDirect: input.threadIsDirect === undefined ? true : input.threadIsDirect,
    },
    reply: buildReplyRow({
      attemptId: input.replyAttemptId ?? "attempt_synthetic_1",
      intentId,
      redactedJson: {
        ...(resultAtMs === null ? {} : { turnTimingProviderResultAtEpochMs: resultAtMs }),
        turnTimingFinalResponseCompletion: input.completion ?? "unavailable",
        ...(input.completedToResultMs === undefined
          ? {}
          : { turnTimingFinalResponseCompletedToProviderResultMs: input.completedToResultMs }),
        turnTimingSinceProviderResultMs: 30,
      },
    }),
  };
}

function buildReplyRow(input: {
  attemptId: string;
  intentId: string;
  redactedJson: Record<string, unknown>;
}): HostedFinalReplyTimingLogRow {
  return {
    attemptId: input.attemptId,
    redactedJson: {
      deliveryIntentPresent: true,
      deliveryOutcomeKind: "queued",
      finalReplySelected: true,
      schema: "murph.assistant-turn-timing.v1",
      turnTimingDeliveryIntentId: input.intentId,
      turnTimingStage: "reply-dispatched",
      type: "assistant.turn.timing",
      ...input.redactedJson,
    },
  };
}

function toLogRow(row: HostedFinalReplyTimingLogRow, index = 0) {
  return { ...row, at: NOW.toISOString(), id: `log_synthetic_${index}` };
}

function evaluate(
  cases: readonly ReturnType<typeof buildCase>[],
  extraTimingRows: HostedFinalReplyTimingLogRow[] = [],
) {
  return evaluateHostedFinalReplyDeliveryLatency({
    deliveries: cases.map((entry) => entry.delivery),
    now: NOW,
    timingHorizon: TIMING_HORIZON,
    timingRows: [...cases.map((entry) => entry.reply), ...extraTimingRows],
  });
}

describe("final reply delivery latency evaluation", () => {
  it.each([
    [true, 4_999, false],
    [true, 5_000, false],
    [true, 5_001, true],
    [null, 5_001, true],
    [false, 8_999, false],
    [false, 9_000, false],
    [false, 9_001, true],
  ])("uses strict budgets (direct=%s, %i ms → alert %s)", (threadIsDirect, elapsedMs, alerts) => {
    const { candidates, counts } = evaluate([
      buildCase({ providerResultToAcceptedMs: elapsedMs, threadIsDirect }),
    ]);

    expect(counts.providerResult.observed).toBe(1);
    expect(candidates).toHaveLength(alerts ? 1 : 0);
    if (alerts) {
      expect(candidates[0]).toMatchObject({
        providerResultToAccepted: { elapsedMs, status: "observed" },
        scope: threadIsDirect === false ? "group" : "direct",
        thresholdMs: threadIsDirect === false ? 9_000 : 5_000,
        triggerOrigins: ["provider_result"],
      });
    }
  });

  it.each([
    [true, 4_999, false],
    [true, 5_000, false],
    [true, 5_001, true],
    [false, 8_999, false],
    [false, 9_000, false],
    [false, 9_001, true],
  ])(
    "uses strict budgets for the generation origin alone (direct=%s, %i ms → alert %s)",
    (threadIsDirect, elapsedMs, alerts) => {
      const providerResultToAcceptedMs = 1_000;
      const { candidates, counts } = evaluate([buildCase({
        completedToResultMs: elapsedMs - providerResultToAcceptedMs,
        completion: "observed",
        providerResultToAcceptedMs,
        threadIsDirect,
      })]);

      expect(counts.finalResponseCompleted.observed).toBe(1);
      expect(counts.providerResult.slow).toBe(0);
      expect(candidates).toHaveLength(alerts ? 1 : 0);
      if (alerts) {
        expect(candidates[0]).toMatchObject({
          finalResponseCompletedToAccepted: { elapsedMs, status: "observed" },
          providerResultToAccepted: { elapsedMs: providerResultToAcceptedMs, status: "observed" },
          triggerOrigins: ["final_response_completed"],
        });
      }
    },
  );

  it("alerts on a slow generation origin while the provider-result origin is fast", () => {
    const { candidates } = evaluate([buildCase({
      completedToResultMs: 1_001,
      completion: "observed",
      providerResultToAcceptedMs: 4_000,
    })]);

    expect(candidates).toEqual([expect.objectContaining({
      finalResponseCompletedToAccepted: { elapsedMs: 5_001, status: "observed" },
      providerResultToAccepted: { elapsedMs: 4_000, status: "observed" },
      triggerOrigins: ["final_response_completed"],
    })]);
  });

  it("carries both origins on one alert when both exceed the budget", () => {
    const { candidates } = evaluate([buildCase({
      completedToResultMs: 50,
      completion: "observed",
      providerResultToAcceptedMs: 6_000,
    })]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.triggerOrigins).toEqual(["provider_result", "final_response_completed"]);
  });

  it.each(["superseded", "unavailable", "invalid"])(
    "never substitutes the provider-result origin for a %s generation observation",
    (completion) => {
      const { candidates, counts } = evaluate([buildCase({
        completion,
        providerResultToAcceptedMs: 4_000,
      })]);

      expect(candidates).toEqual([]);
      expect(counts.finalResponseCompleted[completion as "invalid"]).toBe(1);
      expect(counts.finalResponseCompleted.observed).toBe(0);
    },
  );

  it("treats an observed state without its interval as invalid", () => {
    const { counts } = evaluate([buildCase({ completion: "observed" })]);
    expect(counts.finalResponseCompleted.invalid).toBe(1);
  });

  it("keeps old producers without an exact anchor out of both measurements", () => {
    const { candidates, counts } = evaluate([buildCase({ providerResultAtEpochMs: null })]);

    expect(candidates).toEqual([]);
    expect(counts.providerResult.producer_absent).toBe(1);
    expect(counts.finalResponseCompleted.producer_absent).toBe(1);
  });

  it.each([
    ["the send attempt precedes the provider result", { attemptedAtMs: ACCEPTED_AT_MS - 2_000, providerResultToAcceptedMs: 1_000 }],
    ["acceptance precedes the send attempt", { attemptedAtMs: ACCEPTED_AT_MS + 1, providerResultToAcceptedMs: 9_000 }],
  ] as const)("rejects chronology when %s", (_label, input) => {
    const { candidates, counts } = evaluate([buildCase({
      ...input,
      completedToResultMs: 10,
      completion: "observed",
    })]);

    expect(candidates).toEqual([]);
    expect(counts.providerResult.invalid_chronology).toBe(1);
    expect(counts.finalResponseCompleted.invalid_chronology).toBe(1);
  });

  it("separates pending, missing, retention-bounded, and unlinked deliveries", () => {
    const pending = buildCase({
      acceptedAtMs: NOW.getTime() - 4 * 60_000,
      deliveryId: "delivery_pending",
      intentId: "intent_pending",
      providerResultToAcceptedMs: 20_000,
    });
    const missing = buildCase({ deliveryId: "delivery_missing", intentId: "intent_missing" });
    const beyondRetention = buildCase({
      deliveryId: "delivery_old_ingress",
      earliestTraceAcceptedAt: new Date(TIMING_HORIZON.getTime() - 1),
      intentId: "intent_old_ingress",
    });
    const unlinked = buildCase({
      deliveryId: "delivery_unlinked",
      earliestTraceAcceptedAt: null,
      intentId: "intent_unlinked",
      providerResultToAcceptedMs: 20_000,
    });

    const { candidates, counts } = evaluateHostedFinalReplyDeliveryLatency({
      deliveries: [pending.delivery, missing.delivery, beyondRetention.delivery, unlinked.delivery],
      now: NOW,
      timingHorizon: TIMING_HORIZON,
      timingRows: [pending.reply, unlinked.reply],
    });

    expect(candidates).toEqual([]);
    expect(counts).toMatchObject({
      deliveryCount: 4,
      evaluatedCount: 0,
      missingTimingCount: 1,
      pendingCount: 1,
      timingBeyondRetentionCount: 1,
      unlinkedCount: 1,
    });
  });

  it("refuses duplicate timing rows or duplicate deliveries for one source reference", () => {
    const duplicateTiming = buildCase({ providerResultToAcceptedMs: 20_000 });
    const sharedA = buildCase({ deliveryId: "delivery_a", intentId: "intent_shared", providerResultToAcceptedMs: 20_000 });
    const sharedB = buildCase({ deliveryId: "delivery_b", intentId: "intent_shared", providerResultToAcceptedMs: 20_000 });

    expect(evaluate([duplicateTiming], [duplicateTiming.reply]).counts.ambiguousCount).toBe(1);
    const shared = evaluateHostedFinalReplyDeliveryLatency({
      deliveries: [sharedA.delivery, sharedB.delivery],
      now: NOW,
      timingHorizon: TIMING_HORIZON,
      timingRows: [sharedA.reply],
    });
    expect(shared.candidates).toEqual([]);
    expect(shared.counts.ambiguousCount).toBe(2);
  });

  it("ignores non-final, unqueued, or foreign-schema timing rows", () => {
    const entry = buildCase({ providerResultToAcceptedMs: 20_000 });
    const json = entry.reply.redactedJson as Record<string, unknown>;
    for (const override of [
      { finalReplySelected: false },
      { deliveryOutcomeKind: "sent" },
      { schema: "murph.other.v1" },
    ]) {
      const { counts } = evaluate([{ ...entry, reply: { ...entry.reply, redactedJson: { ...json, ...override } } }]);
      expect(counts.missingTimingCount).toBe(1);
    }
  });

  it("attributes a long durable retry to its original turn and marks the attempt handoff", () => {
    const { candidates } = evaluate([buildCase({
      providerResultToAcceptedMs: 3 * 60 * 60_000,
      replyAttemptId: "attempt_original",
      replyRuntimeAttemptIds: ["attempt_retry"],
    })]);

    expect(candidates).toEqual([expect.objectContaining({
      deliveryAttemptRelation: "different",
      providerResultToAccepted: { elapsedMs: 3 * 60 * 60_000, status: "observed" },
    })]);
  });

  it("attaches dispatch attribution only when one row matches the delivery", () => {
    const entry = buildCase({ providerResultToAcceptedMs: 20_000 });
    const dispatchRow = buildReplyRow({
      attemptId: "attempt_synthetic_1",
      intentId: "intent_synthetic_1",
      redactedJson: {
        deliveryMemberChannelBarrierMs: 7,
        deliveryRouteAuthorityCheckMs: 3,
        deliverySinceForegroundPhaseStartedMs: -4,
        turnTimingStage: "linq-dispatch-entered",
      },
    });

    expect(evaluate([entry], [dispatchRow]).candidates[0]?.dispatchAttribution).toEqual({
      memberChannelBarrierMs: 7,
      routeAuthorityCheckMs: 3,
      status: "observed",
    });
    expect(evaluate([entry], [dispatchRow, dispatchRow]).candidates[0]?.dispatchAttribution)
      .toEqual({ status: "ambiguous" });
    expect(evaluate([entry]).candidates[0]?.dispatchAttribution).toEqual({ status: "missing" });
  });

  it.each([
    [7_999, false],
    [8_000, false],
    [8_001, true],
  ])("excludes only observed pacing from the strict budget at %i ms", (elapsedMs, slow) => {
    const entry = buildCase({ providerResultToAcceptedMs: elapsedMs });
    const dispatch = buildReplyRow({
      attemptId: "attempt_synthetic_1",
      intentId: "intent_synthetic_1",
      redactedJson: {
        deliveryReplyBubblePacingMs: 3_000,
        deliverySinceForegroundPhaseStartedMs: 7_000,
        turnTimingStage: "linq-dispatch-entered",
      },
    });
    const result = evaluate([entry], [dispatch]);
    expect(result.candidates).toHaveLength(slow ? 1 : 0);
    expect(result.counts.providerResult.slow).toBe(slow ? 1 : 0);
    if (slow) {
      expect(result.candidates[0]).toMatchObject({
        intentionalPacingMs: 3_000,
        providerResultToAccepted: { elapsedMs, status: "observed" },
      });
    }
  });

  it("evaluates final completion independently after the same pacing exclusion", () => {
    const entry = buildCase({
      completedToResultMs: 100,
      completion: "observed",
      providerResultToAcceptedMs: 8_000,
    });
    const result = evaluate([entry], [buildReplyRow({
      attemptId: "attempt_synthetic_1",
      intentId: "intent_synthetic_1",
      redactedJson: {
        deliveryReplyBubblePacingMs: 3_000,
        deliverySinceForegroundPhaseStartedMs: 7_000,
        turnTimingStage: "linq-dispatch-entered",
      },
    })]);
    expect(result.candidates[0]).toMatchObject({
      intentionalPacingMs: 3_000,
      finalResponseCompletedToAccepted: { elapsedMs: 8_100, status: "observed" },
      triggerOrigins: ["final_response_completed"],
    });
  });

  it.each([
    { label: "older producer", pacing: undefined },
    { label: "negative pacing", pacing: -1 },
    { label: "fractional pacing", pacing: 1.5 },
    { label: "pacing outside phase", pacing: 6_000 },
    { label: "missing phase", phase: undefined },
    { label: "phase outside result", phase: 9_000 },
    { label: "different dispatch attempt", attemptId: "attempt_other" },
    { label: "handoff", replyRuntimeAttemptIds: ["attempt_retry"] },
    { label: "ambiguous dispatch", duplicate: true },
  ])("retains the full budget for $label", (scenario) => {
    const entry = buildCase({
      providerResultToAcceptedMs: 7_000,
      replyRuntimeAttemptIds: scenario.replyRuntimeAttemptIds,
    });
    const dispatch = buildReplyRow({
      attemptId: scenario.attemptId ?? "attempt_synthetic_1",
      intentId: "intent_synthetic_1",
      redactedJson: {
        deliveryReplyBubblePacingMs: "pacing" in scenario ? scenario.pacing : 3_000,
        deliverySinceForegroundPhaseStartedMs: "phase" in scenario ? scenario.phase : 5_000,
        turnTimingStage: "linq-dispatch-entered",
      },
    });
    const result = evaluate([entry], scenario.duplicate ? [dispatch, dispatch] : [dispatch]);
    expect(result.candidates[0]).toMatchObject({
      intentionalPacingMs: null,
      triggerOrigins: ["provider_result"],
    });
  });

  it("does not re-raise a delivery that already owns its alert", () => {
    const { candidates, counts } = evaluate([buildCase({
      alertRecorded: true,
      providerResultToAcceptedMs: 20_000,
    })]);

    expect(candidates).toEqual([]);
    expect(counts.alreadyAlertedCount).toBe(1);
  });
});

describe("final reply delivery alert monitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isHostedRuntimeLogDatabaseConfigured.mockReturnValue(true);
  });

  function createPrisma(rows: HostedFinalReplyDeliveryRow[], insertedCount?: number) {
    const createMany = vi.fn(async (input: { data: unknown[] }) => ({
      count: insertedCount ?? input.data.length,
    }));
    return {
      createMany,
      prisma: {
        $queryRaw: vi.fn(async () => rows),
        hostedLinqAlert: { createMany },
      } as never,
    };
  }

  it("fails closed when the delivery page is truncated", async () => {
    const rows = Array.from({ length: HOSTED_FINAL_REPLY_DELIVERY_READ_LIMIT + 1 }, (_, index) =>
      buildCase({
        deliveryId: `delivery_${index}`,
        // The duplicate past the page would otherwise look unique.
        intentId: index === HOSTED_FINAL_REPLY_DELIVERY_READ_LIMIT ? "intent_0" : `intent_${index}`,
        providerResultToAcceptedMs: 20_000,
      }).delivery);
    const { createMany, prisma } = createPrisma(rows);
    const listTimingLogs = vi.fn();

    await expect(runHostedRuntimeFinalReplyDeliveryAlertMonitor({ listTimingLogs, now: NOW, prisma }))
      .resolves.toEqual({ deliveryScan: "truncated", queuedCount: 0, timingScan: "skipped" });
    expect(listTimingLogs).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it.each([
    ["unavailable", async () => { throw new Error("synthetic read failure"); }],
    ["truncated", async () => Array.from({ length: 2_001 }, () => buildCase().reply)],
  ] as const)("raises nothing when the timing scan is %s", async (status, listImpl) => {
    const entry = buildCase({ providerResultToAcceptedMs: 20_000 });
    const { createMany, prisma } = createPrisma([entry.delivery]);

    await expect(runHostedRuntimeFinalReplyDeliveryAlertMonitor({
      listTimingLogs: vi.fn(listImpl) as never,
      now: NOW,
      prisma,
    })).resolves.toMatchObject({ queuedCount: 0, timingScan: status });
    expect(createMany).not.toHaveBeenCalled();
  });

  it("reports an unconfigured runtime-log database as unavailable", async () => {
    mocks.isHostedRuntimeLogDatabaseConfigured.mockReturnValue(false);
    const { prisma } = createPrisma([buildCase().delivery]);

    await expect(runHostedRuntimeFinalReplyDeliveryAlertMonitor({ now: NOW, prisma }))
      .resolves.toMatchObject({ timingScan: "unavailable" });
  });

  it("reads timing back to the earliest linked ingress, bounded by log retention", async () => {
    const recent = buildCase({ earliestTraceAcceptedAt: new Date(ACCEPTED_AT_MS - 5 * 60 * 60_000) });
    const listTimingLogs = vi.fn(async () => []);
    await runHostedRuntimeFinalReplyDeliveryAlertMonitor({
      listTimingLogs,
      now: NOW,
      prisma: createPrisma([recent.delivery]).prisma,
    });
    expect(listTimingLogs).toHaveBeenLastCalledWith(expect.objectContaining({
      from: new Date(ACCEPTED_AT_MS - 5 * 60 * 60_000 - 60_000),
      stages: ["linq-dispatch-entered", "reply-dispatched"],
      to: NOW,
    }));

    const ancient = buildCase({ earliestTraceAcceptedAt: new Date(TIMING_HORIZON.getTime() - 86_400_000) });
    await runHostedRuntimeFinalReplyDeliveryAlertMonitor({
      listTimingLogs,
      now: NOW,
      prisma: createPrisma([ancient.delivery]).prisma,
    });
    expect(listTimingLogs).toHaveBeenLastCalledWith(expect.objectContaining({ from: TIMING_HORIZON }));
  });

  it("queues one immutable scalar-only alert and reports actual inserts", async () => {
    const entry = buildCase({ providerResultToAcceptedMs: 20_000 });
    // A concurrent run already inserted the same identity.
    const { createMany, prisma } = createPrisma([entry.delivery], 0);

    await expect(runHostedRuntimeFinalReplyDeliveryAlertMonitor({
      listTimingLogs: vi.fn(async () => [toLogRow(entry.reply)]),
      now: NOW,
      prisma,
    })).resolves.toMatchObject({ queuedCount: 0, timingScan: "complete" });

    const alertId = buildHostedFinalReplyDeliveryAlertId("delivery_synthetic_1");
    expect(createMany).toHaveBeenCalledOnce();
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        id: alertId,
        kind: "runtime_final_reply_delivery_slow",
        status: "pending",
      })],
      skipDuplicates: true,
    });
    const details = (createMany.mock.calls[0]![0].data[0] as { detailsJson: Record<string, unknown> })
      .detailsJson;
    expect(Object.keys(details).sort()).toEqual([
      "acceptedAt",
      "components",
      "deliveryAttemptRelation",
      "dispatchAttribution",
      "finalResponseCompletedToAccepted",
      "intentionalPacingMs",
      "providerResultToAccepted",
      "schemaVersion",
      "scope",
      "thresholdMs",
      "triggerOrigins",
    ]);
    expect(JSON.stringify(details)).not.toContain("intent_synthetic_1");
    // The existing durable sender claim owns dedupe across concurrent runs.
    expect(mocks.sendPendingHostedLinqAlertsBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ alertIds: [alertId] }),
    );
  });
});
