import type { HostedLinqAlert } from "@prisma/client";
import { parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";
import type { HostedRuntimeLogEntry } from "@murphai/hosted-execution/runtime-control";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HostedResendPlainTextEmailError,
  type sendHostedResendPlainTextEmail,
} from "@/src/lib/hosted-onboarding/resend-plain-text-email";
import {
  HOSTED_RUNTIME_PROGRESS_ALERT_SAMPLE_LIMIT,
  HOSTED_RUNTIME_PROGRESS_USAGE_READ_LIMIT,
  HOSTED_RUNTIME_PROGRESS_REMINDER_INTERVAL_MS,
  HOSTED_RUNTIME_PROGRESS_STALL_THRESHOLD_MS,
  readHostedRuntimeProgressHealth,
  readHostedRuntimeStalledRecheckCandidates,
  runHostedRuntimeProgressAlertMonitor,
  summarizeHostedRuntimeProgressRows,
  type HostedRuntimeProgressHealthRow,
} from "@/src/lib/hosted-runtime-progress/alert-monitor";

const usageGate = vi.hoisted(() => vi.fn());
vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: usageGate,
}));
beforeEach(() => { usageGate.mockReset().mockResolvedValue({ allowed: true }); });

const now = instant("2026-08-10T16:00:00.000Z");
const alertEnv = {
  HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph Alerts <alerts@example.test>",
  HOSTED_LINQ_ALERT_EMAILS: "operator@example.test",
  HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE: "America/Los_Angeles",
  RESEND_API_KEY: "re_test",
};

function createVoidDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("usage-paused system notification progress", () => {
  const notification = (runtimeKey = "runtime_paused", overrides: Partial<HostedRuntimeProgressHealthRow> = {}) => ({
    ...progressRow({ runtimeKey, lane: "system", headKind: "assistant.notification.requested",
      progressOriginAt: "2026-08-10T15:00:00Z", durableHighWaterSeq: 5n,
      workspaceSystemImportedSeq: 5n, pendingCount: 5n }),
    agedHighWaterSeq: 5n,
    headDedupeKey: "assistant.notification.requested:synthetic:notification",
    ...overrides,
  });

  it("silently rearms an existing alert for a current usage pause and alerts again when allowance returns", async () => {
    const fixture = createProgressMonitorFixture([notification()]);
    const sendAlert = vi.fn().mockResolvedValue({ providerMessageId: "synthetic-alert" });
    let checkedAt = now;
    const run = () => runHostedRuntimeProgressAlertMonitor({ now: checkedAt, env: alertEnv,
      prisma: fixture.prisma, sendAlert, scheduleObservation: () => {} });
    expect((await run()).health.stalledSystemLaneCount).toBe(1);
    expect(sendAlert).toHaveBeenCalledTimes(1);
    checkedAt = new Date(+now + 5 * 60_000);
    usageGate.mockResolvedValue({ allowed: false, reason: "ai_usage_limit_exceeded" });
    expect((await run()).health).toMatchObject({ anomalous: false,
      excludedUsageBlockedSystemLaneCount: 1, stalledSystemLaneCount: 0, pendingItemCount: 0 });
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fixture.readState())).not.toContain(notification().headDedupeKey);
    expect(JSON.stringify(fixture.readState())).not.toContain("runtime_paused");
    checkedAt = new Date(+now + 25 * 60_000);
    usageGate.mockResolvedValue({ allowed: true });
    expect((await run()).health.stalledSystemLaneCount).toBe(1);
    expect(sendAlert).toHaveBeenCalledTimes(2);
  });

  it.each([
    { headKind: "device-sync.wake" },
    { headKind: "unknown.future-kind" },
    { headDedupeKey: "assistant.notification.requested:group-join:synthetic" },
    { headDedupeKey: "assistant.notification.requested:device-delivery-stalled:v1:synthetic" },
    { headDedupeKey: undefined },
    { agedHighWaterSeq: null },
    { agedHighWaterSeq: 0n },
    { workspaceSystemImportedSeq: 0n },
    { workspaceSystemImportedSeq: null },
    { workspaceSystemImportedSeq: 4n },
    { workspaceSystemImportedSeq: 6n },
    { chronologyInvalid: true },
  ])("retains actionable or unproven work: %#", async (overrides) => {
    usageGate.mockResolvedValue({ allowed: false, reason: "ai_usage_limit_exceeded" });
    const fixture = createProgressMonitorFixture([notification("runtime_paused", overrides)]);
    expect(await readHostedRuntimeProgressHealth({ now, prisma: fixture.prisma }))
      .toMatchObject({ anomalous: true, excludedUsageBlockedSystemLaneCount: 0 });
    expect(usageGate).not.toHaveBeenCalled();
  });

  it("keeps an imported notification paused while only fresh suffix work remains unimported", async () => {
    usageGate.mockResolvedValue({ allowed: false, reason: "ai_usage_limit_exceeded" });
    const fixture = createProgressMonitorFixture([notification("runtime_paused", {
      durableHighWaterSeq: 7n,
      workspaceSystemImportedSeq: 5n,
      agedHighWaterSeq: 5n,
    })]);
    expect(await readHostedRuntimeProgressHealth({ now, prisma: fixture.prisma }))
      .toMatchObject({ anomalous: false, excludedUsageBlockedSystemLaneCount: 1 });
    fixture.setRows([notification("runtime_paused", {
      durableHighWaterSeq: 7n,
      workspaceSystemImportedSeq: 5n,
      agedHighWaterSeq: 6n,
    })]);
    expect(await readHostedRuntimeProgressHealth({ now, prisma: fixture.prisma }))
      .toMatchObject({ anomalous: true, excludedUsageBlockedSystemLaneCount: 0 });
    expect(usageGate).toHaveBeenCalledTimes(1);
  });

  it("keeps a separate deterministic system head visible for an exhausted runtime", async () => {
    usageGate.mockResolvedValue({ allowed: false, reason: "ai_usage_limit_exceeded" });
    const fixture = createProgressMonitorFixture([notification(), notification("runtime_device", { headKind: "device-sync.wake" })]);
    expect(await readHostedRuntimeProgressHealth({ now, prisma: fixture.prisma }))
      .toMatchObject({ anomalous: true, excludedUsageBlockedSystemLaneCount: 1, stalledSystemLaneCount: 1 });
  });

  it.each(["unavailable", "inactive"])("does not infer usage exhaustion from %s", async (mode) => {
    if (mode === "unavailable") usageGate.mockRejectedValue(new Error("synthetic read failure"));
    else usageGate.mockResolvedValue({ allowed: false, reason: "inactive" });
    const fixture = createProgressMonitorFixture([notification()]);
    expect(await readHostedRuntimeProgressHealth({ now, prisma: fixture.prisma }))
      .toMatchObject({ anomalous: true, excludedUsageBlockedSystemLaneCount: 0 });
  });

  it("caps serial allowance reads for a maximum-size candidate page and keeps overflow alertable", async () => {
    let active = 0;
    let peak = 0;
    usageGate.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      return { allowed: false, reason: "ai_usage_limit_exceeded" };
    });
    const fixture = createProgressMonitorFixture([]);
    fixture.queryRaw.mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => notification(`runtime_${i}`))).mockResolvedValueOnce([]);
    fixture.hostedMemberFindMany.mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => ({
      accountGroupMemberships: [], billingRef: null, billingStatus: "active", consentGrants: [],
      id: `runtime_${i}`, suspendedAt: null, threadContainer: null,
    })));
    expect(await readHostedRuntimeProgressHealth({ now, prisma: fixture.prisma }))
      .toMatchObject({ anomalous: true, excludedUsageBlockedSystemLaneCount: HOSTED_RUNTIME_PROGRESS_USAGE_READ_LIMIT,
        stalledSystemLaneCount: 500 - HOSTED_RUNTIME_PROGRESS_USAGE_READ_LIMIT });
    expect(usageGate).toHaveBeenCalledTimes(HOSTED_RUNTIME_PROGRESS_USAGE_READ_LIMIT);
    expect(peak).toBe(1);
  });
});

