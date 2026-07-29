import { beforeEach, describe, expect, it, vi } from "vitest";

import { DatabaseHealthMonitor } from "../src/database-health/monitor.ts";
import { createTestSqlStorage } from "./sql-storage.ts";
import { buildMetricsBody } from "./helpers/database-health.ts";

const BRANCH_ID = "branch_test";
const FIVE_MINUTES_MS = 5 * 60 * 1_000;
const THIRTY_MINUTES_MS = 30 * 60 * 1_000;
const POSTGRES_STATE_ALERT_CASES: ReadonlyArray<{
  condition: {
    count: number;
    kind:
      | "postgres_disabled_connections"
      | "postgres_idle_in_transaction";
  };
  evidence: string;
  postgresStates: Readonly<Record<string, number>>;
}> = [
  {
    condition: {
      count: 1,
      kind: "postgres_disabled_connections",
    },
    evidence: "1 disabled Postgres connection",
    postgresStates: {
      active: 5,
      disabled: 1,
      idle: 5,
    },
  },
  {
    condition: {
      count: 5,
      kind: "postgres_idle_in_transaction",
    },
    evidence: "5 idle-in-transaction connections",
    postgresStates: {
      active: 5,
      idle: 5,
      "idle in transaction": 5,
    },
  },
];

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

  it("admits only one collection while the durable run lease is held", async () => {
    const discoveryStarted = createDeferred<void>();
    const discoveryResponse = createDeferred<Response>();
    const harness = createMonitorHarness({
      serviceDiscoveryResponses: [
        () => {
          discoveryStarted.resolve();
          return discoveryResponse.promise;
        },
      ],
    });

    const firstRun = harness.runScheduledCheck(FIVE_MINUTES_MS);
    await discoveryStarted.promise;

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves.toEqual({
      conditions: [],
      outcome: "run_in_progress",
      sampleStatus: null,
    });
    expect(harness.planetScaleRequests).toHaveLength(1);

    discoveryResponse.resolve(createServiceDiscoveryResponse());
    await expect(firstRun).resolves.toMatchObject({ outcome: "healthy" });
    expect(harness.monitor.readRecentSamples()).toHaveLength(1);
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

  it.each([
    {
      label: "a formatted provider phone",
      phoneNumbersBody: {
        phone_numbers: [
          {
            phone_number: "+1 (202) 555-0122",
            reputation: {
              status: "HEALTHY",
            },
          },
        ],
      },
    },
    {
      label: "the documented top-level health alias",
      phoneNumbersBody: {
        phone_numbers: [
          {
            health_status: "HEALTHY",
            phone_number: "+12025550122",
            reputation: {
              status: null,
            },
          },
        ],
      },
    },
  ])(
    "accepts Linq inventory with $label",
    async ({ phoneNumbersBody }) => {
      const harness = createMonitorHarness({
        linqPhoneNumbersBody: phoneNumbersBody,
        metricsBody: buildMetricsBody({
          branchId: BRANCH_ID,
          clientWaitSeconds: 8,
        }),
      });

      await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
        .toMatchObject({ outcome: "alert_sent" });
      expect(harness.linqRequests).toHaveLength(1);
    },
  );

  it.each([
    {
      label: "duplicate matching lines",
      phoneNumbersBody: {
        phone_numbers: [
          {
            phone_number: "+12025550122",
            reputation: {
              status: "HEALTHY",
            },
          },
          {
            health_status: "HEALTHY",
            phone_number: "+1 (202) 555-0122",
          },
        ],
      },
    },
    {
      label: "a malformed line phone",
      phoneNumbersBody: {
        phone_numbers: [
          {
            phone_number: "not-a-phone",
            reputation: {
              status: "HEALTHY",
            },
          },
        ],
      },
    },
    {
      label: "a mismatched line phone",
      phoneNumbersBody: {
        phone_numbers: [
          {
            phone_number: "+12025550999",
            reputation: {
              status: "HEALTHY",
            },
          },
        ],
      },
    },
  ])(
    "suppresses the message post for $label",
    async ({ phoneNumbersBody }) => {
      const harness = createMonitorHarness({
        linqPhoneNumbersBody: phoneNumbersBody,
        metricsBody: buildMetricsBody({
          branchId: BRANCH_ID,
          clientWaitSeconds: 8,
        }),
      });

      await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
        .toMatchObject({ outcome: "alert_failed" });
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

  it.each([
    {
      chatBody: createLinqChatResponseBody({ isGroup: true }),
      label: "a group chat",
    },
    {
      chatBody: createLinqChatResponseBody({
        recipients: ["+12025550123", "+12025550124"],
      }),
      label: "multiple active external recipients",
    },
  ])(
    "keeps the pending alert without posting to $label",
    async ({ chatBody }) => {
      const harness = createMonitorHarness({
        linqHealthResponses: [
          () => Response.json(chatBody),
          () => Response.json(createHealthyLinqPhoneNumbersBody()),
        ],
        metricsBody: buildMetricsBody({
          branchId: BRANCH_ID,
          clientWaitSeconds: 8,
        }),
      });

      await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
        .toMatchObject({ outcome: "alert_failed" });
      const pendingAlert = harness.monitor.readAlertState();

      expect(harness.linqRequests).toEqual([]);
      expect(pendingAlert).toMatchObject({
        incidentOpen: true,
        pendingAlertIdempotencyKey: expect.any(String),
        pendingAlertMessage: expect.any(String),
      });

      await expect(
        harness.runScheduledCheck(FIVE_MINUTES_MS + THIRTY_MINUTES_MS),
      ).resolves.toMatchObject({ outcome: "alert_sent" });

      expect(harness.linqRequests).toHaveLength(1);
      const deliveredBody = await readLinqRequestBody(harness.linqRequests[0]);
      expect(deliveredBody.message.idempotency_key)
        .toBe(pendingAlert.pendingAlertIdempotencyKey);
      expect(deliveredBody.message.parts[0]?.value)
        .toBe(pendingAlert.pendingAlertMessage);
    },
  );

  it("reuses the exact body and idempotency key after restart and an ambiguous Linq failure", async () => {
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
    const pendingAlert = harness.monitor.readAlertState();
    harness.restartMonitor();
    expect(harness.monitor.readAlertState()).toMatchObject({
      pendingAlertIdempotencyKey: pendingAlert.pendingAlertIdempotencyKey,
      pendingAlertMessage: pendingAlert.pendingAlertMessage,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + 10 * 60 * 1_000),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    expect(harness.linqRequests).toHaveLength(1);
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + THIRTY_MINUTES_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    expect(harness.linqRequests).toHaveLength(2);
    expect(await readLinqRequestBody(harness.linqRequests[1])).toEqual(
      await readLinqRequestBody(harness.linqRequests[0]),
    );
    const retryBody = await readLinqRequestBody(harness.linqRequests[1]);
    expect(retryBody.message.idempotency_key)
      .toBe(pendingAlert.pendingAlertIdempotencyKey);
    expect(retryBody.message.parts[0]?.value)
      .toBe(pendingAlert.pendingAlertMessage);
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

  it("retains an admitted page across failed and healthy samples until delivery", async () => {
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
      outcome: "alert_deferred",
      sampleStatus: "failed",
    });

    expect(harness.monitor.readAlertState()).toMatchObject({
      incidentOpen: true,
      pendingAlertIdempotencyKey:
        pendingBeforeFailure.pendingAlertIdempotencyKey,
      pendingAlertMessage: pendingBeforeFailure.pendingAlertMessage,
    });

    metricsBody = buildMetricsBody({ branchId: BRANCH_ID });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    expect(harness.monitor.readAlertState()).toMatchObject({
      incidentOpen: true,
      pendingAlertIdempotencyKey:
        pendingBeforeFailure.pendingAlertIdempotencyKey,
      pendingAlertMessage: pendingBeforeFailure.pendingAlertMessage,
    });

    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + THIRTY_MINUTES_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });
    expect(harness.monitor.readAlertState()).toMatchObject({
      incidentOpen: false,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
    expect(harness.linqRequests).toHaveLength(2);
    expect(await readLinqRequestBody(harness.linqRequests[1])).toEqual(
      await readLinqRequestBody(harness.linqRequests[0]),
    );
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

  it("delivers a one-sample direct error admitted inside the attempt fence", async () => {
    let metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 8,
      directErrors: 5,
    });
    const harness = createMonitorHarness({
      readMetricsBody: () => metricsBody,
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_sent" });
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
      outcome: "alert_deferred",
    });
    const pendingAlert = harness.monitor.readAlertState();

    harness.restartMonitor();
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3),
    ).resolves.toMatchObject({
      conditions: [],
      outcome: "alert_deferred",
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + THIRTY_MINUTES_MS),
    ).resolves.toMatchObject({
      conditions: [],
      outcome: "alert_sent",
    });

    expect(harness.linqRequests).toHaveLength(2);
    const deliveredBody = await readLinqRequestBody(harness.linqRequests[1]);
    expect(deliveredBody.message.idempotency_key)
      .toBe(pendingAlert.pendingAlertIdempotencyKey);
    expect(deliveredBody.message.parts[0]?.value)
      .toBe(pendingAlert.pendingAlertMessage);
    expect(deliveredBody.message.parts[0]?.value)
      .toContain("2 direct migration connection errors");
    expect(harness.monitor.readAlertState()).toMatchObject({
      incidentOpen: false,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
  });

  it("retains a direct-error page suppressed by Linq health after recovery", async () => {
    let metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 5,
    });
    const harness = createMonitorHarness({
      linqHealthResponses: [
        () => new Response(null, { status: 503 }),
      ],
      readMetricsBody: () => metricsBody,
    });

    await harness.runScheduledCheck(FIVE_MINUTES_MS);
    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 7,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({ outcome: "alert_failed" });
    const pendingAlert = harness.monitor.readAlertState();
    expect(harness.linqRequests).toEqual([]);

    harness.restartMonitor();
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3),
    ).resolves.toMatchObject({
      conditions: [],
      outcome: "alert_deferred",
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2 + THIRTY_MINUTES_MS),
    ).resolves.toMatchObject({
      conditions: [],
      outcome: "alert_sent",
    });

    expect(harness.linqRequests).toHaveLength(1);
    const deliveredBody = await readLinqRequestBody(harness.linqRequests[0]);
    expect(deliveredBody.message.idempotency_key)
      .toBe(pendingAlert.pendingAlertIdempotencyKey);
    expect(deliveredBody.message.parts[0]?.value)
      .toBe(pendingAlert.pendingAlertMessage);
  });

  it("re-evaluates a direct error after alert admission and sample persistence roll back", async () => {
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
    harness.failBeforeNextSuccessfulSamplePersist();
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).rejects.toThrow("Injected successful sample persistence failure.");
    expect(harness.monitor.readAlertState()).toMatchObject({
      incidentOpen: false,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
    expect(harness.monitor.readRecentSamples()).toHaveLength(1);

    harness.restartMonitor();
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3),
    ).resolves.toMatchObject({
      conditions: [
        {
          count: 2,
          kind: "direct_migration_admission_failures",
        },
      ],
      outcome: "alert_sent",
    });
    expect(harness.linqRequests).toHaveLength(1);
  });

  it.each(POSTGRES_STATE_ALERT_CASES)(
    "pages with evidence for $condition.kind",
    async ({ condition, evidence, postgresStates }) => {
      const harness = createMonitorHarness({
        metricsBody: buildMetricsBody({
          branchId: BRANCH_ID,
          postgresStates,
        }),
      });

      await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
        .toMatchObject({
          conditions: [condition],
          outcome: "alert_sent",
        });
      expect(
        (await readLinqRequestBody(harness.linqRequests[0]))
          .message.parts[0]?.value,
      ).toContain(evidence);
    },
  );

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
  linqPhoneNumbersBody?: unknown;
  linqResponses?: Array<() => Response | Promise<Response>>;
  metricsBody?: string;
  readMetricsBody?: () => string;
  serviceDiscoveryResponses?: Array<() => Response | Promise<Response>>;
} = {}) {
  let failBeforeSuccessfulSamplePersist = false;
  const sql = createTestSqlStorage({
    beforeExec(query) {
      if (
        failBeforeSuccessfulSamplePersist
        && query.trimStart().startsWith(
          "INSERT INTO database_health_samples",
        )
        && query.includes("VALUES (?, 'ok'")
      ) {
        failBeforeSuccessfulSamplePersist = false;
        throw new Error("Injected successful sample persistence failure.");
      }
    },
  });
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
      return createServiceDiscoveryResponse();
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
          return Response.json(
            input.linqPhoneNumbersBody
              ?? createHealthyLinqPhoneNumbersBody(
                input.linqLineReputationStatus,
              ),
          );
        }
        return Response.json({
          ...createLinqChatResponseBody(),
          health_status: {
            status: input.linqChatHealthStatus ?? "HEALTHY",
          },
        });
      }
      linqRequests.push(request);
      const next = linqResponses.shift();
      return next ? await next() : new Response(null, { status: 202 });
    }
    throw new Error(`Unexpected database health request host: ${url.hostname}`);
  });
  const environment = {
    HOSTED_DATABASE_ALERT_LINQ_CHAT_ID: "chat_test",
    HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID: BRANCH_ID,
    HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION: "org-test",
    HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN: "service-token",
    HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID: "service-token-id",
    LINQ_API_TOKEN: "linq-token",
  };
  const createMonitor = () =>
    new DatabaseHealthMonitor(
      {
        sql,
        transactionSync<T>(callback: () => T): T {
          return sql.transactionSync(callback);
        },
      },
      environment,
      fetchImplementation,
      () => nowMs,
    );
  let monitor = createMonitor();

  return {
    failBeforeNextSuccessfulSamplePersist() {
      failBeforeSuccessfulSamplePersist = true;
    },
    fetchImplementation,
    linqHealthRequests,
    linqRequests,
    get monitor() {
      return monitor;
    },
    planetScaleRequests,
    restartMonitor() {
      monitor = createMonitor();
      return monitor;
    },
    runScheduledCheck(
      scheduledAtMs: number,
      currentTimeMs: number = scheduledAtMs,
    ) {
      nowMs = currentTimeMs;
      return monitor.runScheduledCheck(scheduledAtMs);
    },
  };
}

function createServiceDiscoveryResponse(): Response {
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

function createLinqChatResponseBody(input: {
  isGroup?: boolean;
  recipients?: string[];
} = {}) {
  return {
    handles: [
      {
        handle: "+12025550122",
        is_me: true,
        service: "iMessage",
        status: "active",
      },
      ...(input.recipients ?? ["+12025550123"]).map((handle) => ({
        handle,
        is_me: false,
        service: "iMessage",
        status: "active",
      })),
    ],
    health_status: {
      status: "HEALTHY",
    },
    is_group: input.isGroup ?? false,
  };
}

function createHealthyLinqPhoneNumbersBody(
  reputationStatus: "AT_RISK" | "CRITICAL" | "HEALTHY" = "HEALTHY",
) {
  return {
    phone_numbers: [
      {
        phone_number: "+12025550122",
        reputation: {
          status: reputationStatus,
        },
      },
    ],
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise,
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
