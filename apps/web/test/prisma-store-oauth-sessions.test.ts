import { describe, expect, it, vi } from "vitest";

import { PrismaHostedOAuthSessionStore } from "@/src/lib/device-sync/prisma-store/oauth-sessions";

interface MockDeviceOauthSessionRow {
  state: string;
  userId: string | null;
  provider: string;
  returnTo: string | null;
  metadataJson: Record<string, unknown> | null;
  createdAt: Date;
  expiresAt: Date;
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

describe("PrismaHostedOAuthSessionStore.consumeOAuthState", () => {
  it("fails closed when another callback already consumed the same state", async () => {
    const record = buildOAuthSessionRow();
    const tx = createTransaction({
      deleteManyCount: 0,
      record,
    });
    const store = createStore(tx);

    await expect(
      store.consumeOAuthState(record.state, record.createdAt.toISOString(), record.provider),
    ).resolves.toEqual({
      status: "missing",
    });
    expect(tx.deviceOauthSession.deleteMany).toHaveBeenCalledWith({
      where: {
        state: record.state,
        provider: record.provider,
      },
    });
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
    expect(tx.deviceOauthSession.deleteMany).not.toHaveBeenCalled();
  });

  it("returns the stored state after a successful single consumer delete", async () => {
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
    expect(tx.deviceOauthSession.deleteMany).toHaveBeenCalledWith({
      where: {
        state: record.state,
        provider: record.provider,
      },
    });
  });
});

function buildOAuthSessionRow(
  overrides: Partial<MockDeviceOauthSessionRow> = {},
): MockDeviceOauthSessionRow {
  return {
    state: overrides.state ?? "state_123",
    userId: overrides.userId ?? "user_123",
    provider: overrides.provider ?? "whoop",
    returnTo: overrides.returnTo ?? "https://murph.test/settings",
    metadataJson: overrides.metadataJson ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-04-13T12:00:00.000Z"),
    expiresAt: overrides.expiresAt ?? new Date("2026-04-13T12:15:00.000Z"),
  };
}

function createTransaction(input: {
  record?: MockDeviceOauthSessionRow | null;
  deleteManyCount?: number;
}) {
  return {
    deviceOauthSession: {
      deleteMany: vi.fn().mockResolvedValue({ count: input.deleteManyCount ?? 1 }),
      findUnique: vi.fn().mockResolvedValue(input.record ?? null),
    },
  };
}

function createStore(tx: ReturnType<typeof createTransaction>) {
  return {
    prisma: {
      $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
    },
    consumeOAuthState: PrismaHostedOAuthSessionStore.prototype.consumeOAuthState,
  };
}