describe("hosted runtime progress health", () => {
  it("detects the exact 15-minute durable progress boundary across both lanes", () => {
    const health = summarizeHostedRuntimeProgressRows({
      activeRuntimeKeys: ["runtime_a", "runtime_b"],
      now,
      rows: [
        progressRow({
          progressOriginAt: "2026-08-10T15:45:00.001Z",
          lane: "system",
          pendingCount: 9n,
          runtimeKey: "runtime_a",
        }),
        progressRow({
          progressOriginAt: "2026-08-10T15:45:00.000Z",
          durableHighWaterSeq: 12n,
          effectiveConsumedSeq: 9n,
          headKind: "device-sync.wake",
          headLaneSeq: 10n,
          lane: "system",
          nextWakeReason: "assistant",
          pendingCount: 3n,
          runtimeKey: "runtime_a",
          workspaceSystemImportedSeq: 12n,
        }),
        progressRow({
          progressOriginAt: "2026-08-10T15:30:00.000Z",
          lane: "conversation",
          pendingCount: 2n,
          runtimeKey: "runtime_b",
        }),
      ],
    });

    expect(HOSTED_RUNTIME_PROGRESS_STALL_THRESHOLD_MS).toBe(15 * 60_000);
    expect(health).toMatchObject({
      anomalous: true,
      oldestStalledAgeMs: 30 * 60_000,
      pendingItemCount: 5,
      stalledConversationLaneCount: 1,
      stalledLaneCount: 2,
      stalledRuntimeCount: 2,
      stalledSystemLaneCount: 1,
      systemDiagnostics: {
        assistantWakeLaneCount: 1,
        deviceSyncHeadLaneCount: 1,
        deviceSyncWakeLaneCount: 0,
        fullyImportedLaneCount: 1,
        importedUnhandledItemCount: 3,
        otherOrMissingWakeLaneCount: 0,
        partiallyImportedLaneCount: 0,
        unimportedHeadLaneCount: 0,
        unknownImportLaneCount: 0,
      },
    });
  });

  it.each(["delivery", "terminal_no_reply"])("defers a completed conversation head until its checkpoint deadline (%s)", (completion) => {
    const row = progressRow({ progressOriginAt: "2026-08-10T15:30:00Z", lane: "conversation", runtimeKey: "runtime_a" });
    Object.assign(row, {
      deliveryAcceptedAt: completion === "delivery" ? instant("2026-08-10T15:56:00Z") : null,
      checkpointEvidence: { assistant: {
        checkpointPublicationExpectedByEpochMs: +now + 60_000,
        ...(completion === "terminal_no_reply" ? { terminalNonReplyCommittedAtEpochMs: +now - 4 * 60_000 } : {}),
      } },
    });
    const summarize = (at: Date) => summarizeHostedRuntimeProgressRows({
      activeRuntimeKeys: ["runtime_a"], rows: [row], now: at,
    });
    expect(summarize(now).anomalous).toBe(false);
    expect(summarize(new Date(+now + 60_000)).anomalous).toBe(false);
    expect(summarize(new Date(+now + 60_001))).toMatchObject({
      anomalous: true, stalledConversationLaneCount: 1, pendingItemCount: 1,
    });
  });

  it("does not defer missing completion, invalid chronology, or system work", () => {
    const deadline = +now + 60_000;
    const completion = instant("2026-08-10T15:56:00Z");
    const cases = [
      { deliveryAcceptedAt: null, expected: deadline },
      { deliveryAcceptedAt: completion, expected: null },
      { deliveryAcceptedAt: completion, expected: String(deadline) },
      { deliveryAcceptedAt: completion, expected: 1e100 },
      { deliveryAcceptedAt: completion, expected: +completion - 1 },
      { deliveryAcceptedAt: instant("2026-08-10T15:29:00Z"), expected: deadline },
      { deliveryAcceptedAt: new Date(+now + 1), expected: deadline },
      { deliveryAcceptedAt: completion, expected: deadline, lane: "system" },
    ];
    for (const test of cases) {
      const row = Object.assign(progressRow({ progressOriginAt: "2026-08-10T15:30:00Z",
        lane: test.lane ?? "conversation", runtimeKey: "runtime_a" }), {
        deliveryAcceptedAt: test.deliveryAcceptedAt,
        checkpointEvidence: { assistant: { checkpointPublicationExpectedByEpochMs: test.expected } },
      });
      expect(summarizeHostedRuntimeProgressRows({ activeRuntimeKeys: ["runtime_a"], rows: [row], now }).anomalous).toBe(true);
    }
  });

  it.each(["member.activated", "device-sync.wake"])("defers imported %s behind a current foreground checkpoint only until its deadline", (headKind) => {
    const row = progressRow({
      progressOriginAt: "2026-08-10T15:30:00Z", lane: "system", runtimeKey: "runtime_a",
      headKind, workspaceCheckpointedAt: instant("2026-08-10T15:40:00Z"),
    });
    row.foregroundCheckpointEvidence = { assistant: {
      terminalReplyCommittedAtEpochMs: +now - 4 * 60_000,
      checkpointPublicationExpectedByEpochMs: +now + 60_000,
    } };
    const summarize = (candidate = row, at = now) => summarizeHostedRuntimeProgressRows({
      activeRuntimeKeys: ["runtime_a"], rows: [candidate], now: at,
    });
    expect(summarize().anomalous).toBe(false);
    expect(summarize(row, new Date(+now + 60_000)).anomalous).toBe(false);
    expect(summarize(row, new Date(+now + 60_001))).toMatchObject({
      anomalous: true, stalledSystemLaneCount: 1, oldestStalledAgeMs: 31 * 60_000 + 1,
    });
    for (const override of [
      { headKind: "member.preferences.updated" },
      { workspaceSystemImportedSeq: null },
      { workspaceSystemImportedSeq: 0n },
      { workspaceSystemImportedSeq: 2n },
      { workspaceCheckpointedAt: null },
      { workspaceCheckpointedAt: instant("2026-08-10T15:56:00Z") },
      { foregroundCheckpointEvidence: null },
      { chronologyInvalid: true },
      { foregroundCheckpointEvidence: { assistant: {
        checkpointPublicationExpectedByEpochMs: +now + 60_000,
      } } },
      { foregroundCheckpointEvidence: { assistant: {
        terminalReplyCommittedAtEpochMs: +now + 1,
        checkpointPublicationExpectedByEpochMs: +now + 60_000,
      } } },
    ]) {
      expect(summarize({ ...row, ...override }).anomalous).toBe(true);
    }
  });

  it("classifies every system import and wake-owner diagnostic without identifiers", () => {
    const health = summarizeHostedRuntimeProgressRows({
      activeRuntimeKeys: [
        "runtime_full",
        "runtime_partial",
        "runtime_unimported",
        "runtime_unknown",
      ],
      now,
      rows: [
        progressRow({
          durableHighWaterSeq: 10n,
          effectiveConsumedSeq: 8n,
          headKind: "device-sync.wake",
          headLaneSeq: 9n,
          lane: "system",
          nextWakeReason: "assistant",
          pendingCount: 2n,
          progressOriginAt: "2026-08-10T15:30:00.000Z",
          runtimeKey: "runtime_full",
          workspaceSystemImportedSeq: 10n,
        }),
        progressRow({
          durableHighWaterSeq: 10n,
          effectiveConsumedSeq: 6n,
          headKind: "device-sync.wake",
          headLaneSeq: 7n,
          lane: "system",
          nextWakeReason: "device-sync.reconcile",
          pendingCount: 4n,
          progressOriginAt: "2026-08-10T15:30:00.000Z",
          runtimeKey: "runtime_partial",
          workspaceSystemImportedSeq: 8n,
        }),
        progressRow({
          durableHighWaterSeq: 10n,
          effectiveConsumedSeq: 5n,
          headKind: "device-sync.wake",
          headLaneSeq: 7n,
          lane: "system",
          nextWakeReason: null,
          pendingCount: 5n,
          progressOriginAt: "2026-08-10T15:30:00.000Z",
          runtimeKey: "runtime_unimported",
          workspaceSystemImportedSeq: 6n,
        }),
        progressRow({
          durableHighWaterSeq: 10n,
          effectiveConsumedSeq: 5n,
          headKind: "runtime.maintenance-requested",
          headLaneSeq: 6n,
          lane: "system",
          nextWakeReason: "mailbox",
          pendingCount: 5n,
          progressOriginAt: "2026-08-10T15:30:00.000Z",
          runtimeKey: "runtime_unknown",
          workspaceSystemImportedSeq: null,
        }),
      ],
    });

    expect(health.systemDiagnostics).toEqual({
      assistantWakeLaneCount: 1,
      deviceSyncHeadLaneCount: 3,
      deviceSyncWakeLaneCount: 1,
      fullyImportedLaneCount: 1,
      importedUnhandledItemCount: 4,
      otherOrMissingWakeLaneCount: 2,
      partiallyImportedLaneCount: 1,
      unimportedHeadLaneCount: 1,
      unknownImportLaneCount: 1,
    });
  });

  it.each([
    { importedSeq: 2n, full: 0, unknown: 1, unhandled: 0 },
    { importedSeq: 1n, full: 1, unknown: 0, unhandled: 1 },
  ])("bounds system import coverage at durable high water ($importedSeq)", ({
    importedSeq,
    full,
    unknown,
    unhandled,
  }) => {
    const health = summarizeHostedRuntimeProgressRows({
      activeRuntimeKeys: ["runtime_a"],
      now,
      rows: [progressRow({
        durableHighWaterSeq: 1n,
        effectiveConsumedSeq: 0n,
        headKind: "device-sync.wake",
        headLaneSeq: 1n,
        lane: "system",
        pendingCount: 1n,
        progressOriginAt: "2026-08-10T15:30:00.000Z",
        runtimeKey: "runtime_a",
        workspaceSystemImportedSeq: importedSeq,
      })],
    });

    expect(health.systemDiagnostics).toMatchObject({
      fullyImportedLaneCount: full,
      importedUnhandledItemCount: unhandled,
      partiallyImportedLaneCount: 0,
      unimportedHeadLaneCount: 0,
      unknownImportLaneCount: unknown,
    });
  });

  it("excludes inactive and intentionally usage-blocked work", () => {
    const health = summarizeHostedRuntimeProgressRows({
      activeRuntimeKeys: ["runtime_active"],
      now,
      rows: [
        progressRow({
          progressOriginAt: "2026-08-10T15:00:00.000Z",
          lane: "system",
          runtimeKey: "runtime_inactive",
        }),
        progressRow({
          progressOriginAt: "2026-08-10T15:00:00.000Z",
          lane: "conversation",
          runtimeKey: "runtime_active",
          usageBlocked: true,
        }),
      ],
    });

    expect(health).toMatchObject({
      anomalous: false,
      excludedInactiveLaneCount: 1,
      excludedUsageBlockedConversationLaneCount: 1,
      stalledLaneCount: 0,
    });
  });

  it("fails safe for invalid or truncated progress evidence", () => {
    const health = summarizeHostedRuntimeProgressRows({
      activeRuntimeKeys: ["runtime_active"],
      now,
      rows: [
        progressRow({
          progressOriginAt: "2026-08-10T15:00:00.000Z",
          lane: "unexpected",
          runtimeKey: "runtime_active",
        }),
      ],
      scanTruncated: true,
    });

    expect(health).toMatchObject({
      anomalous: true,
      invalidRowCount: 1,
      scanTruncated: true,
    });
  });

  it("selects only the durable legacy device-sync stall signature", async () => {
    const fixture = createProgressMonitorFixture([
      stalledDeviceSyncRow("runtime_z", { pendingCount: 7n }),
      stalledDeviceSyncRow("runtime_fresh", {
        progressOriginAt: "2026-08-10T15:45:00.001Z",
      }),
      stalledDeviceSyncRow("runtime_wrong_head", {
        headKind: "runtime.maintenance-requested",
      }),
      stalledDeviceSyncRow("runtime_conversation", {
        lane: "conversation",
      }),
      stalledDeviceSyncRow("runtime_missing_wake", {
        nextWakeAt: null,
      }),
      stalledDeviceSyncRow("runtime_fresh_wake", {
        nextWakeAt: instant("2026-08-10T15:45:00.001Z"),
      }),
      stalledDeviceSyncRow("runtime_wrong_wake_reason", {
        nextWakeReason: "assistant.default-processing",
      }),
      stalledDeviceSyncRow("runtime_default_wake", {
        nextDefaultProcessingWakeAt: instant("2026-08-10T15:10:00.000Z"),
      }),
      stalledDeviceSyncRow("runtime_default_wake_reason", {
        nextDefaultProcessingWakeReason: "assistant.default-processing",
      }),
      stalledDeviceSyncRow("runtime_current_generation", {
        systemMailboxProgressGeneration: 0n,
      }),
      stalledDeviceSyncRow("runtime_without_checkpoint", {
        workspaceCheckpointedAt: null,
      }),
      stalledDeviceSyncRow("runtime_a", { pendingCount: 3n }),
    ]);

    await expect(readHostedRuntimeStalledRecheckCandidates({
      now,
      prisma: fixture.prisma,
    })).resolves.toEqual({
      candidates: [
        {
          pendingItemCount: "3",
          stalledSince: "2026-08-10T15:00:00.000Z",
          userId: "runtime_a",
        },
        {
          pendingItemCount: "7",
          stalledSince: "2026-08-10T15:00:00.000Z",
          userId: "runtime_z",
        },
      ],
      scanTruncated: false,
    });
  });

  it("reports when the bounded stalled-recheck scan truncates", async () => {
    const repeatedRow = stalledDeviceSyncRow("runtime_inactive");
    const queryRaw = vi.fn(async () => Array.from(
      { length: 20_001 },
      () => repeatedRow,
    ));

    await expect(readHostedRuntimeStalledRecheckCandidates({
      now,
      prisma: {
        $queryRaw: queryRaw,
        hostedMember: {
          findMany: vi.fn(async () => []),
        },
        hostedThreadContainerParticipant: {
          findMany: vi.fn(async () => []),
        },
      } as never,
    })).resolves.toEqual({
      candidates: [],
      scanTruncated: true,
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe("hosted runtime progress alert monitor", () => {
  it("ages the first pending live item beyond the effective handled cursor", async () => {
    const fixture = createProgressMonitorFixture([]);

    await runHostedRuntimeProgressAlertMonitor({
      env: {},
      now,
      prisma: fixture.prisma,
    });

    const query = fixture.queryRaw.mock.calls[0]?.[0];
    if (
      typeof query !== "object"
      || query === null
      || !("strings" in query)
      || !Array.isArray(query.strings)
    ) {
      throw new TypeError("Expected a Prisma SQL query.");
    }
    const sql = query.strings.join(" ").replace(/\s+/gu, " ");
    expect(sql).toContain(
      "mailbox_item.lane_seq > lane_boundary.effective_consumed_seq",
    );
    expect(sql).toContain(
      "pending_head.created_at AS head_created_at",
    );
    expect(sql).toContain(
      "lane_boundary.lane <> 'conversation' OR mailbox_item.consumed_at IS NULL",
    );
    expect(sql).toContain("COUNT(*) OVER () AS pending_count");
    expect(sql).toContain("trace.assistant_input_staged_at");
    expect(sql).toContain("trace.provider_start_at");
    expect(sql).toContain("delivery.accepted_at");
    expect(sql).toContain(
      "workspace.next_wake_at AS workspace_next_wake_at",
    );
    expect(sql).toContain("pending_head.kind AS head_kind");
    expect(sql).toContain(
      "workspace.checkpointed_at AS workspace_checkpointed_at",
    );
    expect(sql).toContain(
      "workspace.next_default_processing_wake_at AS workspace_next_default_processing_wake_at",
    );
    expect(sql).toContain(
      "workspace.next_default_processing_wake_reason AS workspace_next_default_processing_wake_reason",
    );
    expect(sql).toContain(
      "workspace.system_mailbox_progress_generation AS workspace_system_mailbox_progress_generation",
    );
    expect(sql).toContain('progress_lane.head_kind AS "headKind"');
    expect(sql).toContain(
      'AS "nextDefaultProcessingWakeAt"',
    );
    expect(sql).toContain(
      'AS "nextDefaultProcessingWakeReason"',
    );
    expect(sql).toContain('AS "nextWakeAt"');
    expect(sql).toContain('AS "nextWakeReason"');
    expect(sql).toContain('AS "systemMailboxProgressGeneration"');
    expect(sql).toContain('AS "workspaceCheckpointedAt"');
    expect(sql).not.toContain("head_consumed_at");
  });

  it("bounds the raw candidate scan before inactive-lane exclusions", async () => {
    let emitted = 0;
    const queryRaw = vi.fn(async () => {
      if (emitted >= 20_001) {
        return [];
      }
      const pageSize = emitted < 20_000 ? 500 : 1;
      const rows = Array.from({ length: pageSize }, (_, index) => {
        const ordinal = emitted + index;
        return progressRow({
          progressOriginAt: "2026-08-10T15:00:00.000Z",
          lane: "system",
          runtimeKey: `runtime_inactive_${ordinal}`,
        });
      });
      emitted += pageSize;
      return rows;
    });
    const hostedMemberFindMany = vi.fn(async () => []);
    const hostedThreadContainerParticipantFindMany = vi.fn(async () => []);

    const health = await readHostedRuntimeProgressHealth({
      now,
      prisma: {
        $queryRaw: queryRaw,
        hostedMember: {
          findMany: hostedMemberFindMany,
        },
        hostedThreadContainerParticipant: {
          findMany: hostedThreadContainerParticipantFindMany,
        },
      } as never,
    });

    expect(queryRaw).toHaveBeenCalledTimes(41);
    expect(hostedMemberFindMany).toHaveBeenCalledTimes(40);
    expect(health).toMatchObject({
      anomalous: true,
      excludedInactiveLaneCount: 20_000,
      pendingItemCount: 0,
      scanTruncated: true,
      stalledLaneCount: 0,
      stalledRuntimeCount: 0,
    });
  });

  it("opens one aggregate Resend incident and coalesces repeated stalled scans", async () => {
    const fixture = createProgressMonitorFixture([
      progressRow({
        progressOriginAt: "2026-08-10T15:30:00.000Z",
        durableHighWaterSeq: 7n,
        effectiveConsumedSeq: 0n,
        headKind: "device-sync.wake",
        headLaneSeq: 1n,
        lane: "system",
        nextWakeReason: "assistant",
        pendingCount: 7n,
        runtimeKey: "runtime_private_a",
        workspaceSystemImportedSeq: 7n,
      }),
      progressRow({
        progressOriginAt: "2026-08-10T15:20:00.000Z",
        lane: "conversation",
        pendingCount: 2n,
        runtimeKey: "runtime_private_b",
      }),
    ]);
    const sendAlert = vi.fn(async (input: AlertSendInput) => {
      void input;
      return { providerMessageId: "provider-message" };
    });

    const opened = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendAlert,
    });
    const repeated = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now: instant("2026-08-10T16:05:00.000Z"),
      prisma: fixture.prisma,
      sendAlert,
    });

    expect(opened.outcome).toBe("alert_sent");
    expect(repeated.outcome).toBe("incident_active");
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringMatching(
        /^murph\/runtime-progress\/[0-9a-f-]+\/alert$/u,
      ),
      subject: "Hosted runtime progress stalled",
      text: expect.stringContaining(
        "2 active runtimes have durable mailbox work that has remained beyond",
      ),
      to: ["operator@example.test"],
    }));
    const persisted = JSON.stringify(fixture.readState()?.detailsJson);
    const message = sendAlert.mock.calls[0]?.[0].text ?? "";
    expect(message).toContain("Affected lanes: 1 system, 1 conversation");
    expect(message).toContain("Pending live items: 9");
    expect(message).toContain(
      "System diagnostics: 1/1 device-sync heads; import coverage 1 full, 0 partial, 0 head-unimported, 0 unknown; 7 imported-but-unhandled items; wake owners 1 assistant, 0 device-sync, 0 other/missing.",
    );
    expect(message).not.toContain("runtime_private_a");
    expect(message).not.toContain("runtime_private_b");
    expect(persisted).not.toContain("runtime_private_a");
    expect(persisted).not.toContain("runtime_private_b");
    expect(fixture.readState()).toMatchObject({
      detailsJson: {
        health: {
          systemDiagnostics: {
            assistantWakeLaneCount: 1,
            deviceSyncHeadLaneCount: 1,
            fullyImportedLaneCount: 1,
            importedUnhandledItemCount: 7,
          },
        },
      },
      kind: "hosted_runtime_progress_monitor",
      status: "progress_alerting",
    });
  });

  it("refreshes aggregate evidence in a six-hour reminder", async () => {
    const fixture = createProgressMonitorFixture([
      progressRow({
        progressOriginAt: "2026-08-10T15:30:00.000Z",
        lane: "system",
        pendingCount: 2n,
        runtimeKey: "runtime_private_initial",
      }),
    ]);
    const sendAlert = vi.fn(async (input: AlertSendInput) => {
      void input;
      return { providerMessageId: "provider-message" };
    });

    const opened = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendAlert,
    });
    fixture.setRows([
      progressRow({
        progressOriginAt: "2026-08-10T14:00:00.000Z",
        lane: "system",
        pendingCount: 4n,
        runtimeKey: "runtime_private_reminder_a",
      }),
      progressRow({
        progressOriginAt: "2026-08-10T15:00:00.000Z",
        lane: "conversation",
        pendingCount: 3n,
        runtimeKey: "runtime_private_reminder_b",
      }),
    ]);
    const exactBoundary = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now: instant("2026-08-10T22:00:00.000Z"),
      prisma: fixture.prisma,
      sendAlert,
    });
    const reminded = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now: instant("2026-08-10T22:15:00.000Z"),
      prisma: fixture.prisma,
      sendAlert,
    });
    const remindedAgain = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now: instant("2026-08-11T04:30:00.000Z"),
      prisma: fixture.prisma,
      sendAlert,
    });

    expect(HOSTED_RUNTIME_PROGRESS_REMINDER_INTERVAL_MS).toBe(6 * 60 * 60_000);
    expect(opened.outcome).toBe("alert_sent");
    expect(exactBoundary.outcome).toBe("incident_active");
    expect(reminded.outcome).toBe("alert_sent");
    expect(remindedAgain.outcome).toBe("alert_sent");
    expect(fixture.queryRaw).toHaveBeenCalledTimes(7);
    expect(sendAlert).toHaveBeenCalledTimes(3);
    const initialKey = sendAlert.mock.calls[0]?.[0].idempotencyKey ?? "";
    const firstReminderKey = sendAlert.mock.calls[1]?.[0].idempotencyKey ?? "";
    const secondReminderKey = sendAlert.mock.calls[2]?.[0].idempotencyKey ?? "";
    expect(initialKey).toMatch(/^murph\/runtime-progress\/[0-9a-f-]+\/alert$/u);
    expect(firstReminderKey).toMatch(
      /^murph\/runtime-progress\/[0-9a-f-]+\/alert$/u,
    );
    expect(secondReminderKey).toMatch(
      /^murph\/runtime-progress\/[0-9a-f-]+\/alert$/u,
    );
    expect(firstReminderKey).not.toBe(initialKey);
    expect(secondReminderKey).not.toBe(firstReminderKey);
    expect(sendAlert.mock.calls[1]?.[0]).toMatchObject({
      subject: "Hosted runtime progress stalled",
      to: ["operator@example.test"],
    });
    const reminderMessage = sendAlert.mock.calls[1]?.[0].text ?? "";
    const persisted = JSON.stringify(fixture.readState()?.detailsJson);
    expect(reminderMessage).toContain("Murph runtime progress reminder.");
    expect(reminderMessage).toContain("2 active runtimes");
    expect(reminderMessage).toContain("Affected lanes: 1 system, 1 conversation");
    expect(reminderMessage).toContain("Pending live items: 7");
    expect(reminderMessage).not.toContain("runtime_private_initial");
    expect(reminderMessage).not.toContain("runtime_private_reminder_a");
    expect(reminderMessage).not.toContain("runtime_private_reminder_b");
    expect(persisted).not.toContain("runtime_private_initial");
    expect(persisted).not.toContain("runtime_private_reminder_a");
    expect(persisted).not.toContain("runtime_private_reminder_b");
    expect(fixture.readState()?.detailsJson).toMatchObject({
      schema: "murph.hosted-runtime-progress-monitor.v1",
    });
  });

  it("retries one reminder with its exact persisted body and Resend key", async () => {
    const fixture = createProgressMonitorFixture([
      progressRow({
        progressOriginAt: "2026-08-10T15:00:00.000Z",
        lane: "system",
        runtimeKey: "runtime_private",
      }),
    ]);
    const sendAlert = vi.fn(async (_input: AlertSendInput) => {
      void _input;
      return { providerMessageId: "provider-message" };
    })
      .mockResolvedValueOnce({ providerMessageId: "initial-message" })
      .mockRejectedValueOnce(new HostedResendPlainTextEmailError(
        "Hosted Resend email send failed.",
        {
          code: "RESEND_SEND_FAILED",
          providerStatus: 503,
        },
      ))
      .mockResolvedValueOnce({ providerMessageId: "reminder-message" });

    await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendAlert,
    });
    await expect(runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now: instant("2026-08-10T22:15:00.000Z"),
      prisma: fixture.prisma,
      sendAlert,
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_PROGRESS_ALERT_SEND_FAILED",
    });
    const retried = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now: instant("2026-08-10T22:35:00.000Z"),
      prisma: fixture.prisma,
      sendAlert,
    });

    expect(retried.outcome).toBe("alert_sent");
    expect(sendAlert).toHaveBeenCalledTimes(3);
    expect(sendAlert.mock.calls[2]?.[0].idempotencyKey).toBe(
      sendAlert.mock.calls[1]?.[0].idempotencyKey,
    );
    expect(sendAlert.mock.calls[2]?.[0].text).toBe(
      sendAlert.mock.calls[1]?.[0].text,
    );
    expect(fixture.readState()).toMatchObject({
      attemptCount: 3,
      lastErrorCode: null,
      lastProviderStatus: null,
      status: "progress_alerting",
    });
  });

  it("admits one provider effect when due reminder scans overlap", async () => {
    const fixture = createProgressMonitorFixture([
      progressRow({
        progressOriginAt: "2026-08-10T15:00:00.000Z",
        lane: "system",
        runtimeKey: "runtime_private",
      }),
    ]);
    let sendOrdinal = 0;
    const reminderStarted = createVoidDeferred();
    const reminderRelease = createVoidDeferred();
    const sendAlert = vi.fn(async (_input: AlertSendInput) => {
      void _input;
      sendOrdinal += 1;
      if (sendOrdinal === 2) {
        reminderStarted.resolve();
        await reminderRelease.promise;
      }
      return { providerMessageId: `provider-message-${sendOrdinal}` };
    });

    await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendAlert,
    });
    const firstReminder = runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now: instant("2026-08-10T22:15:00.000Z"),
      prisma: fixture.prisma,
      sendAlert,
    });
    await reminderStarted.promise;
    const overlapping = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now: instant("2026-08-10T22:15:00.000Z"),
      prisma: fixture.prisma,
      sendAlert,
    });
    reminderRelease.resolve();

    expect((await firstReminder).outcome).toBe("alert_sent");
    expect(overlapping.outcome).toBe("coalesced");
    expect(sendAlert).toHaveBeenCalledTimes(2);
  });

  it("sends a first progress alert during quiet hours", async () => {
    const quietNow = instant("2026-08-11T06:20:00.000Z");
    const fixture = createProgressMonitorFixture([
      progressRow({
        progressOriginAt: "2026-08-11T05:00:00.000Z",
        lane: "system",
        runtimeKey: "runtime_private",
      }),
    ]);
    const sendAlert = vi.fn(async (_input: AlertSendInput) => {
      void _input;
      return { providerMessageId: "provider-message" };
    });

    const result = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now: quietNow,
      prisma: fixture.prisma,
      sendAlert,
    });

    expect(result.outcome).toBe("alert_sent");
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert.mock.calls[0]?.[0].text).toContain(
      "Murph runtime progress alert.",
    );
  });

  it("sends an overdue progress reminder during quiet hours", async () => {
    const initialNow = instant("2026-08-11T00:00:00.000Z");
    const fixture = createProgressMonitorFixture([
      progressRow({
        progressOriginAt: "2026-08-10T23:00:00.000Z",
        lane: "system",
        runtimeKey: "runtime_private",
      }),
    ]);
    const sendAlert = vi.fn(async (_input: AlertSendInput) => {
      void _input;
      return { providerMessageId: "provider-message" };
    });

    await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now: initialNow,
      prisma: fixture.prisma,
      sendAlert,
    });
    const overnight = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now: instant("2026-08-11T06:20:00.000Z"),
      prisma: fixture.prisma,
      sendAlert,
    });

    expect(overnight.outcome).toBe("alert_sent");
    expect(sendAlert).toHaveBeenCalledTimes(2);
    expect(sendAlert.mock.calls[1]?.[0].text).toContain(
      "Murph runtime progress reminder.",
    );
  });

  it("reminds from an already-active v1 incident without a migration", async () => {
    const fixture = createProgressMonitorFixture([
      progressRow({
        progressOriginAt: "2026-08-10T15:00:00.000Z",
        lane: "system",
        runtimeKey: "runtime_private",
      }),
    ]);
    const sendAlert = vi.fn(async (_input: AlertSendInput) => {
      void _input;
      return { providerMessageId: "provider-message" };
    });

    await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendAlert,
    });
    const activeState = fixture.readState();
    if (!activeState) {
      throw new Error("Expected an active progress incident.");
    }
    const legacyIncidentId = readIncidentId(activeState);
    fixture.setState({
      ...activeState,
      detailsJson: {
        health: {
          pendingItemCount: 1,
          stalledRuntimeCount: 1,
        },
        incidentId: readIncidentId(activeState),
        lastEvaluatedAt: now.toISOString(),
        message: sendAlert.mock.calls[0]?.[0].text ?? null,
        phase: "alert",
        schema: "murph.hosted-runtime-progress-monitor.v1",
        thresholdMs: HOSTED_RUNTIME_PROGRESS_STALL_THRESHOLD_MS,
      },
    });

    const reminded = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now: instant("2026-08-10T22:15:00.000Z"),
      prisma: fixture.prisma,
      sendAlert,
    });

    expect(reminded.outcome).toBe("alert_sent");
    expect(sendAlert).toHaveBeenCalledTimes(2);
    expect(readIncidentId(fixture.readState())).not.toBe(legacyIncidentId);
    expect(fixture.readState()?.detailsJson).toMatchObject({
      schema: "murph.hosted-runtime-progress-monitor.v1",
    });
  });

  it("silently rearms after recovery and gives a later stall a new identity", async () => {
    const fixture = createProgressMonitorFixture([
      progressRow({
        progressOriginAt: "2026-08-10T15:30:00.000Z",
        lane: "system",
        runtimeKey: "runtime_a",
      }),
    ]);
    const sendAlert = vi.fn(async (input: AlertSendInput) => {
      void input;
      return { providerMessageId: "provider-message" };
    });

    await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendAlert,
    });
    fixture.setRows([]);
    const recovered = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now: instant("2026-08-10T16:05:00.000Z"),
      prisma: fixture.prisma,
      sendAlert,
    });
    fixture.setRows([
      progressRow({
        progressOriginAt: "2026-08-10T16:10:00.000Z",
        lane: "system",
        runtimeKey: "runtime_a",
      }),
    ]);
    const recurred = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now: instant("2026-08-10T16:30:00.000Z"),
      prisma: fixture.prisma,
      sendAlert,
    });

    expect(recovered.outcome).toBe("healthy");
    expect(recurred.outcome).toBe("alert_sent");
    expect(sendAlert).toHaveBeenCalledTimes(2);
    expect(sendAlert.mock.calls[1]?.[0].idempotencyKey).not.toBe(
      sendAlert.mock.calls[0]?.[0].idempotencyKey,
    );
  });

  it("stays disabled without the shared latency-alert time-zone opt-in", async () => {
    const fixture = createProgressMonitorFixture([
      progressRow({
        progressOriginAt: "2026-08-10T15:00:00.000Z",
        lane: "system",
        runtimeKey: "runtime_a",
      }),
    ]);
    const sendAlert = vi.fn();

    const result = await runHostedRuntimeProgressAlertMonitor({
      env: {},
      now,
      prisma: fixture.prisma,
      sendAlert,
    });

    expect(result.outcome).toBe("disabled");
    expect(fixture.readState()).toBeNull();
    expect(sendAlert).not.toHaveBeenCalled();
  });
});

