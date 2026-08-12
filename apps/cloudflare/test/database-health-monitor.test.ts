import { beforeEach, describe, expect, it, vi } from "vitest";

import { DatabaseHealthMonitor } from "../src/database-health/monitor.ts";
import { createTestSqlStorage } from "./sql-storage.ts";
import { buildMetricsBody } from "./helpers/database-health.ts";

const BRANCH_ID = "branch_test";
const BRANCH_NAME = "main";
const DATABASE_NAME = "database_test";
const ORGANIZATION = "org-test";
const FIVE_MINUTES_MS = 5 * 60 * 1_000;
const ONE_HOUR_MS = 60 * 60 * 1_000;
const STALE_OR_CONDITION_SPECIFIC_OPENING_CLAIM =
  /\b(?:active|availability|capacity|connection|current|degraded|headroom|live|now|pressure|remains?|still|threshold|unresolved|utilization)\b/iu;
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
    expect(harness.primaryLinqRequests).toEqual([]);
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

  it("pages at most once per hour and rotates evidence-bearing copy", async () => {
    let metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 8,
    });
    const harness = createMonitorHarness({
      readMetricsBody: () => metricsBody,
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_sent" });
    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 9,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS - 1),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 12,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    expect(harness.primaryLinqRequests).toHaveLength(2);
    const first = await readLinqRequestBody(harness.primaryLinqRequests[0]);
    const second = await readLinqRequestBody(harness.primaryLinqRequests[1]);
    expect(new URL(harness.primaryLinqRequests[0]?.url ?? "").pathname)
      .toBe("/api/partner/v3/messages");
    expect(harness.primaryLinqRequests[0]?.headers.get("idempotency-key"))
      .toBe(first.message.idempotency_key);
    expect(first.message.parts[0]?.value).toContain("PgBouncer wait 8s");
    expect(first.message.parts[0]?.value).toContain("UTC");
    expect(first.to).toEqual(["+12025550123"]);
    expect(first).not.toHaveProperty("from");
    expect(second.message.parts[0]?.value).not.toBe(first.message.parts[0]?.value);
    expect(second.message.idempotency_key).not.toBe(first.message.idempotency_key);
    expect(second.message.parts[0]?.value).toContain("PgBouncer wait 12s");
    expect(second.message.parts[0]?.value).toContain("Checked 01:05 UTC");
  });

  it("uses all 100 reviewed pressure openings before repeating one", async () => {
    const harness = createMonitorHarness({
      metricsBody: buildMetricsBody({
        branchId: BRANCH_ID,
        clientWaitSeconds: 8,
      }),
    });

    for (let alertIndex = 0; alertIndex < 101; alertIndex += 1) {
      await expect(
        harness.runScheduledCheck(
          FIVE_MINUTES_MS + alertIndex * ONE_HOUR_MS,
        ),
      ).resolves.toMatchObject({ outcome: "alert_sent" });
    }

    const messages = await Promise.all(
      harness.primaryLinqRequests.map(readLinqRequestBody),
    );
    const openings = messages.map((body) =>
      readDatabaseAlertOpening(body.message.parts[0]?.value)
    );
    expect(messages).toHaveLength(101);
    expect(new Set(openings.slice(0, 100)).size).toBe(100);
    expect(openings[100]).toBe(openings[0]);
    for (const opening of openings) {
      expect(opening).not.toMatch(STALE_OR_CONDITION_SPECIFIC_OPENING_CLAIM);
    }
  });

  it("fans one admitted alert out to two separate direct chats", async () => {
    const harness = createMonitorHarness({
      metricsBody: buildMetricsBody({
        branchId: BRANCH_ID,
        clientWaitSeconds: 8,
      }),
      secondaryLinqChatId: "chat_secondary_test",
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_sent" });

    expect(harness.allLinqRequests).toHaveLength(2);
    const bodies = await Promise.all(
      harness.allLinqRequests.map(readLinqRequestBody),
    );
    const primary = bodies.find((body) => body.to[0] === "+12025550123");
    const secondary = bodies.find((body) => body.to[0] === "+12025550124");
    expect(primary).toBeDefined();
    expect(secondary).toBeDefined();
    expect(secondary?.message.parts).toEqual(primary?.message.parts);
    expect(primary?.message.idempotency_key).toBe("murph-db-1-1");
    expect(secondary?.message.idempotency_key)
      .toBe("murph-db-1-1-recipient-2");
  });

  it("keeps the cycle pending when distinct chats resolve to the same recipient", async () => {
    const harness = createMonitorHarness({
      metricsBody: buildMetricsBody({
        branchId: BRANCH_ID,
        clientWaitSeconds: 8,
      }),
      secondaryLinqRecipient: "+12025550123",
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_failed" });
    expect(harness.allLinqRequests).toHaveLength(1);
    const pendingAlert = harness.monitor.readAlertState();
    const initialPrimaryBody = await readLinqRequestBody(
      harness.allLinqRequests[0],
    );
    expect(initialPrimaryBody.message.idempotency_key)
      .toBe(pendingAlert.pendingAlertIdempotencyKey);
    expect(initialPrimaryBody.message.parts[0]?.value)
      .toBe(pendingAlert.pendingAlertMessage);

    harness.setSecondaryLinqRecipient("+12025550124");
    harness.restartMonitor();
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    expect(harness.allLinqRequests).toHaveLength(3);
    const replayBodies = await Promise.all(
      harness.allLinqRequests.slice(1).map(readLinqRequestBody),
    );
    expect(replayBodies.map((body) => body.message.idempotency_key))
      .toEqual([
        pendingAlert.pendingAlertIdempotencyKey,
        `${pendingAlert.pendingAlertIdempotencyKey}-recipient-2`,
      ]);
    expect(
      replayBodies.every(
        (body) =>
          body.message.parts[0]?.value === pendingAlert.pendingAlertMessage,
      ),
    ).toBe(true);
    expect(harness.monitor.readAlertState()).toMatchObject({
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
  });

  it("requires primary recipient identity before secondary provider entry", async () => {
    const harness = createMonitorHarness({
      linqHealthResponses: [
        () => new Response(null, { status: 503 }),
        () => Response.json(createHealthyLinqPhoneNumbersBody()),
      ],
      metricsBody: buildMetricsBody({
        branchId: BRANCH_ID,
        clientWaitSeconds: 8,
      }),
      secondaryLinqRecipient: "+12025550123",
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_failed" });
    expect(harness.allLinqRequests).toEqual([]);
    const pendingAlert = harness.monitor.readAlertState();

    harness.restartMonitor();
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_failed" });
    expect(harness.allLinqRequests).toHaveLength(1);
    const collisionPrimaryBody = await readLinqRequestBody(
      harness.allLinqRequests[0],
    );
    expect(collisionPrimaryBody.message.idempotency_key)
      .toBe(pendingAlert.pendingAlertIdempotencyKey);
    expect(collisionPrimaryBody.message.parts[0]?.value)
      .toBe(pendingAlert.pendingAlertMessage);

    harness.setSecondaryLinqRecipient("+12025550124");
    harness.restartMonitor();
    await expect(
      harness.runScheduledCheck(
        FIVE_MINUTES_MS + ONE_HOUR_MS * 2,
      ),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    expect(harness.allLinqRequests).toHaveLength(3);
    const recoveryBodies = await Promise.all(
      harness.allLinqRequests.slice(1).map(readLinqRequestBody),
    );
    expect(recoveryBodies.map((body) => body.message.idempotency_key))
      .toEqual([
        pendingAlert.pendingAlertIdempotencyKey,
        `${pendingAlert.pendingAlertIdempotencyKey}-recipient-2`,
      ]);
    expect(
      recoveryBodies.every(
        (body) =>
          body.message.parts[0]?.value === pendingAlert.pendingAlertMessage,
      ),
    ).toBe(true);
    expect(harness.monitor.readAlertState()).toMatchObject({
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
  });

  it("retries a partially failed fan-out only after the global fence", async () => {
    const harness = createMonitorHarness({
      linqResponses: [
        () => new Response(null, { status: 202 }),
        () => new Response(null, { status: 202 }),
      ],
      secondaryLinqResponses: [
        () => new Response(null, { status: 503 }),
        () => new Response(null, { status: 202 }),
      ],
      metricsBody: buildMetricsBody({
        branchId: BRANCH_ID,
        clientWaitSeconds: 8,
      }),
      secondaryLinqChatId: "chat_secondary_test",
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_failed" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    expect(harness.allLinqRequests).toHaveLength(2);

    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });
    expect(harness.allLinqRequests).toHaveLength(4);

    const bodies = await Promise.all(
      harness.allLinqRequests.map(readLinqRequestBody),
    );
    const primaryBodies = bodies.filter(
      (body) => body.to[0] === "+12025550123",
    );
    const secondaryBodies = bodies.filter(
      (body) => body.to[0] === "+12025550124",
    );
    expect(primaryBodies).toHaveLength(2);
    expect(secondaryBodies).toHaveLength(2);
    expect(primaryBodies[1]).toEqual(primaryBodies[0]);
    expect(secondaryBodies[1]).toEqual(secondaryBodies[0]);
  });

  it("attempts a healthy destination when the other chat fails closed", async () => {
    const harness = createMonitorHarness({
      metricsBody: buildMetricsBody({
        branchId: BRANCH_ID,
        clientWaitSeconds: 8,
      }),
      secondaryLinqChatHealthStatus: "AT_RISK",
      secondaryLinqChatId: "chat_secondary_test",
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_failed" });
    expect(harness.primaryLinqRequests).toHaveLength(1);
    await expect(
      readLinqRequestBody(harness.primaryLinqRequests[0]),
    ).resolves.toMatchObject({ to: ["+12025550123"] });
  });

  it("attempts the healthy secondary when primary identity is known but its chat is unhealthy", async () => {
    const harness = createMonitorHarness({
      linqChatHealthStatus: "AT_RISK",
      metricsBody: buildMetricsBody({
        branchId: BRANCH_ID,
        clientWaitSeconds: 8,
      }),
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_failed" });
    expect(harness.allLinqRequests).toHaveLength(1);
    await expect(
      readLinqRequestBody(harness.allLinqRequests[0]),
    ).resolves.toMatchObject({
      message: {
        idempotency_key: "murph-db-1-1-recipient-2",
      },
      to: ["+12025550124"],
    });
    expect(harness.monitor.readAlertState()).toMatchObject({
      pendingAlertIdempotencyKey: "murph-db-1-1",
      pendingAlertMessage: expect.any(String),
    });
  });

  it("attempts the healthy secondary when primary identity is known but its line health is unavailable", async () => {
    const harness = createMonitorHarness({
      linqHealthResponses: [
        () => Response.json(createLinqChatResponseBody()),
        () => new Response(null, { status: 503 }),
      ],
      metricsBody: buildMetricsBody({
        branchId: BRANCH_ID,
        clientWaitSeconds: 8,
      }),
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_failed" });
    expect(harness.allLinqRequests).toHaveLength(1);
    await expect(
      readLinqRequestBody(harness.allLinqRequests[0]),
    ).resolves.toMatchObject({
      message: {
        idempotency_key: "murph-db-1-1-recipient-2",
      },
      to: ["+12025550124"],
    });
    expect(harness.monitor.readAlertState()).toMatchObject({
      pendingAlertIdempotencyKey: "murph-db-1-1",
      pendingAlertMessage: expect.any(String),
    });
  });

  it("replays stable per-recipient keys after an unhealthy primary recovers", async () => {
    const harness = createMonitorHarness({
      linqHealthResponses: [
        () => Response.json({
          ...createLinqChatResponseBody(),
          health_status: { status: "AT_RISK" },
        }),
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
    expect(harness.allLinqRequests).toHaveLength(1);
    const initialSecondaryBody = await readLinqRequestBody(
      harness.allLinqRequests[0],
    );
    expect(initialSecondaryBody.message.idempotency_key)
      .toBe(`${pendingAlert.pendingAlertIdempotencyKey}-recipient-2`);
    expect(initialSecondaryBody.message.parts[0]?.value)
      .toBe(pendingAlert.pendingAlertMessage);

    harness.restartMonitor();
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    expect(harness.allLinqRequests).toHaveLength(3);
    const recoveryBodies = await Promise.all(
      harness.allLinqRequests.slice(1).map(readLinqRequestBody),
    );
    expect(recoveryBodies.map((body) => body.message.idempotency_key))
      .toEqual([
        pendingAlert.pendingAlertIdempotencyKey,
        `${pendingAlert.pendingAlertIdempotencyKey}-recipient-2`,
      ]);
    expect(recoveryBodies[1]).toEqual(initialSecondaryBody);
    expect(
      recoveryBodies.every(
        (body) =>
          body.message.parts[0]?.value === pendingAlert.pendingAlertMessage,
      ),
    ).toBe(true);
    expect(harness.monitor.readAlertState()).toMatchObject({
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
  });

  it("fails closed when the secondary direct chat is missing", () => {
    expect(() =>
      createMonitorHarness({ omitSecondaryLinqChatId: true })
    ).toThrowError(
      "HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID is required.",
    );
  });

  it("fails closed when the secondary direct chat is blank", () => {
    expect(() =>
      createMonitorHarness({ secondaryLinqChatId: "   " })
    ).toThrowError(
      "HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID is required.",
    );
  });

  it("rejects duplicate direct-chat configuration", () => {
    expect(() =>
      createMonitorHarness({ secondaryLinqChatId: "chat_test" })
    ).toThrowError("Database health alert chat IDs must be distinct.");
  });

  it("does not send a fenced gauge recurrence after recovery", async () => {
    let metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 8,
    });
    const harness = createMonitorHarness({
      readMetricsBody: () => metricsBody,
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_sent" });
    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 9,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    expect(harness.monitor.readAlertState().pendingAlertMessage).toBeNull();

    metricsBody = buildMetricsBody({ branchId: BRANCH_ID });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3),
    ).resolves.toMatchObject({ outcome: "healthy" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "healthy" });

    expect(harness.primaryLinqRequests).toHaveLength(1);
  });

  it("keeps the one-hour attempt fence across recovery and a new incident", async () => {
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
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    expect(harness.primaryLinqRequests).toHaveLength(2);
    const incidentMessages = await Promise.all(
      harness.primaryLinqRequests.map(readLinqRequestBody),
    );
    expect(readDatabaseAlertOpening(
      incidentMessages[1]?.message.parts[0]?.value,
    )).not.toBe(readDatabaseAlertOpening(
      incidentMessages[0]?.message.parts[0]?.value,
    ));
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
        FIVE_MINUTES_MS + ONE_HOUR_MS,
        FIVE_MINUTES_MS * 10,
      ),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });

    expect(harness.primaryLinqRequests).toHaveLength(1);
    expect(
      (await readLinqRequestBody(harness.primaryLinqRequests[0])).message.parts[0]?.value,
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

      expect(harness.primaryLinqHealthRequests).toHaveLength(2);
      expect(harness.primaryLinqRequests).toEqual([]);
      expect(harness.allLinqRequests).toHaveLength(1);
      await expect(
        readLinqRequestBody(harness.allLinqRequests[0]),
      ).resolves.toMatchObject({ to: ["+12025550124"] });
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

      expect(harness.primaryLinqHealthRequests).toHaveLength(2);
      expect(harness.primaryLinqRequests).toEqual([]);
      expect(harness.allLinqRequests).toHaveLength(1);
      await expect(
        readLinqRequestBody(harness.allLinqRequests[0]),
      ).resolves.toMatchObject({ to: ["+12025550124"] });
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
      expect(harness.primaryLinqRequests).toHaveLength(1);
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
      expect(harness.primaryLinqRequests).toEqual([]);
      expect(harness.allLinqRequests).toHaveLength(1);
      await expect(
        readLinqRequestBody(harness.allLinqRequests[0]),
      ).resolves.toMatchObject({ to: ["+12025550124"] });
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

    expect(harness.primaryLinqRequests).toEqual([]);
    expect(harness.allLinqRequests).toEqual([]);
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

      expect(harness.primaryLinqRequests).toEqual([]);
      expect(harness.allLinqRequests).toEqual([]);
      expect(pendingAlert).toMatchObject({
        incidentOpen: true,
        pendingAlertIdempotencyKey: expect.any(String),
        pendingAlertMessage: expect.any(String),
      });

      await expect(
        harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
      ).resolves.toMatchObject({ outcome: "alert_sent" });

      expect(harness.primaryLinqRequests).toHaveLength(1);
      const deliveredBody = await readLinqRequestBody(harness.primaryLinqRequests[0]);
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
    expect(harness.primaryLinqRequests).toHaveLength(1);
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    expect(harness.primaryLinqRequests).toHaveLength(2);
    expect(await readLinqRequestBody(harness.primaryLinqRequests[1])).toEqual(
      await readLinqRequestBody(harness.primaryLinqRequests[0]),
    );
    const retryBody = await readLinqRequestBody(harness.primaryLinqRequests[1]);
    expect(retryBody.message.idempotency_key)
      .toBe(pendingAlert.pendingAlertIdempotencyKey);
    expect(retryBody.message.parts[0]?.value)
      .toBe(pendingAlert.pendingAlertMessage);
  });

  it("pages once per uninterrupted telemetry outage and identifies missing metrics", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const healthyMetricsBody = buildMetricsBody({ branchId: BRANCH_ID });
    const missingMetricsBody = healthyMetricsBody.replace(
      /^planetscale_postgres_settings_max_connections.*$/mu,
      "",
    );
    let metricsBody = missingMetricsBody;
    const harness = createMonitorHarness({
      readMetricsBody: () => metricsBody,
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
          missingMetrics: [
            "planetscale_postgres_settings_max_connections",
          ],
        },
      ],
      outcome: "alert_sent",
      sampleStatus: "failed",
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2 + ONE_HOUR_MS),
    ).resolves.toMatchObject({
      outcome: "alert_deferred",
      sampleStatus: "failed",
    });
    expect(harness.primaryLinqRequests).toHaveLength(1);

    const firstAlert = await readLinqRequestBody(
      harness.primaryLinqRequests[0],
    );
    expect(firstAlert.message.parts[0]?.value).toBe(
      "Database monitor telemetry was incomplete for 2 checks "
      + "(missing PlanetScale metric observed: Postgres max connections). "
      + "Window ended 00:10 UTC.",
    );
    expect(firstAlert.message.parts[0]?.value).not.toContain(
      "database is under pressure",
    );
    expect(warning).toHaveBeenCalledWith(
      "Database health metrics collection failed.",
      {
        failureCode: "required_metrics_missing",
        failures: 1,
        missingMetrics: [
          "planetscale_postgres_settings_max_connections",
        ],
      },
    );

    const failedSample = harness.monitor.readRecentSamples().find(
      (sample) => sample.observedAtMs === FIVE_MINUTES_MS * 2,
    );
    expect(failedSample?.conditions).toEqual([
      {
        failures: 2,
        incompleteChecks: 2,
        kind: "monitoring_unavailable",
        missingMetrics: [
          "planetscale_postgres_settings_max_connections",
        ],
        unavailableChecks: 0,
      },
    ]);

    metricsBody = healthyMetricsBody;
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3 + ONE_HOUR_MS),
    ).resolves.toMatchObject({
      outcome: "healthy",
      sampleStatus: "ok",
    });

    expect(harness.monitor.readAlertState()).toMatchObject({
      consecutiveScrapeFailures: 0,
      incidentOpen: false,
    });

    metricsBody = missingMetricsBody;
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 4 + ONE_HOUR_MS),
    ).resolves.toMatchObject({
      conditions: [],
      outcome: "healthy",
      sampleStatus: "failed",
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 5 + ONE_HOUR_MS),
    ).resolves.toMatchObject({
      outcome: "alert_sent",
      sampleStatus: "failed",
    });
    expect(harness.primaryLinqRequests).toHaveLength(2);
    const secondAlert = await readLinqRequestBody(
      harness.primaryLinqRequests[1],
    );
    expect(secondAlert.message.idempotency_key)
      .not.toBe(firstAlert.message.idempotency_key);
  });

  it("pages a fully unavailable telemetry outage with explicit unavailable copy", async () => {
    const harness = createMonitorHarness({
      serviceDiscoveryResponses: [
        () => new Response(null, { status: 503 }),
        () => new Response(null, { status: 503 }),
        () => new Response(null, { status: 503 }),
        () => new Response(null, { status: 503 }),
      ],
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves.toEqual({
      conditions: [],
      outcome: "healthy",
      sampleStatus: "failed",
    });
    expect(harness.planetScaleRequests).toHaveLength(2);
    expect(harness.retryWaits).toEqual([1_000]);
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({
      conditions: [
        {
          failures: 2,
          kind: "monitoring_unavailable",
          missingMetrics: [],
        },
      ],
      outcome: "alert_sent",
      sampleStatus: "failed",
    });

    const alert = await readLinqRequestBody(harness.primaryLinqRequests[0]);
    expect(alert.message.parts[0]?.value).toBe(
      "Database monitor telemetry was unavailable for 2 checks. "
      + "Window ended 00:10 UTC.",
    );
    expect(alert.message.parts[0]?.value).not.toContain(
      "database is under pressure",
    );
    expect(harness.monitor.readRecentSamples()[0]).toMatchObject({
      failureCode: "service_discovery_failed",
      scrapeStatus: "failed",
    });
    expect(harness.planetScaleRequests).toHaveLength(4);
    expect(harness.retryWaits).toEqual([1_000, 1_000]);
  });

  it("retries transient telemetry failure before counting a failed check", async () => {
    const harness = createMonitorHarness({
      serviceDiscoveryResponses: [
        () => new Response(null, { status: 503 }),
        createServiceDiscoveryResponse,
      ],
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves.toEqual({
      conditions: [],
      outcome: "healthy",
      sampleStatus: "ok",
    });

    expect(harness.planetScaleRequests).toHaveLength(3);
    expect(harness.retryWaits).toEqual([1_000]);
    expect(harness.monitor.readRecentSamples()).toEqual([
      expect.objectContaining({
        failureCode: null,
        scrapeStatus: "ok",
      }),
    ]);
    expect(harness.primaryLinqRequests).toEqual([]);
  });

  it("retries a safe partial scrape when only the direct-error counter is missing", async () => {
    const completeMetricsBody = buildMetricsBody({ branchId: BRANCH_ID });
    const partialMetricsBody = completeMetricsBody.replace(
      /^planetscale_edge_postgres_connection_errors_total.*$/gmu,
      "",
    );
    let scrapeAttempt = 0;
    const harness = createMonitorHarness({
      readMetricsBody() {
        scrapeAttempt += 1;
        return scrapeAttempt === 1
          ? partialMetricsBody
          : completeMetricsBody;
      },
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves.toEqual({
      conditions: [],
      outcome: "healthy",
      sampleStatus: "ok",
    });

    expect(harness.planetScaleRequests).toHaveLength(4);
    expect(harness.retryWaits).toEqual([1_000]);
    expect(harness.monitor.readRecentSamples()).toEqual([
      expect.objectContaining({
        directConnectionErrorDelta: 0,
        failureCode: null,
        scrapeStatus: "ok",
      }),
    ]);
    expect(harness.primaryLinqRequests).toEqual([]);
  });

  it("retains the original incomplete observation when direct-error confirmation fails", async () => {
    const partialMetricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
    }).replace(
      /^planetscale_edge_postgres_connection_errors_total.*$/gmu,
      "",
    );
    const harness = createMonitorHarness({
      metricsBody: partialMetricsBody,
      serviceDiscoveryResponses: [
        createServiceDiscoveryResponse,
        () => new Response(null, { status: 503 }),
      ],
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves.toEqual({
      conditions: [],
      outcome: "healthy",
      sampleStatus: "failed",
    });

    expect(harness.planetScaleRequests).toHaveLength(3);
    expect(harness.retryWaits).toEqual([1_000]);
    expect(harness.monitor.readRecentSamples()).toEqual([
      expect.objectContaining({
        failureCode: "required_metrics_missing",
        scrapeStatus: "failed",
      }),
    ]);
    expect(harness.primaryLinqRequests).toEqual([]);
  });

  it("pages an available unsafe signal without retrying a missing direct-error counter", async () => {
    const partialMetricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 8,
    }).replace(
      /^planetscale_edge_postgres_connection_errors_total.*$/gmu,
      "",
    );
    const harness = createMonitorHarness({ metricsBody: partialMetricsBody });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({
        conditions: [{ kind: "client_wait", seconds: 8 }],
        outcome: "alert_sent",
        sampleStatus: "failed",
      });

    expect(harness.planetScaleRequests).toHaveLength(2);
    expect(harness.retryWaits).toEqual([]);
    expect(harness.primaryLinqRequests).toHaveLength(1);
  });

  it("pages a positive direct-error delta recovered by the partial retry", async () => {
    const baselineMetricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 4,
    });
    const partialMetricsBody = baselineMetricsBody.replace(
      /^planetscale_edge_postgres_connection_errors_total.*$/gmu,
      "",
    );
    const incrementedMetricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 6,
    });
    let scrapeAttempt = 0;
    const harness = createMonitorHarness({
      readMetricsBody() {
        scrapeAttempt += 1;
        if (scrapeAttempt === 1) {
          return baselineMetricsBody;
        }
        return scrapeAttempt === 2
          ? partialMetricsBody
          : incrementedMetricsBody;
      },
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "ok" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({
      conditions: [
        { count: 2, kind: "direct_migration_admission_failures" },
      ],
      outcome: "alert_sent",
      sampleStatus: "ok",
    });

    expect(harness.planetScaleRequests).toHaveLength(6);
    expect(harness.retryWaits).toEqual([1_000]);
    expect(harness.primaryLinqRequests).toHaveLength(1);
    expect(harness.monitor.readRecentSamples()[0]).toMatchObject({
      directConnectionErrorDelta: 2,
      failureCode: null,
      scrapeStatus: "ok",
    });
  });

  it("pages pressure that appears while confirming the missing direct-error counter", async () => {
    const partialMetricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
    }).replace(
      /^planetscale_edge_postgres_connection_errors_total.*$/gmu,
      "",
    );
    const unsafePartialMetricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 8,
    }).replace(
      /^planetscale_edge_postgres_connection_errors_total.*$/gmu,
      "",
    );
    let scrapeAttempt = 0;
    const harness = createMonitorHarness({
      readMetricsBody() {
        scrapeAttempt += 1;
        return scrapeAttempt === 1
          ? partialMetricsBody
          : unsafePartialMetricsBody;
      },
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({
        conditions: [{ kind: "client_wait", seconds: 8 }],
        outcome: "alert_sent",
        sampleStatus: "failed",
      });

    expect(harness.planetScaleRequests).toHaveLength(4);
    expect(harness.retryWaits).toEqual([1_000]);
    expect(harness.primaryLinqRequests).toHaveLength(1);
  });

  it("retains the two-check telemetry page when direct-error retries stay incomplete", async () => {
    const partialMetricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
    }).replace(
      /^planetscale_edge_postgres_connection_errors_total.*$/gmu,
      "",
    );
    const harness = createMonitorHarness({ metricsBody: partialMetricsBody });

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
          missingMetrics: [
            "planetscale_edge_postgres_connection_errors_total",
          ],
        },
      ],
      outcome: "alert_sent",
      sampleStatus: "failed",
    });

    expect(harness.planetScaleRequests).toHaveLength(8);
    expect(harness.retryWaits).toEqual([1_000, 1_000]);
    const alert = await readLinqRequestBody(harness.primaryLinqRequests[0]);
    expect(alert.message.parts[0]?.value).toBe(
      "Database monitor telemetry was incomplete for 2 checks "
      + "(missing PlanetScale metric observed: direct connection errors). "
      + "Window ended 00:10 UTC.",
    );
  });

  it("pages concrete pressure returned by the retry without delay", async () => {
    const harness = createMonitorHarness({
      metricsBody: buildMetricsBody({
        branchId: BRANCH_ID,
        clientWaitSeconds: 8,
      }),
      serviceDiscoveryResponses: [
        () => new Response(null, { status: 503 }),
        createServiceDiscoveryResponse,
      ],
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({
        conditions: [{ kind: "client_wait", seconds: 8 }],
        outcome: "alert_sent",
        sampleStatus: "ok",
      });

    expect(harness.primaryLinqRequests).toHaveLength(1);
    expect(harness.retryWaits).toEqual([1_000]);
  });

  it("retries a zero-evidence scrape before evaluating recovered pressure", async () => {
    let scrapeAttempt = 0;
    const recoveredMetricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 8,
    });
    const harness = createMonitorHarness({
      readMetricsBody() {
        scrapeAttempt += 1;
        return scrapeAttempt === 1 ? "" : recoveredMetricsBody;
      },
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({
        conditions: [{ kind: "client_wait", seconds: 8 }],
        outcome: "alert_sent",
        sampleStatus: "ok",
      });

    expect(harness.planetScaleRequests).toHaveLength(4);
    expect(harness.retryWaits).toEqual([1_000]);
    expect(harness.monitor.readAlertState().consecutiveScrapeFailures).toBe(0);
    expect(harness.primaryLinqRequests).toHaveLength(1);
  });

  it("pages only after two scheduled runs exhaust zero-evidence retries", async () => {
    const harness = createMonitorHarness({ metricsBody: "" });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves.toEqual({
      conditions: [],
      outcome: "healthy",
      sampleStatus: "failed",
    });
    expect(harness.planetScaleRequests).toHaveLength(4);
    expect(harness.retryWaits).toEqual([1_000]);

    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({
      conditions: [{ failures: 2, kind: "monitoring_unavailable" }],
      outcome: "alert_sent",
      sampleStatus: "failed",
    });
    expect(harness.planetScaleRequests).toHaveLength(8);
    expect(harness.retryWaits).toEqual([1_000, 1_000]);
    expect(harness.monitor.readRecentSamples()[0]).toMatchObject({
      failureCode: "required_metrics_missing",
      scrapeStatus: "failed",
    });
  });

  it("summarizes a partial-then-unavailable telemetry window across retry", async () => {
    const partialMetricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
    }).replace(
      /^planetscale_postgres_settings_max_connections.*$/mu,
      "",
    );
    const harness = createMonitorHarness({
      linqResponses: [
        () => {
          throw new Error("ambiguous send");
        },
      ],
      metricsBody: partialMetricsBody,
      serviceDiscoveryResponses: [
        createServiceDiscoveryResponse,
        () => new Response(null, { status: 503 }),
        () => new Response(null, { status: 503 }),
      ],
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "failed" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({ outcome: "alert_failed", sampleStatus: "failed" });

    const expectedMessage =
      "Database monitor telemetry was impaired for 2 checks "
      + "(1 incomplete, 1 unavailable; missing PlanetScale metric observed: "
      + "Postgres max connections). Window ended 00:10 UTC.";
    const pendingAlert = harness.monitor.readAlertState();
    const idempotencyKey = pendingAlert.pendingAlertIdempotencyKey;
    if (!idempotencyKey || !pendingAlert.pendingAlertMessage) {
      throw new Error("Expected a persisted mixed telemetry alert.");
    }
    expect(pendingAlert).toMatchObject({
      monitoringAlertObligation: {
        checkedAtMs: FIVE_MINUTES_MS * 2,
        failures: 2,
        incompleteChecks: 1,
        missingMetrics: [
          "planetscale_postgres_settings_max_connections",
        ],
        unavailableChecks: 1,
      },
      pendingAlertMessage: expectedMessage,
    });
    const firstBodies = await Promise.all(
      harness.allLinqRequests.map(readLinqRequestBody),
    );
    expect(firstBodies.map((body) => body.message.parts[0]?.value))
      .toEqual([expectedMessage, expectedMessage]);

    harness.restartMonitor();
    expect(harness.monitor.readAlertState()).toMatchObject({
      pendingAlertIdempotencyKey: idempotencyKey,
      pendingAlertMessage: expectedMessage,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2 + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    const allBodies = await Promise.all(
      harness.allLinqRequests.map(readLinqRequestBody),
    );
    expect(allBodies.map((body) => body.message.parts[0]?.value))
      .toEqual([
        expectedMessage,
        expectedMessage,
        expectedMessage,
        expectedMessage,
      ]);
    expect(allBodies.map((body) => body.message.idempotency_key).sort())
      .toEqual([
        idempotencyKey,
        idempotencyKey,
        `${idempotencyKey}-recipient-2`,
        `${idempotencyKey}-recipient-2`,
      ].sort());
    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: null,
      pendingAlertMessage: null,
    });
  });

  it("summarizes an unavailable-then-partial telemetry window", async () => {
    const partialMetricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
    }).replace(
      /^planetscale_postgres_settings_max_connections.*$/mu,
      "",
    );
    const harness = createMonitorHarness({
      metricsBody: partialMetricsBody,
      serviceDiscoveryResponses: [
        () => new Response(null, { status: 503 }),
        () => new Response(null, { status: 503 }),
        createServiceDiscoveryResponse,
      ],
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "failed" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({ outcome: "alert_sent", sampleStatus: "failed" });

    const expectedMessage =
      "Database monitor telemetry was impaired for 2 checks "
      + "(1 incomplete, 1 unavailable; missing PlanetScale metric observed: "
      + "Postgres max connections). Window ended 00:10 UTC.";
    const bodies = await Promise.all(
      harness.allLinqRequests.map(readLinqRequestBody),
    );
    expect(bodies).toHaveLength(2);
    expect(bodies.map((body) => body.message.parts[0]?.value))
      .toEqual([expectedMessage, expectedMessage]);
    expect(bodies[1]?.message.idempotency_key)
      .toBe(`${bodies[0]?.message.idempotency_key}-recipient-2`);
    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: null,
      pendingAlertMessage: null,
    });
  });

  it("unions observed missing families across a partial telemetry window", async () => {
    const healthyMetricsBody = buildMetricsBody({ branchId: BRANCH_ID });
    let metricsBody = healthyMetricsBody.replace(
      /^planetscale_postgres_settings_max_connections.*$/mu,
      "",
    );
    const harness = createMonitorHarness({
      readMetricsBody: () => metricsBody,
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "failed" });
    metricsBody = healthyMetricsBody.replace(
      /^planetscale_pgbouncer_pools_server.*$/gmu,
      "",
    );
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({ outcome: "alert_sent", sampleStatus: "failed" });

    const expectedMessage =
      "Database monitor telemetry was incomplete for 2 checks "
      + "(missing PlanetScale metrics observed: PgBouncer server pools, "
      + "Postgres max connections). Window ended 00:10 UTC.";
    const bodies = await Promise.all(
      harness.allLinqRequests.map(readLinqRequestBody),
    );
    expect(bodies).toHaveLength(2);
    expect(bodies.map((body) => body.message.parts[0]?.value))
      .toEqual([expectedMessage, expectedMessage]);
    expect(bodies[1]?.message.idempotency_key)
      .toBe(`${bodies[0]?.message.idempotency_key}-recipient-2`);
    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: null,
      pendingAlertMessage: null,
    });
  });

  it("keeps an available unsafe signal when a present family lacks its required pod label", async () => {
    const completeMaxConnectionsLine =
      "planetscale_postgres_settings_max_connections{"
      + `planetscale_database_branch_id="${BRANCH_ID}",`
      + 'planetscale_pod="pod-primary",planetscale_role="primary"} 50';
    const structurallyIncompleteMetricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 8,
    }).replace(
      completeMaxConnectionsLine,
      "planetscale_postgres_settings_max_connections{"
      + `planetscale_database_branch_id="${BRANCH_ID}",`
      + 'planetscale_role="primary"} 50',
    );
    const harness = createMonitorHarness({
      metricsBody: structurallyIncompleteMetricsBody,
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({
        conditions: [
          {
            kind: "client_wait",
            seconds: 8,
            waitingConnections: 3,
          },
        ],
        outcome: "alert_sent",
        sampleStatus: "failed",
      });
    expect(harness.monitor.readRecentSamples()[0]).toMatchObject({
      clientWaitSeconds: 8,
      failureCode: "required_metrics_missing",
      postgresMaxConnections: null,
      scrapeStatus: "failed",
    });
  });

  it("still pages an available unsafe signal when another metric is missing", async () => {
    const partialMetricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 8,
    }).replace(
      /^planetscale_postgres_settings_max_connections.*$/mu,
      "",
    );
    const harness = createMonitorHarness({ metricsBody: partialMetricsBody });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({
        conditions: [
          {
            kind: "client_wait",
            seconds: 8,
            waitingConnections: 3,
          },
        ],
        outcome: "alert_sent",
        sampleStatus: "failed",
      });

    expect(harness.primaryLinqRequests).toHaveLength(1);
    expect(harness.planetScaleRequests).toHaveLength(2);
    expect(harness.retryWaits).toEqual([]);
    const alert = await readLinqRequestBody(harness.primaryLinqRequests[0]);
    expect(alert.message.parts[0]?.value).toContain("PgBouncer wait 8s");
    expect(harness.monitor.readRecentSamples()[0]).toMatchObject({
      clientWaitSeconds: 8,
      failureCode: "required_metrics_missing",
      postgresMaxConnections: null,
      scrapeStatus: "failed",
    });
  });

  it("coalesces recovered telemetry thresholds behind an older pending page", async () => {
    let clientWaitSeconds = 8;
    let omitMaxConnections = false;
    let omitServerPools = false;
    const harness = createMonitorHarness({
      linqResponses: [
        () => {
          throw new Error("ambiguous send");
        },
      ],
      readMetricsBody: () => {
        const body = buildMetricsBody({
          branchId: BRANCH_ID,
          clientWaitSeconds,
        });
        const withMaxConnections = omitMaxConnections
          ? body.replace(
            /^planetscale_postgres_settings_max_connections.*$/mu,
            "",
          )
          : body;
        return omitServerPools
          ? withMaxConnections.replace(
            /^planetscale_pgbouncer_pools_server.*$/gmu,
            "",
          )
          : withMaxConnections;
      },
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_failed", sampleStatus: "ok" });
    const olderPendingAlert = harness.monitor.readAlertState();
    expect(olderPendingAlert.pendingAlertMessage).toContain(
      "PgBouncer wait 8s",
    );

    omitMaxConnections = true;
    clientWaitSeconds = 0;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 2)).resolves
      .toMatchObject({ outcome: "alert_deferred", sampleStatus: "failed" });
    clientWaitSeconds = 8;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 3)).resolves
      .toMatchObject({
        conditions: [
          {
            kind: "client_wait",
            seconds: 8,
          },
          {
            failures: 2,
            kind: "monitoring_unavailable",
          },
        ],
        outcome: "alert_deferred",
        sampleStatus: "failed",
      });

    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: {
        checkedAtMs: FIVE_MINUTES_MS * 3,
        failures: 2,
        missingMetrics: [
          "planetscale_postgres_settings_max_connections",
        ],
      },
      pendingAlertIdempotencyKey:
        olderPendingAlert.pendingAlertIdempotencyKey,
      pendingAlertMessage: olderPendingAlert.pendingAlertMessage,
    });
    harness.restartMonitor();
    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: expect.objectContaining({ failures: 2 }),
      pendingAlertIdempotencyKey:
        olderPendingAlert.pendingAlertIdempotencyKey,
    });

    clientWaitSeconds = 0;
    omitMaxConnections = false;
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({
      outcome: "alert_sent",
      sampleStatus: "ok",
    });
    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: expect.objectContaining({ failures: 2 }),
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });

    omitServerPools = true;
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2 + ONE_HOUR_MS),
    ).resolves.toMatchObject({
      outcome: "alert_deferred",
      sampleStatus: "failed",
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3 + ONE_HOUR_MS),
    ).resolves.toMatchObject({
      conditions: [
        {
          failures: 2,
          kind: "monitoring_unavailable",
        },
      ],
      outcome: "alert_deferred",
      sampleStatus: "failed",
    });
    harness.restartMonitor();
    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: {
        checkedAtMs: FIVE_MINUTES_MS * 3,
        failures: 2,
        missingMetrics: [
          "planetscale_postgres_settings_max_connections",
        ],
      },
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });

    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS * 2),
    ).resolves.toMatchObject({
      outcome: "alert_sent",
      sampleStatus: "failed",
    });
    expect(harness.monitor.readAlertState()).toMatchObject({
      incidentOpen: true,
      monitoringAlertObligation: null,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2 + ONE_HOUR_MS * 2),
    ).resolves.toMatchObject({
      outcome: "alert_deferred",
      sampleStatus: "failed",
    });
    omitServerPools = false;
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3 + ONE_HOUR_MS * 2),
    ).resolves.toMatchObject({
      outcome: "healthy",
      sampleStatus: "ok",
    });
    expect(harness.monitor.readAlertState().incidentOpen).toBe(false);

    expect(harness.primaryLinqRequests).toHaveLength(3);
    const firstAttempt = await readLinqRequestBody(
      harness.primaryLinqRequests[0],
    );
    const olderRetry = await readLinqRequestBody(
      harness.primaryLinqRequests[1],
    );
    const telemetryAttempt = await readLinqRequestBody(
      harness.primaryLinqRequests[2],
    );
    expect(olderRetry).toEqual(firstAttempt);
    expect(telemetryAttempt.message.parts[0]?.value).toBe(
      "Database monitor telemetry was incomplete for 2 checks "
      + "(missing PlanetScale metric observed: Postgres max connections). "
      + "Window ended 00:15 UTC.",
    );
    const telemetryAttempts = (
      await Promise.all(harness.allLinqRequests.map(readLinqRequestBody))
    ).filter(
      (body) =>
        body.message.parts[0]?.value
        === telemetryAttempt.message.parts[0]?.value,
    );
    expect(telemetryAttempts).toHaveLength(2);
    expect(telemetryAttempts.map((body) => body.to[0]).sort()).toEqual([
      "+12025550123",
      "+12025550124",
    ]);
    expect(telemetryAttempts.map(
      (body) => body.message.idempotency_key,
    ).sort()).toEqual([
      telemetryAttempt.message.idempotency_key,
      `${telemetryAttempt.message.idempotency_key}-recipient-2`,
    ]);
  });

  it("gives the first eligible slot to current pressure with owed telemetry", async () => {
    let clientWaitSeconds = 8;
    let omitMaxConnections = false;
    const harness = createMonitorHarness({
      readMetricsBody: () => {
        const body = buildMetricsBody({
          branchId: BRANCH_ID,
          clientWaitSeconds,
        });
        return omitMaxConnections
          ? body.replace(
            /^planetscale_postgres_settings_max_connections.*$/mu,
            "",
          )
          : body;
      },
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_sent", sampleStatus: "ok" });
    clientWaitSeconds = 0;
    omitMaxConnections = true;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 2)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "failed" });
    clientWaitSeconds = 9;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 3)).resolves
      .toMatchObject({
        conditions: [
          { kind: "client_wait", seconds: 9 },
          { failures: 2, kind: "monitoring_unavailable" },
        ],
        outcome: "alert_deferred",
        sampleStatus: "failed",
      });
    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: {
        checkedAtMs: FIVE_MINUTES_MS * 3,
        failures: 2,
      },
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });

    harness.restartMonitor();
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({
      outcome: "alert_sent",
      sampleStatus: "failed",
    });

    expect(harness.primaryLinqRequests).toHaveLength(2);
    const combinedAlert = await readLinqRequestBody(
      harness.primaryLinqRequests[1],
    );
    expect(combinedAlert.message.parts[0]?.value).toBe(
      "The monitor logged evidence for an operator database review. "
      + "PgBouncer wait 9s; "
      + "Database monitor telemetry was incomplete for 2 checks "
      + "(window ended 00:15 UTC; missing PlanetScale metric observed: "
      + "Postgres max connections). Checked 01:05 UTC.",
    );
    const combinedAttempts = (
      await Promise.all(harness.allLinqRequests.map(readLinqRequestBody))
    ).filter(
      (body) =>
        body.message.parts[0]?.value
        === combinedAlert.message.parts[0]?.value,
    );
    expect(combinedAttempts.map((body) => body.to[0]).sort()).toEqual([
      "+12025550123",
      "+12025550124",
    ]);
  });

  it("retains one mixed new-incident page across the fence and recovery", async () => {
    let clientWaitSeconds = 8;
    let omitMaxConnections = false;
    const harness = createMonitorHarness({
      readMetricsBody: () => {
        const body = buildMetricsBody({
          branchId: BRANCH_ID,
          clientWaitSeconds,
        });
        return omitMaxConnections
          ? body.replace(
            /^planetscale_postgres_settings_max_connections.*$/mu,
            "",
          )
          : body;
      },
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_sent", sampleStatus: "ok" });
    clientWaitSeconds = 0;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 2)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "ok" });
    expect(harness.monitor.readAlertState().incidentOpen).toBe(false);

    omitMaxConnections = true;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 3)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "failed" });
    clientWaitSeconds = 8;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 4)).resolves
      .toMatchObject({
        conditions: [
          { kind: "client_wait", seconds: 8 },
          { failures: 2, kind: "monitoring_unavailable" },
        ],
        outcome: "alert_deferred",
        sampleStatus: "failed",
      });
    const pressurePending = harness.monitor.readAlertState();
    expect(pressurePending).toMatchObject({
      monitoringAlertObligation: {
        checkedAtMs: FIVE_MINUTES_MS * 4,
        failures: 2,
      },
      pendingAlertIncludesMonitoring: true,
    });
    expect(pressurePending.pendingAlertMessage).toBe(
      "The recorded health check produced a database incident signal. "
      + "PgBouncer wait 8s; "
      + "Database monitor telemetry was incomplete for 2 checks "
      + "(missing PlanetScale metric observed: Postgres max connections). "
      + "Checked 00:20 UTC.",
    );
    expectObservationScopedDatabaseOpening(
      pressurePending.pendingAlertMessage,
    );
    expect(pressurePending.pendingAlertIdempotencyKey).not.toBeNull();

    clientWaitSeconds = 0;
    omitMaxConnections = false;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 5)).resolves
      .toMatchObject({ outcome: "alert_deferred", sampleStatus: "ok" });
    harness.restartMonitor();
    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: expect.objectContaining({ failures: 2 }),
      pendingAlertIdempotencyKey:
        pressurePending.pendingAlertIdempotencyKey,
      pendingAlertMessage: pressurePending.pendingAlertMessage,
    });

    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent", sampleStatus: "ok" });
    expect(harness.monitor.readAlertState()).toMatchObject({
      incidentOpen: false,
      monitoringAlertObligation: null,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2 + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "healthy", sampleStatus: "ok" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS * 2),
    ).resolves.toMatchObject({ outcome: "healthy", sampleStatus: "ok" });
    expect(harness.monitor.readAlertState()).toMatchObject({
      incidentOpen: false,
      monitoringAlertObligation: null,
    });

    const allBodies = await Promise.all(
      harness.allLinqRequests.map(readLinqRequestBody),
    );
    const pressureAttempts = allBodies.filter(
      (body) =>
        body.message.parts[0]?.value === pressurePending.pendingAlertMessage,
    );
    expect(pressureAttempts.map((body) => body.to[0]).sort()).toEqual([
      "+12025550123",
      "+12025550124",
    ]);
    expect(pressureAttempts.map(
      (body) => body.message.idempotency_key,
    ).sort()).toEqual([
      pressurePending.pendingAlertIdempotencyKey,
      `${pressurePending.pendingAlertIdempotencyKey}-recipient-2`,
    ]);
    expect(harness.primaryLinqRequests).toHaveLength(2);
    expect(harness.allLinqRequests).toHaveLength(4);
  });

  it("retains pressure that begins after an unadmitted telemetry threshold", async () => {
    let clientWaitSeconds = 8;
    let omitMaxConnections = false;
    const harness = createMonitorHarness({
      readMetricsBody: () => {
        const body = buildMetricsBody({
          branchId: BRANCH_ID,
          clientWaitSeconds,
        });
        return omitMaxConnections
          ? body.replace(
            /^planetscale_postgres_settings_max_connections.*$/mu,
            "",
          )
          : body;
      },
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_sent", sampleStatus: "ok" });
    clientWaitSeconds = 0;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 2)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "ok" });

    omitMaxConnections = true;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 3)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "failed" });
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 4)).resolves
      .toMatchObject({
        conditions: [{ failures: 2, kind: "monitoring_unavailable" }],
        outcome: "alert_deferred",
        sampleStatus: "failed",
      });
    expect(harness.monitor.readAlertState()).toMatchObject({
      alertSequence: 0,
      incidentOpen: true,
      monitoringAlertObligation: {
        checkedAtMs: FIVE_MINUTES_MS * 4,
        failures: 2,
      },
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });

    clientWaitSeconds = 8;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 5)).resolves
      .toMatchObject({
        conditions: [
          { kind: "client_wait", seconds: 8 },
          { failures: 3, kind: "monitoring_unavailable" },
        ],
        outcome: "alert_deferred",
        sampleStatus: "failed",
      });
    const mixedPending = harness.monitor.readAlertState();
    expect(mixedPending).toMatchObject({
      alertSequence: 1,
      monitoringAlertObligation: {
        checkedAtMs: FIVE_MINUTES_MS * 4,
        failures: 2,
      },
      pendingAlertIncludesMonitoring: true,
    });
    expect(mixedPending.pendingAlertMessage).toBe(
      "The recorded health check produced a database incident signal. "
      + "PgBouncer wait 8s; "
      + "Database monitor telemetry was incomplete for 2 checks "
      + "(window ended 00:20 UTC; missing PlanetScale metric observed: "
      + "Postgres max connections). Checked 00:25 UTC.",
    );
    expect(mixedPending.pendingAlertIdempotencyKey).not.toBeNull();

    clientWaitSeconds = 0;
    omitMaxConnections = false;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 6)).resolves
      .toMatchObject({ outcome: "alert_deferred", sampleStatus: "ok" });
    harness.restartMonitor();
    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: expect.objectContaining({ failures: 2 }),
      pendingAlertIdempotencyKey: mixedPending.pendingAlertIdempotencyKey,
      pendingAlertMessage: mixedPending.pendingAlertMessage,
    });

    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent", sampleStatus: "ok" });
    expect(harness.monitor.readAlertState()).toMatchObject({
      incidentOpen: false,
      monitoringAlertObligation: null,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS * 2),
    ).resolves.toMatchObject({ outcome: "healthy", sampleStatus: "ok" });

    const allBodies = await Promise.all(
      harness.allLinqRequests.map(readLinqRequestBody),
    );
    const mixedAttempts = allBodies.filter(
      (body) =>
        body.message.parts[0]?.value === mixedPending.pendingAlertMessage,
    );
    expect(mixedAttempts.map((body) => body.to[0]).sort()).toEqual([
      "+12025550123",
      "+12025550124",
    ]);
    expect(mixedAttempts.map(
      (body) => body.message.idempotency_key,
    ).sort()).toEqual([
      mixedPending.pendingAlertIdempotencyKey,
      `${mixedPending.pendingAlertIdempotencyKey}-recipient-2`,
    ]);
    expect(harness.primaryLinqRequests).toHaveLength(2);
    expect(harness.allLinqRequests).toHaveLength(4);
  });

  it("keeps a delayed direct error in an unadmitted mixed incident", async () => {
    let clientWaitSeconds = 8;
    let directErrors = 5;
    let omitMaxConnections = false;
    const harness = createMonitorHarness({
      readMetricsBody: () => {
        const body = buildMetricsBody({
          branchId: BRANCH_ID,
          clientWaitSeconds,
          directErrors,
        });
        return omitMaxConnections
          ? body.replace(
            /^planetscale_postgres_settings_max_connections.*$/mu,
            "",
          )
          : body;
      },
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_sent", sampleStatus: "ok" });
    clientWaitSeconds = 0;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 2)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "ok" });

    omitMaxConnections = true;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 3)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "failed" });
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 4)).resolves
      .toMatchObject({
        conditions: [{ failures: 2, kind: "monitoring_unavailable" }],
        outcome: "alert_deferred",
        sampleStatus: "failed",
      });
    expect(harness.monitor.readAlertState()).toMatchObject({
      alertSequence: 0,
      incidentOpen: true,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });

    clientWaitSeconds = 8;
    directErrors = 7;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 5)).resolves
      .toMatchObject({
        conditions: [
          { kind: "client_wait", seconds: 8 },
          { count: 2, kind: "direct_migration_admission_failures" },
          { failures: 3, kind: "monitoring_unavailable" },
        ],
        outcome: "alert_deferred",
        sampleStatus: "failed",
      });
    const mixedPending = harness.monitor.readAlertState();
    expect(mixedPending).toMatchObject({
      alertSequence: 1,
      monitoringAlertObligation: {
        checkedAtMs: FIVE_MINUTES_MS * 4,
        failures: 2,
      },
      pendingAlertIncludesMonitoring: true,
    });
    expect(mixedPending.pendingAlertMessage).toBe(
      "The recorded health check produced a database incident signal. "
      + "PgBouncer wait 8s; "
      + "Database monitor telemetry was incomplete for 2 checks "
      + "(window ended 00:20 UTC; missing PlanetScale metric observed: "
      + "Postgres max connections); 2 direct migration connection errors. "
      + "Checked 00:25 UTC.",
    );
    expect(mixedPending.pendingAlertIdempotencyKey).not.toBeNull();

    clientWaitSeconds = 0;
    omitMaxConnections = false;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 6)).resolves
      .toMatchObject({ outcome: "alert_deferred", sampleStatus: "ok" });
    harness.restartMonitor();
    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: expect.objectContaining({ failures: 2 }),
      pendingAlertIdempotencyKey: mixedPending.pendingAlertIdempotencyKey,
      pendingAlertMessage: mixedPending.pendingAlertMessage,
    });

    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent", sampleStatus: "ok" });
    expect(harness.monitor.readAlertState()).toMatchObject({
      incidentOpen: false,
      monitoringAlertObligation: null,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS * 2),
    ).resolves.toMatchObject({ outcome: "healthy", sampleStatus: "ok" });

    const allBodies = await Promise.all(
      harness.allLinqRequests.map(readLinqRequestBody),
    );
    const mixedAttempts = allBodies.filter(
      (body) =>
        body.message.parts[0]?.value === mixedPending.pendingAlertMessage,
    );
    expect(mixedAttempts.map((body) => body.to[0]).sort()).toEqual([
      "+12025550123",
      "+12025550124",
    ]);
    expect(mixedAttempts.map(
      (body) => body.message.idempotency_key,
    ).sort()).toEqual([
      mixedPending.pendingAlertIdempotencyKey,
      `${mixedPending.pendingAlertIdempotencyKey}-recipient-2`,
    ]);
    expect(harness.primaryLinqRequests).toHaveLength(2);
    expect(harness.allLinqRequests).toHaveLength(4);
  });

  it("keeps a stale pressure retry from clearing rearmed telemetry", async () => {
    let clientWaitSeconds = 0;
    let missingFamily: "max_connections" | "server_pools" | null =
      "max_connections";
    const harness = createMonitorHarness({
      linqResponses: [
        () => new Response(null, { status: 202 }),
        () => {
          throw new Error("ambiguous pressure send");
        },
      ],
      readMetricsBody: () => {
        const body = buildMetricsBody({
          branchId: BRANCH_ID,
          clientWaitSeconds,
        });
        if (missingFamily === "max_connections") {
          return body.replace(
            /^planetscale_postgres_settings_max_connections.*$/mu,
            "",
          );
        }
        if (missingFamily === "server_pools") {
          return body.replace(
            /^planetscale_pgbouncer_pools_server.*$/gmu,
            "",
          );
        }
        return body;
      },
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "failed" });
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 2)).resolves
      .toMatchObject({ outcome: "alert_sent", sampleStatus: "failed" });
    const firstTelemetryAlert = await readLinqRequestBody(
      harness.primaryLinqRequests[0],
    );
    expect(firstTelemetryAlert.message.parts[0]?.value).toBe(
      "Database monitor telemetry was incomplete for 2 checks "
      + "(missing PlanetScale metric observed: Postgres max connections). "
      + "Window ended 00:10 UTC.",
    );

    clientWaitSeconds = 8;
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2 + ONE_HOUR_MS),
    ).resolves.toMatchObject({
      outcome: "alert_failed",
      sampleStatus: "failed",
    });
    const pressurePending = harness.monitor.readAlertState();
    expect(pressurePending).toMatchObject({
      monitoringAlertObligation: null,
      pendingAlertIncludesMonitoring: false,
    });
    expect(pressurePending.pendingAlertMessage).toContain(
      "PgBouncer wait 8s",
    );
    expect(pressurePending.pendingAlertMessage).not.toContain("telemetry");

    clientWaitSeconds = 0;
    missingFamily = null;
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3 + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_deferred", sampleStatus: "ok" });
    missingFamily = "server_pools";
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 4 + ONE_HOUR_MS),
    ).resolves.toMatchObject({
      outcome: "alert_deferred",
      sampleStatus: "failed",
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 5 + ONE_HOUR_MS),
    ).resolves.toMatchObject({
      conditions: [
        { failures: 2, kind: "monitoring_unavailable" },
      ],
      outcome: "alert_deferred",
      sampleStatus: "failed",
    });
    harness.restartMonitor();
    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: {
        checkedAtMs: FIVE_MINUTES_MS * 5 + ONE_HOUR_MS,
        failures: 2,
        missingMetrics: ["planetscale_pgbouncer_pools_server"],
      },
      pendingAlertIdempotencyKey:
        pressurePending.pendingAlertIdempotencyKey,
      pendingAlertIncludesMonitoring: false,
    });

    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2 + ONE_HOUR_MS * 2),
    ).resolves.toMatchObject({
      outcome: "alert_sent",
      sampleStatus: "failed",
    });
    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: {
        checkedAtMs: FIVE_MINUTES_MS * 5 + ONE_HOUR_MS,
        failures: 2,
      },
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
    expect(await readLinqRequestBody(harness.primaryLinqRequests[2])).toEqual(
      await readLinqRequestBody(harness.primaryLinqRequests[1]),
    );

    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3 + ONE_HOUR_MS * 2),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2 + ONE_HOUR_MS * 3),
    ).resolves.toMatchObject({ outcome: "alert_sent" });
    const secondTelemetryAlert = await readLinqRequestBody(
      harness.primaryLinqRequests[3],
    );
    expect(secondTelemetryAlert.message.parts[0]?.value).toBe(
      "Database monitor telemetry was incomplete for 2 checks "
      + "(missing PlanetScale metric observed: PgBouncer server pools). "
      + "Window ended 01:25 UTC.",
    );
    const telemetryAttempts = (
      await Promise.all(harness.allLinqRequests.map(readLinqRequestBody))
    ).filter((body) =>
      body.message.parts[0]?.value
      === firstTelemetryAlert.message.parts[0]?.value
      || body.message.parts[0]?.value
      === secondTelemetryAlert.message.parts[0]?.value
    );
    expect(telemetryAttempts.map((body) => body.to[0]).sort()).toEqual([
      "+12025550123",
      "+12025550123",
      "+12025550124",
      "+12025550124",
    ]);
    expect(secondTelemetryAlert.message.idempotency_key)
      .not.toBe(firstTelemetryAlert.message.idempotency_key);
  });

  it("advances an available direct-error baseline across partial samples", async () => {
    let directErrors = 5;
    let omitMaxConnections = false;
    const harness = createMonitorHarness({
      readMetricsBody: () => {
        const body = buildMetricsBody({
          branchId: BRANCH_ID,
          directErrors,
        });
        return omitMaxConnections
          ? body.replace(
            /^planetscale_postgres_settings_max_connections.*$/mu,
            "",
          )
          : body;
      },
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "ok" });
    directErrors = 7;
    omitMaxConnections = true;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 2)).resolves
      .toMatchObject({
        conditions: [
          {
            count: 2,
            kind: "direct_migration_admission_failures",
          },
        ],
        outcome: "alert_sent",
        sampleStatus: "failed",
      });
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 3)).resolves
      .toMatchObject({
        conditions: [
          {
            failures: 2,
            kind: "monitoring_unavailable",
          },
        ],
        outcome: "alert_deferred",
        sampleStatus: "failed",
      });

    expect(harness.monitor.readRecentSamples()[0]).toMatchObject({
      directConnectionErrorDelta: 0,
      failureCode: "required_metrics_missing",
    });
  });

  it("combines owed telemetry with direct-only inside-fence admission", async () => {
    let clientWaitSeconds = 8;
    let directErrors = 5;
    let omitMaxConnections = false;
    const harness = createMonitorHarness({
      readMetricsBody: () => {
        const body = buildMetricsBody({
          branchId: BRANCH_ID,
          clientWaitSeconds,
          directErrors,
        });
        return omitMaxConnections
          ? body.replace(
            /^planetscale_postgres_settings_max_connections.*$/mu,
            "",
          )
          : body;
      },
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_sent", sampleStatus: "ok" });
    clientWaitSeconds = 0;
    omitMaxConnections = true;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 2)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "failed" });
    clientWaitSeconds = 9;
    directErrors = 7;
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 3)).resolves
      .toMatchObject({
        conditions: [
          { kind: "client_wait", seconds: 9 },
          { count: 2, kind: "direct_migration_admission_failures" },
          { failures: 2, kind: "monitoring_unavailable" },
        ],
        outcome: "alert_deferred",
        sampleStatus: "failed",
      });

    const combinedPendingAlert = harness.monitor.readAlertState();
    const combinedIdempotencyKey =
      combinedPendingAlert.pendingAlertIdempotencyKey;
    const combinedMessage = combinedPendingAlert.pendingAlertMessage;
    if (!combinedIdempotencyKey || !combinedMessage) {
      throw new Error("Expected a persisted combined alert.");
    }
    expect(combinedPendingAlert).toMatchObject({
      monitoringAlertObligation: expect.objectContaining({ failures: 2 }),
      pendingAlertIncludesMonitoring: true,
    });
    expect(combinedPendingAlert.pendingAlertMessage).toContain(
      "2 direct migration connection errors",
    );
    expect(combinedPendingAlert.pendingAlertMessage).toContain(
      "Database monitor telemetry was incomplete for 2 checks",
    );
    expect(combinedPendingAlert.pendingAlertMessage).not.toContain(
      "PgBouncer wait",
    );

    clientWaitSeconds = 0;
    omitMaxConnections = false;
    harness.restartMonitor();
    expect(harness.monitor.readAlertState()).toMatchObject({
      pendingAlertIdempotencyKey:
        combinedIdempotencyKey,
      pendingAlertIncludesMonitoring: true,
      pendingAlertMessage: combinedMessage,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });
    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: null,
      pendingAlertIncludesMonitoring: false,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
    expect(harness.allLinqRequests).toHaveLength(4);
    const combinedBodies = await Promise.all(
      harness.allLinqRequests.slice(2).map(readLinqRequestBody),
    );
    expect(combinedBodies.map((body) => body.message.parts[0]?.value))
      .toEqual([
        combinedMessage,
        combinedMessage,
      ]);
    expect(combinedBodies.map((body) => body.message.idempotency_key).sort())
      .toEqual([
        combinedIdempotencyKey,
        `${combinedIdempotencyKey}-recipient-2`,
      ].sort());

    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS * 2),
    ).resolves.toMatchObject({ outcome: "healthy" });
    expect(harness.allLinqRequests).toHaveLength(4);
  });

  it("retries an unacknowledged telemetry page with its exact identity", async () => {
    const missingMetricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
    }).replace(
      /^planetscale_postgres_settings_max_connections.*$/mu,
      "",
    );
    const harness = createMonitorHarness({
      linqResponses: [
        () => {
          throw new Error("ambiguous send");
        },
      ],
      metricsBody: missingMetricsBody,
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "healthy", sampleStatus: "failed" });
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 2)).resolves
      .toMatchObject({ outcome: "alert_failed", sampleStatus: "failed" });
    const pendingAlert = harness.monitor.readAlertState();
    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS * 3)).resolves
      .toMatchObject({ outcome: "alert_deferred", sampleStatus: "failed" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2 + ONE_HOUR_MS),
    ).resolves.toMatchObject({
      outcome: "alert_sent",
      sampleStatus: "failed",
    });

    expect(harness.primaryLinqRequests).toHaveLength(2);
    const firstAttempt = await readLinqRequestBody(
      harness.primaryLinqRequests[0],
    );
    const retryAttempt = await readLinqRequestBody(
      harness.primaryLinqRequests[1],
    );
    expect(retryAttempt).toEqual(firstAttempt);
    expect(retryAttempt.message.idempotency_key)
      .toBe(pendingAlert.pendingAlertIdempotencyKey);
    expect(retryAttempt.message.parts[0]?.value)
      .toBe(pendingAlert.pendingAlertMessage);
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
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });
    expect(harness.monitor.readAlertState()).toMatchObject({
      incidentOpen: false,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
    expect(harness.primaryLinqRequests).toHaveLength(2);
    expect(await readLinqRequestBody(harness.primaryLinqRequests[1])).toEqual(
      await readLinqRequestBody(harness.primaryLinqRequests[0]),
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

    const directErrorMessage = (await readLinqRequestBody(
      harness.primaryLinqRequests[0],
    )).message.parts[0]?.value;
    expect(directErrorMessage)
      .toContain("2 direct migration connection errors");
    expect(directErrorMessage)
      .not.toMatch(/\b(?:capacity|headroom|pressure|utilization)\b/iu);
    expectObservationScopedDatabaseOpening(directErrorMessage);
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
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({
      conditions: [],
      outcome: "alert_sent",
    });

    expect(harness.primaryLinqRequests).toHaveLength(2);
    const deliveredBody = await readLinqRequestBody(harness.primaryLinqRequests[1]);
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

  it("excludes replayable gauge evidence from an inside-fence direct-error page", async () => {
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
      clientWaitSeconds: 9,
      directErrors: 7,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({
      conditions: [
        {
          kind: "client_wait",
          seconds: 9,
        },
        {
          count: 2,
          kind: "direct_migration_admission_failures",
        },
      ],
      outcome: "alert_deferred",
    });

    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 7,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    const delayedMessage = (
      await readLinqRequestBody(harness.primaryLinqRequests[1])
    ).message.parts[0]?.value;
    expect(delayedMessage).toContain("2 direct migration connection errors");
    expect(delayedMessage).not.toContain("PgBouncer wait");
  });

  it("includes all current mixed conditions when the attempt fence opens", async () => {
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
      clientWaitSeconds: 12,
      directErrors: 7,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    const currentMessage = (
      await readLinqRequestBody(harness.primaryLinqRequests[1])
    ).message.parts[0]?.value;
    expect(currentMessage).toContain("PgBouncer wait 12s");
    expect(currentMessage).toContain("2 direct migration connection errors");
    expect(currentMessage).toContain("Checked 01:05 UTC");
  });

  it("preserves a direct error behind an older health-suppressed gauge page", async () => {
    let metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 8,
      directErrors: 5,
    });
    const harness = createMonitorHarness({
      linqHealthResponses: [
        () => Response.json({
          ...createLinqChatResponseBody(),
          health_status: { status: "HEALTHY" },
        }),
        () => Response.json(createHealthyLinqPhoneNumbersBody()),
        () => new Response(null, { status: 503 }),
      ],
      readMetricsBody: () => metricsBody,
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_sent" });
    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 5,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({ outcome: "healthy" });

    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 9,
      directErrors: 5,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 9,
      directErrors: 7,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 4),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    expect(harness.monitor.readAlertState()).toMatchObject({
      deferredDirectErrorCount: 2,
    });

    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 7,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS + ONE_HOUR_MS),
    ).resolves.toMatchObject({ outcome: "alert_failed" });
    expect(harness.primaryLinqRequests).toHaveLength(1);
    expect(harness.monitor.readAlertState()).toMatchObject({
      deferredDirectErrorCount: 2,
    });

    harness.restartMonitor();
    await expect(
      harness.runScheduledCheck(
        FIVE_MINUTES_MS + ONE_HOUR_MS * 2,
      ),
    ).resolves.toMatchObject({ outcome: "alert_sent" });
    expect(harness.monitor.readAlertState()).toMatchObject({
      deferredDirectErrorCount: 2,
      incidentOpen: true,
      pendingAlertMessage: null,
    });

    await expect(
      harness.runScheduledCheck(
        FIVE_MINUTES_MS * 2 + ONE_HOUR_MS * 2,
      ),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    expect(harness.monitor.readAlertState()).toMatchObject({
      deferredDirectErrorCount: 0,
      pendingAlertMessage: expect.stringContaining(
        "2 direct migration connection errors",
      ),
    });

    harness.restartMonitor();
    await expect(
      harness.runScheduledCheck(
        FIVE_MINUTES_MS + ONE_HOUR_MS * 3,
      ),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    expect(harness.primaryLinqRequests).toHaveLength(3);
    const olderGaugePage = await readLinqRequestBody(harness.primaryLinqRequests[1]);
    const directErrorPage = await readLinqRequestBody(harness.primaryLinqRequests[2]);
    expect(olderGaugePage.message.parts[0]?.value)
      .toContain("PgBouncer wait 9s");
    expect(directErrorPage.message.parts[0]?.value)
      .toContain("2 direct migration connection errors");
    expect(directErrorPage.message.parts[0]?.value)
      .toContain("Checked 00:20 UTC");
    expect(directErrorPage.message.parts[0]?.value)
      .not.toContain("PgBouncer wait");
    expect(
      harness.monitor.readRecentSamples(10)
        .filter((sample) => sample.directConnectionErrorDelta === 2),
    ).toHaveLength(1);
    expect(harness.monitor.readAlertState()).toMatchObject({
      deferredDirectErrorCount: 0,
      incidentOpen: false,
      pendingAlertMessage: null,
    });
  });

  it("dates mixed current and deferred direct evidence to the current check", async () => {
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
      directErrors: 5,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({ outcome: "healthy" });

    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 9,
      directErrors: 5,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 9,
      directErrors: 7,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 4),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    expect(harness.monitor.readAlertState()).toMatchObject({
      deferredDirectErrorCheckedAtMs: FIVE_MINUTES_MS * 4,
      deferredDirectErrorCount: 2,
    });

    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 7,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 13),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 9,
    });
    harness.restartMonitor();
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 26),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    expect(harness.primaryLinqRequests).toHaveLength(3);
    const aggregatePage = await readLinqRequestBody(
      harness.primaryLinqRequests[2],
    );
    expect(aggregatePage.message.parts[0]?.value)
      .toContain("4 direct migration connection errors");
    expect(aggregatePage.message.parts[0]?.value)
      .toContain("Checked 02:10 UTC");
    expect(aggregatePage.message.parts[0]?.value)
      .not.toContain("Checked 00:20 UTC");
    expect(aggregatePage.message.parts[0]?.value)
      .not.toContain("PgBouncer wait");
    expect(harness.monitor.readAlertState()).toMatchObject({
      deferredDirectErrorCheckedAtMs: null,
      deferredDirectErrorCount: 0,
      pendingAlertMessage: null,
    });
  });

  it("promotes deferred direct evidence with owed telemetry after the fence reopens", async () => {
    let metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 8,
      directErrors: 5,
    });
    const healthyChatResponse = () => Response.json({
      ...createLinqChatResponseBody(),
      health_status: { status: "HEALTHY" },
    });
    const healthyPhoneResponse = () =>
      Response.json(createHealthyLinqPhoneNumbersBody());
    const harness = createMonitorHarness({
      linqHealthResponses: [
        healthyChatResponse,
        healthyPhoneResponse,
        healthyChatResponse,
        healthyPhoneResponse,
        () => new Response(null, { status: 503 }),
      ],
      readMetricsBody: () => metricsBody,
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({ outcome: "alert_sent" });
    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 5,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2),
    ).resolves.toMatchObject({ outcome: "healthy" });

    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 9,
      directErrors: 5,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });

    metricsBody = metricsBody.replace(
      /^planetscale_postgres_settings_max_connections.*$/mu,
      "",
    );
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 4),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 5),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    expect(harness.monitor.readAlertState()).toMatchObject({
      monitoringAlertObligation: {
        checkedAtMs: FIVE_MINUTES_MS * 5,
        failures: 2,
      },
    });
    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 9,
      directErrors: 7,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 6),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });

    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 7,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 13),
    ).resolves.toMatchObject({ outcome: "alert_sent" });
    expect(harness.monitor.readAlertState()).toMatchObject({
      deferredDirectErrorCheckedAtMs: FIVE_MINUTES_MS * 6,
      deferredDirectErrorCount: 2,
      monitoringAlertObligation: expect.objectContaining({ failures: 2 }),
      pendingAlertMessage: null,
    });

    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      clientWaitSeconds: 12,
      directErrors: 9,
    });
    harness.restartMonitor();
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 26),
    ).resolves.toMatchObject({ outcome: "alert_failed" });
    expect(harness.primaryLinqRequests).toHaveLength(2);
    expect(harness.monitor.readAlertState()).toMatchObject({
      deferredDirectErrorCheckedAtMs: null,
      deferredDirectErrorCount: 0,
      monitoringAlertObligation: expect.objectContaining({ failures: 2 }),
      pendingAlertIncludesMonitoring: true,
      pendingAlertMessage: expect.stringContaining(
        "4 direct migration connection errors",
      ),
    });
    expect(harness.monitor.readAlertState().pendingAlertMessage)
      .toContain("Checked 02:10 UTC");
    expect(harness.monitor.readAlertState().pendingAlertMessage)
      .not.toContain("Checked 00:30 UTC");
    expect(harness.monitor.readAlertState().pendingAlertMessage)
      .toContain(
        "Database monitor telemetry was incomplete for 2 checks "
        + "(window ended 00:25 UTC; missing PlanetScale metric observed: "
        + "Postgres max connections)",
      );
    expect(harness.monitor.readAlertState().pendingAlertMessage)
      .not.toContain("PgBouncer wait");

    metricsBody = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 9,
    });
    harness.restartMonitor();
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 27),
    ).resolves.toMatchObject({ outcome: "alert_deferred" });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 38),
    ).resolves.toMatchObject({ outcome: "alert_sent" });

    expect(harness.primaryLinqRequests).toHaveLength(3);
    const directErrorPage = await readLinqRequestBody(harness.primaryLinqRequests[2]);
    expect(directErrorPage.message.parts[0]?.value)
      .toContain("4 direct migration connection errors");
    expect(directErrorPage.message.parts[0]?.value)
      .toContain("Checked 02:10 UTC");
    expect(directErrorPage.message.parts[0]?.value)
      .not.toContain("Checked 00:30 UTC");
    expect(directErrorPage.message.parts[0]?.value)
      .toContain(
        "Database monitor telemetry was incomplete for 2 checks "
        + "(window ended 00:25 UTC; missing PlanetScale metric observed: "
        + "Postgres max connections)",
      );
    expect(directErrorPage.message.parts[0]?.value)
      .not.toContain("PgBouncer wait");
    const combinedBodies = await Promise.all(
      harness.allLinqRequests.slice(4).map(readLinqRequestBody),
    );
    expect(combinedBodies).toHaveLength(2);
    expect(combinedBodies[1]?.message.parts)
      .toEqual(combinedBodies[0]?.message.parts);
    expect(combinedBodies[1]?.message.idempotency_key)
      .toBe(`${combinedBodies[0]?.message.idempotency_key}-recipient-2`);
    expect(
      harness.monitor.readRecentSamples(20)
        .filter((sample) => sample.directConnectionErrorDelta === 2),
    ).toHaveLength(2);
    expect(harness.monitor.readAlertState()).toMatchObject({
      deferredDirectErrorCheckedAtMs: null,
      deferredDirectErrorCount: 0,
      incidentOpen: false,
      monitoringAlertObligation: null,
      pendingAlertMessage: null,
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 26),
    ).resolves.toMatchObject({ outcome: "healthy" });
    expect(harness.allLinqRequests).toHaveLength(6);
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
    expect(harness.primaryLinqRequests).toEqual([]);

    harness.restartMonitor();
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 3),
    ).resolves.toMatchObject({
      conditions: [],
      outcome: "alert_deferred",
    });
    await expect(
      harness.runScheduledCheck(FIVE_MINUTES_MS * 2 + ONE_HOUR_MS),
    ).resolves.toMatchObject({
      conditions: [],
      outcome: "alert_sent",
    });

    expect(harness.primaryLinqRequests).toHaveLength(1);
    const deliveredBody = await readLinqRequestBody(harness.primaryLinqRequests[0]);
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
    expect(harness.primaryLinqRequests).toHaveLength(1);
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
      const message = (await readLinqRequestBody(
        harness.primaryLinqRequests[0],
      )).message.parts[0]?.value;
      expect(message).toContain(evidence);
      expectObservationScopedDatabaseOpening(message);
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
      .toBe("service-token-id:service-token");
    expect(metricsRequest.headers.get("authorization")).toBeNull();
    expect(new URL(metricsRequest.url).searchParams.get("sig"))
      .toBe("signed-scrape-token");
    expect(new URL(metricsRequest.url).searchParams.get("exp"))
      .toBe("2000000000");
    for (const request of [discoveryRequest, metricsRequest]) {
      expect(request).toBeDefined();
      expect(request.url).not.toContain("service-token-id");
      expect(request.url).not.toContain("service-token");
      expect(request.redirect).toBe("manual");
    }
  });

  it("selects the exact database and branch when discovery repeats branch names", async () => {
    const harness = createMonitorHarness({
      serviceDiscoveryResponses: [
        () =>
          Response.json([
            {
              labels: {
                __metrics_path__: "/metrics",
                __scheme__: "https",
                planetscale_branch_name: BRANCH_NAME,
                planetscale_database_name: "other-database",
                planetscale_organization_name: ORGANIZATION,
              },
              targets: ["other.metrics.planetscale.test"],
            },
            {
              labels: {
                __metrics_path__: "/metrics",
                __scheme__: "https",
                planetscale_branch_name: BRANCH_NAME,
                planetscale_database_name: DATABASE_NAME,
                planetscale_organization_name: ORGANIZATION,
              },
              targets: ["metrics.planetscale.test"],
            },
          ]),
      ],
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({
        outcome: "healthy",
        sampleStatus: "ok",
      });
    expect(harness.planetScaleRequests).toHaveLength(2);
    expect(new URL(harness.planetScaleRequests[1]?.url ?? "").hostname)
      .toBe("metrics.planetscale.test");
  });

  it("rejects an unsafe discovered target before scrape egress", async () => {
    const createUnsafeDiscoveryResponse = () =>
      Response.json([
        {
          labels: {
            __metrics_path__: "/metrics",
            __scheme__: "https",
            planetscale_branch_name: BRANCH_NAME,
            planetscale_database_name: DATABASE_NAME,
            planetscale_organization_name: ORGANIZATION,
          },
          targets: ["metrics.planetscale.test/redirect"],
        },
      ]);
    const harness = createMonitorHarness({
      serviceDiscoveryResponses: [
        createUnsafeDiscoveryResponse,
        createUnsafeDiscoveryResponse,
      ],
    });

    await expect(harness.runScheduledCheck(FIVE_MINUTES_MS)).resolves
      .toMatchObject({
        outcome: "healthy",
        sampleStatus: "failed",
      });

    expect(harness.planetScaleRequests).toHaveLength(2);
    expect(
      harness.planetScaleRequests.every(
        (request) => new URL(request.url).hostname === "api.planetscale.com",
      ),
    ).toBe(true);
    expect(harness.primaryLinqRequests).toEqual([]);
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
  omitSecondaryLinqChatId?: boolean;
  readMetricsBody?: () => string;
  secondaryLinqChatHealthStatus?:
    | "AT_RISK"
    | "CRITICAL"
    | "HEALTHY"
    | "OPTED_OUT";
  secondaryLinqChatId?: string;
  secondaryLinqRecipient?: string;
  secondaryLinqResponses?: Array<() => Response | Promise<Response>>;
  serviceDiscoveryResponses?: Array<() => Response | Promise<Response>>;
} = {}) {
  const secondaryLinqChatId = input.omitSecondaryLinqChatId
    ? undefined
    : (input.secondaryLinqChatId ?? "chat_secondary_test");
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
  const allLinqRequests: Request[] = [];
  const primaryLinqHealthRequests: Request[] = [];
  const primaryLinqRequests: Request[] = [];
  const planetScaleRequests: Request[] = [];
  const retryWaits: number[] = [];
  let linqPhoneNumbersRequestCount = 0;
  let nowMs = FIVE_MINUTES_MS;
  const linqHealthResponses = [...(input.linqHealthResponses ?? [])];
  const linqResponses = [...(input.linqResponses ?? [])];
  const secondaryLinqResponses = [...(input.secondaryLinqResponses ?? [])];
  const serviceDiscoveryResponses = [
    ...(input.serviceDiscoveryResponses ?? []),
  ];
  let secondaryLinqRecipient =
    input.secondaryLinqRecipient ?? "+12025550124";
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
        const isPhoneNumbersRequest =
          url.pathname.endsWith("/phone_numbers");
        if (isPhoneNumbersRequest) {
          linqPhoneNumbersRequestCount += 1;
        }
        const isSecondaryRequest = isPhoneNumbersRequest
          ? linqPhoneNumbersRequestCount % 2 === 0
          : url.pathname.endsWith(`/chats/${secondaryLinqChatId}`);
        if (isSecondaryRequest) {
          if (isPhoneNumbersRequest) {
            return Response.json(createHealthyLinqPhoneNumbersBody());
          }
          return Response.json({
            ...createLinqChatResponseBody({
              recipients: [secondaryLinqRecipient],
            }),
            health_status: {
              status: input.secondaryLinqChatHealthStatus ?? "HEALTHY",
            },
          });
        }
        primaryLinqHealthRequests.push(request);
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
      allLinqRequests.push(request);
      const body = await readLinqRequestBody(request);
      if (body.to[0] === "+12025550124") {
        const next = secondaryLinqResponses.shift();
        return next ? await next() : new Response(null, { status: 202 });
      }
      primaryLinqRequests.push(request);
      const next = linqResponses.shift();
      return next ? await next() : new Response(null, { status: 202 });
    }
    throw new Error(`Unexpected database health request host: ${url.hostname}`);
  });
  const environment = {
    HOSTED_DATABASE_ALERT_LINQ_CHAT_ID: "chat_test",
    HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID: secondaryLinqChatId,
    HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID: BRANCH_ID,
    HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_NAME: BRANCH_NAME,
    HOSTED_DATABASE_ALERT_PLANETSCALE_DATABASE_NAME: DATABASE_NAME,
    HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION: ORGANIZATION,
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
      async (delayMs) => {
        retryWaits.push(delayMs);
      },
    );
  let monitor = createMonitor();

  return {
    allLinqRequests,
    failBeforeNextSuccessfulSamplePersist() {
      failBeforeSuccessfulSamplePersist = true;
    },
    fetchImplementation,
    primaryLinqHealthRequests,
    primaryLinqRequests,
    retryWaits,
    get monitor() {
      return monitor;
    },
    planetScaleRequests,
    restartMonitor() {
      monitor = createMonitor();
      return monitor;
    },
    setSecondaryLinqRecipient(recipient: string) {
      secondaryLinqRecipient = recipient;
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
        planetscale_branch_name: BRANCH_NAME,
        planetscale_database_name: DATABASE_NAME,
        planetscale_organization_name: ORGANIZATION,
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

function expectObservationScopedDatabaseOpening(
  message: string | null | undefined,
): void {
  expect(readDatabaseAlertOpening(message))
    .not.toMatch(STALE_OR_CONDITION_SPECIFIC_OPENING_CLAIM);
}

function readDatabaseAlertOpening(
  message: string | null | undefined,
): string {
  if (!message) {
    throw new Error("Expected a database alert message.");
  }
  const sentenceEnd = message.indexOf(". ");
  if (sentenceEnd === -1) {
    throw new Error("Expected a database alert opening sentence.");
  }
  return message.slice(0, sentenceEnd + 1);
}
