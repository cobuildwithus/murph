import type { HostedLinqAlert } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { sendHostedResendPlainTextEmail } from "@/src/lib/hosted-onboarding/resend-plain-text-email";
import {
  HOSTED_RUNTIME_PROGRESS_STALL_THRESHOLD_MS,
  readHostedRuntimeProgressHealth,
  runHostedRuntimeProgressAlertMonitor,
  summarizeHostedRuntimeProgressRows,
  type HostedRuntimeProgressHealthRow,
} from "@/src/lib/hosted-runtime-progress/alert-monitor";

const now = instant("2026-08-10T16:00:00.000Z");
const alertEnv = {
  HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph Alerts <alerts@example.test>",
  HOSTED_LINQ_ALERT_EMAILS: "operator@example.test",
  HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE: "America/Los_Angeles",
  RESEND_API_KEY: "re_test",
};

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
          lane: "system",
          pendingCount: 3n,
          runtimeKey: "runtime_a",
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
        lane: "system",
        pendingCount: 7n,
        runtimeKey: "runtime_private_a",
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
    expect(message).not.toContain("runtime_private_a");
    expect(message).not.toContain("runtime_private_b");
    expect(persisted).not.toContain("runtime_private_a");
    expect(persisted).not.toContain("runtime_private_b");
    expect(fixture.readState()).toMatchObject({
      kind: "hosted_runtime_progress_monitor",
      status: "progress_alerting",
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

function progressRow(input: {
  chronologyInvalid?: boolean;
  progressOriginAt: string;
  lane: string;
  pendingCount?: bigint;
  runtimeKey: string;
  usageBlocked?: boolean;
}): HostedRuntimeProgressHealthRow {
  return {
    chronologyInvalid: input.chronologyInvalid ?? false,
    progressOriginAt: instant(input.progressOriginAt),
    lane: input.lane,
    pendingCount: input.pendingCount ?? 1n,
    runtimeKey: input.runtimeKey,
    usageBlocked: input.usageBlocked ?? false,
  };
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
  };
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
