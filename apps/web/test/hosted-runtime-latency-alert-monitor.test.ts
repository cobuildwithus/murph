import type { HostedLinqAlert } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_LATENCY_ALERT_MINIMUM_INTERVAL_MS,
  HOSTED_RUNTIME_REPLY_LATENCY_ALERT_THRESHOLD_MS,
  HOSTED_RUNTIME_TERMINAL_NON_REPLY_CHECKPOINT_GRACE_MS,
  runHostedRuntimeLatencyAlertMonitor,
  summarizeHostedRuntimeLatencyRows,
  type HostedRuntimeLatencyHealthRow,
} from "@/src/lib/hosted-runtime-latency/alert-monitor";

const now = instant("2026-07-26T16:00:00.000Z");
const alertEnv = {
  HOSTED_RUNTIME_LATENCY_ALERT_LINQ_CHAT_ID: "opaque-alert-chat",
  HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE: "America/Los_Angeles",
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

  it("treats an explicit terminal non-reply as resolved before mailbox checkpointing", () => {
    const health = summarizeHostedRuntimeLatencyRows({
      now,
      rows: [
        latencyRow({
          acceptedAt: "2026-07-26T15:58:00.000Z",
          terminalNonReplyCommittedAt: "2026-07-26T15:58:12.000Z",
        }),
      ],
    });

    expect(health).toMatchObject({
      anomalous: false,
      invalidChronologyCount: 0,
      unresolvedReplyCount: 0,
    });
  });

  it("reopens an unconsumed terminal non-reply after checkpoint grace expires", () => {
    const health = summarizeHostedRuntimeLatencyRows({
      now,
      rows: [
        latencyRow({
          acceptedAt: "2026-07-26T15:54:00.000Z",
          terminalNonReplyCommittedAt: "2026-07-26T15:55:00.000Z",
        }),
      ],
    });

    expect(HOSTED_RUNTIME_TERMINAL_NON_REPLY_CHECKPOINT_GRACE_MS).toBe(5 * 60_000);
    expect(health).toMatchObject({
      anomalous: true,
      invalidChronologyCount: 0,
      oldestUnresolvedAgeMs: 6 * 60_000,
      unresolvedReplyCount: 1,
    });
  });

  it("keeps checkpointed terminal non-replies resolved after grace expires", () => {
    const health = summarizeHostedRuntimeLatencyRows({
      now,
      rows: [
        latencyRow({
          acceptedAt: "2026-07-26T15:54:00.000Z",
          consumedAt: "2026-07-26T15:57:30.000Z",
          terminalNonReplyCommittedAt: "2026-07-26T15:55:00.000Z",
        }),
      ],
    });

    expect(health).toMatchObject({
      anomalous: false,
      invalidChronologyCount: 0,
      unresolvedReplyCount: 0,
    });
  });

  it("ignores impossible terminal non-reply chronology and keeps stuck work alertable", () => {
    const health = summarizeHostedRuntimeLatencyRows({
      now,
      rows: [
        latencyRow({
          acceptedAt: "2026-07-26T15:58:00.000Z",
          terminalNonReplyCommittedAt: "2026-07-26T15:57:59.000Z",
        }),
      ],
    });

    expect(health).toMatchObject({
      anomalous: true,
      invalidChronologyCount: 1,
      unresolvedReplyCount: 1,
    });
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
  it("derives terminal non-replies from the stored latency phase breakdown", async () => {
    const fixture = createMonitorPrismaFixture([
      latencyRow({
        acceptedAt: "2026-07-26T15:58:00.000Z",
        terminalNonReplyCommittedAt: "2026-07-26T15:58:05.000Z",
      }),
    ]);

    const result = await runHostedRuntimeLatencyAlertMonitor({
      env: {},
      now,
      prisma: fixture.prisma,
    });

    expect(result).toMatchObject({
      configured: false,
      health: {
        anomalous: false,
        unresolvedReplyCount: 0,
      },
      outcome: "disabled",
    });
  });

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

  it("rate-limits a failed alert before retrying the exact provider effect", async () => {
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
    const deferred = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:05:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    const retried = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:20:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });

    expect(HOSTED_RUNTIME_LATENCY_ALERT_MINIMUM_INTERVAL_MS).toBe(10 * 60_000);
    expect(deferred.outcome).toBe("deferred_rate_limit");
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

  it("paces from whichever durable provider boundary is later", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(instant("2026-07-26T16:00:00.000Z"));
      const fixture = createMonitorPrismaFixture([
        latencyRow({
          acceptedAt: "2026-07-26T15:58:00.000Z",
        }),
      ]);
      let sendOrdinal = 0;
      const sendLinqMessage = vi.fn(async (input: LinqSendInput) => {
        sendOrdinal += 1;
        if (sendOrdinal === 1) {
          vi.setSystemTime(instant("2026-07-26T16:08:00.000Z"));
        } else if (sendOrdinal === 2) {
          throw new Error("private provider detail");
        }
        return {
          chatId: input.chatId,
          messageId: `provider-message-${sendOrdinal}`,
        };
      });

      const opened = await runHostedRuntimeLatencyAlertMonitor({
        env: alertEnv,
        prisma: fixture.prisma,
        sendLinqMessage,
      });
      expect(opened.outcome).toBe("alert_sent");
      expect(fixture.readState()?.lastAttemptedAt).toEqual(
        instant("2026-07-26T16:00:00.000Z"),
      );
      expect(fixture.readState()?.sentAt).toEqual(
        instant("2026-07-26T16:08:00.000Z"),
      );

      fixture.setRows([]);
      vi.setSystemTime(instant("2026-07-26T16:09:00.000Z"));
      const cleared = await runHostedRuntimeLatencyAlertMonitor({
        env: alertEnv,
        prisma: fixture.prisma,
        sendLinqMessage,
      });
      expect(cleared.outcome).toBe("healthy");

      fixture.setRows([
        latencyRow({
          acceptedAt: "2026-07-26T16:10:00.000Z",
        }),
      ]);
      vi.setSystemTime(instant("2026-07-26T16:18:00.000Z"));
      const acceptedBoundaryDeferred =
        await runHostedRuntimeLatencyAlertMonitor({
          env: alertEnv,
          prisma: fixture.prisma,
          sendLinqMessage,
        });

      vi.setSystemTime(instant("2026-07-26T16:28:00.000Z"));
      await expect(runHostedRuntimeLatencyAlertMonitor({
        env: alertEnv,
        prisma: fixture.prisma,
        sendLinqMessage,
      })).rejects.toMatchObject({
        code: "HOSTED_RUNTIME_LATENCY_ALERT_SEND_FAILED",
      });

      vi.setSystemTime(instant("2026-07-26T16:38:00.000Z"));
      const attemptBoundaryDeferred =
        await runHostedRuntimeLatencyAlertMonitor({
          env: alertEnv,
          prisma: fixture.prisma,
          sendLinqMessage,
        });
      vi.setSystemTime(instant("2026-07-26T16:48:00.000Z"));
      const retried = await runHostedRuntimeLatencyAlertMonitor({
        env: alertEnv,
        prisma: fixture.prisma,
        sendLinqMessage,
      });

      expect(acceptedBoundaryDeferred.outcome).toBe("deferred_rate_limit");
      expect(attemptBoundaryDeferred.outcome).toBe("deferred_rate_limit");
      expect(retried.outcome).toBe("alert_sent");
      expect(sendLinqMessage).toHaveBeenCalledTimes(3);
      expect(sendLinqMessage.mock.calls[2]?.[0].idempotencyKey).toBe(
        sendLinqMessage.mock.calls[1]?.[0].idempotencyKey,
      );
      expect(sendLinqMessage.mock.calls[2]?.[0].message).toBe(
        sendLinqMessage.mock.calls[1]?.[0].message,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a failed incident that recovers instead of paging stale evidence", async () => {
    const fixture = createMonitorPrismaFixture([
      latencyRow({
        acceptedAt: "2026-07-26T15:58:00.000Z",
      }),
    ]);
    const sendLinqMessage = vi.fn(async () => {
      throw new Error("private provider detail");
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
    const cleared = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:05:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    const stayedHealthy = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:20:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });

    expect(cleared.outcome).toBe("healthy");
    expect(stayedHealthy.outcome).toBe("healthy");
    expect(sendLinqMessage).toHaveBeenCalledTimes(1);
    expect(fixture.readState()?.status).toBe("latency_healthy");
  });

  it("does not pace a recurrence after recovery cancels provider admission", async () => {
    const anomalousRows = [
      latencyRow({
        acceptedAt: "2026-07-26T15:58:00.000Z",
      }),
    ];
    const fixture = createMonitorPrismaFixture(anomalousRows);
    fixture.queueRowsForReads(anomalousRows, []);
    const sendLinqMessage = vi.fn(async (input: LinqSendInput) => ({
      chatId: input.chatId,
      messageId: "provider-message",
    }));

    const recovered = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendLinqMessage,
    });

    expect(recovered.outcome).toBe("healthy");
    expect(recovered.health.anomalous).toBe(false);
    expect(sendLinqMessage).not.toHaveBeenCalled();
    expect(fixture.readState()?.status).toBe("latency_healthy");
    expect(fixture.readState()?.attemptCount).toBe(0);
    expect(fixture.readState()?.lastAttemptedAt).toBeNull();

    fixture.setRows([
      latencyRow({
        acceptedAt: "2026-07-26T16:04:00.000Z",
      }),
    ]);
    const recurred = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:05:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });

    expect(recurred.outcome).toBe("alert_sent");
    expect(sendLinqMessage).toHaveBeenCalledTimes(1);
    expect(fixture.readState()?.attemptCount).toBe(1);
  });

  it("coalesces recovery when a concurrent incident cycles back to healthy", async () => {
    const anomalousRows = [
      latencyRow({
        acceptedAt: "2026-07-26T15:58:00.000Z",
      }),
    ];
    const fixture = createMonitorPrismaFixture(anomalousRows);
    fixture.queueRowsForReads(anomalousRows, []);
    fixture.queueTraceReadEffects(
      () => {},
      () => {
        fixture.recordConcurrentHealthyCycle({
          attemptedAt: instant("2026-07-26T15:59:00.000Z"),
          sentAt: instant("2026-07-26T15:59:10.000Z"),
        });
      },
    );
    const sendLinqMessage = vi.fn(async (input: LinqSendInput) => ({
      chatId: input.chatId,
      messageId: "provider-message",
    }));

    const recovered = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendLinqMessage,
    });

    expect(recovered.outcome).toBe("coalesced");
    expect(sendLinqMessage).not.toHaveBeenCalled();
    expect(fixture.readState()?.status).toBe("latency_healthy");
    expect(fixture.readState()?.attemptCount).toBe(1);
  });

  it("does not admit a stale healthy candidate after a concurrent incident", async () => {
    const anomalousRows = [
      latencyRow({
        acceptedAt: "2026-07-26T15:58:00.000Z",
      }),
    ];
    const fixture = createMonitorPrismaFixture(anomalousRows);
    fixture.queueRowsForReads(anomalousRows, anomalousRows);
    fixture.queueTraceReadEffects(
      () => {},
      () => {
        fixture.recordConcurrentHealthyCycle({
          attemptedAt: instant("2026-07-26T15:59:00.000Z"),
          sentAt: instant("2026-07-26T15:59:10.000Z"),
        });
      },
    );
    const sendLinqMessage = vi.fn(async (input: LinqSendInput) => ({
      chatId: input.chatId,
      messageId: "provider-message",
    }));

    const stale = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendLinqMessage,
    });

    expect(stale.outcome).toBe("coalesced");
    expect(sendLinqMessage).not.toHaveBeenCalled();
    expect(fixture.readState()?.lastAttemptedAt).toEqual(
      instant("2026-07-26T15:59:00.000Z"),
    );
    expect(fixture.readState()?.attemptCount).toBe(1);
  });

  it("coalesces healthy recovery until an admitted provider effect settles", async () => {
    const fixture = createMonitorPrismaFixture([
      latencyRow({
        acceptedAt: "2026-07-26T15:58:00.000Z",
      }),
    ]);
    let releaseSend = () => {};
    const sendBlocked = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const sendLinqMessage = vi.fn(async (input: LinqSendInput) => {
      await sendBlocked;
      return {
        chatId: input.chatId,
        messageId: "provider-message",
      };
    });

    const sending = runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now,
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    await vi.waitFor(() => {
      expect(sendLinqMessage).toHaveBeenCalledTimes(1);
    });

    fixture.setRows([]);
    const recovered = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:01:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    expect(recovered.outcome).toBe("coalesced");
    expect(fixture.readState()?.status).toBe("latency_alert_sending");

    releaseSend();
    await expect(sending).resolves.toMatchObject({
      outcome: "alert_sent",
    });
    const stayedHealthy = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:02:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });

    expect(stayedHealthy.outcome).toBe("healthy");
    expect(fixture.readState()?.status).toBe("latency_healthy");
    expect(sendLinqMessage).toHaveBeenCalledTimes(1);
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
    const deferred = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:10:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    const recurred = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:20:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    const active = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:21:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });

    expect(cleared.outcome).toBe("healthy");
    expect(deferred.outcome).toBe("deferred_rate_limit");
    expect(recurred.outcome).toBe("alert_sent");
    expect(active.outcome).toBe("incident_active");
    expect(sendLinqMessage).toHaveBeenCalledTimes(2);
    expect(sendLinqMessage.mock.calls[1]?.[0].idempotencyKey).not.toBe(
      sendLinqMessage.mock.calls[0]?.[0].idempotencyKey,
    );
    expect(sendLinqMessage.mock.calls[1]?.[0].message).not.toBe(
      sendLinqMessage.mock.calls[0]?.[0].message,
    );
  });

  it("does not create alert state or send when alerting is unconfigured", async () => {
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

  it.each([
    [
      "dedicated chat",
      { HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE: "America/Los_Angeles" },
    ],
    [
      "operator time zone",
      { HOSTED_RUNTIME_LATENCY_ALERT_LINQ_CHAT_ID: "opaque-alert-chat" },
    ],
  ])("fails visibly when the configured alert is missing its %s", async (
    _missing,
    env,
  ) => {
    const fixture = createMonitorPrismaFixture([
      latencyRow({
        acceptedAt: "2026-07-26T15:58:00.000Z",
      }),
    ]);

    await expect(runHostedRuntimeLatencyAlertMonitor({
      env,
      now,
      prisma: fixture.prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_LATENCY_ALERT_CONFIG_INCOMPLETE",
    });
    expect(fixture.alertUpsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid operator time zone without creating alert state", async () => {
    const fixture = createMonitorPrismaFixture([
      latencyRow({
        acceptedAt: "2026-07-26T15:58:00.000Z",
      }),
    ]);

    await expect(runHostedRuntimeLatencyAlertMonitor({
      env: {
        HOSTED_RUNTIME_LATENCY_ALERT_LINQ_CHAT_ID: "opaque-alert-chat",
        HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE: "Mars/Olympus",
      },
      now,
      prisma: fixture.prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE_INVALID",
    });
    expect(fixture.alertUpsert).not.toHaveBeenCalled();
  });

  it("suppresses overnight sends in the configured operator time zone", async () => {
    const rows = [
      latencyRow({
        acceptedAt: "2026-07-26T05:58:00.000Z",
      }),
    ];
    const overnightFixture = createMonitorPrismaFixture(rows);
    const daytimeFixture = createMonitorPrismaFixture(rows);
    const sendLinqMessage = vi.fn(async (input: LinqSendInput) => ({
      chatId: input.chatId,
      messageId: "provider-message",
    }));

    const overnight = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T06:00:00.000Z"),
      prisma: overnightFixture.prisma,
      sendLinqMessage,
    });
    const daytime = await runHostedRuntimeLatencyAlertMonitor({
      env: {
        ...alertEnv,
        HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE: "Asia/Tokyo",
      },
      now: instant("2026-07-26T06:00:00.000Z"),
      prisma: daytimeFixture.prisma,
      sendLinqMessage,
    });

    expect(overnight.outcome).toBe("deferred_quiet_hours");
    expect(daytime.outcome).toBe("alert_sent");
    expect(sendLinqMessage).toHaveBeenCalledTimes(1);
  });

  it("defers when quiet hours begin before provider admission", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(instant("2026-07-27T05:59:00.000Z"));
      const rows = [
        latencyRow({
          acceptedAt: "2026-07-27T05:57:00.000Z",
        }),
      ];
      const fixture = createMonitorPrismaFixture(rows);
      fixture.queueTraceReadEffects(
        () => {},
        () => {
          vi.setSystemTime(instant("2026-07-27T06:00:00.000Z"));
        },
      );
      const sendLinqMessage = vi.fn(async (input: LinqSendInput) => ({
        chatId: input.chatId,
        messageId: "provider-message",
      }));

      const deferred = await runHostedRuntimeLatencyAlertMonitor({
        env: alertEnv,
        prisma: fixture.prisma,
        sendLinqMessage,
      });

      expect(deferred.outcome).toBe("deferred_quiet_hours");
      expect(deferred.health.anomalous).toBe(true);
      expect(sendLinqMessage).not.toHaveBeenCalled();
      expect(fixture.readState()?.status).toBe("latency_healthy");
      expect(fixture.readState()?.attemptCount).toBe(0);
      expect(fixture.readState()?.lastAttemptedAt).toBeNull();

      vi.setSystemTime(instant("2026-07-27T14:10:00.000Z"));
      fixture.setRows([
        latencyRow({
          acceptedAt: "2026-07-27T14:08:00.000Z",
        }),
      ]);
      const resumed = await runHostedRuntimeLatencyAlertMonitor({
        env: alertEnv,
        prisma: fixture.prisma,
        sendLinqMessage,
      });

      expect(resumed.outcome).toBe("alert_sent");
      expect(sendLinqMessage).toHaveBeenCalledTimes(1);
      expect(sendLinqMessage.mock.calls[0]?.[0].message).toContain(
        "Checked 2026-07-27T14:10:00Z",
      );
      expect(sendLinqMessage.mock.calls[0]?.[0].message).not.toContain(
        "Checked 2026-07-27T05:59:00Z",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves an ambiguous retry across a quiet-hours deferral", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(instant("2026-07-26T22:00:00.000Z"));
      const fixture = createMonitorPrismaFixture([
        latencyRow({
          acceptedAt: "2026-07-26T21:58:00.000Z",
        }),
      ]);
      const sendLinqMessage = vi.fn(async (input: LinqSendInput) => ({
        chatId: input.chatId,
        messageId: "provider-message",
      })).mockRejectedValueOnce(new Error("private provider detail"));

      await expect(runHostedRuntimeLatencyAlertMonitor({
        env: alertEnv,
        prisma: fixture.prisma,
        sendLinqMessage,
      })).rejects.toMatchObject({
        code: "HOSTED_RUNTIME_LATENCY_ALERT_SEND_FAILED",
      });
      const firstAttemptAt = fixture.readState()?.lastAttemptedAt;
      const firstKey = sendLinqMessage.mock.calls[0]?.[0].idempotencyKey;
      const firstMessage = sendLinqMessage.mock.calls[0]?.[0].message;
      expect(fixture.readState()?.status).toBe("latency_alert_failed");

      vi.setSystemTime(instant("2026-07-27T05:59:00.000Z"));
      fixture.setRows([
        latencyRow({
          acceptedAt: "2026-07-27T05:57:00.000Z",
        }),
      ]);
      fixture.queueTraceReadEffects(
        () => {},
        () => {
          vi.setSystemTime(instant("2026-07-27T06:00:00.000Z"));
        },
      );
      const deferred = await runHostedRuntimeLatencyAlertMonitor({
        env: alertEnv,
        prisma: fixture.prisma,
        sendLinqMessage,
      });

      expect(deferred.outcome).toBe("deferred_quiet_hours");
      expect(sendLinqMessage).toHaveBeenCalledTimes(1);
      expect(fixture.readState()?.status).toBe("latency_alert_failed");
      expect(fixture.readState()?.lastAttemptedAt).toEqual(firstAttemptAt);

      vi.setSystemTime(instant("2026-07-27T14:10:00.000Z"));
      fixture.setRows([
        latencyRow({
          acceptedAt: "2026-07-27T14:08:00.000Z",
        }),
      ]);
      const resumed = await runHostedRuntimeLatencyAlertMonitor({
        env: alertEnv,
        prisma: fixture.prisma,
        sendLinqMessage,
      });

      expect(resumed.outcome).toBe("alert_sent");
      expect(sendLinqMessage).toHaveBeenCalledTimes(2);
      expect(sendLinqMessage.mock.calls[1]?.[0].idempotencyKey).toBe(firstKey);
      expect(sendLinqMessage.mock.calls[1]?.[0].message).toBe(firstMessage);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps stable wake-up jitter across more than one cron bucket", async () => {
    const fixture = createMonitorPrismaFixture([
      latencyRow({
        acceptedAt: "2026-07-20T13:58:00.000Z",
      }),
    ]);
    const sendLinqMessage = vi.fn(async (input: LinqSendInput) => ({
      chatId: input.chatId,
      messageId: "provider-message",
    }));

    const wakeBoundary = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-20T14:00:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    const firstCronBucket = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-20T14:05:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    const afterJitter = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-20T14:10:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });

    expect(wakeBoundary.outcome).toBe("deferred_quiet_hours");
    expect(firstCronBucket.outcome).toBe("deferred_quiet_hours");
    expect(afterJitter.outcome).toBe("alert_sent");
    expect(sendLinqMessage).toHaveBeenCalledTimes(1);
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

  it("coalesces a live send and reclaims it only after the paced retry window", async () => {
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
    const oldLeaseBoundary = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:04:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    const minimumBoundary = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:10:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    const expired = await runHostedRuntimeLatencyAlertMonitor({
      env: alertEnv,
      now: instant("2026-07-26T16:20:00.000Z"),
      prisma: fixture.prisma,
      sendLinqMessage,
    });
    releaseFirstSend();
    await expect(first).resolves.toMatchObject({
      outcome: "alert_sent",
    });

    expect(overlapping.outcome).toBe("coalesced");
    expect(oldLeaseBoundary.outcome).toBe("coalesced");
    expect(minimumBoundary.outcome).toBe("coalesced");
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
  terminalNonReplyCommittedAt?: string | null;
}): HostedRuntimeLatencyHealthRow {
  return {
    acceptedAt: instant(input.acceptedAt),
    consumedAt: input.consumedAt ? instant(input.consumedAt) : null,
    deliveryAcceptedAt: input.deliveryAcceptedAt
      ? instant(input.deliveryAcceptedAt)
      : null,
    terminalNonReplyCommittedAt: input.terminalNonReplyCommittedAt
      ? instant(input.terminalNonReplyCommittedAt)
      : null,
  };
}

function createMonitorPrismaFixture(
  initialRows: readonly HostedRuntimeLatencyHealthRow[],
  options: { rejectNextClaim?: boolean } = {},
) {
  let rows = [...initialRows];
  const queuedRows: HostedRuntimeLatencyHealthRow[][] = [];
  const traceReadEffects: Array<() => void> = [];
  let state: HostedLinqAlert | null = null;
  let rejectNextClaim = options.rejectNextClaim === true;

  const traceFindMany = vi.fn(async () => {
    const selectedRows = queuedRows.shift() ?? rows;
    traceReadEffects.shift()?.();
    return selectedRows.map((row) => ({
      acceptedAt: row.acceptedAt,
      linqDelivery: row.deliveryAcceptedAt
      ? { acceptedAt: row.deliveryAcceptedAt }
      : null,
      mailboxItem: {
        consumedAt: row.consumedAt,
      },
      phaseBreakdownJson: row.terminalNonReplyCommittedAt
        ? {
            assistant: {
              terminalNonReplyCommittedAtEpochMs:
                row.terminalNonReplyCommittedAt.getTime(),
            },
            schemaVersion: 1,
          }
        : null,
    }));
  });
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
    queueRowsForReads(
      ...nextRows: readonly HostedRuntimeLatencyHealthRow[][]
    ) {
      queuedRows.push(...nextRows.map((readRows) => [...readRows]));
    },
    queueTraceReadEffects(...effects: Array<() => void>) {
      traceReadEffects.push(...effects);
    },
    recordConcurrentHealthyCycle(input: {
      attemptedAt: Date;
      sentAt: Date;
    }) {
      if (!state) {
        throw new Error("Expected latency alert state.");
      }
      state = {
        ...state,
        attemptCount: state.attemptCount + 1,
        claimedAt: input.attemptedAt,
        lastAttemptedAt: input.attemptedAt,
        sentAt: input.sentAt,
        status: "latency_healthy",
        updatedAt: new Date(state.updatedAt.getTime() + 1),
      };
    },
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
