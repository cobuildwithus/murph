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
  HOSTED_AUTOMATION_LOSS_WINDOW_MS,
  runHostedAutomationLossAlertMonitor,
} from "@/src/lib/hosted-runtime-log/automation-loss-alert-monitor";

const now = new Date("2026-10-07T16:00:00Z");
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

function lostRows(totalRuntimes: number) {
  return { rows: [
    { automation: "weekly-health-digest", lostRunCount: "4", runtimeCount: "4", totalRuntimeCount: String(totalRuntimes) },
    { automation: "member_automation", lostRunCount: "1", runtimeCount: "1", totalRuntimeCount: String(totalRuntimes) },
  ] };
}
const failedRows = { rows: [
  { errorCode: "ASSISTANT_CODEX_FAILED", failedAttemptCount: "12" },
  { errorCode: "other", failedAttemptCount: "2" },
] };
function alerting() {
  mocks.query.mockImplementation(async (sql: string) => sql.includes("WITH lost") ? lostRows(5) : failedRows);
}

describe("scheduled automation loss incident monitor", () => {
  it("stays healthy when no run was lost outright, without reading failure codes", async () => {
    expect(await runHostedAutomationLossAlertMonitor({ now, env, sendAlert }))
      .toMatchObject({ configured: true, outcome: "healthy", health: { anomalous: false, runtimeCount: 0 } });
    expect(sendAlert).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([
      new Date(+now - HOSTED_AUTOMATION_LOSS_WINDOW_MS), now,
      expect.any(Array), "personal-patterns-update", "ASSISTANT_CODEX_USAGE_LIMIT",
    ]);
  });

  it("alerts on a single runtime's outright loss", async () => {
    mocks.query.mockImplementation(async (sql: string) => sql.includes("WITH lost") ? { rows: [
      { automation: "weekly-health-digest", lostRunCount: "1", runtimeCount: "1", totalRuntimeCount: "1" },
    ] } : failedRows);
    expect((await runHostedAutomationLossAlertMonitor({ now, env, sendAlert })).outcome).toBe("alert_sent");
  });

  it("sends allowlisted counts", async () => {
    alerting();
    const result = await runHostedAutomationLossAlertMonitor({ now, env, sendAlert });
    expect(result.outcome).toBe("alert_sent");
    expect(mocks.query).toHaveBeenCalledTimes(4); // Shared pre-send recheck.
    expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("Scheduled runs lost outright: 5 across 5 runtimes in the trailing 6 hours."),
      idempotencyKey: expect.stringMatching(/^murph\/automation-loss\/.+\/alert$/u),
    }));
    const details = state?.detailsJson as Prisma.JsonObject;
    expect(details.message).toContain("weekly-health-digest: 4 lost runs across 4 runtimes.");
    expect(details.message).toContain("member_automation: 1 lost runs across 1 runtimes.");
    expect(details.message).toContain("ASSISTANT_CODEX_FAILED: 12.");
    expect(JSON.stringify(details)).not.toMatch(/userId|memberId|@|phone|subjectKey/iu);
    expect(state?.status).toBe("automation_loss_alerting");
  });

  it("clears a recovered incident without sending a recovery email", async () => {
    alerting();
    await runHostedAutomationLossAlertMonitor({ now, env, sendAlert });
    mocks.query.mockResolvedValue({ rows: [] });
    expect((await runHostedAutomationLossAlertMonitor({ now, env, sendAlert })).outcome).toBe("healthy");
    expect(state?.status).toBe("automation_loss_healthy");
    expect(sendAlert).toHaveBeenCalledOnce();
  });

  it("suppresses an active incident and reminds after six hours plus jitter", async () => {
    alerting();
    const morning = new Date("2026-10-07T08:00:00Z");
    await runHostedAutomationLossAlertMonitor({ now: morning, env, sendAlert });
    expect((await runHostedAutomationLossAlertMonitor({ now: new Date(+morning + 5 * 60_000), env, sendAlert })).outcome)
      .toBe("incident_active");
    expect((await runHostedAutomationLossAlertMonitor({ now: new Date(+morning + 7 * 60 * 60_000), env, sendAlert })).outcome)
      .toBe("alert_sent");
    expect(sendAlert).toHaveBeenCalledTimes(2);
  });

  it("reports a loss at the start of quiet hours before it can age out of the window", async () => {
    alerting();
    expect((await runHostedAutomationLossAlertMonitor({ now: new Date("2026-10-07T23:30:00Z"), env, sendAlert })).outcome)
      .toBe("alert_sent");
    mocks.query.mockResolvedValue({ rows: [] });
    expect((await runHostedAutomationLossAlertMonitor({ now: new Date("2026-10-08T05:35:00Z"), env, sendAlert })).outcome)
      .toBe("healthy");
    expect(sendAlert).toHaveBeenCalledOnce();
  });

  it("does not send when the pre-send recheck recovers", async () => {
    mocks.query.mockResolvedValueOnce(lostRows(5)).mockResolvedValueOnce(failedRows).mockResolvedValue({ rows: [] });
    expect((await runHostedAutomationLossAlertMonitor({ now, env, sendAlert })).outcome).toBe("healthy");
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("skips an unconfigured local database without clearing a live incident", async () => {
    alerting();
    await runHostedAutomationLossAlertMonitor({ now, env, sendAlert });
    mocks.configured.mockReturnValue(false);
    mocks.query.mockClear();
    mocks.upsert.mockClear();
    expect(await runHostedAutomationLossAlertMonitor({ now, env, sendAlert }))
      .toEqual({ configured: false, outcome: "disabled" });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(state?.status).toBe("automation_loss_alerting");
  });

  it("does not clear an incident on database failure", async () => {
    alerting();
    await runHostedAutomationLossAlertMonitor({ now, env, sendAlert });
    mocks.query.mockRejectedValueOnce(new Error("diagnostics unavailable"));
    await expect(runHostedAutomationLossAlertMonitor({ now, env, sendAlert })).rejects.toThrow("diagnostics unavailable");
    expect(state?.status).toBe("automation_loss_alerting");
  });

  it("skips all work when email alerts are unconfigured", async () => {
    expect(await runHostedAutomationLossAlertMonitor({ now, env: {}, sendAlert }))
      .toEqual({ configured: false, outcome: "disabled" });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
