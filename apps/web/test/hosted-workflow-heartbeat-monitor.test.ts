import type { HostedLinqAlert, Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ hostedLinqAlert: mocks }) }));
import { runHostedWorkflowHeartbeatAlertMonitor } from "@/src/lib/hosted-operational-alert/workflow-heartbeat-monitor";
import { WORKFLOW_HEARTBEAT_STATE_ID, WORKFLOW_HEARTBEAT_API_TIMEOUT_MS,
  type HeartbeatEngine } from "@/src/lib/hosted-operational-alert/workflow-heartbeat-state";
import type { HostedOperationalAlertSend } from "@/src/lib/hosted-operational-alert/incident-email-monitor";

const now = new Date("2026-08-10T01:00:00Z");
const env = { HOSTED_LINQ_ALERT_EMAIL_FROM: "Alerts <alerts@example.test>",
  HOSTED_LINQ_ALERT_EMAILS: "operator@example.test", HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE: "UTC", RESEND_API_KEY: "re_test" };
const states = new Map<string, HostedLinqAlert>();
const sendAlert = vi.fn<HostedOperationalAlertSend>(async () => ({ providerMessageId: "synthetic-message" }));
const engine = { start: vi.fn<HeartbeatEngine["start"]>(), inspect: vi.fn<HeartbeatEngine["inspect"]>() };
const tick = (minutes: number) => runHostedWorkflowHeartbeatAlertMonitor({ now: new Date(+now + minutes * 60_000), env, engine, sendAlert });

beforeEach(() => {
  vi.clearAllMocks(); states.clear();
  engine.start.mockResolvedValue("synthetic-run");
  engine.inspect.mockResolvedValue({ status: "running" });
  mocks.upsert.mockImplementation(async ({ create }: { create: HostedLinqAlert }) => {
    if (!states.has(create.id)) states.set(create.id, { ...create, attemptCount: 0,
      lastAttemptedAt: null, sentAt: null, updatedAt: now, createdAt: now });
    return structuredClone(states.get(create.id));
  });
  mocks.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => structuredClone(states.get(where.id) ?? null));
  mocks.updateMany.mockImplementation(async ({ where, data }: {
    where: Omit<Partial<HostedLinqAlert>, "detailsJson"> & { detailsJson?: { equals: Prisma.JsonValue } };
    data: Omit<Partial<HostedLinqAlert>, "attemptCount"> & { attemptCount?: { increment: number } };
  }) => {
    const state = states.get(where.id!);
    if (!state || (where.status && where.status !== state.status)
      || (where.updatedAt && +where.updatedAt !== +state.updatedAt)
      || (where.lastAttemptedAt && +where.lastAttemptedAt !== +(state.lastAttemptedAt ?? 0))
      || (where.detailsJson && JSON.stringify(where.detailsJson.equals) !== JSON.stringify(state.detailsJson))) return { count: 0 };
    const { attemptCount, ...fields } = data;
    states.set(state.id, { ...state, ...fields, updatedAt: new Date(+state.updatedAt + 1),
      attemptCount: state.attemptCount + (attemptCount?.increment ?? 0) });
    return { count: 1 };
  });
});
afterEach(() => vi.useRealTimers());

