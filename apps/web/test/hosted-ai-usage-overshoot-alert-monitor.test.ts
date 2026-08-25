import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runHostedOperationalEmailIncident: vi.fn(),
}));

vi.mock("@/src/lib/hosted-operational-alert/incident-email-monitor", async (load) => {
  const actual = await load<typeof import(
    "@/src/lib/hosted-operational-alert/incident-email-monitor"
  )>();
  return {
    ...actual,
    runHostedOperationalEmailIncident: mocks.runHostedOperationalEmailIncident,
  };
});

import {
  HOSTED_AI_USAGE_OVERSHOOT_PERCENT,
  readHostedAiUsageOvershootHealth,
  runHostedAiUsageOvershootAlertMonitor,
} from "@/src/lib/hosted-execution/usage-overshoot-alert-monitor";

const now = new Date("2026-08-24T12:00:00.000Z");
const alertEnv = {
  HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph Alerts <alerts@example.test>",
  HOSTED_LINQ_ALERT_EMAILS: "operator@example.test",
  HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE: "America/New_York",
  RESEND_API_KEY: "re_test",
};

describe("hosted AI usage overshoot alert monitor", () => {
  it.each([
    { anomalous: false, exceeded: false },
    { anomalous: true, exceeded: true },
  ])("reads only whether a current allowance breached the threshold", async ({
    anomalous,
    exceeded,
  }) => {
    const queryRaw = vi.fn(async (_query: unknown) => {
      void _query;
      return [{ exceeded }];
    });

    await expect(readHostedAiUsageOvershootHealth({
      now,
      prisma: { $queryRaw: queryRaw } as never,
    })).resolves.toEqual({
      anomalous,
      thresholdPercent: 20,
    });

    const query = queryRaw.mock.calls[0]?.[0];
    if (
      typeof query !== "object"
      || query === null
      || !("strings" in query)
      || !Array.isArray(query.strings)
    ) {
      throw new TypeError("Expected a Prisma SQL query.");
    }
    const sql = query.strings.join(" ").replace(/\s+/gu, " ");
    expect(sql).toContain("SELECT EXISTS");
    expect(sql).toContain("period.blocked_at IS NOT NULL");
    expect(sql).toContain(
      "period.spent_usd_micros * 5 > period.limit_usd_micros * 6",
    );
    expect(sql).not.toContain("hosted_ai_usage AS usage");
  });

  it("reuses the operational Resend incident with its own identity", async () => {
    const health = {
      anomalous: true,
      thresholdPercent: HOSTED_AI_USAGE_OVERSHOOT_PERCENT,
    };
    const queryRaw = vi.fn(async (_query: unknown) => {
      void _query;
      return [{ exceeded: true }];
    });
    mocks.runHostedOperationalEmailIncident.mockResolvedValueOnce({
      health,
      outcome: "alert_sent",
    });

    await expect(runHostedAiUsageOvershootAlertMonitor({
      env: alertEnv,
      now,
      prisma: {
        $queryRaw: queryRaw,
        hostedLinqAlert: {},
      } as never,
    })).resolves.toMatchObject({
      configured: true,
      health,
      outcome: "alert_sent",
    });

    const call = mocks.runHostedOperationalEmailIncident.mock.calls[0]?.[0];
    expect(call.spec).toMatchObject({
      id: "hosted-ai-usage-overshoot-monitor:v1",
      kind: "hosted_ai_usage_overshoot_monitor",
      subject: "Hosted AI allowance overshoot exceeded",
    });
    expect(call.spec.id).not.toBe("hosted-runtime-progress-monitor:v1");
    expect(call.spec.buildMessage({
      health,
      notificationKind: "alert",
      now,
    })).toContain("more than 20%");
  });
});