describe("hosted runtime progress alert sample observation", () => {
  function observationHarness() {
    const tasks: Array<() => Promise<void>> = [];
    const scheduleObservation = vi.fn((task: () => Promise<void>) => {
      tasks.push(task);
    });
    const writeRuntimeLogs = vi.fn(async (input: {
      entries: readonly HostedRuntimeLogEntry[];
      userId: string;
    }) => input.entries.length);
    return {
      runTasks: async () => {
        for (const task of tasks.splice(0)) await task();
      },
      scheduleObservation,
      writeRuntimeLogs,
    };
  }

  it("binds each sampled lane head to the claimed incident and sampling clock", async () => {
    const fixture = createProgressMonitorFixture([
      progressRow({
        headLaneSeq: 41n,
        lane: "system",
        progressOriginAt: "2026-08-10T15:00:00.000Z",
        runtimeKey: "runtime_private_a",
      }),
      progressRow({
        headLaneSeq: 7n,
        lane: "conversation",
        progressOriginAt: "2026-08-10T15:10:00.000Z",
        runtimeKey: "runtime_private_b",
      }),
      progressRow({
        headLaneSeq: 99n,
        lane: "system",
        progressOriginAt: "2026-08-10T15:59:00.000Z",
        runtimeKey: "runtime_private_fresh",
      }),
    ]);
    const harness = observationHarness();
    const sendAlert = vi.fn(async (_input: AlertSendInput) => {
      void _input;
      expect(harness.writeRuntimeLogs).not.toHaveBeenCalled();
      return { providerMessageId: "provider-message" };
    });

    const result = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      scheduleObservation: harness.scheduleObservation,
      sendAlert,
      writeRuntimeLogs: harness.writeRuntimeLogs,
    });
    await harness.runTasks();

    expect(result.outcome).toBe("alert_sent");
    expect(harness.scheduleObservation).toHaveBeenCalledTimes(1);
    const incidentId = readIncidentId(fixture.readState());
    const writes = harness.writeRuntimeLogs.mock.calls.map(([call]) => call);
    expect(writes.map((write) => write.userId)).toEqual([
      "runtime_private_a",
      "runtime_private_b",
    ]);
    const entries = writes.flatMap((write) => write.entries);
    expect(entries).toEqual([
      expect.objectContaining({ mailboxLane: "system", mailboxSeqEnd: "41", mailboxSeqStart: "41" }),
      expect.objectContaining({ mailboxLane: "conversation", mailboxSeqEnd: "7", mailboxSeqStart: "7" }),
    ]);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        at: now.toISOString(),
        component: "mailbox",
        eventCode: "mailbox.progress_alert_sampled",
        level: "warn",
        phase: "invoke",
        redactedJson: {
          alertIncidentId: incidentId,
          healthCheckedAt: now.toISOString(),
          sampleCount: 2,
          sampleOverflowCount: 0,
          scanTruncated: false,
        },
      });
      expect(Object.keys(entry.redactedJson ?? {}).sort()).toEqual([
        "alertIncidentId", "healthCheckedAt", "sampleCount", "sampleOverflowCount", "scanTruncated",
      ]);
    }
    expect(parseHostedRuntimeLogRequest({ entries }).entries).toHaveLength(2);
    expect(sendAlert.mock.calls[0]?.[0].text).toContain(
      `Checked ${now.toISOString().replace(".000Z", "Z")}.`,
    );
    const exposed = [
      sendAlert.mock.calls[0]?.[0].text ?? "",
      JSON.stringify(fixture.readState()?.detailsJson),
      JSON.stringify(result, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value),
    ].join("\n");
    expect(exposed).not.toContain("runtime_private");
    expect(exposed).not.toMatch(/"(41|7|99)"/u);
    expect(exposed).not.toContain("progress_alert_sampled");
  });

  it("binds the claimed sample clock and head, not the later admission or earlier read", async () => {
    const t0 = instant("2026-08-10T16:00:00.000Z");
    const t1 = instant("2026-08-10T16:00:01.250Z");
    const t2 = instant("2026-08-10T16:00:03.750Z");
    const sampleRow = (headLaneSeq: bigint) => progressRow({
      headLaneSeq,
      lane: "system",
      progressOriginAt: "2026-08-10T15:00:00.000Z",
      runtimeKey: "runtime_private_a",
    });
    const fixture = createProgressMonitorFixture([sampleRow(41n)]);
    fixture.queryRaw
      .mockImplementationOnce(async () => {
        vi.setSystemTime(t1);
        return [sampleRow(41n)];
      })
      .mockImplementationOnce(async () => {
        vi.setSystemTime(t2);
        return [sampleRow(42n)];
      });
    const harness = observationHarness();
    const sendAlert = vi.fn(async (_input: AlertSendInput) => {
      void _input;
      return { providerMessageId: "provider-message" };
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(t0);
      const result = await runHostedRuntimeProgressAlertMonitor({
        env: alertEnv,
        prisma: fixture.prisma,
        scheduleObservation: harness.scheduleObservation,
        sendAlert,
        writeRuntimeLogs: harness.writeRuntimeLogs,
      });
      expect(result.outcome).toBe("alert_sent");
    } finally {
      vi.useRealTimers();
    }
    await harness.runTasks();

    expect(fixture.queryRaw).toHaveBeenCalledTimes(2);
    const entries = harness.writeRuntimeLogs.mock.calls.flatMap(([call]) => call.entries);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      at: t2.toISOString(),
      mailboxSeqStart: "42",
      redactedJson: {
        alertIncidentId: readIncidentId(fixture.readState()),
        healthCheckedAt: t1.toISOString(),
      },
    });
    expect(sendAlert.mock.calls[0]?.[0].text).toContain(`Checked ${t2.toISOString()}.`);
  });

  it("records a new incident and sample for a reminder", async () => {
    const fixture = createProgressMonitorFixture([
      progressRow({ headLaneSeq: 5n, progressOriginAt: "2026-08-10T15:00:00.000Z", lane: "system", runtimeKey: "runtime_a" }),
    ]);
    const harness = observationHarness();
    const sendAlert = vi.fn(async (_input: AlertSendInput) => {
      void _input;
      return { providerMessageId: "provider-message" };
    });
    const options = {
      env: alertEnv,
      prisma: fixture.prisma,
      scheduleObservation: harness.scheduleObservation,
      sendAlert,
      writeRuntimeLogs: harness.writeRuntimeLogs,
    };

    await runHostedRuntimeProgressAlertMonitor({ ...options, now });
    const alertIncidentId = readIncidentId(fixture.readState());
    fixture.setRows([
      progressRow({ headLaneSeq: 6n, progressOriginAt: "2026-08-10T21:00:00.000Z", lane: "system", runtimeKey: "runtime_a" }),
    ]);
    const reminderAt = instant("2026-08-10T22:15:00.000Z");
    const reminded = await runHostedRuntimeProgressAlertMonitor({ ...options, now: reminderAt });
    await harness.runTasks();

    expect(reminded.outcome).toBe("alert_sent");
    expect(sendAlert.mock.calls[1]?.[0].text).toMatch(/^Murph runtime progress reminder\./u);
    const reminderIncidentId = readIncidentId(fixture.readState());
    expect(reminderIncidentId).not.toBe(alertIncidentId);
    const entries = harness.writeRuntimeLogs.mock.calls.flatMap(([call]) => call.entries);
    expect(entries.map((entry) => [entry.at, entry.mailboxSeqStart, entry.redactedJson?.alertIncidentId]))
      .toEqual([
        [now.toISOString(), "5", alertIncidentId],
        [reminderAt.toISOString(), "6", reminderIncidentId],
      ]);
  });

  it("drops the observation when the default after() scheduler cannot schedule", async () => {
    const fixture = createProgressMonitorFixture([
      progressRow({ progressOriginAt: "2026-08-10T15:00:00.000Z", lane: "system", runtimeKey: "runtime_a" }),
    ]);
    const harness = observationHarness();

    const result = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendAlert: async () => ({ providerMessageId: "provider-message" }),
      writeRuntimeLogs: harness.writeRuntimeLogs,
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.outcome).toBe("alert_sent");
    expect(harness.writeRuntimeLogs).not.toHaveBeenCalled();
  });

  it("caps samples oldest-first and reports the overflow", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => progressRow({
      headLaneSeq: BigInt(index + 1),
      lane: "system",
      progressOriginAt: new Date(now.getTime() - (60 - index) * 60_000).toISOString(),
      runtimeKey: `runtime_${String(index).padStart(2, "0")}`,
    }));
    const fixture = createProgressMonitorFixture(rows);
    const harness = observationHarness();

    await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      scheduleObservation: harness.scheduleObservation,
      sendAlert: async () => ({ providerMessageId: "provider-message" }),
      writeRuntimeLogs: harness.writeRuntimeLogs,
    });
    await harness.runTasks();

    const entries = harness.writeRuntimeLogs.mock.calls.flatMap(([call]) => call.entries);
    expect(entries).toHaveLength(HOSTED_RUNTIME_PROGRESS_ALERT_SAMPLE_LIMIT);
    expect(entries.map((entry) => entry.mailboxSeqStart)).toEqual(
      Array.from({ length: 20 }, (_, index) => String(index + 1)),
    );
    expect(entries[0]?.redactedJson).toMatchObject({ sampleCount: 20, sampleOverflowCount: 5 });
  });

  it("schedules nothing for healthy, coalesced, or lost-claim evaluations", async () => {
    const healthy = createProgressMonitorFixture([]);
    const harness = observationHarness();
    const options = {
      env: alertEnv,
      scheduleObservation: harness.scheduleObservation,
      sendAlert: async () => ({ providerMessageId: "provider-message" }),
      writeRuntimeLogs: harness.writeRuntimeLogs,
    };
    expect((await runHostedRuntimeProgressAlertMonitor({
      ...options, now, prisma: healthy.prisma,
    })).outcome).toBe("healthy");

    const active = createProgressMonitorFixture([
      progressRow({ progressOriginAt: "2026-08-10T15:00:00.000Z", lane: "system", runtimeKey: "runtime_a" }),
    ]);
    await runHostedRuntimeProgressAlertMonitor({ ...options, now, prisma: active.prisma });
    expect((await runHostedRuntimeProgressAlertMonitor({
      ...options, now: instant("2026-08-10T16:05:00.000Z"), prisma: active.prisma,
    })).outcome).toBe("incident_active");
    expect(harness.scheduleObservation).toHaveBeenCalledTimes(1);

    const lost = createProgressMonitorFixture([
      progressRow({ progressOriginAt: "2026-08-10T15:00:00.000Z", lane: "system", runtimeKey: "runtime_b" }),
    ]);
    const prisma = lost.prisma as unknown as {
      hostedLinqAlert: { updateMany: ReturnType<typeof vi.fn> };
    };
    prisma.hostedLinqAlert.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await runHostedRuntimeProgressAlertMonitor({
      ...options, now, prisma: lost.prisma,
    })).outcome).toBe("coalesced");
    expect(harness.scheduleObservation).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed attempt's sample and never rebinds a retried message", async () => {
    const fixture = createProgressMonitorFixture([
      progressRow({ headLaneSeq: 5n, progressOriginAt: "2026-08-10T15:00:00.000Z", lane: "system", runtimeKey: "runtime_a" }),
    ]);
    const harness = observationHarness();
    const sendAlert = vi.fn(async (_input: AlertSendInput) => {
      void _input;
      return { providerMessageId: "provider-message" };
    }).mockRejectedValueOnce(new HostedResendPlainTextEmailError(
      "Hosted Resend email send failed.",
      { code: "RESEND_SEND_FAILED", providerStatus: 503 },
    ));
    const options = {
      env: alertEnv,
      prisma: fixture.prisma,
      scheduleObservation: harness.scheduleObservation,
      sendAlert,
      writeRuntimeLogs: harness.writeRuntimeLogs,
    };

    await expect(runHostedRuntimeProgressAlertMonitor({ ...options, now })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_PROGRESS_ALERT_SEND_FAILED",
    });
    fixture.setRows([
      progressRow({ headLaneSeq: 6n, progressOriginAt: "2026-08-10T15:30:00.000Z", lane: "system", runtimeKey: "runtime_a" }),
    ]);
    const retried = await runHostedRuntimeProgressAlertMonitor({
      ...options, now: instant("2026-08-10T16:20:00.000Z"),
    });
    await harness.runTasks();

    expect(retried.outcome).toBe("alert_sent");
    expect(sendAlert.mock.calls[1]?.[0].text).toBe(sendAlert.mock.calls[0]?.[0].text);
    expect(harness.scheduleObservation).toHaveBeenCalledTimes(1);
    const entries = harness.writeRuntimeLogs.mock.calls.flatMap(([call]) => call.entries);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      at: now.toISOString(),
      mailboxSeqStart: "5",
      redactedJson: { healthCheckedAt: now.toISOString() },
    });
  });

  it("delivers regardless of observation scheduling, write failure, or a hung write", async () => {
    const rows = [
      progressRow({ progressOriginAt: "2026-08-10T15:00:00.000Z", lane: "system", runtimeKey: "runtime_a" }),
      progressRow({ progressOriginAt: "2026-08-10T15:01:00.000Z", lane: "system", runtimeKey: "runtime_b" }),
    ];
    const throwingSchedule = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now,
      prisma: createProgressMonitorFixture(rows).prisma,
      scheduleObservation: () => {
        throw new Error("scheduler unavailable");
      },
      sendAlert: async () => ({ providerMessageId: "provider-message" }),
    });
    expect(throwingSchedule.outcome).toBe("alert_sent");

    const harness = observationHarness();
    const hung = createVoidDeferred();
    harness.writeRuntimeLogs
      .mockRejectedValueOnce(new Error("runtime log unavailable"))
      .mockImplementationOnce(async () => {
        await hung.promise;
        return 1;
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sent = await runHostedRuntimeProgressAlertMonitor({
      env: alertEnv,
      now,
      prisma: createProgressMonitorFixture(rows).prisma,
      scheduleObservation: harness.scheduleObservation,
      sendAlert: async () => ({ providerMessageId: "provider-message" }),
      writeRuntimeLogs: harness.writeRuntimeLogs,
    });
    expect(sent.outcome).toBe("alert_sent");
    const pending = harness.runTasks();
    await vi.waitFor(() => expect(harness.writeRuntimeLogs).toHaveBeenCalledTimes(2));
    hung.resolve();
    await pending;
    expect(warn).toHaveBeenCalledWith(
      "Hosted runtime progress alert observation write failed.",
      { errorName: "Error" },
    );
    warn.mockRestore();
  });
});

