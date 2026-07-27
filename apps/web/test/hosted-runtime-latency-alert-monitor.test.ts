import type { HostedLinqAlert } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_REPLY_LATENCY_ALERT_THRESHOLD_MS,
  runHostedRuntimeLatencyAlertMonitor,
  summarizeHostedRuntimeLatencyRows,
  type HostedRuntimeLatencyHealthRow,
} from "@/src/lib/hosted-runtime-latency/alert-monitor";

const now = instant("2026-07-26T16:00:00.000Z");
const alertEnv = {
  HOSTED_RUNTIME_LATENCY_ALERT_LINQ_CHAT_ID: "opaque-alert-chat",
};

describe("hosted runtime latency health", () => {
  it("classifies the exact 30-second reply and unresolved boundaries", () => {
    const health = summarizeHostedRuntimeLatencyRows({
      now,
      rows: [
        latencyRow({
          acceptedAt: "2026-07-26T15:59:00.000Z",
          deliveryAcceptedAt: "2026-07-26T15:59:29.999Z",
        }),
        latencyRow({
          acceptedAt: "2026-07-26T15:58:00.000Z",
          deliveryAcceptedAt: "2026-07-26T15:58:30.000Z",
        }),
        latencyRow({
          acceptedAt: "2026-07-26T15:59:30.000Z",
        }),
        latencyRow({
          acceptedAt: "2026-07-26T15:59:20.000Z",
          consumedAt: "2026-07-26T15:59:50.000Z",
        }),
        latencyRow({
          acceptedAt: "2026-07-26T15:49:00.000Z",
          deliveryAcceptedAt: "2026-07-26T15:49:30.000Z",
        }),
      ],
    });

    expect(HOSTED_RUNTIME_REPLY_LATENCY_ALERT_THRESHOLD_MS).toBe(30_000);
    expect(health).toMatchObject({
      anomalous: true,
      maxCompletedReplyLatencyMs: 30_000,
      oldestUnresolvedAgeMs: 30_000,
      recentCompletedReplyCount: 2,
      recentSlowReplyCount: 1,
      unresolvedReplyCount: 1,
    });
  });

  it("does not treat a consumed trace with a missing delivery link as unresolved", () => {
    const health = summarizeHostedRuntimeLatencyRows({
      now,
      rows: [
        latencyRow({
          acceptedAt: "2026-07-26T15:00:00.000Z",
          consumedAt: "2026-07-26T15:00:09.000Z",
        }),
      ],
    });

    expect(health.anomalous).toBe(false);
    expect(health.unresolvedReplyCount).toBe(0);
  });

  it("fails the health scan safe when its bounded trace read is truncated", () => {
    const health = summarizeHostedRuntimeLatencyRows({
      now,
      rows: [],
      scanTruncated: true,
    });

    expect(health.anomalous).toBe(true);
    expect(health.scanTruncated).toBe(true);
  });

  it("excludes impossible delivery chronology from completed reply evidence", () => {
    const health = summarizeHostedRuntimeLatencyRows({
      now,
      rows: [
        latencyRow({
          acceptedAt: "2026-07-26T15:59:30.000Z",
          deliveryAcceptedAt: "2026-07-26T15:59:29.000Z",
        }),
      ],
    });

    expect(health.anomalous).toBe(false);
    expect(health.invalidChronologyCount).toBe(1);
    expect(health.recentCompletedReplyCount).toBe(0);
  });
});

