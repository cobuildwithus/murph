import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runHostedRuntimeLatencyAlertMonitor: vi.fn(),
}));

vi.mock("@/src/lib/hosted-runtime-latency/alert-monitor", () => ({
  runHostedRuntimeLatencyAlertMonitor:
    mocks.runHostedRuntimeLatencyAlertMonitor,
}));

import { GET } from "@/app/api/internal/hosted-runtime/latency-alert/cron/route";

const originalCronSecret = process.env.CRON_SECRET;

describe("hosted runtime latency alert cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "latency-cron-secret";
    mocks.runHostedRuntimeLatencyAlertMonitor.mockReset();
    mocks.runHostedRuntimeLatencyAlertMonitor.mockResolvedValue({
      configured: true,
      health: {
        anomalous: false,
      },
      outcome: "healthy",
    });
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it("runs the monitor for an authenticated Vercel cron request", async () => {
    const response = await GET(new Request(
      "https://example.test/api/internal/hosted-runtime/latency-alert/cron",
      {
        headers: {
          authorization: "Bearer latency-cron-secret",
        },
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.runHostedRuntimeLatencyAlertMonitor).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
  });

  it("rejects unauthenticated requests without evaluating latency", async () => {
    const response = await GET(new Request(
      "https://example.test/api/internal/hosted-runtime/latency-alert/cron",
    ));

    expect(response.status).toBe(401);
    expect(mocks.runHostedRuntimeLatencyAlertMonitor).not.toHaveBeenCalled();
  });
});
