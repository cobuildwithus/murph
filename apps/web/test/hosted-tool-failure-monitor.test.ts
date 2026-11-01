import type { HostedLinqAlert, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  $queryRaw: mocks.query, hostedLinqAlert: { upsert: mocks.upsert, updateMany: mocks.updateMany },
}) }));
import { runHostedToolFailureAlertMonitor } from "@/src/lib/hosted-operational-alert/tool-failure-monitor";
import type { ToolFailureGroup } from "@/src/lib/hosted-operational-alert/tool-failure-health";

const now = new Date("2026-08-10T01:00:00Z");
const env = { HOSTED_LINQ_ALERT_EMAIL_FROM: "Alerts <alerts@example.test>",
  HOSTED_LINQ_ALERT_EMAILS: "operator@example.test", HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE: "UTC", RESEND_API_KEY: "re_test" };
const states = new Map<string, HostedLinqAlert>();
const sendAlert = vi.fn<import("@/src/lib/hosted-operational-alert/incident-email-monitor").HostedOperationalAlertSend>(async () => ({ providerMessageId: "synthetic-message" }));
function row(patch: Partial<ToolFailureGroup> = {}): ToolFailureGroup {
  return { source: "dynamic_tool", operation: "automation", count: 4,
    reason: "handler_exception", category: "unavailable", releaseSha: "a".repeat(40),
    firstAt: now.toISOString(), lastAt: now.toISOString(), ...patch };
}

beforeEach(() => {
  vi.clearAllMocks(); states.clear(); mocks.query.mockResolvedValue([]);
  mocks.upsert.mockImplementation(async ({ create }: { create: HostedLinqAlert }) => {
    if (!states.has(create.id)) states.set(create.id, { ...create, attemptCount: 0,
      lastAttemptedAt: null, sentAt: null, updatedAt: now, createdAt: now });
    return { ...states.get(create.id) };
  });
  mocks.updateMany.mockImplementation(async ({ where, data }: {
    where: Partial<HostedLinqAlert>; data: Omit<Partial<HostedLinqAlert>, "attemptCount"> & { attemptCount?: { increment: number } };
  }) => {
    const state = states.get(where.id!);
    if (!state || (where.status && where.status !== state.status)
      || (where.updatedAt && +where.updatedAt !== +state.updatedAt)) return { count: 0 };
    const { attemptCount, ...fields } = data;
    states.set(state.id, { ...state, ...fields, attemptCount: state.attemptCount + (attemptCount?.increment ?? 0) });
    return { count: 1 };
  });
});

describe("tool failure incident monitor", () => {
  it.each([0, 1, 3, 4, 5])("uses four backend failures per operation, observed=%s", async count => {
    mocks.query.mockResolvedValue([row({ count }), row({ operation: "game", count: 1 })]);
    const result = await runHostedToolFailureAlertMonitor({ now, env, sendAlert });
    expect(result.conditions[1]?.health.anomalous).toBe(count >= 4);
    expect(sendAlert).toHaveBeenCalledTimes(count >= 4 ? 1 : 0);
    expect(mocks.query).toHaveBeenCalledTimes(count >= 4 ? 2 : 1);
  });

  it.each(["dynamic_tool", "phone_start"] as const)("alerts on a single %s phone observation during quiet hours", async source => {
    mocks.query.mockResolvedValue([row({ source, operation: "create-phone-call", count: 1 })]);
    expect((await runHostedToolFailureAlertMonitor({ now, env, sendAlert })).conditions[0]?.outcome).toBe("alert_sent");
    const text = sendAlert.mock.calls[0]?.[0];
    expect(text).toMatchObject({ subject: "Phone call start failures", text: expect.stringContaining("create-phone-call") });
  });

  it("combines categories and releases for the threshold and includes occurrence bounds", async () => {
    mocks.query.mockResolvedValue([row({ count: 2 }), row({ count: 2, category: "timeout", releaseSha: "b".repeat(40) })]);
    await runHostedToolFailureAlertMonitor({ now, env, sendAlert });
    expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining(`first=${now.toISOString()}`) }));
    const details = states.get("hosted-tool-failure-backend:v1")?.detailsJson as Prisma.JsonObject;
    expect(JSON.stringify(details)).toContain("timeout");
    expect(JSON.stringify(details)).not.toMatch(/memberId|userId|summary|detailsJson|runtimeAttemptId/);
  });

  it("dedupes, reminds, recovers, and independently alerts for a new phone failure", async () => {
    mocks.query.mockResolvedValue([row()]);
    await runHostedToolFailureAlertMonitor({ now, env, sendAlert });
    mocks.query.mockResolvedValue([row(), row({ operation: "create-phone-call", count: 1 })]);
    await runHostedToolFailureAlertMonitor({ now: new Date(+now + 5 * 60_000), env, sendAlert });
    expect(sendAlert).toHaveBeenCalledTimes(2);
    await runHostedToolFailureAlertMonitor({ now: new Date(+now + 7 * 3_600_000), env, sendAlert });
    expect(sendAlert).toHaveBeenCalledTimes(4);
    mocks.query.mockResolvedValue([]);
    const recovered = await runHostedToolFailureAlertMonitor({ now: new Date(+now + 8 * 3_600_000), env, sendAlert });
    expect(recovered.conditions.every(c => c.outcome === "healthy")).toBe(true);
    expect(sendAlert).toHaveBeenCalledTimes(4);
  });

  it("rechecks before sending and does not clear incidents on query failure", async () => {
    mocks.query.mockResolvedValueOnce([row()]).mockResolvedValue([]);
    await runHostedToolFailureAlertMonitor({ now, env, sendAlert });
    expect(sendAlert).not.toHaveBeenCalled();
    mocks.query.mockResolvedValue([row()]);
    await runHostedToolFailureAlertMonitor({ now, env, sendAlert });
    mocks.query.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(runHostedToolFailureAlertMonitor({ now, env, sendAlert })).rejects.toThrow("database unavailable");
    expect(states.get("hosted-tool-failure-backend:v1")?.status).toBe("tool_failure_backend_alerting");
  });

  it("retries persisted messages with the same email idempotency key", async () => {
    mocks.query.mockResolvedValue([row()]);
    sendAlert.mockRejectedValueOnce(new Error("synthetic send failure"));
    await expect(runHostedToolFailureAlertMonitor({ now, env, sendAlert })).rejects.toThrow("delivery failed");
    await runHostedToolFailureAlertMonitor({ now: new Date(+now + 21 * 60_000), env, sendAlert });
    expect(sendAlert.mock.calls[1]?.[0]).toEqual(sendAlert.mock.calls[0]?.[0]);
  });

  it("performs no database work when unconfigured", async () => {
    await runHostedToolFailureAlertMonitor({ env: {} });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