describe("Workflow heartbeat", () => {
  it("starts without product traffic and waits for actual completion", async () => {
    expect(await tick(0)).toMatchObject({ outcome: "healthy", health: { lastCompletedAt: null } });
    expect(engine.start).toHaveBeenCalledOnce();
    expect(engine.inspect).not.toHaveBeenCalled();
    await tick(15);
    expect(engine.start).toHaveBeenCalledOnce(); // Do not discard a pending run early.
    expect((await tick(29.999)).outcome).toBe("healthy");
    expect((await tick(30)).outcome).toBe("alert_sent");
    expect(engine.start).toHaveBeenCalledTimes(2);
    expect(sendAlert.mock.calls[0]?.[0].text).toContain("Last completion: none");
    expect(JSON.stringify(states.get("hosted-workflow-heartbeat-monitor:v1")?.detailsJson)).not.toContain("synthetic-run");
  });

  it("starts completed probes at the 15-minute boundary, but never early", async () => {
    await tick(0);
    engine.inspect.mockResolvedValue({ status: "completed", completedAt: new Date(+now + 60_000) });
    await tick(5);
    await tick(14.999);
    expect(engine.start).toHaveBeenCalledOnce();
    expect(await tick(15)).toMatchObject({ health: { lastCompletedAt: new Date(+now + 60_000).toISOString() } });
    expect(engine.start).toHaveBeenCalledTimes(2);
  });

  it.each(["failed", "cancelled"] as const)("a %s run cannot reset the outage clock", async status => {
    await tick(0);
    engine.inspect.mockResolvedValue({ status });
    await tick(15);
    expect((await tick(30)).outcome).toBe("alert_sent");
    expect(engine.start).toHaveBeenCalledTimes(3);
  });

  it("start rejection alerts after 30 minutes and retries do not grant fresh grace", async () => {
    engine.start.mockRejectedValue(new Error("private provider error"));
    await tick(0);
    await tick(15);
    expect((await tick(30)).outcome).toBe("alert_sent");
    expect(engine.inspect).not.toHaveBeenCalled();
    expect(JSON.stringify([...states.values()])).not.toContain("private provider error");
    expect(sendAlert.mock.calls[0]?.[0].text).toContain("start_failed");
  });

  it("bounds a hung SDK start, records failure, and does not store late results", async () => {
    vi.useFakeTimers();
    let finish!: (runId: string) => void;
    engine.start.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const first = tick(0);
    await vi.advanceTimersByTimeAsync(WORKFLOW_HEARTBEAT_API_TIMEOUT_MS);
    await first;
    finish("late-orphan-run");
    await Promise.resolve();
    expect(states.get(WORKFLOW_HEARTBEAT_STATE_ID)?.detailsJson).toMatchObject({ status: "start_failed", runId: null });
    expect((await tick(30)).outcome).toBe("alert_sent");
  });

  it("bounds a hung status read and still emails from the cron", async () => {
    await tick(0);
    vi.useFakeTimers();
    engine.inspect.mockReturnValue(new Promise(() => {}));
    const result = tick(30);
    await vi.advanceTimersByTimeAsync(WORKFLOW_HEARTBEAT_API_TIMEOUT_MS);
    expect((await result).outcome).toBe("alert_sent");
  });

  it("dedupes and reminds during outage, recovers on completion, then detects the next outage", async () => {
    await tick(0);
    await tick(30);
    expect((await tick(35)).outcome).toBe("incident_active");
    expect((await tick(400)).outcome).toBe("alert_sent");
    engine.inspect.mockResolvedValue({ status: "completed", completedAt: new Date(+now + 401 * 60_000) });
    expect((await tick(405)).outcome).toBe("healthy");
    expect(sendAlert).toHaveBeenCalledTimes(2); // Recovery is a state transition, not an email.
    engine.inspect.mockResolvedValue({ status: "running" });
    await tick(415);
    expect((await tick(430.999)).outcome).toBe("healthy");
    expect((await tick(431)).outcome).toBe("alert_sent");
  });

  it.each([undefined, new Date(+now - 1), new Date(+now + 60 * 60_000)])("does not recover from invalid completion evidence (%s)", async completedAt => {
    await tick(0);
    engine.inspect.mockResolvedValue({ status: "completed", completedAt });
    expect((await tick(30)).outcome).toBe("alert_sent");
  });

  it("does not reset age on metadata errors or a crash between claim and start", async () => {
    await tick(0);
    engine.inspect.mockRejectedValue(new Error("schema broken"));
    expect((await tick(30)).outcome).toBe("alert_sent");
    const state = states.get(WORKFLOW_HEARTBEAT_STATE_ID)!;
    const details = state.detailsJson as Prisma.JsonObject;
    state.detailsJson = { ...details, status: "starting", runId: null };
    await tick(60);
    expect(engine.start).toHaveBeenCalledTimes(3);
    expect(sendAlert).toHaveBeenCalledOnce();
  });

  it("bounds the overdue tick's database and engine calls", async () => {
    await tick(0);
    vi.clearAllMocks();
    await tick(30);
    expect(mocks.upsert.mock.calls.length + mocks.findUnique.mock.calls.length + mocks.updateMany.mock.calls.length).toBe(10);
    expect(engine.inspect).toHaveBeenCalledOnce();
    expect(engine.start).toHaveBeenCalledOnce();
    expect(sendAlert).toHaveBeenCalledOnce();
  });

  it("overlapping cron calls claim at most one start and one alert", async () => {
    await Promise.all([tick(0), tick(0), tick(0)]);
    expect(engine.start).toHaveBeenCalledOnce();
    await Promise.all([tick(30), tick(30), tick(30)]);
    expect(engine.start).toHaveBeenCalledTimes(2);
    expect(sendAlert).toHaveBeenCalledOnce();
  });

  it("stays healthy with zero product traffic over repeated successful probes", async () => {
    for (let minute = 0; minute <= 120; minute += 5) {
      const state = states.get(WORKFLOW_HEARTBEAT_STATE_ID)?.detailsJson as Prisma.JsonObject | undefined;
      if (typeof state?.lastStartedAt === "string") {
        engine.inspect.mockResolvedValue({ status: "completed", completedAt: new Date(Date.parse(state.lastStartedAt) + 1_000) });
      }
      expect((await tick(minute)).outcome).toBe("healthy");
    }
    expect(engine.start).toHaveBeenCalledTimes(9);
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("a synthetic three-day dead engine sends one alert and eleven reminders", async () => {
    engine.inspect.mockResolvedValue({ status: "failed" });
    for (let minute = 0; minute < 3 * 24 * 60; minute += 5) await tick(minute);
    expect(sendAlert).toHaveBeenCalledTimes(12);
    expect(sendAlert.mock.calls[0]?.[0].text).not.toContain("Reminder:");
    expect(sendAlert.mock.calls.slice(1).every(([message]) => message.text.startsWith("Reminder:"))).toBe(true);
  });

  it("does no work when alerts are unconfigured", async () => {
    expect(await runHostedWorkflowHeartbeatAlertMonitor({ env: {}, engine })).toEqual({ configured: false, outcome: "disabled" });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(engine.start).not.toHaveBeenCalled();
  });
});
