import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

type MutableSignal = {
  id: number;
  userId: string;
  connectionId: string | null;
  provider: string;
  kind: string;
  payloadJson: Record<string, unknown>;
  createdAt: Date;
};

type MutableWebhookTrace = {
  provider: string;
  traceId: string;
  externalAccountId: string;
  eventType: string;
  status: string;
  processingExpiresAt: Date | null;
  receivedAt: Date;
  payloadJson: Record<string, unknown> | null;
};

function createSignalStore(seed: MutableSignal[] = []) {
  const signals = new Map<number, MutableSignal>(
    seed.map((signal) => [
      signal.id,
      {
        ...signal,
        connectionId: signal.connectionId,
        payloadJson: { ...signal.payloadJson },
        createdAt: new Date(signal.createdAt),
      },
    ]),
  );
  const createCalls: Record<string, unknown>[] = [];
  let nextId = seed.reduce((max, signal) => Math.max(max, signal.id), 0) + 1;

  const deviceSyncSignal = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      createCalls.push({ ...data });
      const signal = normalizeSignalRecord(nextId, data);
      signals.set(signal.id, signal);
      nextId += 1;
      return cloneSignal(signal);
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) => {
      const rows = [...signals.values()].filter((signal) => matchesWhere(signal, where));
      rows.sort((left, right) => left.id - right.id);
      return rows.map(cloneSignal);
    },
  };

  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma: {
      deviceSyncSignal,
    } as never,
    codec: {
      keyVersion: "v1",
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    },
  });

  return {
    createCalls,
    store,
  };
}

function createWebhookTraceStore(
  seed: MutableWebhookTrace[] = [],
  options: {
    releaseBeforeFindUniqueTraceIds?: string[];
    uniqueViolationTraceIds?: string[];
  } = {},
) {
  const traces = new Map<string, MutableWebhookTrace>(
    seed.map((trace) => [
      `${trace.provider}:${trace.traceId}`,
      {
        ...trace,
        processingExpiresAt: cloneDate(trace.processingExpiresAt),
        receivedAt: new Date(trace.receivedAt),
        payloadJson: trace.payloadJson ? { ...trace.payloadJson } : null,
      },
    ]),
  );
  const releaseBeforeFindUniqueTraceIds = new Set(options.releaseBeforeFindUniqueTraceIds ?? []);
  const uniqueViolationTraceIds = new Set(options.uniqueViolationTraceIds ?? []);
  const uniqueViolationsTriggered = new Set<string>();

  const deviceWebhookTrace = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const trace = normalizeWebhookTraceRecord(data);
      const key = `${trace.provider}:${trace.traceId}`;

      if (
        uniqueViolationTraceIds.has(trace.traceId)
        && !uniqueViolationsTriggered.has(trace.traceId)
      ) {
        uniqueViolationsTriggered.add(trace.traceId);
        throw { code: "P2002" };
      }

      if (traces.has(key)) {
        throw { code: "P2002" };
      }

      traces.set(key, trace);
      return cloneWebhookTrace(trace);
    },
    findUnique: async ({ where }: { where: Record<string, unknown> }) => {
      if (!isRecord(where.provider_traceId)) {
        return null;
      }

      const provider = typeof where.provider_traceId.provider === "string" ? where.provider_traceId.provider : null;
      const traceId = typeof where.provider_traceId.traceId === "string" ? where.provider_traceId.traceId : null;

      if (!provider || !traceId) {
        return null;
      }

      if (releaseBeforeFindUniqueTraceIds.has(traceId)) {
        traces.delete(`${provider}:${traceId}`);
        releaseBeforeFindUniqueTraceIds.delete(traceId);
        return null;
      }

      return cloneWebhookTrace(traces.get(`${provider}:${traceId}`) ?? null);
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;

      for (const trace of traces.values()) {
        if (!matchesWebhookTraceWhere(trace, where)) {
          continue;
        }

        applyWebhookTraceUpdate(trace, data);
        count += 1;
      }

      return { count };
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      let count = 0;

      for (const [key, trace] of traces.entries()) {
        if (!matchesWebhookTraceWhere(trace, where)) {
          continue;
        }

        traces.delete(key);
        count += 1;
      }

      return { count };
    },
  };

  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma: {
      deviceWebhookTrace,
    } as never,
    codec: {
      keyVersion: "v1",
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    },
  });

  return {
    store,
    traces,
  };
}