function progressRow(input: {
  chronologyInvalid?: boolean;
  durableHighWaterSeq?: bigint;
  effectiveConsumedSeq?: bigint;
  headKind?: string;
  headLaneSeq?: bigint;
  progressOriginAt: string;
  lane: string;
  nextDefaultProcessingWakeAt?: Date | null;
  nextDefaultProcessingWakeReason?: string | null;
  nextWakeAt?: Date | null;
  nextWakeReason?: string | null;
  pendingCount?: bigint;
  runtimeKey: string;
  systemMailboxProgressGeneration?: bigint | null;
  usageBlocked?: boolean;
  workspaceCheckpointedAt?: Date | null;
  workspaceSystemImportedSeq?: bigint | null;
}): HostedRuntimeProgressHealthRow {
  return {
    foregroundCheckpointEvidence: null,
    checkpointEvidence: null,
    deliveryAcceptedAt: null,
    chronologyInvalid: input.chronologyInvalid ?? false,
    agedHighWaterSeq: input.durableHighWaterSeq ?? 1n,
    durableHighWaterSeq: input.durableHighWaterSeq ?? 1n,
    effectiveConsumedSeq: input.effectiveConsumedSeq ?? 0n,
    headKind: input.headKind ?? "test.pending-work",
    headLaneSeq: input.headLaneSeq ?? 1n,
    progressOriginAt: instant(input.progressOriginAt),
    lane: input.lane,
    nextDefaultProcessingWakeAt:
      input.nextDefaultProcessingWakeAt ?? null,
    nextDefaultProcessingWakeReason:
      input.nextDefaultProcessingWakeReason ?? null,
    nextWakeAt: input.nextWakeAt ?? null,
    nextWakeReason: input.nextWakeReason ?? null,
    pendingCount: input.pendingCount ?? 1n,
    runtimeKey: input.runtimeKey,
    systemMailboxProgressGeneration:
      input.systemMailboxProgressGeneration ?? null,
    usageBlocked: input.usageBlocked ?? false,
    workspaceCheckpointedAt: input.workspaceCheckpointedAt ?? null,
    workspaceSystemImportedSeq:
      input.workspaceSystemImportedSeq === undefined
        ? 1n
        : input.workspaceSystemImportedSeq,
  };
}

