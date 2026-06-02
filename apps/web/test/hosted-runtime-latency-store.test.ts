import {
  recordHostedIngressAcceptedFromMailboxItem,
  recordHostedIngressAssistantInputStaged,
  recordHostedIngressProviderStarted,
  recordHostedIngressTemporalSignalAccepted,
  readHostedIngressLatencyDashboard,
  type HostedIngressLatencyDashboardInput,
} from "@/src/lib/hosted-runtime-latency/store";
import { describe, expect, it, vi } from "vitest";

type LatencyPrisma = NonNullable<HostedIngressLatencyDashboardInput["prisma"]>;
type LatencyDashboardRow = {
  acceptedAt: Date;
  assistantInputStagedAt: Date | null;
  providerStartAt: Date | null;
  temporalSignalAcceptedAt: Date | null;
};

describe("hosted runtime latency dashboard store", () => {
  it("counts missing staged rows independently of provider start", async () => {
    const prisma = createLatencyDashboardPrisma([
      {
        acceptedAt: instant("2026-05-27T12:00:00.000Z"),
        assistantInputStagedAt: null,
        providerStartAt: instant("2026-05-27T12:00:04.000Z"),
        temporalSignalAcceptedAt: null,
      },
    ]);

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-05-27T12:05:00.000Z"),
      prisma,
      source: "linq",
      windowHours: 1,
    });

    expect(dashboard.completedCount).toBe(1);
    expect(dashboard.missingProviderStartCount).toBe(0);
    expect(dashboard.missingStagedCount).toBe(1);
    expect(dashboard.recentSlowRows[0]?.acceptedToStagedMs).toBeNull();
  });

  it("counts negative stage ordering once per invalid row", async () => {
    const prisma = createLatencyDashboardPrisma([
      {
        acceptedAt: instant("2026-05-27T12:00:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:00:01.000Z"),
        providerStartAt: instant("2026-05-27T12:00:02.000Z"),
        temporalSignalAcceptedAt: instant("2026-05-27T11:59:59.000Z"),
      },
      {
        acceptedAt: instant("2026-05-27T12:01:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:00:59.000Z"),
        providerStartAt: instant("2026-05-27T12:01:02.000Z"),
        temporalSignalAcceptedAt: null,
      },
      {
        acceptedAt: instant("2026-05-27T12:02:00.000Z"),
        assistantInputStagedAt: instant("2026-05-27T12:02:05.000Z"),
        providerStartAt: instant("2026-05-27T12:02:03.000Z"),
        temporalSignalAcceptedAt: null,
      },
      {
        acceptedAt: instant("2026-05-27T12:03:00.000Z"),
        assistantInputStagedAt: null,
        providerStartAt: instant("2026-05-27T12:02:59.000Z"),
        temporalSignalAcceptedAt: null,
      },
    ]);

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-05-27T12:05:00.000Z"),
      prisma,
      source: "linq",
      windowHours: 1,
    });

    expect(dashboard.invalidNegativeLatencyCount).toBe(4);
    expect(dashboard.completedCount).toBe(3);
    expect(dashboard.stageLatencyMs.acceptedToTemporalSignalP50).toBeNull();
    expect(dashboard.stageLatencyMs.stagedToProviderStartP50).toBe(1_000);
  });

  it("stores mailbox accepted timestamps as real instants when DB-local wall time differs from UTC", async () => {
    const prisma = createLatencyWritePrisma({
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-02T18:36:52.229Z")),
    });

    await recordHostedIngressAcceptedFromMailboxItem({
      mailboxItemId: "mailbox_latency_1",
      prisma,
      source: "linq",
    });
    await recordHostedIngressTemporalSignalAccepted({
      at: instant("2026-06-02T18:36:53.229Z"),
      expectedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      prisma,
      source: "linq",
    });
    await recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_latency_1",
      at: instant("2026-06-02T18:36:54.229Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      prisma,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });
    await recordHostedIngressProviderStarted({
      assistantInputIds: ["input_latency_1"],
      at: instant("2026-06-02T18:36:55.229Z"),
      authenticatedUserId: "member_latency_1",
      prisma,
      providerRequestOrdinal: 0,
      runtimeAttemptId: "attempt_latency_1",
      source: "linq",
    });

    const trace = prisma.readTrace();
    expect(trace?.acceptedAt.toISOString()).toBe("2026-06-02T18:36:52.229Z");
    expect(trace?.temporalSignalAcceptedAt?.toISOString()).toBe("2026-06-02T18:36:53.229Z");
    expect(trace?.assistantInputStagedAt?.toISOString()).toBe("2026-06-02T18:36:54.229Z");
    expect(trace?.providerStartAt?.toISOString()).toBe("2026-06-02T18:36:55.229Z");
    expect(prisma.readMailboxQuerySql()).toContain(
      "EXTRACT(EPOCH FROM (created_at AT TIME ZONE current_setting('TimeZone')))",
    );
    expect(prisma.readMailboxQuerySql()).toContain('AS "acceptedAtEpochMs"');
    expect(prisma.readMailboxQuerySql()).not.toContain('AS "acceptedAt"');
    expect(prisma.readMailboxQueryValues()).toEqual([
      ["mailbox_latency_1"],
      ["mailbox_latency_1", "member_latency_1"],
      ["mailbox_latency_1", "member_latency_1"],
    ]);

    const dashboard = await readHostedIngressLatencyDashboard({
      inFlightGraceMs: 0,
      now: instant("2026-06-02T18:40:00.000Z"),
      prisma,
      source: "linq",
      windowHours: 1,
    });

    expect(dashboard.completedCount).toBe(1);
    expect(dashboard.invalidNegativeLatencyCount).toBe(0);
    expect(dashboard.percentileMs.p50).toBe(3_000);
    expect(dashboard.stageLatencyMs.acceptedToTemporalSignalP50).toBe(1_000);
    expect(dashboard.stageLatencyMs.acceptedToStagedP50).toBe(2_000);
    expect(dashboard.stageLatencyMs.stagedToProviderStartP50).toBe(1_000);
  });

  it("records provider start by assistant input even when a later runtime attempt handles it", async () => {
    const prisma = createLatencyWritePrisma({
      mailboxAcceptedAtEpochMs: BigInt(Date.parse("2026-06-02T19:10:20.000Z")),
    });

    await recordHostedIngressAssistantInputStaged({
      assistantInputId: "input_cross_attempt_1",
      at: instant("2026-06-02T19:10:21.000Z"),
      authenticatedUserId: "member_latency_1",
      mailboxItemId: "mailbox_latency_1",
      prisma,
      runtimeAttemptId: "attempt_staged_1",
      source: "linq",
    });
    const result = await recordHostedIngressProviderStarted({
      assistantInputIds: ["input_cross_attempt_1"],
      at: instant("2026-06-02T19:10:22.000Z"),
      authenticatedUserId: "member_latency_1",
      prisma,
      providerRequestOrdinal: 0,
      runtimeAttemptId: "attempt_provider_2",
      source: "linq",
    });

    const trace = prisma.readTrace();
    expect(result).toEqual({
      matchedCount: 1,
      recorded: true,
      unmatchedCount: 0,
    });
    expect(trace?.runtimeAttemptId).toBe("attempt_staged_1");
    expect(trace?.providerStartAt?.toISOString()).toBe("2026-06-02T19:10:22.000Z");
    expect(trace?.providerRequestOrdinal).toBe(0);
  });
});

