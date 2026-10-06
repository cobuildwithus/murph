import type { HostedLinqAlert, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), configured: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(),
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  hostedLinqAlert: { upsert: mocks.upsert, updateMany: mocks.updateMany },
}) }));
vi.mock("@/src/lib/hosted-runtime-log/database", () => ({
  getHostedRuntimeLogPool: () => ({ query: mocks.query }),
  isHostedRuntimeLogDatabaseConfigured: mocks.configured,
}));

import {
  HOSTED_RUNTIME_RUNAWAY_INVOCATION_THRESHOLD,
  HOSTED_RUNTIME_RUNAWAY_PROCESSING_ATTEMPT_THRESHOLD,
  HOSTED_RUNTIME_RUNAWAY_WINDOW_MS,
  runHostedRuntimeRunawayAlertMonitor,
} from "@/src/lib/hosted-runtime-log/runaway-alert-monitor";

const now = new Date("2026-10-04T16:00:00Z");
const env = {
  HOSTED_LINQ_ALERT_EMAIL_FROM: "Alerts <alerts@example.test>",
  HOSTED_LINQ_ALERT_EMAILS: "operator@example.test",
  HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE: "UTC", RESEND_API_KEY: "re_test",
};
let state: HostedLinqAlert | null;
const sendAlert = vi.fn(async () => ({ providerMessageId: "synthetic-message" }));

beforeEach(() => {
  vi.clearAllMocks();
  state = null;
  mocks.configured.mockReturnValue(true);
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.upsert.mockImplementation(async ({ create }: { create: HostedLinqAlert }) => {
    state ??= { ...create, attemptCount: 0, lastAttemptedAt: null, sentAt: null,
      updatedAt: now, createdAt: now };
    return { ...state };
  });
  mocks.updateMany.mockImplementation(async ({ data }: { data: Omit<Partial<HostedLinqAlert>, "attemptCount"> & {
    attemptCount?: { increment: number };
  } }) => {
    if (!state) throw new Error("Missing synthetic alert state");
    const { attemptCount, ...fields } = data;
    state = { ...state, ...fields,
      attemptCount: state.attemptCount + (attemptCount?.increment ?? 0) };
    return { count: 1 };
  });
});

function alertRows(count = 40, processingAttempts = 0) {
  return { rows: [{ subjectPrefix: "abcdef01", invocationCount: String(count),
    processingAttemptCount: String(processingAttempts),
    runawaySubjectCount: "1", processingMode: "system_mailbox",
    nextWakeReason: "device-sync.reconcile", processingOutcome: "retry_later:claim_blocked" }] };
}