function stalledDeviceSyncRow(
  runtimeKey: string,
  overrides: Omit<Partial<HostedRuntimeProgressHealthRow>, "progressOriginAt"> & {
    progressOriginAt?: string;
  } = {},
): HostedRuntimeProgressHealthRow {
  return progressRow({
    headKind: overrides.headKind ?? "device-sync.wake",
    lane: overrides.lane ?? "system",
    nextDefaultProcessingWakeAt:
      overrides.nextDefaultProcessingWakeAt ?? null,
    nextDefaultProcessingWakeReason:
      overrides.nextDefaultProcessingWakeReason ?? null,
    nextWakeAt: overrides.nextWakeAt === undefined
      ? instant("2026-08-10T15:00:00.000Z")
      : overrides.nextWakeAt,
    nextWakeReason: overrides.nextWakeReason ?? "device-sync.reconcile",
    pendingCount: overrides.pendingCount,
    progressOriginAt:
      overrides.progressOriginAt ?? "2026-08-10T15:00:00.000Z",
    runtimeKey,
    systemMailboxProgressGeneration:
      overrides.systemMailboxProgressGeneration ?? null,
    workspaceCheckpointedAt: overrides.workspaceCheckpointedAt === undefined
      ? instant("2026-08-10T15:05:00.000Z")
      : overrides.workspaceCheckpointedAt,
  });
}

