import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedOperationalAlertMonitorSpec } from "@/src/lib/hosted-operational-alert/incident-email-monitor";
import type { DeviceImportPrisma } from "@/src/lib/hosted-runtime-progress/device-import-observation";
import { summarizeDeviceImportHealth, type DeviceImportHealth, type DeviceImportObservation } from "@/src/lib/hosted-runtime-progress/device-import-health";

const mocks = vi.hoisted(() => ({
  read: vi.fn(), incident: vi.fn(), query: vi.fn(), allowed: vi.fn(),
  workspaces: vi.fn(), logQuery: vi.fn(),
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  $queryRaw: mocks.query, hostedWorkspace: { findMany: mocks.workspaces },
}) }));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({ readHostedRuntimeAiAllowedMemberIds: mocks.allowed }));
vi.mock("@/src/lib/hosted-runtime-log/database", () => ({ getHostedRuntimeLogPool: () => ({ query: mocks.logQuery }) }));
vi.mock("@/src/lib/hosted-operational-alert/incident-email-monitor", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-operational-alert/incident-email-monitor")>(),
  runHostedOperationalEmailIncident: mocks.incident,
}));

import { runHostedDeviceImportAlertMonitor } from "@/src/lib/hosted-runtime-progress/device-import-alert-monitor";
import { readDeviceImportHealth, readDeviceImportObservations, DEVICE_IMPORT_MEMBER_LIMIT,
  DEVICE_IMPORT_EVENT_LIMIT } from "@/src/lib/hosted-runtime-progress/device-import-observation";
import { hostedRuntimeLogSubjectKey } from "@/src/lib/hosted-runtime-log/subject-key";

const now = new Date("2026-08-10T16:00:00Z");
const env = { HOSTED_LINQ_ALERT_EMAIL_FROM: "Alerts <alerts@example.test>",
  HOSTED_LINQ_ALERT_EMAILS: "operator@example.test", HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE: "UTC",
  RESEND_API_KEY: "re_test" };
const healthy = () => summarizeDeviceImportHealth({ now, observations: [], dueSubjects: new Set() });
type Spec = HostedOperationalAlertMonitorSpec<DeviceImportHealth, DeviceImportPrisma>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(healthy());
  mocks.incident.mockImplementation(async ({ initialHealth }: { initialHealth: DeviceImportHealth }) => ({ health: initialHealth, outcome: "healthy" }));
  mocks.query.mockResolvedValue([{ userId: "synthetic-active" }, { userId: "synthetic-inactive" }]);
  mocks.allowed.mockResolvedValue(new Set(["synthetic-active"]));
  mocks.workspaces.mockResolvedValue([{ userId: "synthetic-active", nextWakeAt: now, nextWakeReason: "device-sync.reconcile" }]);
  mocks.logQuery.mockResolvedValue({ rows: [] });
});