describe("runtime runaway incident monitor", () => {
  it("stays healthy when no subject reaches the aggregate threshold", async () => {
    expect(await runHostedRuntimeRunawayAlertMonitor({ now, env, sendAlert }))
      .toMatchObject({ configured: true, outcome: "healthy", health: { anomalous: false } });
    expect(sendAlert).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([
      new Date(+now - HOSTED_RUNTIME_RUNAWAY_WINDOW_MS), now,
      HOSTED_RUNTIME_RUNAWAY_INVOCATION_THRESHOLD, HOSTED_RUNTIME_RUNAWAY_PROCESSING_ATTEMPT_THRESHOLD, 10,
      expect.any(Array), expect.any(Array), expect.any(Array), expect.any(Array),
    ]);
  });

  it.each([40, 90, 495])("sends redacted counts at/above the threshold (%s)", async count => {
    mocks.query.mockResolvedValue(alertRows(count));
    const result = await runHostedRuntimeRunawayAlertMonitor({ now, env, sendAlert });
    expect(result.outcome).toBe("alert_sent");
    expect(mocks.query).toHaveBeenCalledTimes(2); // Shared pre-send recheck.
    expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining(`abcdef01: ${count} invocations`),
      idempotencyKey: expect.stringMatching(/^murph\/runtime-runaway\/.+\/alert$/u),
    }));
    const details = state?.detailsJson as Prisma.JsonObject;
    expect(details.message).toContain("Runaway subjects: 1");
    expect(details.message).toContain("processingMode=system_mailbox");
    expect(details.message).toContain("nextWakeReason=device-sync.reconcile");
    expect(JSON.stringify(details)).not.toMatch(/userId|memberId|@|phone|subjectKey/iu);
    expect(state?.status).toBe("runaway_alerting");
  });

  it("alerts on a processing-attempt storm without runaway invocations", async () => {
    mocks.query.mockResolvedValue(alertRows(0, 1_100));
    expect((await runHostedRuntimeRunawayAlertMonitor({ now, env, sendAlert })).outcome).toBe("alert_sent");
    expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("abcdef01: 0 invocations; 1100 processing attempts"),
    }));
    const details = state?.detailsJson as Prisma.JsonObject;
    expect(details.message).toContain("dominant processing outcome=retry_later:claim_blocked");
    expect(details.message).toContain(
      `or ${HOSTED_RUNTIME_RUNAWAY_PROCESSING_ATTEMPT_THRESHOLD} runner.processing_finished events`);
  });

  it("clears a recovered incident without sending a recovery email", async () => {
    mocks.query.mockResolvedValue(alertRows());
    await runHostedRuntimeRunawayAlertMonitor({ now, env, sendAlert });
    mocks.query.mockResolvedValue({ rows: [] });
    expect((await runHostedRuntimeRunawayAlertMonitor({ now, env, sendAlert })).outcome).toBe("healthy");
    expect(state?.status).toBe("runaway_healthy");
    expect(sendAlert).toHaveBeenCalledOnce();
  });

  it("suppresses active incidents and sends a reminder after six hours plus jitter, including quiet hours", async () => {
    mocks.query.mockResolvedValue(alertRows());
    await runHostedRuntimeRunawayAlertMonitor({ now, env, sendAlert });
    expect((await runHostedRuntimeRunawayAlertMonitor({ now: new Date(+now + 5 * 60_000), env, sendAlert })).outcome)
      .toBe("incident_active");
    expect((await runHostedRuntimeRunawayAlertMonitor({ now: new Date(+now + 8 * 60 * 60_000), env, sendAlert })).outcome)
      .toBe("alert_sent");
    expect(sendAlert).toHaveBeenCalledTimes(2);
  });

  it("does not send when the pre-send recheck recovers", async () => {
    mocks.query.mockResolvedValueOnce(alertRows()).mockResolvedValue({ rows: [] });
    expect((await runHostedRuntimeRunawayAlertMonitor({ now, env, sendAlert })).outcome).toBe("healthy");
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("skips an unconfigured local database without clearing a live incident", async () => {
    mocks.query.mockResolvedValue(alertRows());
    await runHostedRuntimeRunawayAlertMonitor({ now, env, sendAlert });
    mocks.configured.mockReturnValue(false);
    mocks.query.mockClear();
    mocks.upsert.mockClear();
    expect(await runHostedRuntimeRunawayAlertMonitor({ now, env, sendAlert }))
      .toEqual({ configured: false, outcome: "disabled" });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(state?.status).toBe("runaway_alerting");
  });

  it("does not clear an incident on database failure", async () => {
    mocks.query.mockResolvedValue(alertRows());
    await runHostedRuntimeRunawayAlertMonitor({ now, env, sendAlert });
    mocks.query.mockRejectedValueOnce(new Error("diagnostics unavailable"));
    await expect(runHostedRuntimeRunawayAlertMonitor({ now, env, sendAlert })).rejects.toThrow("diagnostics unavailable");
    expect(state?.status).toBe("runaway_alerting");
  });

  it("skips all work when email alerts are unconfigured", async () => {
    expect(await runHostedRuntimeRunawayAlertMonitor({ now, env: {}, sendAlert }))
      .toEqual({ configured: false, outcome: "disabled" });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