function createProgressMonitorFixture(
  initialRows: readonly HostedRuntimeProgressHealthRow[],
) {
  let rows = [...initialRows];
  let state: HostedLinqAlert | null = null;
  const queryRaw = vi.fn(async (query: unknown) => {
    void query;
    return rows;
  });
  const hostedMemberFindMany = vi.fn(async () =>
    [...new Set(rows.map((row) => row.runtimeKey))].map((id) => ({
      accountGroupMemberships: [],
      billingRef: null,
      billingStatus: "active",
      consentGrants: [],
      id,
      suspendedAt: null,
      threadContainer: null,
    }))
  );
  const hostedThreadContainerParticipantFindMany = vi.fn(async () => []);
  const alertUpsert = vi.fn(async (args: AlertUpsertArgs) => {
    if (!state) {
      state = {
        attemptCount: 0,
        claimedAt: args.create.claimedAt,
        createdAt: args.create.claimedAt,
        deliveryId: null,
        detailsJson: args.create.detailsJson,
        eventId: null,
        id: args.create.id,
        kind: args.create.kind,
        lastAttemptedAt: null,
        lastErrorCode: null,
        lastProviderStatus: null,
        phoneNumberHint: null,
        phoneNumberLookupKey: null,
        providerMessageId: null,
        sentAt: null,
        status: args.create.status,
        subject: args.create.subject,
        updatedAt: args.create.claimedAt,
      };
    }
    return { ...state };
  });
  const alertUpdateMany = vi.fn(async (args: AlertUpdateManyArgs) => {
    if (!state || !matchesAlertWhere(state, args.where)) {
      return { count: 0 };
    }
    state = applyAlertUpdate(state, args.data);
    return { count: 1 };
  });

  return {
    hostedMemberFindMany,
    prisma: {
      $queryRaw: queryRaw,
      hostedLinqAlert: {
        updateMany: alertUpdateMany,
        upsert: alertUpsert,
      },
      hostedMember: {
        findMany: hostedMemberFindMany,
      },
      hostedThreadContainerParticipant: {
        findMany: hostedThreadContainerParticipantFindMany,
      },
    } as never,
    queryRaw,
    readState: () => state,
    setRows(nextRows: readonly HostedRuntimeProgressHealthRow[]) {
      rows = [...nextRows];
    },
    setState(nextState: HostedLinqAlert) {
      state = nextState;
    },
  };
}