describe("hosted runtime latency alert monitor", () => {
  it("opens one PII-free Linq incident and coalesces the next anomalous scan", async () => {
    const fixture = createMonitorPrismaFixture([
      latencyRow({
        acceptedAt: "2026-07-26T15:58:00.000Z",
        deliveryAcceptedAt: "2026-07-26T15:59:00.000Z",
      }),
    ]);
    const sendLinqMessage = vi.fn(async (input: LinqSendInput) => {
      void input;
      return {
        chatId: "opaque-alert-chat",
        messageId: "provider-message-1",
      };
    });

    const opened = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    const repeated = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:01:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });

    expect(opened.outcome).toBe("alert_sent");
    expect(repeated.outcome).toBe("incident_active");
    expect(sendLinqMessage).toHaveBeenCalledTimes(1);
    expect(sendLinqMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "opaque-alert-chat",
      idempotencyKey: expect.stringMatching(
        /^murph\/runtime-latency\/[0-9a-f-]+\/alert$/u,
      ),
      message: expect.stringContaining("1 completed reply at or above 30 seconds"),
    }));
    const sentMessage = sendLinqMessage.mock.calls[0]?.[0].message;
    expect(sentMessage).not.toContain("opaque-alert-chat");
    expect(sentMessage).not.toContain("provider-message-1");
  });

  it("retries a failed alert with the same provider idempotency key", async () => {
    const fixture = createMonitorPrismaFixture([
      latencyRow({
        acceptedAt: "2026-07-26T15:58:00.000Z",
      }),
    ]);
    const sendLinqMessage = vi.fn(async (input: LinqSendInput) => {
      void input;
      return {
        chatId: "opaque-alert-chat",
        messageId: "provider-message-2",
      };
    })
      .mockRejectedValueOnce(new Error("private provider detail"))
      .mockResolvedValueOnce({
        chatId: "opaque-alert-chat",
        messageId: "provider-message-2",
      });

    await expect(runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendLinqMessage,
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_LATENCY_ALERT_SEND_FAILED",
    });
    fixture.setRows([]);
    const retried = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:05:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });

    expect(retried.outcome).toBe("alert_sent");
    expect(sendLinqMessage).toHaveBeenCalledTimes(2);
    expect(sendLinqMessage.mock.calls[0]?.[0].idempotencyKey).toBe(
      sendLinqMessage.mock.calls[1]?.[0].idempotencyKey,
    );
    expect(sendLinqMessage.mock.calls[0]?.[0].message).toBe(
      sendLinqMessage.mock.calls[1]?.[0].message,
    );
    expect(sendLinqMessage.mock.calls[1]?.[0].message).toContain(
      "1 traced message still unresolved after 30 seconds",
    );
    expect(fixture.readState()?.lastErrorCode).toBeNull();
    expect(fixture.readState()?.status).toBe("latency_alerting");
  });

  it("silently clears an incident and alerts again on a later recurrence", async () => {
    const fixture = createMonitorPrismaFixture([
      latencyRow({
        acceptedAt: "2026-07-26T15:58:00.000Z",
      }),
    ]);
    const sendLinqMessage = vi.fn(async (input: LinqSendInput) => {
      void input;
      return {
        chatId: "opaque-alert-chat",
        messageId: "provider-message",
      };
    });

    await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    fixture.setRows([]);
    const cleared = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:05:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    fixture.setRows([
      latencyRow({
        acceptedAt: "2026-07-26T16:08:00.000Z",
      }),
    ]);
    const recurred = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:10:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    const healthy = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:11:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });

    expect(cleared.outcome).toBe("healthy");
    expect(recurred.outcome).toBe("alert_sent");
    expect(healthy.outcome).toBe("incident_active");
    expect(sendLinqMessage).toHaveBeenCalledTimes(2);
    expect(sendLinqMessage.mock.calls[1]?.[0].idempotencyKey).not.toBe(
      sendLinqMessage.mock.calls[0]?.[0].idempotencyKey,
    );
  });

  it("does not create alert state or send when no dedicated chat is configured", async () => {
    const fixture = createMonitorPrismaFixture([
      latencyRow({
        acceptedAt: "2026-07-26T15:58:00.000Z",
      }),
    ]);
    const sendLinqMessage = vi.fn(async (input: LinqSendInput) => {
      void input;
      return {
        chatId: null,
        messageId: null,
      };
    });

    const result = await runHostedRuntimeLatencyAlertMonitor({
      env: {},
      now,
      prisma: fixture.prisma,
      sendLinqMessage,
    });

    expect(result.outcome).toBe("disabled");
    expect(result.health.anomalous).toBe(true);
    expect(fixture.alertUpsert).not.toHaveBeenCalled();
    expect(sendLinqMessage).not.toHaveBeenCalled();
  });

  it("does not send when a concurrent cron already won the incident claim", async () => {
    const fixture = createMonitorPrismaFixture(
      [
        latencyRow({
          acceptedAt: "2026-07-26T15:58:00.000Z",
        }),
      ],
      { rejectNextClaim: true },
    );
    const sendLinqMessage = vi.fn(async (input: LinqSendInput) => {
      void input;
      return {
        chatId: null,
        messageId: null,
      };
    });

    const result = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendLinqMessage,
    });

    expect(result.outcome).toBe("coalesced");
    expect(sendLinqMessage).not.toHaveBeenCalled();
  });

  it("coalesces a live send lease and reclaims it at the exact expiry", async () => {
    const fixture = createMonitorPrismaFixture([
      latencyRow({
        acceptedAt: "2026-07-26T15:58:00.000Z",
      }),
    ]);
    let releaseFirstSend = () => {};
    const firstSendBlocked = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });
    let sendOrdinal = 0;
    const sendLinqMessage = vi.fn(async (input: LinqSendInput) => {
      void input;
      sendOrdinal += 1;
      if (sendOrdinal === 1) {
        await firstSendBlocked;
      }
      return {
        chatId: "opaque-alert-chat",
        messageId: `provider-message-${sendOrdinal}`,
      };
    });

    const first = runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    await vi.waitFor(() => {
      expect(sendLinqMessage).toHaveBeenCalledTimes(1);
    });

    const overlapping = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:01:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    const expired = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:04:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    releaseFirstSend();
    await expect(first).resolves.toMatchObject({
      outcome: "alert_sent",
    });

    expect(overlapping.outcome).toBe("coalesced");
    expect(expired.outcome).toBe("alert_sent");
    expect(sendLinqMessage).toHaveBeenCalledTimes(2);
    expect(sendLinqMessage.mock.calls[1]?.[0].idempotencyKey).toBe(
      sendLinqMessage.mock.calls[0]?.[0].idempotencyKey,
    );
    expect(sendLinqMessage.mock.calls[1]?.[0].message).toBe(
      sendLinqMessage.mock.calls[0]?.[0].message,
    );
  });
});

