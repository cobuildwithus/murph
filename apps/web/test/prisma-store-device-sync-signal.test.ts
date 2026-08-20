import { afterEach, describe, expect, it, vi } from "vitest";

import { buildHostedProviderAccountBlindIndex } from "@/src/lib/device-sync/routing-index";
import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

type MutableSignal = {
  id: number;
  userId: string;
  connectionId: string | null;
  provider: string;
  kind: string;
  occurredAt: Date | null;
  traceId: string | null;
  eventType: string | null;
  resourceCategory: string | null;
  sourceProviderSlug: string | null;
  reason: string | null;
  nextReconcileAt: Date | null;
  revokeWarningCode: string | null;
  revokeWarningMessage: string | null;
  createdAt: Date;
};

type MutableWebhookTrace = {
  provider: string;
  traceId: string;
  providerAccountBlindIndex: string;
  eventType: string;
  status: string;
  processingExpiresAt: Date | null;
  receivedAt: Date;
};

const BLIND_INDEX_KEY = Buffer.alloc(32, 7);

afterEach(() => {
  vi.useRealTimers();
});

function createSignalStore(seed: MutableSignal[] = []) {
  const signals = new Map<number, MutableSignal>(
    seed.map((signal) => [
      signal.id,
      {
        ...signal,
        connectionId: signal.connectionId,
        occurredAt: cloneDate(signal.occurredAt),
        traceId: signal.traceId,
        eventType: signal.eventType,
        resourceCategory: signal.resourceCategory,
        sourceProviderSlug: signal.sourceProviderSlug,
        reason: signal.reason,
        nextReconcileAt: cloneDate(signal.nextReconcileAt),
        revokeWarningCode: signal.revokeWarningCode,
        revokeWarningMessage: signal.revokeWarningMessage,
        createdAt: new Date(signal.createdAt),
      },
    ]),
  );
  const createCalls: Record<string, unknown>[] = [];
  const findManyCalls: Record<string, unknown>[] = [];
  let nextId = seed.reduce((max, signal) => Math.max(max, signal.id), 0) + 1;

  const deviceSyncSignal = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      createCalls.push({ ...data });
      const signal = normalizeSignalRecord(nextId, data);
      signals.set(signal.id, signal);
      nextId += 1;
      return cloneSignal(signal);
    },
    findMany: async (input: {
      orderBy: { id: "desc" };
      take: number;
      where: {
        connectionId: { in: string[] };
        kind: { in: string[] };
        sourceProviderSlug?: string;
        userId: string;
      };
    }) => {
      findManyCalls.push(input);
      return [...signals.values()]
        .filter((signal) =>
          signal.userId === input.where.userId
          && input.where.kind.in.includes(signal.kind)
          && signal.connectionId !== null
          && input.where.connectionId.in.includes(signal.connectionId)
          && (
            input.where.sourceProviderSlug === undefined
            || signal.sourceProviderSlug === input.where.sourceProviderSlug
          )
        )
        .sort((left, right) => right.id - left.id)
        .slice(0, input.take)
        .map(cloneSignal);
    },
  };

  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma: {
      deviceSyncSignal,
    } as never,
    providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    codec: {
      keyVersion: "v1",
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    },
  });

  return {
    createCalls,
    findManyCalls,
    store,
  };
}

function createWebhookTraceStore(seed: MutableWebhookTrace[] = []) {
  const traces = new Map<string, MutableWebhookTrace>(
    seed.map((trace) => [
      `${trace.provider}:${trace.traceId}`,
      {
        ...trace,
        processingExpiresAt: cloneDate(trace.processingExpiresAt),
        receivedAt: new Date(trace.receivedAt),
      },
    ]),
  );
  const executeRaw = vi.fn(async () => 0);
  const queryRaw = vi.fn(async () => [{ acquired: true }]);

  const deviceWebhookTrace = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const trace = normalizeWebhookTraceRecord(data);
      const key = `${trace.provider}:${trace.traceId}`;

      if (traces.has(key)) {
        throw { code: "P2002" };
      }

      traces.set(key, trace);
      return cloneWebhookTrace(trace);
    },
    createMany: async ({ data }: { data: Record<string, unknown>; skipDuplicates?: boolean }) => {
      const trace = normalizeWebhookTraceRecord(data);
      const key = `${trace.provider}:${trace.traceId}`;

      if (traces.has(key)) {
        return { count: 0 };
      }

      traces.set(key, trace);
      return { count: 1 };
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

  const prisma = {
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    $transaction: vi.fn(),
    deviceWebhookTrace,
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) =>
    callback(prisma)
  );

  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma: prisma as never,
    providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    codec: {
      keyVersion: "v1",
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    },
  });

  return {
    executeRaw,
    queryRaw,
    store,
    traces,
  };
}