function readIncidentId(state: HostedLinqAlert | null): string {
  const details = state?.detailsJson;
  if (
    !details
    || typeof details !== "object"
    || Array.isArray(details)
    || typeof details.incidentId !== "string"
  ) {
    throw new TypeError("Expected an incident identity.");
  }
  return details.incidentId;
}

type AlertSendInput = Parameters<typeof sendHostedResendPlainTextEmail>[0];

interface AlertUpsertArgs {
  create: {
    claimedAt: Date;
    detailsJson: HostedLinqAlert["detailsJson"];
    id: string;
    kind: string;
    status: string;
    subject: string;
  };
}

interface AlertUpdateManyArgs {
  data: {
    attemptCount?: { increment: number };
    claimedAt?: Date;
    detailsJson?: HostedLinqAlert["detailsJson"];
    lastAttemptedAt?: Date | null;
    lastErrorCode?: string | null;
    lastProviderStatus?: number | null;
    providerMessageId?: string | null;
    sentAt?: Date;
    status?: string;
  };
  where: {
    id: string;
    lastAttemptedAt?: Date | null;
    status?: string;
    updatedAt?: Date;
  };
}

function matchesAlertWhere(
  state: HostedLinqAlert,
  where: AlertUpdateManyArgs["where"],
): boolean {
  if (state.id !== where.id || (where.status && state.status !== where.status)) {
    return false;
  }
  if (where.lastAttemptedAt === undefined) {
    return where.updatedAt === undefined
      || state.updatedAt.getTime() === where.updatedAt.getTime();
  }
  return state.lastAttemptedAt?.getTime() === where.lastAttemptedAt?.getTime()
    && (
      where.updatedAt === undefined
      || state.updatedAt.getTime() === where.updatedAt.getTime()
    );
}

