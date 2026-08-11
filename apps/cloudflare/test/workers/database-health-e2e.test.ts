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
import {
  readDatabaseHealthMessageRequests,
  resetDatabaseHealthMessageRequests,
  setDatabaseHealthClientWaitSeconds,
  setDatabaseHealthNowMs,
} from "./database-health-fetch.ts";

const FIVE_MINUTES_MS = 5 * 60 * 1_000;
const ONE_HOUR_MS = 60 * 60 * 1_000;

describe("database health scheduled Worker path", () => {
  it("retains a truthful page through recovery and the hourly fence", async () => {
    resetDatabaseHealthMessageRequests();
    const scheduledAtMs = Date.now();
    setDatabaseHealthNowMs(scheduledAtMs);
    await runDatabaseHealthCron(scheduledAtMs);
    const namespace = readDatabaseHealthNamespace();
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
    const messageRequests = readDatabaseHealthMessageRequests();
    expect(messageRequests).toHaveLength(2);
    const primary = messageRequests.find(
      (request) => request.recipient === "+12025550123",
    );
    const secondary = messageRequests.find(
      (request) => request.recipient === "+12025550124",
    );
    expect(primary).toMatchObject({
      idempotencyKey: "murph-db-1-1",
    });
    expect(secondary).toMatchObject({
      idempotencyKey: "murph-db-1-1-recipient-2",
    });
    expect(secondary?.messageParts).toEqual(primary?.messageParts);

    setDatabaseHealthClientWaitSeconds(0);
    setDatabaseHealthNowMs(scheduledAtMs + FIVE_MINUTES_MS);
    await runDatabaseHealthCron(scheduledAtMs + FIVE_MINUTES_MS);

    setDatabaseHealthClientWaitSeconds(9);
    setDatabaseHealthNowMs(scheduledAtMs + FIVE_MINUTES_MS * 2);
    await runDatabaseHealthCron(scheduledAtMs + FIVE_MINUTES_MS * 2);
    const pendingState = await namespace
      .getByName("production")
      .readAlertState();
    expect(readDatabaseHealthMessageRequests()).toHaveLength(2);
    expect(pendingState.pendingAlertMessage).toContain("PgBouncer wait 9s");
    expect(pendingState.pendingAlertMessage)
      .not.toMatch(
        /\b(?:active|availability|capacity|connection|current|degraded|headroom|live|now|pressure|remains?|still|threshold|unresolved|utilization)\b/iu,
      );

    setDatabaseHealthClientWaitSeconds(0);
    setDatabaseHealthNowMs(scheduledAtMs + FIVE_MINUTES_MS * 3);
    await runDatabaseHealthCron(scheduledAtMs + FIVE_MINUTES_MS * 3);
    expect(readDatabaseHealthMessageRequests()).toHaveLength(2);

    setDatabaseHealthNowMs(scheduledAtMs + ONE_HOUR_MS);
    await runDatabaseHealthCron(scheduledAtMs + ONE_HOUR_MS);
    const retriedMessageRequests = readDatabaseHealthMessageRequests();
    expect(retriedMessageRequests).toHaveLength(4);
    expect(retriedMessageRequests[2]?.messageParts[0]?.value)
      .toBe(pendingState.pendingAlertMessage);
    expect(retriedMessageRequests[3]?.messageParts)
      .toEqual(retriedMessageRequests[2]?.messageParts);
    expect(
      await namespace.getByName("production").readAlertState(),
    ).toMatchObject({
      incidentOpen: false,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
  });
});

function readDatabaseHealthNamespace(): DurableObjectNamespace<
  VitestDatabaseHealthDurableObject
> {
  return (
    env as typeof env & {
      DATABASE_HEALTH_MONITOR:
        DurableObjectNamespace<VitestDatabaseHealthDurableObject>;
    }
  ).DATABASE_HEALTH_MONITOR;
}

async function runDatabaseHealthCron(scheduledAtMs: number): Promise<void> {
  const context = createExecutionContext();
  worker.scheduled(createScheduledController({
    cron: "*/5 * * * *",
    scheduledTime: new Date(scheduledAtMs),
  }), env as WorkerEnvironmentSource, context);
  await waitOnExecutionContext(context);
}