describe("PrismaDeviceSyncControlPlaneStore device-sync signals", () => {
  it("persists and returns only sparse webhook hint payloads", async () => {
    const { createCalls, store } = createSignalStore();

    const created = await store.createSignal({
      userId: "user-123",
      connectionId: "dsc_123",
      provider: "oura",
      kind: "webhook_hint",
      payload: {
        eventType: "sleep.updated",
        traceId: "trace_123",
        occurredAt: "2026-03-26T11:59:00.000Z",
        resourceCategory: "daily_sleep",
      },
      createdAt: "2026-03-26T12:00:00.000Z",
    });

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toEqual({
      userId: "user-123",
      connectionId: "dsc_123",
      provider: "oura",
      kind: "webhook_hint",
      payloadJson: {
        eventType: "sleep.updated",
        traceId: "trace_123",
        occurredAt: "2026-03-26T11:59:00.000Z",
        resourceCategory: "daily_sleep",
      },
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
    });
    expect(created).toEqual({
      id: 1,
      userId: "user-123",
      connectionId: "dsc_123",
      provider: "oura",
      kind: "webhook_hint",
      payload: {
        eventType: "sleep.updated",
        traceId: "trace_123",
        occurredAt: "2026-03-26T11:59:00.000Z",
        resourceCategory: "daily_sleep",
      },
      createdAt: "2026-03-26T12:00:00.000Z",
    });

    const listed = await store.listSignalsForUser("user-123");

    expect(listed).toEqual([created]);
  });
});

describe("PrismaDeviceSyncControlPlaneStore webhook traces", () => {
  it("persists the webhook trace claim lifecycle for hosted control-plane dedupe", async () => {
    const { store, traces } = createWebhookTraceStore([
      {
        provider: "oura",
        traceId: "trace-processed",
        externalAccountId: "acct-processed",
        eventType: "sleep.updated",
        status: "processed",
        processingExpiresAt: null,
        receivedAt: new Date("2026-03-27T00:00:00.000Z"),
        payloadJson: {
          eventType: "sleep.updated",
        },
      },
      {
        provider: "oura",
        traceId: "trace-processing",
        externalAccountId: "acct-processing",
        eventType: "sleep.updated",
        status: "processing",
        processingExpiresAt: new Date("2026-03-27T00:10:00.000Z"),
        receivedAt: new Date("2026-03-27T00:05:00.000Z"),
        payloadJson: {
          eventType: "sleep.updated",
        },
      },
      {
        provider: "oura",
        traceId: "trace-expired",
        externalAccountId: "acct-expired",
        eventType: "sleep.updated",
        status: "processing",
        processingExpiresAt: new Date("2026-03-27T00:01:00.000Z"),
        receivedAt: new Date("2026-03-27T00:00:00.000Z"),
        payloadJson: {
          eventType: "sleep.updated",
        },
      },
    ]);

    expect(
      await store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-new",
        externalAccountId: "acct-new",
        eventType: "sleep.updated",
        receivedAt: "2026-03-27T00:02:00.000Z",
        processingExpiresAt: "2026-03-27T00:07:00.000Z",
        payload: {
          eventType: "sleep.updated",
        },
      }),
    ).toBe("claimed");
    expect(
      await store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-processed",
        externalAccountId: "acct-processed-2",
        eventType: "sleep.updated",
        receivedAt: "2026-03-27T00:02:00.000Z",
        processingExpiresAt: "2026-03-27T00:07:00.000Z",
        payload: {
          eventType: "sleep.updated",
        },
      }),
    ).toBe("processed");
    expect(
      await store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-processing",
        externalAccountId: "acct-processing-2",
        eventType: "sleep.updated",
        receivedAt: "2026-03-27T00:06:00.000Z",
        processingExpiresAt: "2026-03-27T00:11:00.000Z",
        payload: {
          eventType: "sleep.updated",
        },
      }),
    ).toBe("processing");
    expect(
      await store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-expired",
        externalAccountId: "acct-reclaimed",
        eventType: "sleep.updated",
        receivedAt: "2026-03-27T00:06:00.000Z",
        processingExpiresAt: "2026-03-27T00:11:00.000Z",
        payload: {
          eventType: "sleep.updated",
        },
      }),
    ).toBe("claimed");

    await store.completeWebhookTrace("oura", "trace-new");
    await store.releaseWebhookTrace("oura", "trace-expired");

    expect(traces.get("oura:trace-new")).toMatchObject({
      status: "processed",
      processingExpiresAt: null,
      payloadJson: null,
    });
    expect(traces.get("oura:trace-expired")).toBeUndefined();
    expect(traces.get("oura:trace-processing")).toMatchObject({
      status: "processing",
      externalAccountId: "acct-processing",
    });
  });

  it("retries the hosted claim when a conflicting processing row is released before the follow-up read", async () => {
    const { traces, store } = createWebhookTraceStore([], {
      releaseBeforeFindUniqueTraceIds: ["trace-raced"],
      uniqueViolationTraceIds: ["trace-raced"],
    });

    await expect(
      store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-raced",
        externalAccountId: "acct-raced",
        eventType: "sleep.updated",
        receivedAt: "2026-03-27T00:02:00.000Z",
        processingExpiresAt: "2026-03-27T00:07:00.000Z",
        payload: {
          eventType: "sleep.updated",
        },
      }),
    ).resolves.toBe("claimed");

    expect(traces.get("oura:trace-raced")).toMatchObject({
      status: "processing",
      externalAccountId: "acct-raced",
    });
  });
});

