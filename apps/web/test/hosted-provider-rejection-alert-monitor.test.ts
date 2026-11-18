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
  HOSTED_PROVIDER_REJECTION_WINDOW_MS,
  runHostedProviderRejectionAlertMonitor,
} from "@/src/lib/hosted-runtime-log/provider-rejection-alert-monitor";

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

const span = { firstFailureAt: "2026-10-07T15:41:00.000Z", lastFailureAt: "2026-10-07T15:58:30.000Z" };
function rejectedRows(totalMembers: number) {
  return { rows: [
    { errorInfo: "unrecognized", httpStatus: "none", failedReplyCount: "9", totalMemberCount: String(totalMembers), ...span },
    { errorInfo: "other", httpStatus: "400", failedReplyCount: "3", totalMemberCount: String(totalMembers), ...span },
  ] };
}
function alerting() {
  mocks.query.mockResolvedValue(rejectedRows(2));
}

describe("provider request rejection incident monitor", () => {
  it("stays healthy when the provider rejected no reply", async () => {
    expect(await runHostedProviderRejectionAlertMonitor({ now, env, sendAlert })).toMatchObject({
      configured: true, outcome: "healthy",
      health: { anomalous: false, failedReplyCount: 0, memberCount: 0, firstFailureAt: null, lastFailureAt: null },
    });
    expect(sendAlert).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([
      new Date(+now - HOSTED_PROVIDER_REJECTION_WINDOW_MS), now,
      "ASSISTANT_CODEX_FAILED", expect.arrayContaining(["unrecognized", "modelNotFound"]),
    ]);
  });

  it("alerts on a single rejected reply", async () => {
    mocks.query.mockResolvedValue({ rows: [
      { errorInfo: "unrecognized", httpStatus: "none", failedReplyCount: "1", totalMemberCount: "1", ...span },
    ] });
    const result = await runHostedProviderRejectionAlertMonitor({ now, env, sendAlert });
    expect(result).toMatchObject({ outcome: "alert_sent", health: { anomalous: true, failedReplyCount: 1, memberCount: 1 } });
    expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("Replies the model provider rejected in the trailing 30 minutes: 1. Members affected: 1."),
    }));
  });

  it("sends one fleet incident with aggregate counts only", async () => {
    alerting();
    const result = await runHostedProviderRejectionAlertMonitor({ now, env, sendAlert });
    expect(result.outcome).toBe("alert_sent");
    expect(mocks.query).toHaveBeenCalledTimes(2); // Shared pre-send recheck.
    expect(sendAlert).toHaveBeenCalledOnce();
    expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({
      subject: "Murph replies are failing: the model provider is rejecting requests",
      text: expect.stringContaining("Replies the model provider rejected in the trailing 30 minutes: 12. Members affected: 2."),
      idempotencyKey: expect.stringMatching(/^murph\/provider-request-rejection\/.+\/alert$/u),
    }));
    const details = state?.detailsJson as Prisma.JsonObject;
    expect(details.message).toContain("First failure 2026-10-07T15:41:00.000Z. Last failure 2026-10-07T15:58:30.000Z.");
    expect(details.message).toContain("unrecognized, HTTP status none: 9.");
    expect(details.message).toContain("other, HTTP status 400: 3.");
    expect(details.message).toContain("so retrying will not help");
    expect(details.message).toContain("check for a recent runner deploy");
    expect(details.message).not.toMatch(/—| - /u);
    expect(JSON.stringify(details)).not.toMatch(/userId|memberId|@|phone|subjectKey|safeErrorMessage/iu);
    expect(state?.id).toBe("hosted-provider-request-rejection-monitor:v1");
    expect(state?.status).toBe("provider_rejection_alerting");
  });

  it("clears a recovered incident without sending a recovery email", async () => {
    alerting();
    await runHostedProviderRejectionAlertMonitor({ now, env, sendAlert });
    mocks.query.mockResolvedValue({ rows: [] });
    expect((await runHostedProviderRejectionAlertMonitor({ now, env, sendAlert })).outcome).toBe("healthy");
    expect(state?.status).toBe("provider_rejection_healthy");
    expect(sendAlert).toHaveBeenCalledOnce();
  });

  it("suppresses an active incident and reminds after one hour plus jitter", async () => {
    alerting();
    const morning = new Date("2026-10-07T08:00:00Z");
    await runHostedProviderRejectionAlertMonitor({ now: morning, env, sendAlert });
    expect((await runHostedProviderRejectionAlertMonitor({ now: new Date(+morning + 5 * 60_000), env, sendAlert })).outcome)
      .toBe("incident_active");
    expect((await runHostedProviderRejectionAlertMonitor({ now: new Date(+morning + 55 * 60_000), env, sendAlert })).outcome)
      .toBe("incident_active");
    expect((await runHostedProviderRejectionAlertMonitor({ now: new Date(+morning + 75 * 60_000), env, sendAlert })).outcome)
      .toBe("alert_sent");
    expect(sendAlert).toHaveBeenCalledTimes(2);
  });

  it("alerts during quiet hours", async () => {
    alerting();
    expect((await runHostedProviderRejectionAlertMonitor({ now: new Date("2026-10-07T23:30:00Z"), env, sendAlert })).outcome)
      .toBe("alert_sent");
  });

  it("does not send when the pre-send recheck recovers", async () => {
    mocks.query.mockResolvedValueOnce(rejectedRows(2)).mockResolvedValue({ rows: [] });
    expect((await runHostedProviderRejectionAlertMonitor({ now, env, sendAlert })).outcome).toBe("healthy");
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("skips an unconfigured local database without clearing a live incident", async () => {
    alerting();
    await runHostedProviderRejectionAlertMonitor({ now, env, sendAlert });
    mocks.configured.mockReturnValue(false);
    mocks.query.mockClear();
    mocks.upsert.mockClear();
    expect(await runHostedProviderRejectionAlertMonitor({ now, env, sendAlert }))
      .toEqual({ configured: false, outcome: "disabled" });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(state?.status).toBe("provider_rejection_alerting");
  });

  it("does not clear an incident on database failure", async () => {
    alerting();
    await runHostedProviderRejectionAlertMonitor({ now, env, sendAlert });
    mocks.query.mockRejectedValueOnce(new Error("diagnostics unavailable"));
    await expect(runHostedProviderRejectionAlertMonitor({ now, env, sendAlert })).rejects.toThrow("diagnostics unavailable");
    expect(state?.status).toBe("provider_rejection_alerting");
  });

  it("skips all work when email alerts are unconfigured", async () => {
    expect(await runHostedProviderRejectionAlertMonitor({ now, env: {}, sendAlert }))
      .toEqual({ configured: false, outcome: "disabled" });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
