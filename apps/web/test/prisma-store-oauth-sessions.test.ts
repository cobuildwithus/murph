import { describe, expect, it, vi } from "vitest";

import { PrismaHostedOAuthSessionStore } from "@/src/lib/device-sync/prisma-store/oauth-sessions";

interface MockDeviceOauthSessionRow {
  state: string;
  userId: string | null;
  provider: string;
  providerApplicationId: string | null;
  providerApplicationRevision: number | null;
  returnTo: string | null;
  metadataJson: Record<string, unknown> | null;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

describe("PrismaHostedOAuthSessionStore.createOAuthState", () => {
  it("persists safe source and seeded connection metadata for external-link callbacks", async () => {
    const create = vi.fn().mockResolvedValue({});
    const store = {
      prisma: {
        deviceOauthSession: {
          create,
        },
      },
      createOAuthState: PrismaHostedOAuthSessionStore.prototype.createOAuthState,
    };

    await expect(store.createOAuthState({
      state: "state_123",
      ownerId: "user_123",
      provider: "junction",
      returnTo: "https://murph.test/connect?connectSource=garmin",
      metadata: {
        __murphConnectSourceId: "garmin",
        __murphConnectTarget: "garmin",
        __murphSeededConnectionAccountId: "dsc_seeded",
      },
      createdAt: "2026-04-13T12:00:00.000Z",
      expiresAt: "2026-04-13T12:15:00.000Z",
    })).resolves.toMatchObject({
      state: "state_123",
      provider: "junction",
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadataJson: {
          __murphConnectSourceId: "garmin",
          __murphConnectTarget: "garmin",
          __murphSeededConnectionAccountId: "dsc_seeded",
        },
      }),
    });
  });
});

