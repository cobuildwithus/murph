/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type {
  WorkerEnvironmentSource,
} from "../../src/worker-routes/shared.ts";
import worker, {
  type VitestDatabaseHealthDurableObject,
} from "./worker-entry.ts";

describe("database health scheduled Worker path", () => {
  it("dispatches through the real SQLite Durable Object and persists the sample", async () => {
    const scheduledAtMs = Date.now();
    const context = createExecutionContext();
    worker.scheduled(createScheduledController({
      cron: "*/5 * * * *",
      scheduledTime: new Date(scheduledAtMs),
    }), env as WorkerEnvironmentSource, context);
    await waitOnExecutionContext(context);
    const namespace = (
      env as typeof env & {
        DATABASE_HEALTH_MONITOR:
          DurableObjectNamespace<VitestDatabaseHealthDurableObject>;
      }
    ).DATABASE_HEALTH_MONITOR;
    const samples = await namespace
      .getByName("production")
      .readRecentSamples({ limit: 10 });
    const alertState = await namespace
      .getByName("production")
      .readAlertState();

    expect(samples).toEqual([
      expect.objectContaining({
        clientWaitSeconds: 8,
        observedAtMs: scheduledAtMs,
        scrapeStatus: "ok",
      }),
    ]);
    expect(alertState).toMatchObject({
      alertSequence: 1,
      incidentOpen: true,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
  });
});
