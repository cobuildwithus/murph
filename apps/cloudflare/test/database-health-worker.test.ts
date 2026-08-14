import { describe, expect, it, vi } from "vitest";

import worker from "../src/worker/index.ts";

describe("database health scheduled Worker dispatch", () => {
  it("routes the five-minute cron to the singleton database health object", async () => {
    const runScheduledCheck = vi.fn(async () => ({
      conditions: [],
      outcome: "healthy" as const,
      sampleStatus: "ok" as const,
    }));
    const getByName = vi.fn(() => ({ runScheduledCheck }));
    const runQueueScheduledCheck = vi.fn(async () => ({
      conditions: [],
      observationStatus: "ok" as const,
      outcome: "healthy" as const,
    }));
    const getQueueMonitorByName = vi.fn(() => ({
      runScheduledCheck: runQueueScheduledCheck,
    }));
    const waitUntilPromises: Promise<unknown>[] = [];

    worker.scheduled(
      {
        cron: "*/5 * * * *",
        scheduledTime: 1_800_000,
      } as ScheduledController,
      {
        DATABASE_HEALTH_MONITOR: {
          getByName,
        },
        DEVICE_WEBHOOK_QUEUE_MONITOR: {
          getByName: getQueueMonitorByName,
        },
        HOSTED_DATABASE_ALERT_ENABLED: "1",
      } as never,
      {
        waitUntil(promise) {
          waitUntilPromises.push(promise);
        },
      },
    );
    await Promise.all(waitUntilPromises);

    expect(getByName).toHaveBeenCalledWith("production");
    expect(runScheduledCheck).toHaveBeenCalledWith({
      scheduledAtMs: 1_800_000,
    });
    expect(getQueueMonitorByName).toHaveBeenCalledWith("production");
    expect(runQueueScheduledCheck).toHaveBeenCalledWith({
      scheduledAtMs: 1_800_000,
    });
  });

  it("does not activate database paging outside the opted-in production deploy", () => {
    const getByName = vi.fn();
    const getQueueMonitorByName = vi.fn();
    const waitUntil = vi.fn();

    worker.scheduled(
      {
        cron: "*/5 * * * *",
        scheduledTime: 1_800_000,
      } as ScheduledController,
      {
        DATABASE_HEALTH_MONITOR: {
          getByName,
        },
        DEVICE_WEBHOOK_QUEUE_MONITOR: {
          getByName: getQueueMonitorByName,
        },
      } as never,
      { waitUntil },
    );

    expect(getByName).not.toHaveBeenCalled();
    expect(getQueueMonitorByName).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