describe("device import incident integration", () => {
  it("uses independent incident identities, existing reminders, and quiet-hour policy", async () => {
    const result = await runHostedDeviceImportAlertMonitor({ now, env, readHealth: mocks.read });
    expect(result.conditions).toHaveLength(3);
    const specs: Spec[] = mocks.incident.mock.calls.map(([input]) => input.spec);
    expect(new Set(specs.map(spec => spec.id)).size).toBe(3);
    expect(specs.map(spec => spec.sendDuringQuietHours)).toEqual([true, undefined, undefined]);
    expect(specs.every(spec => spec.reminderIntervalMs === 6 * 60 * 60_000)).toBe(true);
    expect(specs[2]?.subject).toContain("notice");
    const firstInput = mocks.incident.mock.calls[0]?.[0];
    await specs[0]?.readHealth({ now, prisma: firstInput.prisma });
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it("formats only aggregate metadata for the shared incident owner", async () => {
    await runHostedDeviceImportAlertMonitor({ now, env, readHealth: mocks.read });
    const spec: Spec = mocks.incident.mock.calls[0]?.[0].spec;
    const health = { ...healthy().stalled, anomalous: true, affectedRuntimeCount: 2, oldestBacklogMs: 20 * 60_000 };
    expect(spec.buildMessage({ health, now, notificationKind: "alert" })).toContain("Affected runtimes: 2");
    const details = spec.buildDetails({ health, now, incidentId: null, phase: "alert" });
    expect(JSON.stringify(details)).not.toMatch(/subjectKey|userId|attemptId/);
  });

  it("awaits all conditions if one incident owner fails", async () => {
    mocks.incident.mockRejectedValueOnce(new Error("send failed"));
    await expect(runHostedDeviceImportAlertMonitor({ now, env, readHealth: mocks.read })).rejects.toThrow("send failed");
    expect(mocks.incident).toHaveBeenCalledTimes(3);
  });

  it("does not reset incidents to healthy when diagnostics fail", async () => {
    mocks.read.mockRejectedValueOnce(new Error("diagnostics unavailable"));
    await expect(runHostedDeviceImportAlertMonitor({ now, env, readHealth: mocks.read })).rejects.toThrow("diagnostics unavailable");
    expect(mocks.incident).not.toHaveBeenCalled();
  });

  it("does not scan or send when alerts are unconfigured", async () => {
    expect(await runHostedDeviceImportAlertMonitor({ now, env: {}, readHealth: mocks.read })).toEqual({ configured: false, conditions: [] });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.incident).not.toHaveBeenCalled();
  });
});

describe("bounded import diagnostic observation", () => {
  it.each([
    { overdueMinutes: -30, stalled: false },
    { overdueMinutes: 0, stalled: false },
    { overdueMinutes: 0.2, stalled: false },
    { overdueMinutes: 14.99, stalled: false },
    { overdueMinutes: 15, stalled: true },
    { overdueMinutes: 30, stalled: true },
  ])("gives a silent queue its scheduled wake grace ($overdueMinutes minutes overdue)", async ({ overdueMinutes, stalled }) => {
    mocks.workspaces.mockResolvedValueOnce([{ userId: "synthetic-active",
      nextWakeAt: new Date(+now - overdueMinutes * 60_000), nextWakeReason: "device-sync.reconcile" }]);
    const pending: DeviceImportObservation = {
      subjectKey: hostedRuntimeLogSubjectKey("synthetic-active"), connectionKey: "a".repeat(64),
      attemptId: "synthetic-attempt", at: new Date(+now - 45 * 60_000),
      eventCode: "device-sync.pass_finished", pending: true, progressed: false,
      checkpointAccepted: false, restarted: false, cancelled: false,
    };
    mocks.logQuery.mockResolvedValueOnce({ rows: [pending, { ...pending,
      at: new Date(+pending.at + 1_000), eventCode: "checkpoint.snapshot_finished",
      connectionKey: null, pending: null, checkpointAccepted: true,
    }] });

    expect((await readDeviceImportHealth({ now })).stalled.anomalous).toBe(stalled);
  });

  it("still detects repeated no-progress passes before a future wake", async () => {
    mocks.workspaces.mockResolvedValueOnce([{ userId: "synthetic-active",
      nextWakeAt: new Date(+now + 30 * 60_000), nextWakeReason: "device-sync.reconcile" }]);
    const rows: DeviceImportObservation[] = [20, 10, 1].map(minutesAgo => ({
      subjectKey: hostedRuntimeLogSubjectKey("synthetic-active"), connectionKey: "a".repeat(64),
      attemptId: "synthetic-attempt", at: new Date(+now - minutesAgo * 60_000),
      eventCode: "device-sync.pass_finished", pending: true, progressed: false,
      checkpointAccepted: false, restarted: false, cancelled: false,
    }));
    mocks.logQuery.mockResolvedValueOnce({ rows });

    expect((await readDeviceImportHealth({ now })).stalled.anomalous).toBe(true);
  });

  it("uses current admission authority and hashed subjects for the separate log database", async () => {
    await readDeviceImportHealth({ now });
    expect(mocks.allowed).toHaveBeenCalledWith(expect.objectContaining({ memberIds: ["synthetic-active", "synthetic-inactive"] }));
    expect(mocks.logQuery.mock.calls[0]?.[1][0]).toEqual([hostedRuntimeLogSubjectKey("synthetic-active")]);
    expect(mocks.logQuery.mock.calls[0]?.[1][3]).toBe(DEVICE_IMPORT_EVENT_LIMIT + 1);
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.workspaces).toHaveBeenCalledOnce();
    expect(mocks.logQuery).toHaveBeenCalledOnce();
  });

  it("skips the log store when no connection is eligible", async () => {
    mocks.allowed.mockResolvedValueOnce(new Set());
    expect((await readDeviceImportHealth({ now })).stalled.anomalous).toBe(false);
    expect(mocks.logQuery).not.toHaveBeenCalled();
  });

  it("keeps maximum-cardinality observation set-based and serial", async () => {
    const ids = Array.from({ length: DEVICE_IMPORT_MEMBER_LIMIT }, (_, index) => `synthetic-${index}`);
    mocks.query.mockResolvedValueOnce(ids.map(userId => ({ userId })));
    mocks.allowed.mockResolvedValueOnce(new Set(ids));
    mocks.workspaces.mockResolvedValueOnce([]);
    mocks.logQuery.mockImplementationOnce(async () => {
      expect(mocks.workspaces).toHaveBeenCalledOnce();
      return { rows: [] };
    });
    await readDeviceImportHealth({ now });
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.allowed).toHaveBeenCalledOnce();
    expect(mocks.workspaces).toHaveBeenCalledOnce();
    expect(mocks.logQuery).toHaveBeenCalledOnce();
    expect(mocks.logQuery.mock.calls[0]?.[1][0]).toHaveLength(DEVICE_IMPORT_MEMBER_LIMIT);
  });

  it("fails visibly on candidate or event truncation", async () => {
    mocks.query.mockResolvedValueOnce(Array.from({ length: DEVICE_IMPORT_MEMBER_LIMIT + 1 }, () => ({ userId: "synthetic" })));
    await expect(readDeviceImportHealth({ now })).rejects.toThrow("member scan is truncated");
    mocks.logQuery.mockResolvedValueOnce({ rows: Array.from({ length: DEVICE_IMPORT_EVENT_LIMIT + 1 }, () => ({})) });
    await expect(readDeviceImportObservations({ now, subjects: ["synthetic"] })).rejects.toThrow("event scan is truncated");
  });
});