function latencyRow(input: {
  acceptedAt: string;
  consumedAt?: string | null;
  deliveryAcceptedAt?: string | null;
}): HostedRuntimeLatencyHealthRow {
  return {
    acceptedAt: instant(input.acceptedAt),
    consumedAt: input.consumedAt ? instant(input.consumedAt) : null,
    deliveryAcceptedAt: input.deliveryAcceptedAt
      ? instant(input.deliveryAcceptedAt)
      : null,
  };
}

function createMonitorPrismaFixture(
  initialRows: readonly HostedRuntimeLatencyHealthRow[],
  options: { rejectNextClaim?: boolean } = {},
) {
  let rows = [...initialRows];
  let state: HostedLinqAlert | null = null;
  let rejectNextClaim = options.rejectNextClaim === true;

  const traceFindMany = vi.fn(async () => rows.map((row) => ({
    acceptedAt: row.acceptedAt,
    linqDelivery: row.deliveryAcceptedAt
      ? { acceptedAt: row.deliveryAcceptedAt }
      : null,
    mailboxItem: {
      consumedAt: row.consumedAt,
    },
  })));
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
    if (rejectNextClaim && args.data.attemptCount) {
      rejectNextClaim = false;
      return { count: 0 };
    }
    if (!state || !matchesAlertWhere(state, args.where)) {
      return { count: 0 };
    }

    state = applyAlertUpdate(state, args.data);
    return { count: 1 };
  });

  return {
    alertUpsert,
    prisma: {
      hostedIngressLatencyTrace: {
        findMany: traceFindMany,
      },
      hostedLinqAlert: {
        updateMany: alertUpdateMany,
        upsert: alertUpsert,
      },
    } as never,
    readState: () => state,
    setRows(nextRows: readonly HostedRuntimeLatencyHealthRow[]) {
      rows = [...nextRows];
    },
  };
}

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

interface LinqSendInput {
  chatId: string;
  idempotencyKey?: string | null;
  message: string;
  signal?: AbortSignal;
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
    return true;
  }
  return state.lastAttemptedAt?.getTime() === where.lastAttemptedAt?.getTime();
}

function applyAlertUpdate(
  state: HostedLinqAlert,
  data: AlertUpdateManyArgs["data"],
): HostedLinqAlert {
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
    updatedAt: data.claimedAt ?? data.sentAt ?? state.updatedAt,
  };
}

function instant(value: string): Date {
  return new Date(value);
}