describe("PrismaHostedOAuthSessionStore member-owned provider binding", () => {
  it("persists and re-reads the exact application revision without consuming state", async () => {
    const create = vi.fn().mockResolvedValue({});
    const findFirst = vi.fn().mockResolvedValue({
      provider: "strava",
      providerApplicationId: "dpa_123",
      providerApplicationRevision: 4,
      userId: "user_123",
    });
    const applicationFindFirst = vi.fn().mockResolvedValue({ id: "dpa_123" });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      deviceOauthSession: { create },
      deviceProviderApplication: { findFirst: applicationFindFirst },
    };
    const store = {
      prisma: {
        $transaction: async <TResult>(
          callback: (transaction: typeof tx) => Promise<TResult>,
        ) => callback(tx),
        deviceOauthSession: { findFirst },
      },
      createOAuthStateWithProviderApplication:
        PrismaHostedOAuthSessionStore.prototype.createOAuthStateWithProviderApplication,
      readOAuthStateProviderApplicationBinding:
        PrismaHostedOAuthSessionStore.prototype.readOAuthStateProviderApplicationBinding,
    };
    const state = {
      state: "state_123",
      ownerId: "user_123",
      provider: "strava",
      returnTo: "https://murph.test/connect",
      metadata: {},
      createdAt: "2026-04-13T12:00:00.000Z",
      expiresAt: "2026-04-13T12:15:00.000Z",
    };
    const binding = {
      applicationId: "dpa_123",
      provider: "strava" as const,
      revision: 4,
    };

    await store.createOAuthStateWithProviderApplication(state, binding);
    await expect(store.readOAuthStateProviderApplicationBinding({
      expectedOwnerId: "user_123",
      expectedProvider: "strava",
      now: "2026-04-13T12:01:00.000Z",
      state: "state_123",
    })).resolves.toEqual(binding);

    expect(applicationFindFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        id: "dpa_123",
        memberId: "user_123",
        provider: "strava",
        revision: 4,
        setups: {
          some: {
            active: true,
            memberId: "user_123",
            provider: "strava",
            providerApplicationRevision: 4,
            status: "oauth_in_progress",
          },
        },
      },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerApplicationId: "dpa_123",
        providerApplicationRevision: 4,
      }),
    });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provider: "strava",
        state: "state_123",
        userId: "user_123",
      }),
    }));
  });

  it("rejects new OAuth state after the exact setup entered deletion", async () => {
    const create = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      deviceOauthSession: { create },
      deviceProviderApplication: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const store = {
      prisma: {
        $transaction: async <TResult>(
          callback: (transaction: typeof tx) => Promise<TResult>,
        ) => callback(tx),
      },
      createOAuthStateWithProviderApplication:
        PrismaHostedOAuthSessionStore.prototype.createOAuthStateWithProviderApplication,
    };

    await expect(store.createOAuthStateWithProviderApplication({
      state: "state_123",
      ownerId: "user_123",
      provider: "strava",
      returnTo: null,
      metadata: {},
      createdAt: "2026-04-13T12:00:00.000Z",
      expiresAt: "2026-04-13T12:15:00.000Z",
    }, {
      applicationId: "dpa_123",
      provider: "strava",
      revision: 4,
    })).rejects.toMatchObject({
      code: "PROVIDER_APPLICATION_STALE",
    });
    expect(tx.deviceProviderApplication.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: expect.objectContaining({
        id: "dpa_123",
        setups: {
          some: expect.objectContaining({ status: "oauth_in_progress" }),
        },
      }),
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a stale application revision before persisting OAuth state", async () => {
    const create = vi.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      deviceOauthSession: { create },
      deviceProviderApplication: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const store = {
      prisma: {
        $transaction: async <TResult>(
          callback: (transaction: typeof tx) => Promise<TResult>,
        ) => callback(tx),
      },
      createOAuthStateWithProviderApplication:
        PrismaHostedOAuthSessionStore.prototype.createOAuthStateWithProviderApplication,
    };

    await expect(store.createOAuthStateWithProviderApplication({
      state: "state_123",
      ownerId: "user_123",
      provider: "strava",
      returnTo: null,
      metadata: {},
      createdAt: "2026-04-13T12:00:00.000Z",
      expiresAt: "2026-04-13T12:15:00.000Z",
    }, {
      applicationId: "dpa_123",
      provider: "strava",
      revision: 4,
    })).rejects.toMatchObject({
      code: "PROVIDER_APPLICATION_STALE",
      httpStatus: 409,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects provider mismatch before persisting state", async () => {
    const create = vi.fn().mockResolvedValue({});
    const store = {
      prisma: { deviceOauthSession: { create } },
      createOAuthStateWithProviderApplication:
        PrismaHostedOAuthSessionStore.prototype.createOAuthStateWithProviderApplication,
    };

    await expect(store.createOAuthStateWithProviderApplication({
      state: "state_123",
      ownerId: "user_123",
      provider: "oura",
      returnTo: null,
      metadata: {},
      createdAt: "2026-04-13T12:00:00.000Z",
      expiresAt: "2026-04-13T12:15:00.000Z",
    }, {
      applicationId: "dpa_123",
      provider: "strava",
      revision: 4,
    })).rejects.toThrow(/provider mismatch/u);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("PrismaHostedOAuthSessionStore.consumeOAuthState", () => {

  it("refuses to consume state through a different provider application", async () => {
    const record = buildOAuthSessionRow({
      provider: "strava",
      providerApplicationId: "dpa_original",
      providerApplicationRevision: 4,
    });
    const tx = createTransaction({ record });
    const store = createStore(tx);

    await expect(
      store.consumeOAuthStateWithProviderApplication(
        record.state,
        record.createdAt.toISOString(),
        {
          applicationId: "dpa_other",
          provider: "strava",
          revision: 4,
        },
        "strava",
        record.userId ?? undefined,
      ),
    ).rejects.toMatchObject({
      code: "PROVIDER_APPLICATION_STALE",
      retryable: false,
    });
    expect(tx.deviceOauthSession.updateMany).not.toHaveBeenCalled();
    expect(tx.deviceOauthSession.deleteMany).not.toHaveBeenCalled();
  });

  it("reports an already-consumed unexpired state as a replay with its stored record", async () => {
    const record = buildOAuthSessionRow({
      consumedAt: new Date("2026-04-13T12:01:00.000Z"),
    });
    const tx = createTransaction({ record });
    const store = createStore(tx);

    await expect(
      store.consumeOAuthState(record.state, record.createdAt.toISOString(), record.provider),
    ).resolves.toMatchObject({
      status: "replayed",
      record: {
        state: record.state,
        provider: record.provider,
        returnTo: record.returnTo,
      },
    });
    expect(tx.deviceOauthSession.updateMany).not.toHaveBeenCalled();
    expect(tx.deviceOauthSession.deleteMany).not.toHaveBeenCalled();
  });

  it("resolves a lost consume race as a replay instead of doing the work twice", async () => {
    const record = buildOAuthSessionRow();
    const tx = createTransaction({
      record,
      updateManyCount: 0,
    });
    const store = createStore(tx);

    await expect(
      store.consumeOAuthState(record.state, record.createdAt.toISOString(), record.provider),
    ).resolves.toMatchObject({
      status: "replayed",
    });
  });

  it("deletes an expired state and reports it missing", async () => {
    const record = buildOAuthSessionRow();
    const tx = createTransaction({ record });
    const store = createStore(tx);

    await expect(
      store.consumeOAuthState(record.state, "2026-04-13T12:30:00.000Z", record.provider),
    ).resolves.toEqual({
      status: "missing",
    });
    expect(tx.deviceOauthSession.deleteMany).toHaveBeenCalledWith({
      where: {
        state: record.state,
      },
    });
    expect(tx.deviceOauthSession.updateMany).not.toHaveBeenCalled();
  });

  it("keeps an unexpired state available when the expected owner does not match", async () => {
    const record = buildOAuthSessionRow({ userId: "user_123" });
    const tx = createTransaction({ record });
    const store = createStore(tx);

    await expect(
      store.consumeOAuthState(record.state, record.createdAt.toISOString(), record.provider, "user_456"),
    ).resolves.toEqual({
      status: "owner_mismatch",
    });
    expect(tx.deviceOauthSession.updateMany).not.toHaveBeenCalled();
    expect(tx.deviceOauthSession.deleteMany).not.toHaveBeenCalled();
  });

  it("keeps a mismatched provider state available for the correct callback path", async () => {
    const record = buildOAuthSessionRow({ provider: "oura" });
    const tx = createTransaction({ record });
    const store = createStore(tx);

    await expect(
      store.consumeOAuthState(record.state, record.createdAt.toISOString(), "whoop"),
    ).resolves.toEqual({
      status: "provider_mismatch",
      provider: record.provider,
    });
    expect(tx.deviceOauthSession.updateMany).not.toHaveBeenCalled();
    expect(tx.deviceOauthSession.deleteMany).not.toHaveBeenCalled();
  });

  it("returns the stored state after a successful single consumer mark", async () => {
    const record = buildOAuthSessionRow({
      metadataJson: {
        __murphConnectSourceId: "garmin",
        __murphConnectTarget: "garmin",
        __murphSeededConnectionAccountId: "dsc_seeded",
      },
    });
    const tx = createTransaction({ record });
    const store = createStore(tx);

    await expect(
      store.consumeOAuthState(record.state, record.createdAt.toISOString(), record.provider),
    ).resolves.toEqual({
      status: "consumed",
      record: {
        state: record.state,
        provider: record.provider,
        returnTo: record.returnTo,
        ownerId: record.userId,
        metadata: {
          __murphConnectSourceId: "garmin",
          __murphConnectTarget: "garmin",
          __murphSeededConnectionAccountId: "dsc_seeded",
        },
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
      },
    });
    expect(tx.deviceOauthSession.updateMany).toHaveBeenCalledWith({
      data: {
        consumedAt: record.createdAt,
      },
      where: {
        state: record.state,
        consumedAt: null,
      },
    });
    expect(tx.deviceOauthSession.deleteMany).not.toHaveBeenCalled();
  });
});

function buildOAuthSessionRow(
  overrides: Partial<MockDeviceOauthSessionRow> = {},
): MockDeviceOauthSessionRow {
  return {
    state: overrides.state ?? "state_123",
    userId: overrides.userId ?? "user_123",
    provider: overrides.provider ?? "whoop",
    providerApplicationId: overrides.providerApplicationId ?? null,
    providerApplicationRevision: overrides.providerApplicationRevision ?? null,
    returnTo: overrides.returnTo ?? "https://murph.test/settings",
    metadataJson: overrides.metadataJson ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-04-13T12:00:00.000Z"),
    expiresAt: overrides.expiresAt ?? new Date("2026-04-13T12:15:00.000Z"),
    consumedAt: overrides.consumedAt ?? null,
  };
}

function createTransaction(input: {
  record?: MockDeviceOauthSessionRow | null;
  deleteManyCount?: number;
  updateManyCount?: number;
}) {
  return {
    deviceOauthSession: {
      deleteMany: vi.fn().mockResolvedValue({ count: input.deleteManyCount ?? 1 }),
      findUnique: vi.fn().mockResolvedValue(input.record ?? null),
      updateMany: vi.fn().mockResolvedValue({ count: input.updateManyCount ?? 1 }),
    },
  };
}

function createStore(tx: ReturnType<typeof createTransaction>) {
  return new PrismaHostedOAuthSessionStore({
    $transaction: async <TResult>(
      callback: (transaction: typeof tx) => Promise<TResult>,
    ) => callback(tx),
  } as never);
}