describe("PrismaDeviceSyncControlPlaneStore device-sync signals", () => {
  it("persists minimized webhook hint payloads", async () => {
    const { createCalls, store } = createSignalStore();

    const created = await store.createSignal({
      userId: "user-123",
      connectionId: "dsc_123",
      provider: "oura",
      kind: "webhook_hint",
      eventType: "sleep.updated",
      traceId: "trace_123",
      occurredAt: "2026-03-26T11:59:00.000Z",
      resourceCategory: "daily_sleep",
      sourceProviderSlug: "health_connect",
      createdAt: "2026-03-26T12:00:00.000Z",
    });

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toEqual({
      userId: "user-123",
      connectionId: "dsc_123",
      provider: "oura",
      kind: "webhook_hint",
      eventType: "sleep.updated",
      traceId: "trace_123",
      occurredAt: new Date("2026-03-26T11:59:00.000Z"),
      resourceCategory: "daily_sleep",
      sourceProviderSlug: "health_connect",
      reason: null,
      nextReconcileAt: null,
      revokeWarningCode: null,
      revokeWarningMessage: null,
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
    });
    expect(created).toEqual({
      id: 1,
      userId: "user-123",
      connectionId: "dsc_123",
      provider: "oura",
      kind: "webhook_hint",
      occurredAt: "2026-03-26T11:59:00.000Z",
      traceId: "trace_123",
      eventType: "sleep.updated",
      resourceCategory: "daily_sleep",
      sourceProviderSlug: "health_connect",
      reason: null,
      nextReconcileAt: null,
      revokeWarning: null,
      createdAt: "2026-03-26T12:00:00.000Z",
    });

  });

  it("drops hosted revoke warning messages while keeping the warning code", async () => {
    const { createCalls, store } = createSignalStore();

    const created = await store.createSignal({
      userId: "user-123",
      connectionId: "dsc_123",
      provider: "whoop",
      kind: "disconnect_warning",
      revokeWarning: {
        code: "WHOOP_REFRESH_TOKEN_MISSING",
        message: "Provider revoke request failed during disconnect.",
      },
      createdAt: "2026-03-26T12:00:00.000Z",
    });

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toEqual(expect.objectContaining({
      revokeWarningCode: "WHOOP_REFRESH_TOKEN_MISSING",
      revokeWarningMessage: null,
    }));
    expect(created.revokeWarning).toEqual({
      code: "WHOOP_REFRESH_TOKEN_MISSING",
    });
  });

  it("filters webhook and canonical import evidence by Junction source when requested", async () => {
    const baseSignal: MutableSignal = {
      connectionId: "dsc_123",
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      eventType: "daily.data.sleep.updated",
      id: 1,
      kind: "webhook_hint",
      nextReconcileAt: null,
      occurredAt: new Date("2026-03-26T11:59:00.000Z"),
      provider: "junction",
      reason: null,
      resourceCategory: "summary",
      revokeWarningCode: null,
      revokeWarningMessage: null,
      sourceProviderSlug: "apple_health_kit",
      traceId: "trace_apple",
      userId: "user-123",
    };
    const { findManyCalls, store } = createSignalStore([
      baseSignal,
      {
        ...baseSignal,
        eventType: "canonical.data.workouts.imported",
        id: 2,
        kind: "canonical_import",
        occurredAt: new Date("2026-03-26T12:01:00.000Z"),
        sourceProviderSlug: "health_connect",
        traceId: "trace_android",
      },
    ]);

    const signals = await store.listRecentConnectionStatusSignals({
      connectionIds: ["dsc_123"],
      sourceProviderSlug: "health_connect",
      userId: "user-123",
    });

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      sourceProviderSlug: "health_connect",
      traceId: "trace_android",
    });
    expect(findManyCalls).toEqual([
      expect.objectContaining({
        where: {
          connectionId: { in: ["dsc_123"] },
          kind: { in: ["webhook_hint", "canonical_import"] },
          sourceProviderSlug: "health_connect",
          userId: "user-123",
        },
      }),
    ]);
  });
});

