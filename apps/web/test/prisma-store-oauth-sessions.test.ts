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

  it("reports an already-consumed expired state as a replay with its stored record", async () => {
    const record = buildOAuthSessionRow({
      consumedAt: new Date("2026-04-13T12:01:00.000Z"),
    });
    const tx = createTransaction({ record });
    const store = createStore(tx);

    await expect(
      store.consumeOAuthState(
        record.state,
        "2026-04-13T12:30:00.000Z",
        record.provider,
      ),
    ).resolves.toMatchObject({
      status: "replayed",
      consumedAt: record.consumedAt?.toISOString(),
      record: {
        state: record.state,
        provider: record.provider,
        returnTo: record.returnTo,
      },
    });
    expect(tx.deviceOauthSession.updateMany).not.toHaveBeenCalled();
    expect(tx.deviceOauthSession.deleteMany).not.toHaveBeenCalled();
  });

  it("does not disclose an expired consumed claim through a foreign provider", async () => {
    const record = buildOAuthSessionRow({
      consumedAt: new Date("2026-04-13T12:01:00.000Z"),
    });
    const tx = createTransaction({ record });
    const store = createStore(tx);

    await expect(store.consumeOAuthState(
      record.state,
      "2026-04-13T12:30:00.000Z",
      "another-provider",
    )).resolves.toEqual({
      provider: record.provider,
      status: "provider_mismatch",
    });
    expect(tx.deviceOauthSession.deleteMany).not.toHaveBeenCalled();
  });

  it("expires only unconsumed callback claims", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const store = new PrismaHostedOAuthSessionStore({
      deviceOauthSession: { deleteMany },
    } as never);
    const now = "2026-04-13T12:30:00.000Z";

    await expect(store.deleteExpiredOAuthStates(now)).resolves.toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        consumedAt: null,
        expiresAt: { lte: new Date(now) },
      },
    });
  });

  it("resolves a lost consume race as a replay instead of doing the work twice", async () => {
    const record = buildOAuthSessionRow();
    const replayConsumedAt = new Date("2026-04-13T12:00:30.000Z");
    const tx = createTransaction({
      record,
      replayConsumedAt,
      updateManyCount: 0,
    });
    const store = createStore(tx);

    await expect(
      store.consumeOAuthState(record.state, record.createdAt.toISOString(), record.provider),
    ).resolves.toMatchObject({
      consumedAt: replayConsumedAt.toISOString(),
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
      consumedAt: record.createdAt.toISOString(),
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

  it("deletes state instead of starting provider work for a suspended owner", async () => {
    const record = buildOAuthSessionRow();
    const tx = createTransaction({
      owner: { suspendedAt: new Date("2026-04-13T12:00:00.000Z") },
      record,
    });
    const store = createStore(tx);

    await expect(
      store.consumeOAuthState(
        record.state,
        record.createdAt.toISOString(),
        record.provider,
        record.userId ?? undefined,
      ),
    ).resolves.toEqual({ status: "missing" });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.deviceOauthSession.updateMany).not.toHaveBeenCalled();
    expect(tx.deviceOauthSession.deleteMany).toHaveBeenCalledWith({
      where: {
        consumedAt: null,
        state: record.state,
      },
    });
  });

  it("returns a consumed claim as replayed before suspended-owner cleanup", async () => {
    const consumedAt = new Date("2026-04-13T12:01:00.000Z");
    const record = buildOAuthSessionRow({ consumedAt });
    const tx = createTransaction({
      owner: { suspendedAt: new Date("2026-04-13T12:02:00.000Z") },
      record,
    });
    const store = createStore(tx);

    await expect(store.consumeOAuthState(
      record.state,
      "2026-04-13T12:03:00.000Z",
      record.provider,
      record.userId ?? undefined,
    )).resolves.toMatchObject({
      consumedAt: consumedAt.toISOString(),
      status: "replayed",
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.deviceOauthSession.deleteMany).not.toHaveBeenCalled();
  });

  it("discards only an exact owner/provider unconsumed admission", async () => {
    const record = buildOAuthSessionRow({
      provider: "oura",
      state: "state_exact",
      userId: "member_exact",
    });
    const tx = createTransaction({ record });
    const store = createStore(tx);

    await expect(store.discardUnconsumedOAuthState(
      "state_exact",
      record.createdAt.toISOString(),
      "oura",
      "member_exact",
    )).resolves.toMatchObject({ status: "discarded", record: { state: "state_exact" } });
    expect(tx.deviceOauthSession.deleteMany).toHaveBeenCalledWith({
      where: {
        consumedAt: null,
        state: "state_exact",
      },
    });
  });

  it("finalizes a consumed callback claim with one exact delete", async () => {
    const tx = createTransaction({ record: null });
    const store = createStore(tx);

    await expect(store.resolveOAuthStateWithoutProviderAuthority({
      state: "state_123",
      consumedAt: "2026-04-13T12:01:00.000Z",
    })).resolves.toBe(true);

    expect(tx.deviceOauthSession.deleteMany).toHaveBeenCalledWith({
      where: {
        consumedAt: new Date("2026-04-13T12:01:00.000Z"),
        state: "state_123",
      },
    });
  });

  it("retains a replacement callback claim when finalization has an old epoch", async () => {
    const tx = createTransaction({ deleteManyCount: 0, record: null });
    const store = createStore(tx);

    await expect(store.resolveOAuthStateWithoutProviderAuthority({
      state: "state_123",
      consumedAt: "2026-04-13T12:01:00.000Z",
    })).resolves.toBe(false);
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
  owner?: { suspendedAt: Date | null } | null;
  replayConsumedAt?: Date;
  updateManyCount?: number;
}) {
  const findUnique = vi.fn().mockResolvedValue(input.record ?? null);
  if (input.replayConsumedAt) {
    findUnique
      .mockResolvedValueOnce(input.record ?? null)
      .mockResolvedValueOnce({ consumedAt: input.replayConsumedAt });
  }
  return {
    $queryRaw: vi.fn().mockResolvedValue(
      input.owner === null
        ? []
        : [{ suspendedAt: input.owner?.suspendedAt ?? null }],
    ),
    deviceOauthSession: {
      deleteMany: vi.fn().mockResolvedValue({ count: input.deleteManyCount ?? 1 }),
      findUnique,
      updateMany: vi.fn().mockResolvedValue({ count: input.updateManyCount ?? 1 }),
    },
  };
}

function createStore(tx: ReturnType<typeof createTransaction>) {
  return new PrismaHostedOAuthSessionStore({
    ...tx,
    $transaction: async <TResult>(
      callback: (transaction: typeof tx) => Promise<TResult>,
    ) => callback(tx),
  } as never);
}
