import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ incident: vi.fn() }));
vi.mock("@/src/lib/hosted-operational-alert/incident-email-monitor", async (load) => ({
  ...await load<typeof import("@/src/lib/hosted-operational-alert/incident-email-monitor")>(),
  runHostedOperationalEmailIncident: mocks.incident,
}));
import { readHostedStarterAbuseHealth, runHostedStarterAbuseAlertMonitor } from "@/src/lib/hosted-execution/starter-abuse-alert-monitor";
const now = new Date("2026-08-20T12:00:00Z");
const env = { RESEND_API_KEY: "re_test", HOSTED_LINQ_ALERT_EMAIL_FROM: "alerts@example.test", HOSTED_LINQ_ALERT_EMAILS: "ops@example.test" };
describe("Starter abuse signals", () => {
  beforeEach(() => vi.resetAllMocks());
  it.each([
    [9, 2, 20, false], [10, 0, 20, true], [0, 3, 20, true], [0, 0, 1000, true],
  ])("evaluates signup/use thresholds and sample saturation", async (recentSignups, rapidUseAccounts, sampleSize, anomalous) => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ recentSignups, rapidUseAccounts, sampleSize }]) };
    await expect(readHostedStarterAbuseHealth({ now, prisma: prisma as never })).resolves.toMatchObject({ anomalous, recentSignups, rapidUseAccounts });
  });
  it("uses the existing operational incident owner and recipients", async () => {
    const health = { anomalous: true, recentSignups: 10, rapidUseAccounts: 0, sampleSaturated: false };
    mocks.incident.mockResolvedValue({ health, outcome: "alert_sent" });
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ recentSignups: 10, rapidUseAccounts: 0, sampleSize: 10 }]) };
    await runHostedStarterAbuseAlertMonitor({ env, now, prisma: prisma as never });
    const input = mocks.incident.mock.calls[0]?.[0];
    expect(input.initialHealth).toEqual(health);
    expect(input.spec.id).toBe("hosted-starter-abuse-monitor:v1");
    expect(JSON.stringify(input.alertConfig)).toContain("ops@example.test");
    const message = input.spec.buildMessage({ health, now, notificationKind: "initial" });
    expect(message).toContain("not confirmed abuse");
    expect(message).toContain("https://www.withmurph.ai/ops/growth");
  });
});