describe("PrismaDeviceSyncControlPlaneStore webhook traces", () => {
  it("persists the webhook trace claim lifecycle for hosted control-plane dedupe", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T00:06:00.000Z"));

    const { store, traces } = createWebhookTraceStore([
      {
        provider: "oura",
        traceId: "trace-prunable",
        providerAccountBlindIndex: buildTestBlindIndex("oura", "acct-prunable"),
        eventType: "sleep.updated",
        status: "processed",
        processingExpiresAt: null,
        receivedAt: new Date("2025-01-01T00:00:00.000Z"),
      },
      {
        provider: "oura",
        traceId: "trace-processed",
        providerAccountBlindIndex: buildTestBlindIndex("oura", "acct-processed"),
        eventType: "sleep.updated",
        status: "processed",
        processingExpiresAt: null,
        receivedAt: new Date("2026-03-27T00:00:00.000Z"),
      },
      {
        provider: "oura",
        traceId: "trace-processing",
        providerAccountBlindIndex: buildTestBlindIndex("oura", "acct-processing"),
        eventType: "sleep.updated",
        status: "processing",
        processingExpiresAt: new Date("2026-03-27T00:10:00.000Z"),
        receivedAt: new Date("2026-03-27T00:05:00.000Z"),
      },
      {
        provider: "oura",
        traceId: "trace-expired",
        providerAccountBlindIndex: buildTestBlindIndex("oura", "acct-expired"),
        eventType: "sleep.updated",
        status: "processing",
        processingExpiresAt: new Date("2026-03-27T00:01:00.000Z"),
        receivedAt: new Date("2026-03-27T00:00:00.000Z"),
      },
    ]);

    expect(
      await store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-new",
        externalAccountId: "acct-new",
        claimedAt: "2026-03-27T00:02:00.000Z",
        claimToken: "claim-token",
        eventType: "sleep.updated",
        receivedAt: "2026-03-27T00:02:00.000Z",
        processingExpiresAt: "2026-03-27T00:07:00.000Z",
      }),
    ).toBe("claimed");
    expect(
      await store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-processed",
        externalAccountId: "acct-processed-2",
        claimedAt: "2026-03-27T00:02:00.000Z",
        claimToken: "claim-token",
        eventType: "sleep.updated",
        receivedAt: "2026-03-27T00:02:00.000Z",
        processingExpiresAt: "2026-03-27T00:07:00.000Z",
      }),
    ).toBe("processed");
    expect(
      await store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-processing",
        externalAccountId: "acct-processing-2",
        claimedAt: "2026-03-27T00:06:00.000Z",
        claimToken: "claim-token",
        eventType: "sleep.updated",
        receivedAt: "2026-03-27T00:06:00.000Z",
        processingExpiresAt: "2026-03-27T00:11:00.000Z",
      }),
    ).toBe("processing");
    expect(
      await store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-expired",
        externalAccountId: "acct-reclaimed",
        claimedAt: "2026-03-27T00:06:00.000Z",
        claimToken: "claim-token",
        eventType: "sleep.updated",
        receivedAt: "2026-03-27T00:06:00.000Z",
        processingExpiresAt: "2026-03-27T00:11:00.000Z",
      }),
    ).toBe("claimed");

    await store.completeWebhookTrace("oura", "trace-new", "claim-token");
    await store.releaseWebhookTrace("oura", "trace-expired", "claim-token");

    expect(traces.get("oura:trace-new")).toMatchObject({
      status: "processed",
      processingExpiresAt: null,
    });
    expect(traces.get("oura:trace-expired")).toBeUndefined();
    // Retention for unrelated processed traces belongs to the hourly job, not
    // to whichever webhook happens to arrive next.
    expect(traces.get("oura:trace-prunable")).toMatchObject({
      status: "processed",
    });
    expect(traces.get("oura:trace-processing")).toMatchObject({
      status: "processing",
      providerAccountBlindIndex: buildTestBlindIndex("oura", "acct-processing"),
    });
  });

  it("claims hosted webhook traces with exact trace dedupe instead of a provider-account owner lock", async () => {
    const { queryRaw, traces, store } = createWebhookTraceStore();

    await expect(
      store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-raced",
        externalAccountId: "acct-raced",
        claimedAt: "2026-03-27T00:02:00.000Z",
        claimToken: "claim-token",
        eventType: "sleep.updated",
        receivedAt: "2026-03-27T00:02:00.000Z",
        processingExpiresAt: "2026-03-27T00:07:00.000Z",
      }),
    ).resolves.toBe("claimed");

    expect(traces.get("oura:trace-raced")).toMatchObject({
      status: "processing",
      providerAccountBlindIndex: buildTestBlindIndex("oura", "acct-raced"),
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

function normalizeSignalRecord(id: number, data: Record<string, unknown>): MutableSignal {
  if (
    typeof data.userId !== "string" ||
    (typeof data.connectionId !== "string" && data.connectionId !== null) ||
    typeof data.provider !== "string" ||
    typeof data.kind !== "string" ||
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
    occurredAt: data.occurredAt instanceof Date ? new Date(data.occurredAt) : null,
    traceId: typeof data.traceId === "string" ? data.traceId : null,
    eventType: typeof data.eventType === "string" ? data.eventType : null,
    resourceCategory: typeof data.resourceCategory === "string" ? data.resourceCategory : null,
    sourceProviderSlug: typeof data.sourceProviderSlug === "string" ? data.sourceProviderSlug : null,
    reason: typeof data.reason === "string" ? data.reason : null,
    nextReconcileAt: data.nextReconcileAt instanceof Date ? new Date(data.nextReconcileAt) : null,
    revokeWarningCode: typeof data.revokeWarningCode === "string" ? data.revokeWarningCode : null,
    revokeWarningMessage: typeof data.revokeWarningMessage === "string" ? data.revokeWarningMessage : null,
    createdAt: new Date(data.createdAt),
  };
}

function cloneSignal(signal: MutableSignal): MutableSignal {
  return {
    ...signal,
    connectionId: signal.connectionId,
    occurredAt: cloneDate(signal.occurredAt),
    nextReconcileAt: cloneDate(signal.nextReconcileAt),
    createdAt: new Date(signal.createdAt),
  };
}

function normalizeWebhookTraceRecord(data: Record<string, unknown>): MutableWebhookTrace {
  if (
    typeof data.provider !== "string"
    || typeof data.traceId !== "string"
    || typeof data.providerAccountBlindIndex !== "string"
    || typeof data.eventType !== "string"
    || typeof data.status !== "string"
    || !(data.receivedAt instanceof Date)
    || (data.processingExpiresAt !== null && !(data.processingExpiresAt instanceof Date))
  ) {
    throw new TypeError("Invalid webhook trace record.");
  }

  return {
    provider: data.provider,
    traceId: data.traceId,
    providerAccountBlindIndex: data.providerAccountBlindIndex,
    eventType: data.eventType,
    status: data.status,
    processingExpiresAt: cloneDate(data.processingExpiresAt),
    receivedAt: new Date(data.receivedAt),
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

  if (
    isRecord(where.receivedAt)
    && where.receivedAt.lt instanceof Date
    && trace.receivedAt.getTime() >= where.receivedAt.lt.getTime()
  ) {
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
  if (typeof data.providerAccountBlindIndex === "string") {
    trace.providerAccountBlindIndex = data.providerAccountBlindIndex;
  }

  if (typeof data.eventType === "string") {
    trace.eventType = data.eventType;
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
  };
}

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildTestBlindIndex(provider: string, externalAccountId: string): string {
  return buildHostedProviderAccountBlindIndex({
    key: BLIND_INDEX_KEY,
    provider,
    externalAccountId,
  });
}