function createLatencyDashboardPrisma(rows: LatencyDashboardRow[]): LatencyPrisma {
  return {
    $queryRaw: vi.fn(),
    hostedIngressLatencyTrace: {
      findMany: vi.fn(async () => rows),
    },
  } as unknown as LatencyPrisma;
}

function createLatencyWritePrisma(input: {
  mailboxAcceptedAtEpochMs: bigint | number | string;
}): LatencyPrisma & {
  readMailboxQuerySql: () => string;
  readMailboxQueryValues: () => readonly (readonly unknown[])[];
  readTrace: () => MutableLatencyTrace | null;
} {
  let trace: MutableLatencyTrace | null = null;
  let mailboxQueryTemplate: TemplateStringsArray | null = null;
  const mailboxQueryValues: unknown[][] = [];
  const queryRaw = vi.fn(
    async (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
      mailboxQueryTemplate = strings;
      mailboxQueryValues.push([...values]);
      return [
        {
          acceptedAtEpochMs: input.mailboxAcceptedAtEpochMs,
          id: "mailbox_latency_1",
          lane: "conversation",
          laneSeq: 1n,
          userId: "member_latency_1",
        },
      ];
    },
  );
  const findMany = vi.fn(async () => trace ? [trace] : []);
  const upsert = vi.fn(async (args: LatencyTraceUpsertInput) => {
    if (!trace) {
      trace = {
        ...args.create,
        assistantInputId: null,
        assistantInputStagedAt: null,
        createdAt: instant("2026-06-02T12:00:00.000Z"),
        providerRequestOrdinal: null,
        providerStartAt: null,
        runtimeAttemptId: null,
        temporalSignalAcceptedAt: null,
        updatedAt: instant("2026-06-02T12:00:00.000Z"),
      };
    }
    return trace;
  });
  const update = vi.fn(async (args: LatencyTraceUpdateInput) => {
    if (!trace) {
      throw new Error("Trace update called before upsert.");
    }
    trace = {
      ...trace,
      ...args.data,
      updatedAt: instant("2026-06-02T12:00:00.000Z"),
    };
    return trace;
  });
  const prisma = {
    $queryRaw: queryRaw,
    hostedIngressLatencyTrace: {
      findMany,
      upsert,
      update,
    },
    readMailboxQuerySql: () => {
      if (!mailboxQueryTemplate) {
        return "";
      }
      return mailboxQueryTemplate.join("");
    },
    readMailboxQueryValues: () => mailboxQueryValues,
    readTrace: () => trace,
  };

  return prisma as unknown as LatencyPrisma & {
    readMailboxQuerySql: () => string;
    readMailboxQueryValues: () => readonly (readonly unknown[])[];
    readTrace: () => MutableLatencyTrace | null;
  };
}

function instant(value: string): Date {
  return new Date(value);
}

type MutableLatencyTrace = LatencyTraceCreateInput & {
  assistantInputId: string | null;
  assistantInputStagedAt: Date | null;
  createdAt: Date;
  providerRequestOrdinal: number | null;
  providerStartAt: Date | null;
  runtimeAttemptId: string | null;
  temporalSignalAcceptedAt: Date | null;
  updatedAt: Date;
};

type LatencyTraceCreateInput = {
  acceptedAt: Date;
  id: string;
  mailboxItemId: string;
  mailboxLane: string;
  mailboxLaneSeq: bigint;
  source: string;
  userId: string;
};

type LatencyTraceUpdateInput = {
  data: Partial<Omit<MutableLatencyTrace, "id">>;
  where: {
    id: string;
  };
};

type LatencyTraceUpsertInput = {
  create: LatencyTraceCreateInput;
  update: Record<string, never>;
  where: {
    mailboxItemId: string;
  };
};
