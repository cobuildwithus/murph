import { beforeEach, describe, expect, it, vi } from "vitest";

import { DatabaseHealthMonitor } from "../src/database-health/monitor.ts";
import { createTestSqlStorage } from "./sql-storage.ts";
import { buildMetricsBody } from "./helpers/database-health.ts";

const BRANCH_ID = "branch_test";
const FIVE_MINUTES_MS = 5 * 60 * 1_000;
const THIRTY_MINUTES_MS = 30 * 60 * 1_000;

interface LinqRequestBody {
  message: {
    idempotency_key: string;
    parts: Array<{
      type: string;
      value: string;
    }>;
  };
  to: string[];
}

describe("database health monitor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("persists samples and sends no Linq page for healthy database metrics", async () => {
    const harness = createMonitorHarness();

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves.toEqual({
      conditions: [],
      outcome: "healthy",
      sampleStatus: "ok",
    });

    expect(harness.monitor.readRecentSamples()).toEqual([
      expect.objectContaining({
        clientWaitSeconds: 0,
        directConnectionErrorDelta: 0,
        observedAtMs: FIVE_MINUTES_MS,
        scrapeStatus: "ok",
        serverPoolSaturationRatio: 0.2,
      }),
    ]);
    expect(harness.linqRequests).toEqual([]);
  });

  it("pages at most every 30 minutes and rotates evidence-bearing copy", async () => {
    const harness = createMonitorHarness({
      metricsBody: buildMetricsBody({
        branchId: BRANCH_ID,
        clientWaitSeconds: 8,
      }),
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_sent" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + 10 * 60 * 1_000),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + THIRTY_MINUTES_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    expect(harness.linqRequests).toHaveLength(2);
    const first = await readLinqRequestBody(harness.linqRequests[0]);
    const second = await readLinqRequestBody(harness.linqRequests[1]);
    expect(new URL(harness.linqRequests[0]?.url ?? "").pathname)
      .toBe("/api/partner/v3/messages");
    expect(harness.linqRequests[0]?.headers.get("idempotency-key"))
      .toBe(first.message.idempotency_key);
    expect(first.message.parts[0]?.value).toContain("PgBouncer wait 8s");
    expect(first.message.parts[0]?.value).toContain("UTC");
    expect(first.to).toEqual(["+12025550123"]);
    expect(first).not.toHaveProperty("from");
    expect(second.message.parts[0]?.value).not.toBe(first.message.parts[0]?.value);
    expect(second.message.idempotency_key).not.toBe(first.message.idempotency_key);
  });

  it("keeps the 30-minute attempt fence across recovery and a new incident", async () => {
    let metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 8,
    });
    const harness = createMonitorHarness({
      readMetricsBody: () => metricsBody,
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_sent" });
    metricsBody = buildMetricsBody({ branchId: BRANCH_ID });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({ outcome: "healthy" });
    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 9,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + THIRTY_MINUTES_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    expect(harness.linqRequests).toHaveLength(2);
  });

  it("paces provider attempts by wall time when cron delivery is delayed", async () => {
    const harness = createMonitorHarness({
      metricsBody: buildMetricsBody({
        branchId: BRANCH_ID,
        clientWaitSeconds: 8,
      }),
    });

    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS, FIVE_MINUTES_MS * 9),
    ).resolves.toMatchObject({ outcome: "alert_sent" });
    await expect(
      harness.runScheduledCheck(
        FIVE_MINUTES_MS + THIRTY_MINUTES_MS,
        FIVE_MINUTES_MS * 10,
      ),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });

    expect(harness.linqRequests).toHaveLength(1);
    expect(
      (await readLinqRequestBody(harness.linqRequests[0])).message.parts[0]?.value,
    ).toContain("Checked 00:45 UTC");
  });

  it.each(["AT_RISK", "CRITICAL", "OPTED_OUT"] as const)(
    "suppresses the message post when Linq chat health is %s",
    async (linqChatHealthStatus) => {
      const harness = createMonitorHarness({
        linqChatHealthStatus,
        metricsBody: buildMetricsBody({
          branchId: BRANCH_ID,
          clientWaitSeconds: 8,
        }),
      });

      await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
        .toMatchObject({ outcome: "alert_failed" });

      expect(harness.linqHealthRequests).toHaveLength(2);
      expect(harness.linqRequests).toEqual([]);
    },
  );

  it.each(["AT_RISK", "CRITICAL"] as const)(
    "suppresses the message post when Linq line reputation is %s",
    async (linqLineReputationStatus) => {
      const harness = createMonitorHarness({
        linqLineReputationStatus,
        metricsBody: buildMetricsBody({
          branchId: BRANCH_ID,
          clientWaitSeconds: 8,
        }),
      });

      await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
        .toMatchObject({ outcome: "alert_failed" });

      expect(harness.linqHealthRequests).toHaveLength(2);
      expect(harness.linqRequests).toEqual([]);
    },
  );

  it("fails closed when Linq delivery health cannot be determined", async () => {
    const harness = createMonitorHarness({
      linqHealthResponses: [
        () => new Response(null, { status: 503 }),
      ],
      metricsBody: buildMetricsBody({
        branchId: BRANCH_ID,
        clientWaitSeconds: 8,
      }),
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_failed" });

    expect(harness.linqRequests).toEqual([]);
  });

  it("reuses the exact body and idempotency key after an ambiguous Linq failure", async () => {
    const harness = createMonitorHarness({
      linqResponses: [
        () => {
          throw new Error("connection reset after request");
        },
        () => new Response(null, { status: 200 }),
      ],
      metricsBody: buildMetricsBody({
        branchId: BRANCH_ID,
        serverConnections: 46,
      }),
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_failed" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + THIRTY_MINUTES_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    expect(harness.linqRequests).toHaveLength(2);
    expect(await readLinqRequestBody(harness.linqRequests[1])).toEqual(
      await readLinqRequestBody(harness.linqRequests[0]),
    );
  });

  it("pages only after two consecutive scrape failures and clears after recovery", async () => {
    const harness = createMonitorHarness({
      serviceDiscoveryResponses: [
        () => new Response(null, { status: 503 }),
        () => new Response(null, { status: 503 }),
      ],
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves.toEqual({
      conditions: [],
      outcome: "healthy",
      sampleStatus: "failed",
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({
      conditions: [
        {
          failures: 2,
          kind: "monitoring_unavailable",
        },
      ],
      outcome: "alert_sent",
      sampleStatus: "failed",
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3),
    ).resolves.toMatchObject({
      outcome: "healthy",
      sampleStatus: "ok",
    });

    expect(harness.monitor.readAlertState()).toMatchObject({
      consecutiveScrapeFailures: 0,
      incidentOpen: false,
    });
    expect(harness.linqRequests).toHaveLength(1);
  });

  it("does not treat one failed scrape as recovery from an open incident", async () => {
    let metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 8,
    });
    const harness = createMonitorHarness({
      linqResponses: [
        () => {
          throw new Error("ambiguous send");
        },
      ],
      readMetricsBody: () => metricsBody,
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_failed" });
    const pendingBeforeFailure = harness.monitor.readAlertState();
    metricsBody = "";
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({
      conditions: [],
      outcome: "healthy",
      sampleStatus: "failed",
    });

    expect(harness.monitor.readAlertState()).toMatchObject({
      incidentOpen: true,
      pendingAlertIdempotencyKey:
        pendingBeforeFailure.pendingAlertIdempotencyKey,
      pendingAlertMessage: pendingBeforeFailure.pendingAlertMessage,
    });

    metricsBody = buildMetricsBody({ branchId: BRANCH_ID });
    await harness.runScheduledCheck(FIVE_MINUTES_MS * 3);
    expect(harness.monitor.readAlertState()).toMatchObject({
      incidentOpen: false,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
  });

  it("detects direct migration admission failures from positive 5432 counter deltas", async () => {
    let metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 5,
    });
    const harness = createMonitorHarness({
      readMetricsBody: () => metricsBody,
    });

    await harness.runScheduledCheck(FIVE_MINUTES_MS);
    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 7,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({
      conditions: [
        {
          count: 2,
          kind: "direct_migration_admission_failures",
        },
      ],
      outcome: "alert_sent",
    });

    expect(
      (await readLinqRequestBody(harness.linqRequests[0])).message.parts[0]?.value,
    ).toContain("2 direct migration connection errors");
  });

  it("keeps the service token on discovery and uses signed scrape parameters", async () => {
    const harness = createMonitorHarness();

    await harness.runScheduledCheck(FIVE_MINUTES_MS);

    expect(harness.planetScaleRequests).toHaveLength(2);
    const [discoveryRequest, metricsRequest] = harness.planetScaleRequests;
    if (!discoveryRequest || !metricsRequest) {
      throw new Error("Expected discovery and metrics requests.");
    }
    expect(discoveryRequest.headers.get("authorization"))
      .toBe("token service-token-id:service-token");
    expect(metricsRequest.headers.get("authorization")).toBeNull();
    expect(new URL(metricsRequest.url).searchParams.get("sig"))
      .toBe("signed-scrape-token");
    expect(new URL(metricsRequest.url).searchParams.get("exp"))
      .toBe("2000000000");
    for (const request of [discoveryRequest, metricsRequest]) {
      expect(request).toBeDefined();
      expect(request.url).not.toContain("service-token-id");
      expect(request.url).not.toContain("service-token");
      expect(request.redirect).toBe("error");
    }
  });

  it("rejects an unsafe discovered target before scrape egress", async () => {
    const harness = createMonitorHarness({
      serviceDiscoveryResponses: [
        () =>
          Response.json([
            {
              labels: {
                __metrics_path__: "/metrics",
                __scheme__: "https",
                planetscale_database_branch_id: BRANCH_ID,
              },
              targets: ["metrics.planetscale.test/redirect"],
            },
          ]),
      ],
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({
        outcome: "healthy",
        sampleStatus: "failed",
      });

    expect(harness.planetScaleRequests).toHaveLength(1);
    expect(harness.linqRequests).toEqual([]);
  });

  it("prunes metric history older than 30 days", async () => {
    const harness = createMonitorHarness();
    const firstObservedAt = FIVE_MINUTES_MS;
    const afterRetention =
      firstObservedAt + 31 * 24 * 60 * 60 * 1_000;

    await harness.runScheduledCheck(firstObservedAt);
    await harness.runScheduledCheck(afterRetention);

    expect(harness.monitor.readRecentSamples()).toHaveLength(1);
    expect(harness.monitor.readRecentSamples()[0]?.observedAtMs)
      .toBe(afterRetention);
  });
});

function createMonitorHarness(input: {
  linqChatHealthStatus?: "AT_RISK" | "CRITICAL" | "HEALTHY" | "OPTED_OUT";
  linqHealthResponses?: Array<() => Response | Promise<Response>>;
  linqLineReputationStatus?: "AT_RISK" | "CRITICAL" | "HEALTHY";
  linqResponses?: Array<() => Response | Promise<Response>>;
  metricsBody?: string;
  readMetricsBody?: () => string;
  serviceDiscoveryResponses?: Array<() => Response | Promise<Response>>;
} = {}) {
  const sql = createTestSqlStorage();
  const linqHealthRequests: Request[] = [];
  const linqRequests: Request[] = [];
  const planetScaleRequests: Request[] = [];
  let nowMs = FIVE_MINUTES_MS;
  const linqHealthResponses = [...(input.linqHealthResponses ?? [])];
  const linqResponses = [...(input.linqResponses ?? [])];
  const serviceDiscoveryResponses = [
    ...(input.serviceDiscoveryResponses ?? []),
  ];
  const fetchImplementation = vi.fn(async (
    requestInput: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(requestInput, init);
    const url = new URL(request.url);
    if (url.hostname === "api.planetscale.com") {
      planetScaleRequests.push(request);
      const next = serviceDiscoveryResponses.shift();
      if (next) {
        return await next();
      }
      return Response.json([
        {
          labels: {
            __metrics_path__: "/metrics",
            __param_exp: "2000000000",
            __param_sig: "signed-scrape-token",
            __scheme__: "https",
            planetscale_database_branch_id: BRANCH_ID,
          },
          targets: ["metrics.planetscale.test"],
        },
      ]);
    }
    if (url.hostname === "metrics.planetscale.test") {
      planetScaleRequests.push(request);
      return new Response(
        input.readMetricsBody?.()
          ?? input.metricsBody
          ?? buildMetricsBody({ branchId: BRANCH_ID }),
        { status: 200 },
      );
    }
    if (url.hostname === "api.linqapp.com") {
      if (request.method === "GET") {
        linqHealthRequests.push(request);
        const next = linqHealthResponses.shift();
        if (next) {
          return await next();
        }
        if (url.pathname.endsWith("/phone_numbers")) {
          return Response.json({
            phone_numbers: [
              {
                phone_number: "+12025550122",
                reputation: {
                  status: input.linqLineReputationStatus ?? "HEALTHY",
                },
              },
            ],
          });
        }
        return Response.json({
          handles: [
            {
              handle: "+12025550122",
              is_me: true,
              service: "iMessage",
              status: "active",
            },
            {
              handle: "+12025550123",
              is_me: false,
              service: "iMessage",
              status: "active",
            },
          ],
          health_status: {
            status: input.linqChatHealthStatus ?? "HEALTHY",
          },
          is_group: false,
        });
      }
      linqRequests.push(request);
      const next = linqResponses.shift();
      return next ? await next() : new Response(null, { status: 202 });
    }
    throw new Error(`Unexpected database health request host: ${url.hostname}`);
  });
  const monitor = new DatabaseHealthMonitor(
    sql,
    {
      HOSTED_DATABASE_ALERT_LINQ_CHAT_ID: "chat_test",
      HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID: BRANCH_ID,
      HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION: "org-test",
      HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN: "service-token",
      HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID: "service-token-id",
      LINQ_API_TOKEN: "linq-token",
    },
    fetchImplementation,
    () => nowMs,
  );

  return {
    fetchImplementation,
    linqHealthRequests,
    linqRequests,
    monitor,
    planetScaleRequests,
    runScheduledCheck(
      scheduledAtMs: number,
      currentTimeMs: number = scheduledAtMs,
    ) {
      nowMs = currentTimeMs;
      return monitor.runScheduledCheck(scheduledAtMs);
    },
  };
}

async function readLinqRequestBody(
  request: Request | undefined,
): Promise<LinqRequestBody> {
  if (!request) {
    throw new Error("Expected a Linq request.");
  }
  return await request.clone().json() as LinqRequestBody;
}