function applyAlertUpdate(
  state: HostedLinqAlert,
  data: AlertUpdateManyArgs["data"],
): HostedLinqAlert {
  const requestedUpdatedAt = data.claimedAt ?? data.sentAt;
  return {
    ...state,
    attemptCount: state.attemptCount + (data.attemptCount?.increment ?? 0),
    claimedAt: data.claimedAt ?? state.claimedAt,
    detailsJson: data.detailsJson ?? state.detailsJson,
    lastAttemptedAt: data.lastAttemptedAt === undefined
      ? state.lastAttemptedAt
      : data.lastAttemptedAt,
    lastErrorCode: data.lastErrorCode === undefined
      ? state.lastErrorCode
      : data.lastErrorCode,
    lastProviderStatus: data.lastProviderStatus === undefined
      ? state.lastProviderStatus
      : data.lastProviderStatus,
    providerMessageId: data.providerMessageId === undefined
      ? state.providerMessageId
      : data.providerMessageId,
    sentAt: data.sentAt ?? state.sentAt,
    status: data.status ?? state.status,
    updatedAt: new Date(Math.max(
      state.updatedAt.getTime() + 1,
      requestedUpdatedAt?.getTime() ?? Number.NEGATIVE_INFINITY,
    )),
  };
}

function instant(value: string): Date {
  return new Date(value);
}
