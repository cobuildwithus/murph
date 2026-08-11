import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runHostedRuntimeLatencyAlertMonitor: vi.fn(),
  runHostedRuntimeProgressAlertMonitor: vi.fn(),
}));

vi.mock("@/src/lib/hosted-runtime-latency/alert-monitor", () => ({
  runHostedRuntimeLatencyAlertMonitor:
    mocks.runHostedRuntimeLatencyAlertMonitor,
}));

vi.mock("@/src/lib/hosted-runtime-progress/alert-monitor", () => ({
  runHostedRuntimeProgressAlertMonitor:
    mocks.runHostedRuntimeProgressAlertMonitor,
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
    mocks.runHostedRuntimeProgressAlertMonitor.mockReset();
    mocks.runHostedRuntimeProgressAlertMonitor.mockResolvedValue({
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
    expect(mocks.runHostedRuntimeProgressAlertMonitor).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
  });

  it("rejects unauthenticated requests without evaluating latency", async () => {
    const response = await GET(new Request(
      "https://example.test/api/internal/hosted-runtime/latency-alert/cron",
    ));

    expect(response.status).toBe(401);
    expect(mocks.runHostedRuntimeLatencyAlertMonitor).not.toHaveBeenCalled();
    expect(mocks.runHostedRuntimeProgressAlertMonitor).not.toHaveBeenCalled();
  });

  it.each([
    {
      failing: "progress",
    },
    {
      failing: "latency",
    },
  ] as const)(
    "awaits the sibling monitor before reporting a $failing failure",
    async ({ failing }) => {
      let releaseHeldMonitor: (() => void) | undefined;
      let heldMonitorFinished = false;
      const heldMonitor = new Promise<void>((resolve) => {
        releaseHeldMonitor = resolve;
      }).then(() => {
        heldMonitorFinished = true;
        return {
          configured: true,
          health: { anomalous: false },
          outcome: "healthy",
        };
      });
      const failedMonitor = Promise.reject(new Error(`${failing} failed`));

      mocks.runHostedRuntimeLatencyAlertMonitor.mockReturnValue(
        failing === "latency" ? failedMonitor : heldMonitor,
      );
      mocks.runHostedRuntimeProgressAlertMonitor.mockReturnValue(
        failing === "progress" ? failedMonitor : heldMonitor,
      );

      let routeSettled = false;
      const responsePromise = GET(new Request(
        "https://example.test/api/internal/hosted-runtime/latency-alert/cron",
        {
          headers: {
            authorization: "Bearer latency-cron-secret",
          },
        },
      )).then((response) => {
        routeSettled = true;
        return response;
      });

      await vi.waitFor(() => {
        expect(mocks.runHostedRuntimeLatencyAlertMonitor).toHaveBeenCalled();
        expect(mocks.runHostedRuntimeProgressAlertMonitor).toHaveBeenCalled();
      });
      await Promise.resolve();
      expect(routeSettled).toBe(false);
      expect(heldMonitorFinished).toBe(false);

      releaseHeldMonitor?.();
      const response = await responsePromise;

      expect(heldMonitorFinished).toBe(true);
      expect(response.status).toBe(500);
    },
  );
});
