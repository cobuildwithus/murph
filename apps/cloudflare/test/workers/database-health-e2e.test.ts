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
  readDatabaseHealthPlanetScaleRequestCounts,
  resetDatabaseHealthMessageRequests,
  setDatabaseHealthClientWaitSeconds,
  setDatabaseHealthMissingConnectionErrorPortScrapes,
  setDatabaseHealthMissingConnectionErrorScrapesRemaining,
  setDatabaseHealthNowMs,
  setDatabaseHealthPooledErrors,
  setDatabaseHealthZeroEvidenceScrapesRemaining,
} from "./database-health-fetch.ts";

const FIVE_MINUTES_MS = 5 * 60 * 1_000;
const ONE_HOUR_MS = 60 * 60 * 1_000;

describe("database health scheduled Worker path", () => {
  it("retries one unavailable collection inside the scheduled Durable Object run", async () => {
    resetDatabaseHealthMessageRequests();
    const scheduledAtMs = Date.now();
    setDatabaseHealthNowMs(scheduledAtMs);
    setDatabaseHealthClientWaitSeconds(0);
    setDatabaseHealthZeroEvidenceScrapesRemaining(1);

    const namespace = readDatabaseHealthNamespace();
    const monitor = namespace.getByName("transient-retry");
    await monitor.runScheduledCheck({ scheduledAtMs });

    await expect(
      monitor.readRecentSamples({ limit: 10 }),
    ).resolves.toEqual([
      expect.objectContaining({
        failureCode: null,
        observedAtMs: scheduledAtMs,
        scrapeStatus: "ok",
      }),
    ]);
    await expect(
      monitor.readAlertState(),
    ).resolves.toMatchObject({
      consecutiveScrapeFailures: 0,
      incidentOpen: false,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
    expect(readDatabaseHealthPlanetScaleRequestCounts()).toEqual({
      discovery: 2,
      metrics: 2,
    });
    expect(readDatabaseHealthMessageRequests()).toEqual([]);
  });

  it("retries one safe connection-error-family omission inside the scheduled Durable Object run", async () => {
    resetDatabaseHealthMessageRequests();
    const scheduledAtMs = Date.now();
    setDatabaseHealthNowMs(scheduledAtMs);
    setDatabaseHealthClientWaitSeconds(0);
    setDatabaseHealthMissingConnectionErrorScrapesRemaining(1);

    const namespace = readDatabaseHealthNamespace();
    const monitor = namespace.getByName("direct-counter-retry");
    await monitor.runScheduledCheck({ scheduledAtMs });

    await expect(
      monitor.readRecentSamples({ limit: 10 }),
    ).resolves.toEqual([
      expect.objectContaining({
        failureCode: null,
        observedAtMs: scheduledAtMs,
        scrapeStatus: "ok",
      }),
    ]);
    await expect(
      monitor.readAlertState(),
    ).resolves.toMatchObject({
      consecutiveScrapeFailures: 0,
      incidentOpen: false,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
    expect(readDatabaseHealthPlanetScaleRequestCounts()).toEqual({
      discovery: 2,
      metrics: 2,
    });
    expect(readDatabaseHealthMessageRequests()).toEqual([]);
  });

  it("does not page for a sparse port through the scheduled Durable Object", async () => {
    resetDatabaseHealthMessageRequests();
    const scheduledAtMs = Date.now();
    setDatabaseHealthNowMs(scheduledAtMs);
    setDatabaseHealthClientWaitSeconds(0);
    setDatabaseHealthMissingConnectionErrorPortScrapes({
      port: "6432",
      scrapes: 4,
    });

    const monitor = readDatabaseHealthNamespace().getByName(
      "pooled-counter-telemetry",
    );
    await monitor.runScheduledCheck({ scheduledAtMs });
    setDatabaseHealthNowMs(scheduledAtMs + FIVE_MINUTES_MS);
    await monitor.runScheduledCheck({
      scheduledAtMs: scheduledAtMs + FIVE_MINUTES_MS,
    });

    expect(readDatabaseHealthPlanetScaleRequestCounts()).toEqual({
      discovery: 2,
      metrics: 2,
    });
    expect(readDatabaseHealthMessageRequests()).toEqual([]);
    await expect(monitor.readAlertState()).resolves.toMatchObject({
      consecutiveScrapeFailures: 0,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
  });

  it("pages a pooled connection-error delta through a scheduled monitor", async () => {
    resetDatabaseHealthMessageRequests();
    const scheduledAtMs = Date.now();
    setDatabaseHealthNowMs(scheduledAtMs);
    setDatabaseHealthClientWaitSeconds(0);
    setDatabaseHealthPooledErrors(5);
    const monitor = readDatabaseHealthNamespace().getByName("pooled-errors");
    await monitor.runScheduledCheck({ scheduledAtMs });
    expect(readDatabaseHealthMessageRequests()).toEqual([]);

    setDatabaseHealthNowMs(scheduledAtMs + FIVE_MINUTES_MS);
    setDatabaseHealthPooledErrors(7);
    await monitor.runScheduledCheck({
      scheduledAtMs: scheduledAtMs + FIVE_MINUTES_MS,
    });

    const messageRequests = readDatabaseHealthMessageRequests();
    expect(messageRequests).toHaveLength(2);
    expect(messageRequests.map((request) => request.idempotencyKey).sort())
      .toEqual([
        "murph-db-1-1",
        "murph-db-1-1-recipient-2",
      ]);
    expect(messageRequests[1]?.messageParts)
      .toEqual(messageRequests[0]?.messageParts);
    const message = messageRequests[0]?.messageParts[0]?.value;
    expect(message).toContain(
      "2 pooled application connection errors (port 6432)",
    );
    await expect(
      monitor.readAlertState(),
    ).resolves.toMatchObject({
      incidentOpen: true,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
  });

  it("withdraws recovered telemetry before delivery and pages a new sustained gap", async () => {
    resetDatabaseHealthMessageRequests();
    const start = Date.now();
    const monitor = readDatabaseHealthNamespace().getByName("telemetry-recovery");
    const check = async (slot: number) => {
      const scheduledAtMs = start + FIVE_MINUTES_MS * slot;
      setDatabaseHealthNowMs(scheduledAtMs);
      return await monitor.runScheduledCheck({ scheduledAtMs });
    };
    await check(0);
    expect(readDatabaseHealthMessageRequests()).toHaveLength(2);
    setDatabaseHealthClientWaitSeconds(0);
    await check(1);
    setDatabaseHealthMissingConnectionErrorScrapesRemaining(12);
    for (const slot of [2, 3, 4, 5, 6]) {
      await check(slot);
      if (slot === 2) {
        const requestsBeforeReplay = readDatabaseHealthPlanetScaleRequestCounts();
        const samplesBeforeReplay = await monitor.readRecentSamples({ limit: 10 });
        setDatabaseHealthNowMs(start + FIVE_MINUTES_MS * slot + 10_000);
        await monitor.runScheduledCheck({ scheduledAtMs: start + FIVE_MINUTES_MS * slot });
        expect(readDatabaseHealthPlanetScaleRequestCounts()).toEqual(requestsBeforeReplay);
        await expect(monitor.readRecentSamples({ limit: 10 })).resolves.toEqual(samplesBeforeReplay);
        await expect(monitor.readAlertState()).resolves.toMatchObject({
          consecutiveScrapeFailures: 1,
        });
      }
      expect(readDatabaseHealthMessageRequests()).toHaveLength(2);
      await expect(monitor.readAlertState()).resolves.toMatchObject({
        monitoringAlertObligation: null,
      });
    }
    await check(7);
    await expect(monitor.readAlertState()).resolves.toMatchObject({
      consecutiveScrapeFailures: 6,
      monitoringAlertObligation: { failures: 6, incompleteChecks: 6 },
      pendingAlertMessage: null,
    });
    await check(8);
    await expect(monitor.readAlertState()).resolves.toMatchObject({
      incidentOpen: false, monitoringAlertObligation: null,
    });
    await check(12);
    expect(readDatabaseHealthMessageRequests()).toHaveLength(2);

    setDatabaseHealthMissingConnectionErrorScrapesRemaining(12);
    for (const slot of [13, 14, 15, 16, 17, 18]) await check(slot);
    const messages = readDatabaseHealthMessageRequests();
    expect(messages).toHaveLength(4);
    expect(messages[2]?.messageParts[0]?.value).toContain("incomplete for 6 checks");
    expect(messages[2]?.messageParts[0]?.value).toContain("5432 in 12/12; 6432 in 12/12");
    expect(messages[3]?.messageParts).toEqual(messages[2]?.messageParts);
  });

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