function normalizeSignalRecord(id: number, data: Record<string, unknown>): MutableSignal {
  if (
    typeof data.userId !== "string" ||
    (typeof data.connectionId !== "string" && data.connectionId !== null) ||
    typeof data.provider !== "string" ||
    typeof data.kind !== "string" ||
    !isRecord(data.payloadJson) ||
    !(data.createdAt instanceof Date)
  ) {
    throw new TypeError("Invalid device-sync signal record.");
  }

  return {
    id,
    userId: data.userId,
    connectionId: data.connectionId,
    provider: data.provider,
    kind: data.kind,
    payloadJson: { ...data.payloadJson },
    createdAt: new Date(data.createdAt),
  };
}

function matchesWhere(signal: MutableSignal, where: Record<string, unknown>): boolean {
  if (typeof where.userId === "string" && signal.userId !== where.userId) {
    return false;
  }

  if (!isRecord(where.id) || !("gt" in where.id) || typeof where.id.gt !== "number") {
    return true;
  }

  return signal.id > where.id.gt;
}

function cloneSignal(signal: MutableSignal): MutableSignal {
  return {
    ...signal,
    connectionId: signal.connectionId,
    payloadJson: { ...signal.payloadJson },
    createdAt: new Date(signal.createdAt),
  };
}

function normalizeWebhookTraceRecord(data: Record<string, unknown>): MutableWebhookTrace {
  if (
    typeof data.provider !== "string"
    || typeof data.traceId !== "string"
    || typeof data.externalAccountId !== "string"
    || typeof data.eventType !== "string"
    || typeof data.status !== "string"
    || !(data.receivedAt instanceof Date)
    || (data.processingExpiresAt !== null && !(data.processingExpiresAt instanceof Date))
    || (!isPrismaNullSentinel(data.payloadJson) && data.payloadJson !== null && data.payloadJson !== undefined && !isRecord(data.payloadJson))
  ) {
    throw new TypeError("Invalid webhook trace record.");
  }

  return {
    provider: data.provider,
    traceId: data.traceId,
    externalAccountId: data.externalAccountId,
    eventType: data.eventType,
    status: data.status,
    processingExpiresAt: cloneDate(data.processingExpiresAt),
    receivedAt: new Date(data.receivedAt),
    payloadJson: normalizeWebhookTracePayloadJson(data.payloadJson),
  };
}

function matchesWebhookTraceWhere(trace: MutableWebhookTrace, where: Record<string, unknown>): boolean {
  if (typeof where.provider === "string" && trace.provider !== where.provider) {
    return false;
  }

  if (typeof where.traceId === "string" && trace.traceId !== where.traceId) {
    return false;
  }

  if (typeof where.status === "string" && trace.status !== where.status) {
    return false;
  }

  if (!("OR" in where) || !Array.isArray(where.OR)) {
    return true;
  }

  return where.OR.some((candidate) => matchesWebhookTraceOrBranch(trace, candidate));
}

function matchesWebhookTraceOrBranch(trace: MutableWebhookTrace, candidate: unknown): boolean {
  if (!isRecord(candidate)) {
    return false;
  }

  if ("processingExpiresAt" in candidate && candidate.processingExpiresAt === null) {
    return trace.processingExpiresAt === null;
  }

  if (
    isRecord(candidate.processingExpiresAt)
    && candidate.processingExpiresAt.lte instanceof Date
  ) {
    return (
      trace.processingExpiresAt instanceof Date
      && trace.processingExpiresAt.getTime() <= candidate.processingExpiresAt.lte.getTime()
    );
  }

  return false;
}

function applyWebhookTraceUpdate(trace: MutableWebhookTrace, data: Record<string, unknown>): void {
  if (typeof data.externalAccountId === "string") {
    trace.externalAccountId = data.externalAccountId;
  }

  if (typeof data.eventType === "string") {
    trace.eventType = data.eventType;
  }

  if ("payloadJson" in data) {
    trace.payloadJson = normalizeWebhookTracePayloadJson(data.payloadJson);
  }

  if ("processingExpiresAt" in data) {
    trace.processingExpiresAt =
      data.processingExpiresAt instanceof Date ? new Date(data.processingExpiresAt) : null;
  }

  if ("receivedAt" in data && data.receivedAt instanceof Date) {
    trace.receivedAt = new Date(data.receivedAt);
  }

  if (typeof data.status === "string") {
    trace.status = data.status;
  }
}

function cloneWebhookTrace(trace: MutableWebhookTrace | null): MutableWebhookTrace | null {
  if (!trace) {
    return null;
  }

  return {
    ...trace,
    processingExpiresAt: cloneDate(trace.processingExpiresAt),
    receivedAt: new Date(trace.receivedAt),
    payloadJson: trace.payloadJson ? { ...trace.payloadJson } : null,
  };
}

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrismaNullSentinel(value: unknown): boolean {
  return (
    value === Prisma.DbNull
    || value === Prisma.JsonNull
    || value === Prisma.AnyNull
    || (
      typeof value === "object"
      && value !== null
      && Object.getOwnPropertySymbols(value).some((symbol) => String(symbol) === "Symbol(prisma.objectEnumValue)")
    )
  );
}

function normalizeWebhookTracePayloadJson(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && !isPrismaNullSentinel(value) ? { ...value } : null;
}
