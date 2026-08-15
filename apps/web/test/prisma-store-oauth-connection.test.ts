import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE } from "@murphai/device-syncd/public-account";

const {
  lockHostedMemberRowMock,
  openHostedUserSecureBoxStringMock,
  randomBytesMock,
  readHostedHealthDataConsentStateMock,
  readHostedMemberSuspensionAfterLockTxMock,
  supersedeDirtyStateMock,
} = vi.hoisted(() => ({
  lockHostedMemberRowMock: vi.fn(async () => undefined),
  openHostedUserSecureBoxStringMock: vi.fn(
    async (input: { prisma?: unknown; value?: unknown }) => {
      void input;
      return "acct_456";
    },
  ),
  randomBytesMock: vi.fn((length: number) => Buffer.from(Array.from({ length }, (_, index) => index))),
  readHostedHealthDataConsentStateMock: vi.fn(
    async (): Promise<"granted" | "missing" | "revoked"> => "missing",
  ),
  readHostedMemberSuspensionAfterLockTxMock: vi.fn(
    async (): Promise<"active" | "missing" | "suspended"> => "active",
  ),
  supersedeDirtyStateMock: vi.fn(async () => undefined),
}));

vi.mock("@/src/lib/hosted-onboarding/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/shared")>()),
  lockHostedMemberRow: lockHostedMemberRowMock,
  readHostedMemberSuspensionAfterLockTx:
    readHostedMemberSuspensionAfterLockTxMock,
}));

vi.mock("@/src/lib/legal/consent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/legal/consent")>()),
  readHostedHealthDataConsentState: readHostedHealthDataConsentStateMock,
}));

// Only the secure-box open seam is mocked so the Prisma client the store hands
// to the decrypt path stays observable. Tests that pass a test codec never
// reach this seam.
vi.mock("@/src/lib/hosted-crypto/secure-box", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-crypto/secure-box")>()),
  openHostedUserSecureBoxString: openHostedUserSecureBoxStringMock,
}));

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    randomBytes: randomBytesMock,
  };
});

vi.mock("@/src/lib/device-sync/prisma-store/dirty-connections", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/device-sync/prisma-store/dirty-connections")
  >("@/src/lib/device-sync/prisma-store/dirty-connections");
  return {
    ...actual,
    supersedeHostedCredentialScopedDirtyStateForConnectionTx:
      supersedeDirtyStateMock,
  };
});

import { buildHostedProviderAccountBlindIndex } from "@/src/lib/device-sync/routing-index";
import {
  hostedConnectionRecordArgs,
  hostedRuntimeRedactedConnectionRecordArgs,
  PrismaDeviceSyncControlPlaneStore,
  type HostedConnectionRecord,
} from "@/src/lib/device-sync/prisma-store";

type MutableOAuthSession = {
  state: string;
  userId: string | null;
  provider: string;
  returnTo: string | null;
  metadataJson: Record<string, unknown> | null;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};

type MutableConnectionRecord = {
  accessTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
  id: string;
  userId: string;
  provider: string;
  providerAccountBlindIndex: string;
  credentialKind: "oauth_tokens" | "provider_config" | "none";
  credentialMetadataJson: Record<string, unknown> | null;
  providerConfigKey: string | null;
  providerApplicationId: string | null;
  providerApplicationRevision: number | null;
  displayName: string | null;
  externalAccountIdEncrypted: string | null;
  keyVersion: string | null;
  metadataJson: Record<string, unknown> | null;
  refreshLeaseExpiresAt: Date | null;
  refreshLeaseOwner: string | null;
  refreshLeaseTokenVersion: number | null;
  refreshTokenEncrypted: string | null;
  scopesJson: string[] | null;
  setupExpiresAt: Date | null;
  setupPhase: "pending_link" | "link_returned" | "source_confirmed" | "failed" | null;
  status: "active" | "disconnected" | "reauthorization_required";
  tokenVersion: number | null;
  connectedAt: Date;
  lastWebhookAt: Date | null;
  lastSyncStartedAt: Date | null;
  lastSyncCompletedAt: Date | null;
  lastSyncErrorAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextReconcileAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const BLIND_INDEX_KEY = Buffer.alloc(32, 7);
const TEST_CODEC = {
  decrypt: (value: string) => value.replace(/^enc:/u, ""),
  encrypt: (value: string) => `enc:${value}`,
  keyVersion: "v1",
};

describe("PrismaDeviceSyncControlPlaneStore oauth state ingress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readHostedHealthDataConsentStateMock.mockResolvedValue("missing");
    readHostedMemberSuspensionAfterLockTxMock.mockResolvedValue("active");
    supersedeDirtyStateMock.mockResolvedValue(undefined);
  });

  // Consume semantics (replay, expiry, mismatches) are owned by
  // prisma-store-oauth-sessions.test.ts; this only proves delegation.
  it("delegates oauth state consumption to the session store", async () => {
    const session: MutableOAuthSession = {
      state: "state-123",
      userId: "user-123",
      provider: "oura",
      returnTo: "https://example.test/return",
      metadataJson: {
        __murphConnectSourceId: "oura",
        __murphConnectTarget: "oura",
      },
      createdAt: new Date("2026-03-25T00:00:00.000Z"),
      expiresAt: new Date("2026-03-25T01:00:00.000Z"),
      consumedAt: null,
    };
    const queryRaw = vi.fn(async () => [{ state: session.state }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        $transaction: async <TResult>(
          callback: (transaction: {
            $queryRaw: typeof queryRaw;
            deviceOauthSession: {
              findUnique: ({ where }: { where: { state: string } }) => Promise<MutableOAuthSession | null>;
              updateMany: typeof updateMany;
            };
          }) => Promise<TResult>,
        ) =>
          callback({
            $queryRaw: queryRaw,
            deviceOauthSession: {
              findUnique: async ({ where }) => (where.state === session.state ? cloneOAuthSession(session) : null),
              updateMany,
            },
          }),
      } as never,
    });

    await expect(store.consumeOAuthState("state-123", "2026-03-25T00:30:00.000Z")).resolves.toMatchObject({
      status: "consumed",
      record: {
        state: "state-123",
        provider: "oura",
        ownerId: "user-123",
      },
    });
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        consumedAt: new Date("2026-03-25T00:30:00.000Z"),
      },
      where: {
        state: "state-123",
        consumedAt: null,
      },
    });
  });
});

describe("PrismaDeviceSyncControlPlaneStore hosted connection access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readHostedHealthDataConsentStateMock.mockResolvedValue("missing");
    supersedeDirtyStateMock.mockResolvedValue(undefined);
  });

  it("denies health-data admission after locking and re-reading consent", async () => {
    const executeRaw = vi.fn();
    const tx = { $executeRaw: executeRaw };
    const callback = vi.fn();
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        $transaction: async <TResult>(
          transactionCallback: (transaction: typeof tx) => Promise<TResult>,
        ) => transactionCallback(tx),
      } as never,
    });
    readHostedHealthDataConsentStateMock.mockResolvedValueOnce("revoked");

    await expect(store.withHealthDataAdmissionLock(
      "user-123",
      "dsc_123",
      callback,
    )).rejects.toMatchObject({
      code: "HEALTH_DATA_CONSENT_REQUIRED",
      httpStatus: 403,
    });

    // Callers that pass no options keep the unbounded member-row wait; only
    // webhook acceptance opts into a lock bound.
    expect(lockHostedMemberRowMock).toHaveBeenCalledWith(tx, "user-123", {});
    expect(readHostedHealthDataConsentStateMock).toHaveBeenCalledWith({
      memberId: "user-123",
      prisma: tx,
    });
    expect(executeRaw).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it("bounds the member-row lock wait only for callers that request it", async () => {
    const executeRaw = vi.fn(async () => 0);
    const tx = { $executeRaw: executeRaw };
    const callback = vi.fn(async () => "admitted");
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        $transaction: async <TResult>(
          transactionCallback: (transaction: typeof tx) => Promise<TResult>,
        ) => transactionCallback(tx),
      } as never,
    });

    await expect(store.withHealthDataAdmissionLock(
      "user-123",
      "dsc_123",
      callback,
      { memberRowLockTimeoutMs: 5_000 },
    )).resolves.toBe("admitted");

    // A queued webhook burst must fail fast with a retryable error instead of
    // burning the transaction budget waiting on the member row. The
    // transaction-local lock_timeout also bounds the advisory-lock step.
    expect(lockHostedMemberRowMock).toHaveBeenCalledWith(tx, "user-123", {
      timeoutMs: 5_000,
    });
    expect(executeRaw).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(tx);
    expect(lockHostedMemberRowMock.mock.invocationCallOrder[0]!)
      .toBeLessThan(executeRaw.mock.invocationCallOrder[0]!);
  });

  it.each([
    ["missing", "CONNECTION_OWNER_REQUIRED", 404],
    ["suspended", "CONNECTION_OWNER_SUSPENDED", 409],
  ] as const)(
    "rejects active-member admission for a %s owner before taking the connection lock",
    async (ownerStatus, code, httpStatus) => {
      const executeRaw = vi.fn();
      const tx = { $executeRaw: executeRaw };
      const callback = vi.fn();
      const store = new PrismaDeviceSyncControlPlaneStore({
        prisma: {
          $transaction: async <TResult>(
            transactionCallback: (transaction: typeof tx) => Promise<TResult>,
          ) => transactionCallback(tx),
        } as never,
      });
      readHostedMemberSuspensionAfterLockTxMock.mockResolvedValueOnce(
        ownerStatus,
      );

      await expect(store.withHealthDataAdmissionLock(
        "user-123",
        "dsc_123",
        callback,
        { requireActiveMember: true },
      )).rejects.toMatchObject({ code, httpStatus });

      expect(lockHostedMemberRowMock).toHaveBeenCalledWith(
        tx,
        "user-123",
        {},
      );
      expect(readHostedMemberSuspensionAfterLockTxMock).toHaveBeenCalledWith(
        tx,
        "user-123",
      );
      expect(readHostedHealthDataConsentStateMock).not.toHaveBeenCalled();
      expect(executeRaw).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    },
  );

  it("propagates bounded lock-wait faults without taking the advisory lock", async () => {
    const executeRaw = vi.fn(async () => 0);
    const tx = { $executeRaw: executeRaw };
    const callback = vi.fn();
    const lockTimeout = Object.assign(new Error("Raw query failed. Code: `55P03`."), {
      code: "P2010",
    });
    lockHostedMemberRowMock.mockRejectedValueOnce(lockTimeout);
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        $transaction: async <TResult>(
          transactionCallback: (transaction: typeof tx) => Promise<TResult>,
        ) => transactionCallback(tx),
      } as never,
    });

    // The fault must reach the route unwrapped so the shared device-sync JSON
    // helper can map it to a retryable 503 and the provider redelivers.
    await expect(store.withHealthDataAdmissionLock(
      "user-123",
      "dsc_123",
      callback,
      { memberRowLockTimeoutMs: 5_000 },
    )).rejects.toBe(lockTimeout);

    expect(executeRaw).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it("creates new hosted connections without creating a Prisma secret row", async () => {
    const createdArtifacts: {
      connection: MutableConnectionRecord | null;
      secretCreateCalled: boolean;
    } = {
      connection: null,
      secretCreateCalled: false,
    };

    const tx = {
      deviceConnection: {
        findUnique: async ({ where }: { where: { id?: string } | { provider_providerAccountBlindIndex?: { provider: string; providerAccountBlindIndex: string } } }) => {
          if ("id" in where && where.id && createdArtifacts.connection?.id === where.id) {
            return cloneConnection(createdArtifacts.connection);
          }

          return null;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdArtifacts.connection = normalizeCreatedConnection(data);
          return cloneConnection(createdArtifacts.connection);
        },
        findFirst: async () => null,
      },
      deviceConnectionSecret: {
        create: async () => {
          createdArtifacts.secretCreateCalled = true;
          return {};
        },
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
        deviceConnection: createRootConnectionPreflight(() => createdArtifacts.connection),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    const created = await store.upsertConnection({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "oura",
      externalAccountId: "acct_456",
      displayName: "Oura ring",
      scopes: ["daily"],
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: "2026-03-25T04:00:00.000Z",
      },
      metadata: {
        allowed: true,
        ignored: {
          nested: "value",
        },
        longText: "x".repeat(300),
        region: "us",
      },
      connectedAt: "2026-03-25T00:00:00.000Z",
      nextReconcileAt: "2026-03-25T05:00:00.000Z",
    });

    expect(lockHostedMemberRowMock).toHaveBeenCalledWith(tx, "user-123");
    expect(readHostedHealthDataConsentStateMock).toHaveBeenCalledWith({
      memberId: "user-123",
      prisma: tx,
    });
    expect(lockHostedMemberRowMock.mock.invocationCallOrder[0]).toBeLessThan(
      readHostedHealthDataConsentStateMock.mock.invocationCallOrder[0] ?? 0,
    );

    expect(created.id).toMatch(/^dsc_[A-Za-z0-9_-]+$/u);
    expect(createdArtifacts.connection).toMatchObject({
      id: created.id,
      userId: "user-123",
      provider: "oura",
      providerAccountBlindIndex: buildHostedProviderAccountBlindIndex({
        key: BLIND_INDEX_KEY,
        provider: "oura",
        externalAccountId: "acct_456",
      }),
      status: "active",
      nextReconcileAt: new Date("2026-03-25T05:00:00.000Z"),
    });
    expect(createdArtifacts.secretCreateCalled).toBe(false);
    expect(created.metadata).toEqual({});
  });

  it("commits the exact provider application binding with a new OAuth connection", async () => {
    let created: MutableConnectionRecord | null = null;
    const tx = {
      deviceConnection: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created = normalizeCreatedConnection(data);
          return cloneConnection(created);
        }),
      },
      deviceProviderApplication: {
        findFirst: vi.fn(async () => ({
          id: "dpa_123",
          memberId: "user-123",
          provider: "strava",
          revision: 4,
        })),
      },
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(
          callback: (transaction: typeof tx) => Promise<TResult>,
        ) => callback(tx),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await store.upsertConnectionWithProviderApplication({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "strava",
      externalAccountId: "athlete-123",
      displayName: "Strava",
      scopes: ["activity:read_all"],
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: "2026-03-25T04:00:00.000Z",
      },
      metadata: {},
      connectedAt: "2026-03-25T00:00:00.000Z",
      nextReconcileAt: "2026-03-25T05:00:00.000Z",
    }, {
      applicationId: "dpa_123",
      provider: "strava",
      revision: 4,
    });

    expect(tx.deviceProviderApplication.findFirst).toHaveBeenCalledWith({
      select: {
        id: true,
        memberId: true,
        provider: true,
        revision: true,
      },
      where: {
        id: "dpa_123",
        memberId: "user-123",
        provider: "strava",
        revision: 4,
      },
    });
    expect(created).toMatchObject({
      provider: "strava",
      providerApplicationId: "dpa_123",
      providerApplicationRevision: 4,
      userId: "user-123",
    });
  });

  it("rejects a second active connection for the same member-owned provider", async () => {
    const tx = {
      deviceConnection: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => ({ id: "dsc_existing" })),
        create: vi.fn(),
      },
      deviceProviderApplication: {
        findFirst: vi.fn(async () => ({
          id: "dpa_123",
          memberId: "user-123",
          provider: "strava",
          revision: 4,
        })),
      },
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(
          callback: (transaction: typeof tx) => Promise<TResult>,
        ) => callback(tx),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.upsertConnectionWithProviderApplication({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "strava",
      externalAccountId: "athlete-new",
      displayName: "Strava",
      scopes: ["activity:read_all"],
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: null,
      },
      metadata: {},
      connectedAt: "2026-03-25T00:00:00.000Z",
      nextReconcileAt: null,
    }, {
      applicationId: "dpa_123",
      provider: "strava",
      revision: 4,
    })).rejects.toMatchObject({
      code: "PROVIDER_APPLICATION_CONNECTION_CONFLICT",
    });
    expect(tx.deviceConnection.create).not.toHaveBeenCalled();
  });

  it("rechecks the exact application binding after a uniqueness race", async () => {
    const existing = createConnection({
      id: "dsc_existing",
      provider: "strava",
      providerApplicationId: "dpa_old",
      providerApplicationRevision: 3,
      status: "active",
      userId: "user-123",
    });
    const application = {
      id: "dpa_123",
      memberId: "user-123",
      provider: "strava",
      revision: 4,
    };
    const create = vi.fn(async () => {
      throw Object.assign(new Error("unique connection"), { code: "P2002" });
    });
    const createTx = {
      deviceConnection: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => null),
        create,
      },
      deviceProviderApplication: {
        findFirst: vi.fn(async () => application),
      },
    };
    const retryTx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(existing)),
        findFirst: vi.fn(async () => null),
        update: vi.fn(),
      },
      deviceProviderApplication: {
        findFirst: vi.fn(async () => application),
      },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementationOnce(async (callback: (tx: typeof createTx) => unknown) =>
          callback(createTx))
        .mockImplementationOnce(async (callback: (tx: typeof retryTx) => unknown) =>
          callback(retryTx)),
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(existing)),
      },
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: prisma as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });
    await expect(store.upsertConnectionWithProviderApplication({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "strava",
      externalAccountId: "athlete-123",
      displayName: "Strava",
      scopes: ["activity:read_all"],
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: null,
      },
      metadata: {},
      connectedAt: "2026-03-25T00:00:00.000Z",
      nextReconcileAt: null,
    }, {
      applicationId: "dpa_123",
      provider: "strava",
      revision: 4,
    })).rejects.toMatchObject({
      code: "PROVIDER_APPLICATION_CONNECTION_CONFLICT",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(retryTx.deviceProviderApplication.findFirst).toHaveBeenCalledTimes(1);
    expect(retryTx.deviceConnection.update).not.toHaveBeenCalled();
  });

  it("keeps hosted device connection persistence provider-generic", async () => {
    const createdArtifacts: {
      connection: MutableConnectionRecord | null;
    } = {
      connection: null,
    };

    const tx = {
      deviceConnection: {
        findUnique: async ({ where }: { where: { id?: string } | { provider_providerAccountBlindIndex?: { provider: string; providerAccountBlindIndex: string } } }) => {
          if ("id" in where && where.id && createdArtifacts.connection?.id === where.id) {
            return cloneConnection(createdArtifacts.connection);
          }

          return null;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdArtifacts.connection = normalizeCreatedConnection(data);
          return cloneConnection(createdArtifacts.connection);
        },
        findFirst: async () => null,
      },
      deviceConnectionSecret: {
        create: async () => {
          throw new Error("deviceConnectionSecret rows should stay unused");
        },
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
        deviceConnection: createRootConnectionPreflight(() => createdArtifacts.connection),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    const created = await store.upsertConnection({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "demo",
      externalAccountId: "acct_demo",
      displayName: "Demo provider",
      scopes: ["demo:read"],
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
      },
      metadata: {
        region: "test",
      },
      connectedAt: "2026-03-25T00:00:00.000Z",
      nextReconcileAt: null,
    });

    expect(created.provider).toBe("demo");
    expect(createdArtifacts.connection).toMatchObject({
      id: created.id,
      provider: "demo",
      providerAccountBlindIndex: buildHostedProviderAccountBlindIndex({
        key: BLIND_INDEX_KEY,
        provider: "demo",
        externalAccountId: "acct_demo",
      }),
      status: "active",
    });
  });

  it("creates provider-config hosted connections without fake OAuth token material", async () => {
    const createdArtifacts: {
      connection: MutableConnectionRecord | null;
    } = {
      connection: null,
    };

    const tx = {
      deviceConnection: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdArtifacts.connection = normalizeCreatedConnection(data);
          return cloneConnection(createdArtifacts.connection);
        },
        findFirst: async () => null,
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
        deviceConnection: createRootConnectionPreflight(() => createdArtifacts.connection),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    const created = await store.upsertConnection({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "junction",
      externalAccountId: "junction-user-123",
      displayName: "Junction",
      status: "active",
      setupPhase: "pending_link",
      setupExpiresAt: "2026-03-25T00:30:00.000Z",
      scopes: ["profile"],
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
        subject: {
          accountId: "raw-account",
          client_user_id: "raw-client-user",
          hmacSecret: "do-not-store",
          ownerId: "raw-owner",
          ownerIdHash: "owner-hash",
          profileId: "raw-profile",
          region: "us",
          userId: "raw-user",
          userIdHash: "user-hash",
        },
      },
      metadata: {
        accountId: "raw-account",
        client_user_id: "raw-client-user",
        connectedSources: ["oura"],
        hmacSecret: "do-not-store",
        ownerId: "raw-owner",
        ownerIdHash: "owner-hash",
        profileId: "raw-profile",
        region: "us",
        resourceAvailability: ["profile"],
        userId: "raw-user",
        userIdHash: "user-hash",
      },
      connectedAt: "2026-03-25T00:00:00.000Z",
      nextReconcileAt: null,
    } as Parameters<typeof store.upsertConnection>[0] & {
      setupExpiresAt: string;
      setupPhase: "pending_link";
    });

    expect(created).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^dsc_[A-Za-z0-9_-]+$/u),
      provider: "junction",
      status: "active",
    }));
    expect(createdArtifacts.connection).toMatchObject({
      accessTokenEncrypted: null,
      accessTokenExpiresAt: null,
      credentialKind: "provider_config",
      credentialMetadataJson: {
        "subject.ownerIdHash": "owner-hash",
        "subject.region": "us",
        "subject.userIdHash": "user-hash",
      },
      externalAccountIdEncrypted: "enc:junction-user-123",
      keyVersion: null,
      metadataJson: {
        ownerIdHash: "owner-hash",
        region: "us",
        userIdHash: "user-hash",
      },
      provider: "junction",
      providerAccountBlindIndex: buildHostedProviderAccountBlindIndex({
        key: BLIND_INDEX_KEY,
        provider: "junction",
        externalAccountId: "junction-user-123",
      }),
      providerConfigKey: "junction",
      refreshTokenEncrypted: null,
      setupExpiresAt: new Date("2026-03-25T00:30:00.000Z"),
      setupPhase: "pending_link",
      status: "active",
      tokenVersion: null,
    });
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("connectedSources");
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("resourceAvailability");
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("raw-owner");
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("raw-user");
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("raw-client-user");
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("raw-account");
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("raw-profile");
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("do-not-store");
  });

  it("hydrates provider-config stored connection accounts without token material", async () => {
    const connection = createConnection({
      accessTokenEncrypted: null,
      credentialKind: "provider_config",
      credentialMetadataJson: {
        "subject.region": "us",
      },
      externalAccountIdEncrypted: "enc:junction-user-123",
      keyVersion: null,
      provider: "junction",
      providerConfigKey: "junction",
      refreshTokenEncrypted: null,
      tokenVersion: null,
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
            where.id === connection.id && where.userId === connection.userId ? cloneConnection(connection) : null,
        },
      } as never,
    });

    await expect(store.getStoredConnectionAccountForUser("user-123", "dsc_123")).resolves.toEqual(
      expect.objectContaining({
        credential: {
          kind: "provider_config",
          credentialMetadata: {
            "subject.region": "us",
          },
          providerConfigKey: "junction",
        },
        disconnectGeneration: 0,
        externalAccountId: "junction-user-123",
        id: "dsc_123",
        keyVersion: null,
        provider: "junction",
        tokenVersion: null,
      }),
    );
  });

  it("clears provider-config credentials after successful remote provider revoke", async () => {
    let connection = createConnection({
      credentialKind: "provider_config",
      credentialMetadataJson: {
        "subject.region": "us",
      },
      externalAccountIdEncrypted: "enc:junction-user-123",
      provider: "junction",
      providerAccountBlindIndex: buildHostedProviderAccountBlindIndex({
        key: BLIND_INDEX_KEY,
        provider: "junction",
        externalAccountId: "junction-user-123",
      }),
      providerConfigKey: "junction",
      refreshLeaseExpiresAt: new Date("2026-03-25T04:05:00.000Z"),
      refreshLeaseOwner: "provider-config-revoke",
      refreshLeaseTokenVersion: 1,
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
            where.id === connection.id && where.userId === connection.userId ? cloneConnection(connection) : null,
          updateMany: async ({ data, where }: {
            data: Partial<MutableConnectionRecord>;
            where: Partial<MutableConnectionRecord>;
          }) => {
            if (
              where.id !== connection.id
              || where.userId !== connection.userId
              || where.provider !== connection.provider
              || where.providerConfigKey !== connection.providerConfigKey
              || where.providerAccountBlindIndex !== connection.providerAccountBlindIndex
            ) {
              return { count: 0 };
            }

            connection = {
              ...connection,
              ...data,
            };
            return { count: 1 };
          },
        },
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.clearStoredProviderConfigCredential({
      connectionId: "dsc_123",
      externalAccountId: "junction-user-123",
      provider: "junction",
      providerConfigKey: "junction",
      userId: "user-123",
    })).resolves.toBe(true);

    expect(connection).toMatchObject({
      accessTokenEncrypted: null,
      accessTokenExpiresAt: null,
      credentialKind: "none",
      credentialMetadataJson: {},
      externalAccountIdEncrypted: null,
      keyVersion: null,
      providerAccountBlindIndex: buildHostedProviderAccountBlindIndex({
        key: BLIND_INDEX_KEY,
        provider: "junction",
        externalAccountId: "opaque:dsc_123",
      }),
      providerConfigKey: null,
      refreshLeaseExpiresAt: null,
      refreshLeaseOwner: null,
      refreshLeaseTokenVersion: null,
      refreshTokenEncrypted: null,
      tokenVersion: null,
    });
    await expect(store.getStoredConnectionAccountForUser("user-123", "dsc_123")).resolves.toEqual(
      expect.objectContaining({
        credential: {
          kind: "none",
          credentialMetadata: {},
        },
        externalAccountId: "opaque:dsc_123",
      }),
    );
  });

  it("rejects provider-config hosted connection credentials with unexpected provider profile keys", async () => {
    let createCalled = false;
    const tx = {
      deviceConnection: {
        findUnique: async () => null,
        create: async () => {
          createCalled = true;
          throw new Error("create should not be called");
        },
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
        deviceConnection: createRootConnectionPreflight(() => null),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.upsertConnection({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "junction",
      externalAccountId: "junction-user-123",
      displayName: "Junction",
      status: "active",
      scopes: [],
      credential: {
        kind: "provider_config",
        providerConfigKey: "wrong-profile",
      },
      metadata: {},
      connectedAt: "2026-03-25T00:00:00.000Z",
      nextReconcileAt: null,
    })).rejects.toMatchObject({
      code: "PROVIDER_CONFIG_KEY_MISMATCH",
    });
    expect(createCalled).toBe(false);
  });

  it("preserves legacy v2 Junction progress while discarding stale e1 evidence", async () => {
    let stored = createConnection({
      credentialKind: "provider_config",
      externalAccountIdEncrypted: "enc:junction-user-123",
      id: "dsc_123",
      metadataJson: {
        callbackOutcome: "seeded",
        junctionHistoricalBackfillStatus: "coverage_v2_retrying",
        junctionHistoricalBackfillEmptyAttempts: 2,
        junctionHistoricalBackfillLastEmptyAt: "2026-03-25T00:30:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-03-23T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-25T00:00:00.000Z",
        junctionHistoricalBackfillEvidence:
          "e1|2026-03-23T00:00:00.000Z|2026-03-25T00:00:00.000Z|garmin:1",
        seedOnlyState: "discard",
      },
      provider: "junction",
      providerConfigKey: "junction",
      setupPhase: "pending_link",
      status: "active",
      updatedAt: new Date("2026-03-25T00:30:00.000Z"),
      userId: "user-123",
    });

    const lockConnectionMutation = vi.fn(async () => 0);
    const findConnection = vi.fn(async () => cloneConnection(stored));
    const updateConnection = vi.fn(async ({ data }: { data: Partial<MutableConnectionRecord> }) => {
      stored = {
        ...stored,
        ...data,
        updatedAt: new Date("2026-03-26T04:00:00.000Z"),
      };
      return cloneConnection(stored);
    });
    const tx = {
      $executeRaw: lockConnectionMutation,
      deviceConnection: {
        findUnique: findConnection,
        update: updateConnection,
      },
      deviceConnectionSecret: {
        upsert: vi.fn(async () => {
          throw new Error("secret upsert should not run");
        }),
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
        deviceConnection: createRootConnectionPreflight(() => stored),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.upsertConnection({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "junction",
      externalAccountId: "junction-user-123",
      displayName: "Junction",
      scopes: [],
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      metadata: {
        callbackOutcome: "complete",
      },
      existingAccountGuard: {
        expectedAccountId: "dsc_123",
        expectedConnectedAt: "2026-03-25T00:00:00.000Z",
        rejectIfDisconnected: true,
      },
      connectedAt: "2026-03-25T00:00:00.000Z",
      nextReconcileAt: "2026-03-25T05:00:00.000Z",
    })).resolves.toEqual(expect.objectContaining({
      id: "dsc_123",
      metadata: {},
    }));
    expect(lockConnectionMutation).toHaveBeenCalledWith(
      ["select pg_advisory_xact_lock(hashtext(", "))"],
      "dsc_123",
    );
    expect(findConnection).toHaveBeenCalledTimes(2);
    expect(lockConnectionMutation.mock.invocationCallOrder[0]).toBeLessThan(
      updateConnection.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(updateConnection).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadataJson: {
          junctionHistoricalBackfillStatus: "coverage_v2_retrying",
          junctionHistoricalBackfillEmptyAttempts: 2,
          junctionHistoricalBackfillLastEmptyAt: "2026-03-25T00:30:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-03-23T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-03-25T00:00:00.000Z",
          callbackOutcome: "complete",
        },
      }),
    }));
    expect(tx.deviceConnectionSecret.upsert).not.toHaveBeenCalled();
  });

  it("returns the previous hosted account when reusing an established connection", async () => {
    const existing = createConnection({
      credentialKind: "provider_config",
      displayName: "Junction",
      externalAccountIdEncrypted: "enc:junction-user-123",
      id: "dsc_123",
      provider: "junction",
      providerAccountBlindIndex: buildHostedProviderAccountBlindIndex({
        key: BLIND_INDEX_KEY,
        provider: "junction",
        externalAccountId: "junction-user-123",
      }),
      providerConfigKey: "junction",
      setupPhase: "source_confirmed",
      status: "active",
      userId: "user-123",
    });

    const tx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(existing)),
        create: vi.fn(async () => {
          throw new Error("create should not be called");
        }),
        update: vi.fn(async () => {
          throw new Error("update should not be called");
        }),
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
        deviceConnection: createRootConnectionPreflight(() => existing),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    const result = await store.upsertConnectionWithPrevious({
      ownerId: "user-123",
      existingAccountPolicy: "preserve_established",
      provider: "junction",
      externalAccountId: "junction-user-123",
      displayName: "Junction",
      status: "active",
      setupPhase: "source_confirmed",
      scopes: [],
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      metadata: {},
      connectedAt: "2026-03-25T01:00:00.000Z",
      nextReconcileAt: "2026-03-25T02:00:00.000Z",
    });

    expect(result.account).toEqual(expect.objectContaining({
      id: "dsc_123",
      provider: "junction",
      setupPhase: "source_confirmed",
      status: "active",
      updatedAt: "2026-03-25T00:00:00.000Z",
    }));
    expect(result.previousAccount).toEqual(expect.objectContaining({
      id: "dsc_123",
      provider: "junction",
      setupPhase: "source_confirmed",
      status: "active",
    }));
    expect(tx.deviceConnection.create).not.toHaveBeenCalled();
    expect(tx.deviceConnection.update).not.toHaveBeenCalled();
  });

  it("never lets a static OAuth callback bypass an existing private application", async () => {
    const tx = {
      deviceConnection: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => null),
        create: vi.fn(),
      },
      deviceProviderApplication: {
        findFirst: vi.fn(async () => ({ id: "dpa_123" })),
      },
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(
          callback: (transaction: typeof tx) => Promise<TResult>,
        ) => callback(tx),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.upsertConnectionWithPrevious({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "strava",
      externalAccountId: "athlete-123",
      displayName: "Strava",
      scopes: ["activity:read_all"],
      tokens: {
        accessToken: "static-access",
        refreshToken: "static-refresh",
        accessTokenExpiresAt: null,
      },
      metadata: {},
      connectedAt: "2026-03-25T01:00:00.000Z",
      nextReconcileAt: null,
    })).rejects.toMatchObject({
      code: "PROVIDER_APPLICATION_REQUIRED",
      httpStatus: 409,
    });
    expect(tx.deviceConnection.create).not.toHaveBeenCalled();
  });

  it("never lets a static OAuth callback reuse an app-bound active connection", async () => {
    const existing = createConnection({
      id: "dsc_123",
      provider: "strava",
      providerApplicationId: "dpa_123",
      providerApplicationRevision: 4,
      status: "active",
      userId: "user-123",
    });
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(existing)),
        update: vi.fn(),
      },
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(
          callback: (transaction: typeof tx) => Promise<TResult>,
        ) => callback(tx),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.upsertConnectionWithPrevious({
      ownerId: "user-123",
      existingAccountPolicy: "preserve_established",
      provider: "strava",
      externalAccountId: "acct_456",
      displayName: "Strava",
      scopes: ["activity:read_all"],
      tokens: {
        accessToken: "static-access",
        refreshToken: "static-refresh",
        accessTokenExpiresAt: null,
      },
      metadata: {},
      connectedAt: "2026-03-25T01:00:00.000Z",
      nextReconcileAt: null,
    })).rejects.toMatchObject({
      code: "PROVIDER_APPLICATION_REQUIRED",
      httpStatus: 409,
    });
    expect(tx.deviceConnection.update).not.toHaveBeenCalled();
  });

  it("retries legacy classification once behind the consent and dirty-marker transaction", async () => {
    let stored = createConnection({
      accessTokenEncrypted: null,
      id: "dsc_classification_retry",
      keyVersion: null,
      provider: "whoop",
      refreshTokenEncrypted: null,
      status: "disconnected",
      tokenVersion: null,
      userId: "user-123",
    });
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findFirst: vi.fn(async () => cloneConnection(stored)),
        findUnique: vi.fn(async () => cloneConnection(stored)),
        update: vi.fn(async ({ data }: { data: Partial<MutableConnectionRecord> }) => {
          stored = {
            ...stored,
            ...data,
            updatedAt: new Date("2026-03-26T04:00:00.000Z"),
          };
          return cloneConnection(stored);
        }),
      },
    };
    const transaction = vi.fn(async <TResult>(
      callback: (transactionClient: typeof tx) => Promise<TResult>,
    ) => {
      const snapshot = cloneConnection(stored)!;
      try {
        return await callback(tx);
      } catch (error) {
        stored = snapshot;
        throw error;
      }
    });
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: transaction,
        deviceConnection: createRootConnectionPreflight(() => stored),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });
    supersedeDirtyStateMock
      .mockRejectedValueOnce({
        code: "HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_CLASSIFICATION_PENDING",
        retryable: true,
      })
      .mockResolvedValueOnce(undefined);

    await expect(store.upsertConnection({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "whoop",
      externalAccountId: "acct_456",
      displayName: "WHOOP",
      scopes: ["read:recovery"],
      tokens: {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
      },
      metadata: {},
      connectedAt: "2026-03-26T03:00:00.000Z",
      nextReconcileAt: null,
    })).resolves.toEqual(expect.objectContaining({
      id: "dsc_classification_retry",
      status: "active",
    }));

    expect(supersedeDirtyStateMock).toHaveBeenCalledTimes(2);
    expect(supersedeDirtyStateMock).toHaveBeenNthCalledWith(1, {
      connectionId: "dsc_classification_retry",
      tx,
      userId: "user-123",
    });
    expect(lockHostedMemberRowMock.mock.invocationCallOrder[0]).toBeLessThan(
      readHostedHealthDataConsentStateMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(readHostedHealthDataConsentStateMock.mock.invocationCallOrder[0]).toBeLessThan(
      supersedeDirtyStateMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("bounds repeated connection unique-conflict recovery to one retry", async () => {
    const stored = createConnection({
      connectedAt: new Date("2026-03-25T00:00:00.000Z"),
      id: "dsc_unique_retry",
      provider: "whoop",
      status: "disconnected",
      userId: "user-123",
    });
    const uniqueConflict = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    const transaction = vi.fn(async () => {
      throw uniqueConflict;
    });
    const findUnique = vi.fn(async (input: {
      select?: Record<string, boolean>;
      where: { id?: string; provider_providerAccountBlindIndex?: unknown };
    }) => {
      if (input.where.id) {
        return { userId: stored.userId };
      }
      if (input.select?.connectedAt && Object.keys(input.select).length === 5) {
        return {
          connectedAt: stored.connectedAt,
          id: stored.id,
          setupPhase: stored.setupPhase,
          status: stored.status,
          userId: stored.userId,
        };
      }
      return cloneConnection(stored);
    });
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: transaction,
        deviceConnection: { findUnique },
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.upsertConnection({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "whoop",
      externalAccountId: "acct_456",
      displayName: "WHOOP",
      scopes: ["read:recovery"],
      tokens: {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
      },
      metadata: {},
      connectedAt: "2026-03-26T03:00:00.000Z",
      nextReconcileAt: null,
    })).rejects.toBe(uniqueConflict);

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(supersedeDirtyStateMock).not.toHaveBeenCalled();
  });

  it("reactivates a disconnected hosted connection on successful OAuth reconnect", async () => {
    let stored = createConnection({
      accessTokenEncrypted: null,
      id: "dsc_123",
      keyVersion: null,
      lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
      lastErrorMessage: "Reconnect required.",
      lastSyncErrorAt: new Date("2026-03-25T08:00:00.000Z"),
      provider: "whoop",
      refreshLeaseExpiresAt: new Date("2026-03-25T08:05:00.000Z"),
      refreshLeaseOwner: "agent-refresh:old",
      refreshLeaseTokenVersion: 1,
      refreshTokenEncrypted: null,
      status: "disconnected",
      tokenVersion: null,
      userId: "user-123",
    });
    const updateConnection = vi.fn(async ({ data }: { data: Partial<MutableConnectionRecord> }) => {
      stored = {
        ...stored,
        ...data,
        updatedAt: new Date("2026-03-26T04:00:00.000Z"),
      };
      return cloneConnection(stored);
    });

    const tx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findUnique: async () => cloneConnection(stored),
        update: updateConnection,
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
        deviceConnection: createRootConnectionPreflight(() => stored),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.upsertConnection({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "whoop",
      externalAccountId: "acct_456",
      displayName: "WHOOP",
      scopes: ["read:recovery", "read:sleep"],
      tokens: {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        accessTokenExpiresAt: "2026-03-26T04:00:00.000Z",
      },
      metadata: {},
      connectedAt: "2026-03-26T03:00:00.000Z",
      nextReconcileAt: "2026-03-26T09:00:00.000Z",
    })).resolves.toEqual(expect.objectContaining({
      id: "dsc_123",
      provider: "whoop",
      status: "active",
    }));

    expect(updateConnection).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accessTokenEncrypted: "enc:new-access-token",
        keyVersion: "v1",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncErrorAt: null,
        refreshLeaseExpiresAt: null,
        refreshLeaseOwner: null,
        refreshLeaseTokenVersion: null,
        refreshTokenEncrypted: "enc:new-refresh-token",
        status: "active",
        tokenVersion: 1,
      }),
    }));
    expect(supersedeDirtyStateMock).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      tx,
      userId: "user-123",
    });
    expect(stored.status).toBe("active");
    expect(stored.lastErrorCode).toBeNull();
    expect(stored.lastErrorMessage).toBeNull();
    expect(stored.lastSyncErrorAt).toBeNull();
    expect(stored.refreshLeaseOwner).toBeNull();
  });

  it("rejects reconnect writes while the existing account is being disconnected", async () => {
    const existing = createConnection({
      accessTokenEncrypted: "enc:old-access-token",
      id: "dsc_123",
      keyVersion: "v1",
      lastErrorCode: DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      provider: "whoop",
      refreshTokenEncrypted: "enc:old-refresh-token",
      status: "reauthorization_required",
      tokenVersion: 2,
      userId: "user-123",
    });
    const updateConnection = vi.fn(async () => {
      throw new Error("disconnect intent should block reconnect writes");
    });
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(existing)),
        update: updateConnection,
      },
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
        deviceConnection: createRootConnectionPreflight(() => existing),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.upsertConnection({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "whoop",
      externalAccountId: "acct_456",
      displayName: "WHOOP",
      scopes: ["read:recovery"],
      tokens: {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        accessTokenExpiresAt: "2026-03-26T04:00:00.000Z",
      },
      metadata: {},
      connectedAt: "2026-03-26T03:00:00.000Z",
      nextReconcileAt: "2026-03-26T09:00:00.000Z",
    })).rejects.toMatchObject({
      code: "CONNECTION_DISCONNECT_IN_PROGRESS",
      httpStatus: 409,
      retryable: true,
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(updateConnection).not.toHaveBeenCalled();
  });

  it("lets a failed cleanup owner replace an in-progress disconnect before revocation", async () => {
    let stored = createConnection({
      accessTokenEncrypted: "enc:old-access-token",
      id: "dsc_123",
      keyVersion: "v1",
      lastErrorCode: DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      provider: "whoop",
      refreshTokenEncrypted: "enc:old-refresh-token",
      status: "reauthorization_required",
      tokenVersion: 2,
      userId: "user-123",
    });
    const updateConnection = vi.fn(async ({ data }: { data: Partial<MutableConnectionRecord> }) => {
      stored = {
        ...stored,
        ...data,
        updatedAt: new Date("2026-03-26T03:00:00.000Z"),
      };
      return cloneConnection(stored);
    });
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(stored)),
        update: updateConnection,
      },
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
        deviceConnection: createRootConnectionPreflight(() => stored),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.upsertConnection({
      cleanupOwnership: "oauth_provider_revoke",
      connectedAt: "2026-03-26T03:00:00.000Z",
      credential: {
        kind: "oauth_tokens",
        tokens: {
          accessToken: "new-access-token",
          refreshToken: "new-refresh-token",
        },
      },
      existingAccountPolicy: "replace",
      externalAccountId: "acct_456",
      nextReconcileAt: null,
      ownerId: "user-123",
      provider: "whoop",
      setupPhase: "failed",
      status: "reauthorization_required",
    })).resolves.toMatchObject({
      connectedAt: "2026-03-26T03:00:00.000Z",
      setupPhase: "failed",
      status: "reauthorization_required",
    });
    expect(updateConnection).toHaveBeenCalledTimes(1);
    expect(stored.accessTokenEncrypted).toBe("enc:new-access-token");
    expect(stored.refreshTokenEncrypted).toBe("enc:new-refresh-token");
    expect(stored.lastErrorCode).toBeNull();
    expect(stored.tokenVersion).toBe(3);
  });

  it("rejects OAuth reconnect while a current refresh lease is active", async () => {
    const existing = createConnection({
      accessTokenEncrypted: "enc:old-access-token",
      accessTokenExpiresAt: new Date("2026-03-26T04:00:00.000Z"),
      id: "dsc_123",
      keyVersion: "v1",
      provider: "whoop",
      refreshLeaseExpiresAt: new Date("2026-03-26T03:05:00.000Z"),
      refreshLeaseOwner: "agent-refresh:active",
      refreshLeaseTokenVersion: 2,
      refreshTokenEncrypted: "enc:old-refresh-token",
      status: "active",
      tokenVersion: 2,
      userId: "user-123",
    });
    const updateConnection = vi.fn(async () => {
      throw new Error("active refresh lease should block reconnect writes");
    });

    const tx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(existing)),
        update: updateConnection,
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
        deviceConnection: createRootConnectionPreflight(() => existing),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.upsertConnection({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "whoop",
      externalAccountId: "acct_456",
      displayName: "WHOOP",
      scopes: ["read:recovery", "read:sleep"],
      tokens: {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        accessTokenExpiresAt: "2026-03-26T04:00:00.000Z",
      },
      metadata: {},
      connectedAt: "2026-03-26T03:00:00.000Z",
      nextReconcileAt: "2026-03-26T09:00:00.000Z",
    })).rejects.toMatchObject({
      code: "TOKEN_REFRESH_IN_PROGRESS",
      retryable: true,
    });
    expect(updateConnection).not.toHaveBeenCalled();
  });

  it("rejects guarded hosted callback upserts when the seeded connection was disconnected", async () => {
    const existing = createConnection({
      accessTokenEncrypted: null,
      id: "dsc_123",
      keyVersion: null,
      provider: "whoop",
      refreshTokenEncrypted: null,
      setupPhase: "pending_link",
      status: "disconnected",
      tokenVersion: null,
      userId: "user-123",
    });

    const tx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(existing)),
        update: vi.fn(async () => {
          throw new Error("disconnected seeded callbacks should not update credentials");
        }),
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
        deviceConnection: createRootConnectionPreflight(() => existing),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.upsertConnection({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "whoop",
      externalAccountId: "acct_456",
      displayName: "WHOOP",
      scopes: ["read:recovery", "read:sleep"],
      tokens: {
        accessToken: "<REDACTED_ACCESS_TOKEN>",
        refreshToken: "<REDACTED_REFRESH_TOKEN>",
        accessTokenExpiresAt: "2026-03-26T04:00:00.000Z",
      },
      metadata: {},
      existingAccountGuard: {
        expectedAccountId: "dsc_123",
        expectedConnectedAt: existing.connectedAt.toISOString(),
        rejectIfDisconnected: true,
      },
      connectedAt: "2026-03-26T03:00:00.000Z",
      nextReconcileAt: "2026-03-26T09:00:00.000Z",
    })).rejects.toMatchObject({
      code: "CONNECTION_ALREADY_DISCONNECTED",
      httpStatus: 409,
    });
    expect(tx.deviceConnection.update).not.toHaveBeenCalled();
  });

  it("rejects guarded hosted callback upserts after the seeded connection epoch changes", async () => {
    const existing = createConnection({
      accessTokenEncrypted: null,
      id: "dsc_123",
      keyVersion: null,
      provider: "junction",
      refreshTokenEncrypted: null,
      setupPhase: "source_confirmed",
      status: "active",
      tokenVersion: null,
      connectedAt: new Date("2026-03-26T03:30:00.000Z"),
      updatedAt: new Date("2026-03-26T03:30:00.000Z"),
      userId: "user-123",
    });
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(existing)),
        update: vi.fn(async () => {
          throw new Error("stale seeded callbacks should not update the newer connection");
        }),
      },
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
        deviceConnection: createRootConnectionPreflight(() => existing),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.upsertConnection({
      ownerId: "user-123",
      existingAccountPolicy: "replace",
      provider: "junction",
      externalAccountId: "acct_456",
      displayName: "Garmin",
      scopes: [],
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      metadata: {},
      existingAccountGuard: {
        expectedAccountId: "dsc_123",
        expectedConnectedAt: "2026-03-26T03:00:00.000Z",
        rejectIfDisconnected: true,
      },
      connectedAt: "2026-03-26T04:00:00.000Z",
      nextReconcileAt: null,
    })).rejects.toMatchObject({
      code: "CONNECTION_SEEDED_ACCOUNT_CHANGED",
      httpStatus: 409,
    });
    expect(tx.deviceConnection.update).not.toHaveBeenCalled();
  });

  it("retains hosted OAuth tokens until provider revocation is confirmed", async () => {
    let stored = createConnection({
      accessTokenEncrypted: "enc:access-token",
      accessTokenExpiresAt: new Date("2026-03-26T04:00:00.000Z"),
      keyVersion: "v1",
      nextReconcileAt: new Date("2026-03-26T05:00:00.000Z"),
      refreshTokenEncrypted: "enc:refresh-token",
      status: "active",
      tokenVersion: 3,
      updatedAt: new Date("2026-03-25T00:30:00.000Z"),
    });

    const lockConnectionMutation = vi.fn(async () => 0);
    const tx = {
      $executeRaw: lockConnectionMutation,
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(stored)),
        update: vi.fn(async ({ data }: { data: Partial<MutableConnectionRecord> }) => {
          stored = {
            ...stored,
            ...data,
            updatedAt: new Date("2026-03-26T06:00:00.000Z"),
          };
          return cloneConnection(stored);
        }),
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
        deviceConnection: {
          findFirst: vi.fn(async () => cloneConnection(stored)),
        },
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    const result = await store.markConnectionSetupFailed({
      accountId: "dsc_123",
      expectedConnectedAt: "2026-03-25T00:00:00.000Z",
      now: "2026-03-26T06:00:00.000Z",
      code: "OAUTH_SETUP_FAILED",
      message: "post-connect setup failed",
    });

    expect(tx.deviceConnection.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastErrorCode: "OAUTH_SETUP_FAILED",
        lastErrorMessage: "post-connect setup failed",
        nextReconcileAt: null,
        setupExpiresAt: null,
        setupPhase: "failed",
        status: "reauthorization_required",
      }),
    }));
    expect(tx.deviceConnection.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accessTokenEncrypted: null,
      }),
    }));
    expect(lockConnectionMutation).toHaveBeenCalledWith(
      ["select pg_advisory_xact_lock(hashtext(", "))"],
      "dsc_123",
    );
    expect(lockConnectionMutation.mock.invocationCallOrder[0]).toBeLessThan(
      tx.deviceConnection.findUnique.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(result).toEqual({
      applied: true,
      blockedByRefreshLease: false,
      oauthTokenVersion: 3,
      account: expect.objectContaining({
        accessTokenExpiresAt: "2026-03-26T04:00:00.000Z",
        lastErrorCode: "OAUTH_SETUP_FAILED",
        lastErrorMessage: "post-connect setup failed",
        nextReconcileAt: null,
        status: "reauthorization_required",
      }),
    });
    expect(stored.accessTokenEncrypted).toBe("enc:access-token");
    expect(stored.refreshTokenEncrypted).toBe("enc:refresh-token");
    expect(stored.refreshLeaseOwner).toBeNull();
    expect(stored.setupPhase).toBe("failed");

    await expect(store.getOAuthCleanupAccount({
      accountId: "dsc_123",
      expectedConnectedAt: "2026-03-25T00:00:00.000Z",
      expectedTokenVersion: 3,
    })).resolves.toMatchObject({
      credential: {
        kind: "oauth_tokens",
        tokens: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
        },
      },
      id: "dsc_123",
    });

    await expect(store.clearOAuthCredentialAfterConfirmedRevoke({
      accountId: "dsc_123",
      expectedConnectedAt: "2026-03-25T00:00:00.000Z",
      expectedTokenVersion: 3,
      now: "2026-03-26T06:01:00.000Z",
    })).resolves.toBe(true);
    expect(tx.deviceConnection.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        credentialKind: "none",
        keyVersion: null,
        providerConfigKey: null,
        refreshLeaseExpiresAt: null,
        refreshLeaseOwner: null,
        refreshLeaseTokenVersion: null,
        refreshTokenEncrypted: null,
        tokenVersion: null,
      }),
    }));
    expect(stored.accessTokenEncrypted).toBeNull();
    expect(stored.refreshTokenEncrypted).toBeNull();
    expect(stored.credentialKind).toBe("none");
  });

  it("leaves an in-flight token refresh lease and its OAuth credential unchanged", async () => {
    const stored = createConnection({
      accessTokenEncrypted: "enc:access-token",
      accessTokenExpiresAt: new Date("2026-03-26T04:00:00.000Z"),
      keyVersion: "v1",
      refreshLeaseExpiresAt: new Date("2026-03-26T06:05:00.000Z"),
      refreshLeaseOwner: "agent-refresh:setup",
      refreshLeaseTokenVersion: 3,
      refreshTokenEncrypted: "enc:refresh-token",
      status: "active",
      tokenVersion: 3,
    });
    const update = vi.fn();
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(stored)),
        update,
      },
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.markConnectionSetupFailed({
      accountId: stored.id,
      code: "OAUTH_SETUP_FAILED",
      expectedConnectedAt: stored.connectedAt.toISOString(),
      message: "post-connect setup failed",
      now: "2026-03-26T06:00:00.000Z",
    })).resolves.toEqual({
      account: expect.objectContaining({
        status: "active",
      }),
      applied: false,
      blockedByRefreshLease: true,
      oauthTokenVersion: 3,
    });
    expect(update).not.toHaveBeenCalled();
    await expect(store.clearOAuthCredentialAfterConfirmedRevoke({
      accountId: stored.id,
      expectedConnectedAt: stored.connectedAt.toISOString(),
      expectedTokenVersion: 3,
      now: "2026-03-26T06:01:00.000Z",
    })).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("drops unsafe post-connect setup failure messages before durable writes", async () => {
    let stored = createConnection({
      accessTokenEncrypted: "enc:access-token",
      accessTokenExpiresAt: new Date("2026-03-26T04:00:00.000Z"),
      keyVersion: "v1",
      refreshTokenEncrypted: "enc:refresh-token",
      status: "active",
      tokenVersion: 3,
    });

    const tx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(stored)),
        update: vi.fn(async ({ data }: { data: Partial<MutableConnectionRecord> }) => {
          stored = {
            ...stored,
            ...data,
            updatedAt: new Date("2026-03-26T06:00:00.000Z"),
          };
          return cloneConnection(stored);
        }),
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    const result = await store.markConnectionSetupFailed({
      accountId: "dsc_123",
      expectedConnectedAt: "2026-03-25T00:00:00.000Z",
      now: "2026-03-26T06:00:00.000Z",
      code: "OAUTH_SETUP_FAILED",
      message:
        "post-connect setup failed for api.example.test/path owner@example.test authorization=Bearer secret-token",
    });

    expect(tx.deviceConnection.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastErrorMessage: null,
      }),
    }));
    expect(result.account?.lastErrorMessage).toBeNull();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("api.example.test");
    expect(serialized).not.toContain("owner@example.test");
    expect(serialized).not.toContain("secret-token");
  });

  it("leaves a newer connection epoch unchanged when setup cleanup is stale", async () => {
    const stored = createConnection({
      accessTokenEncrypted: "enc:new-access-token",
      accessTokenExpiresAt: new Date("2026-03-26T08:00:00.000Z"),
      keyVersion: "v1",
      refreshTokenEncrypted: "enc:new-refresh-token",
      status: "active",
      tokenVersion: 4,
      updatedAt: new Date("2026-03-26T07:00:00.000Z"),
    });
    const update = vi.fn();
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(stored)),
        update,
      },
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    const result = await store.markConnectionSetupFailed({
      accountId: stored.id,
      expectedConnectedAt: "2026-03-26T06:00:00.000Z",
      now: "2026-03-26T07:05:00.000Z",
      code: "OAUTH_SETUP_FAILED",
      message: "stale setup failure",
    });

    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({
      applied: false,
      blockedByRefreshLease: false,
      oauthTokenVersion: 4,
      account: expect.objectContaining({
        accessTokenExpiresAt: "2026-03-26T08:00:00.000Z",
        lastErrorCode: null,
        status: "active",
      }),
    });
    await expect(store.clearOAuthCredentialAfterConfirmedRevoke({
      accountId: stored.id,
      expectedConnectedAt: "2026-03-26T06:00:00.000Z",
      expectedTokenVersion: 3,
      now: "2026-03-26T07:06:00.000Z",
    })).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(stored.accessTokenEncrypted).toBe("enc:new-access-token");
  });

  it("leaves a disconnected connection unchanged when setup cleanup has the same timestamp", async () => {
    const stored = createConnection({
      accessTokenEncrypted: null,
      keyVersion: null,
      refreshTokenEncrypted: null,
      status: "disconnected",
      tokenVersion: null,
      updatedAt: new Date("2026-03-26T07:00:00.000Z"),
    });
    const update = vi.fn();
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(stored)),
        update,
      },
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    const result = await store.markConnectionSetupFailed({
      accountId: stored.id,
      expectedConnectedAt: stored.connectedAt.toISOString(),
      now: "2026-03-26T07:05:00.000Z",
      code: "OAUTH_SETUP_FAILED",
      message: "late setup failure",
    });

    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({
      applied: false,
      blockedByRefreshLease: false,
      oauthTokenVersion: null,
      account: expect.objectContaining({
        lastErrorCode: null,
        status: "disconnected",
      }),
    });
  });

  it("serves ordinary hosted connection lists from durable Prisma metadata without live runtime reads", async () => {
    const connection = createConnection({
      id: "dsc_123",
      lastWebhookAt: new Date("2026-03-25T06:00:00.000Z"),
      nextReconcileAt: new Date("2026-03-25T07:00:00.000Z"),
      provider: "oura",
      status: "active",
      updatedAt: new Date("2026-03-25T00:00:00.000Z"),
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findMany: async () => [cloneConnection(connection)],
        },
      } as never,
    });

    await expect(store.listConnectionsForUser("user-123")).resolves.toEqual([
      expect.objectContaining({
        id: "dsc_123",
        provider: "oura",
        status: "active",
        scopes: [],
        nextReconcileAt: "2026-03-25T07:00:00.000Z",
        lastWebhookAt: "2026-03-25T06:00:00.000Z",
        updatedAt: "2026-03-25T00:00:00.000Z",
      }),
    ]);
  });

  it("selects consent cleanup candidates by raw credential authority", async () => {
    const disconnectedNone = createConnection({
      credentialKind: "none",
      id: "dsc_none",
      status: "disconnected",
    });
    const disconnectedProviderConfig = createConnection({
      credentialKind: "provider_config",
      id: "dsc_provider_config",
      provider: "junction",
      providerConfigKey: "junction",
      status: "disconnected",
    });
    const activeNone = createConnection({
      credentialKind: "none",
      id: "dsc_active_none",
      status: "active",
    });
    const findMany = vi.fn(async () => [
      cloneConnection(disconnectedNone),
      cloneConnection(disconnectedProviderConfig),
      cloneConnection(activeNone),
    ]);
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: { findMany },
      } as never,
    });

    await expect(
      store.listConnectionsRequiringCleanupForUser("user-123"),
    ).resolves.toEqual([
      expect.objectContaining({ id: "dsc_provider_config", status: "disconnected" }),
      expect.objectContaining({ id: "dsc_active_none", status: "active" }),
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("uses an id-and-status-only member projection for companion status", async () => {
    const findMany = vi.fn(async () => [{
      id: "dsc_123",
      status: "active",
    }]);
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        deviceConnection: { findMany },
      } as never,
    });

    await expect(store.listMemberConnectionStatuses({
      limit: 32,
      provider: "junction",
      status: "not_disconnected",
      userId: "user-123",
    })).resolves.toEqual([{
      id: "dsc_123",
      status: "active",
    }]);
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 33,
      select: {
        id: true,
        status: true,
      },
      where: {
        provider: "junction",
        status: { not: "disconnected" },
        userId: "user-123",
      },
    });
    expect(openHostedUserSecureBoxStringMock).not.toHaveBeenCalled();
  });

  it("fails closed when companion status connection authority exceeds its bound", async () => {
    const findMany = vi.fn(async () =>
      Array.from({ length: 33 }, (_, index) => ({
        id: `dsc_${String(index).padStart(2, "0")}`,
        status: "active",
      }))
    );
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        deviceConnection: { findMany },
      } as never,
    });

    await expect(store.listMemberConnectionStatuses({
      limit: 32,
      provider: "junction",
      status: "not_disconnected",
      userId: "user-123",
    })).rejects.toMatchObject({
      code: "MEMBER_CONNECTION_STATUS_SNAPSHOT_SATURATED",
      httpStatus: 503,
      retryable: false,
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 33 }));
    expect(openHostedUserSecureBoxStringMock).not.toHaveBeenCalled();
  });

  it("keeps redacted runtime SQL projections free of every device ciphertext", () => {
    expect(hostedConnectionRecordArgs.select).toMatchObject({
      accessTokenEncrypted: true,
      externalAccountIdEncrypted: true,
      refreshTokenEncrypted: true,
    });
    expect(hostedRuntimeRedactedConnectionRecordArgs.select).not.toHaveProperty(
      "accessTokenEncrypted",
    );
    expect(hostedRuntimeRedactedConnectionRecordArgs.select).not.toHaveProperty(
      "externalAccountIdEncrypted",
    );
    expect(hostedRuntimeRedactedConnectionRecordArgs.select).not.toHaveProperty(
      "refreshTokenEncrypted",
    );
  });

  it("keeps webhook-ingress external-account lookups on the durable Prisma owner", async () => {
    const connection = createConnection({
      id: "dsc_123",
      provider: "oura",
      status: "active",
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findUnique: async ({ where }: { where: { provider_providerAccountBlindIndex: { provider: string; providerAccountBlindIndex: string } } }) =>
            where.provider_providerAccountBlindIndex.provider === "oura"
              && where.provider_providerAccountBlindIndex.providerAccountBlindIndex === buildHostedProviderAccountBlindIndex({
                key: BLIND_INDEX_KEY,
                provider: "oura",
                externalAccountId: "acct_456",
              })
              ? cloneConnection(connection)
              : null,
        },
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.getConnectionByExternalAccount("oura", "acct_456")).resolves.toEqual(expect.objectContaining({
      id: "dsc_123",
      provider: "oura",
      status: "active",
    }));
  });

  it("rehydrates seeded hosted callback accounts by durable connection id", async () => {
    const connection = createConnection({
      id: "dsc_seeded",
      provider: "junction",
      status: "active",
      userId: "user-123",
      externalAccountIdEncrypted: "enc:junction-user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findUnique: async ({ where }: { where: { id: string } }) =>
            where.id === "dsc_seeded" ? cloneConnection(connection) : null,
        },
      } as never,
    });

    await expect(store.getConnectionById("dsc_seeded")).resolves.toEqual(expect.objectContaining({
      externalAccountId: "junction-user-123",
      id: "dsc_seeded",
      provider: "junction",
      status: "active",
    }));
  });

  it("decrypts the external account id through the caller's transaction client", async () => {
    const connection = createConnection({
      externalAccountIdEncrypted: "sealed:acct_456",
      id: "dsc_123",
      provider: "oura",
      status: "active",
      userId: "user-123",
    });
    // An interactive transaction already holds one pooled connection. A read
    // that falls back to the root client checks out a second one and can
    // self-starve the pool under webhook bursts, so touching it fails here.
    const rootClientUse = vi.fn();
    const rootPrisma = {
      deviceConnection: {
        findFirst: async () => {
          rootClientUse();
          throw new Error("root Prisma client must not be used inside a transaction");
        },
      },
    };
    const tx = {
      deviceConnection: {
        findFirst: async () => cloneConnection(connection),
      },
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: rootPrisma as never,
    });

    await expect(
      store.getConnectionForUser("user-123", "dsc_123", tx as never),
    ).resolves.toMatchObject({
      externalAccountId: "acct_456",
      id: "dsc_123",
    });

    expect(openHostedUserSecureBoxStringMock).toHaveBeenCalledTimes(1);
    expect(openHostedUserSecureBoxStringMock.mock.calls[0]?.[0]).toMatchObject({
      value: "sealed:acct_456",
    });
    expect(openHostedUserSecureBoxStringMock.mock.calls[0]?.[0].prisma).toBe(tx);
    expect(rootClientUse).not.toHaveBeenCalled();
  });

  it("keeps the root Prisma client as the default external-account reader", async () => {
    const connection = createConnection({
      externalAccountIdEncrypted: "sealed:acct_456",
      id: "dsc_123",
      provider: "oura",
      status: "active",
      userId: "user-123",
    });
    const rootPrisma = {
      deviceConnection: {
        findFirst: async () => cloneConnection(connection),
      },
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: rootPrisma as never,
    });

    await expect(store.getConnectionForUser("user-123", "dsc_123")).resolves.toMatchObject({
      externalAccountId: "acct_456",
    });

    expect(openHostedUserSecureBoxStringMock).toHaveBeenCalledTimes(1);
    expect(openHostedUserSecureBoxStringMock.mock.calls[0]?.[0].prisma).toBe(rootPrisma);
  });

  it("keeps explicit operational connection reads on durable Prisma metadata", async () => {
    const connection = createConnection({
      id: "dsc_123",
      provider: "oura",
      userId: "user-123",
      lastErrorCode: "REMOTE_REVOKE_FAILED",
      lastErrorMessage: "Provider revoke request failed during disconnect.",
      lastSyncErrorAt: new Date("2026-03-25T08:00:00.000Z"),
      lastWebhookAt: new Date("2026-03-25T07:00:00.000Z"),
      status: "disconnected",
      updatedAt: new Date("2026-03-25T08:00:00.000Z"),
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async () => cloneConnection(connection),
        },
      } as never,
    });

    await expect(store.getConnectionForUser("user-123", "dsc_123")).resolves.toEqual(expect.objectContaining({
      id: "dsc_123",
      status: "disconnected",
      metadata: {},
      lastErrorCode: "REMOTE_REVOKE_FAILED",
      lastErrorMessage: "Provider revoke request failed during disconnect.",
      lastWebhookAt: "2026-03-25T07:00:00.000Z",
      updatedAt: "2026-03-25T08:00:00.000Z",
    }));
  });

  it("returns safe provider failure reasons from durable connection state", async () => {
    const providerReason =
      "WHOOP token request failed. Provider reason: The request is missing a required parameter, includes an invalid parameter value, includes a parameter more than once, or is otherwise malformed";
    const connection = createConnection({
      id: "dsc_123",
      provider: "whoop",
      userId: "user-123",
      lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
      lastErrorMessage: providerReason,
      lastSyncErrorAt: new Date("2026-03-25T08:00:00.000Z"),
      status: "active",
      updatedAt: new Date("2026-03-25T08:00:00.000Z"),
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async () => cloneConnection(connection),
        },
      } as never,
    });

    await expect(store.getConnectionForUser("user-123", "dsc_123")).resolves.toEqual(expect.objectContaining({
      id: "dsc_123",
      lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
      lastErrorMessage: providerReason,
      provider: "whoop",
    }));
  });

  it("drops unsafe durable connection error messages before returning them", async () => {
    const connection = createConnection({
      id: "dsc_123",
      provider: "whoop",
      userId: "user-123",
      lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
      lastErrorMessage:
        "Provider request failed for https://api.example.test/oauth?refresh_token=secret owner@example.test authorization=Bearer secret-token",
      lastSyncErrorAt: new Date("2026-03-25T08:00:00.000Z"),
      status: "active",
      updatedAt: new Date("2026-03-25T08:00:00.000Z"),
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async () => cloneConnection(connection),
        },
      } as never,
    });

    const result = await store.getConnectionForUser("user-123", "dsc_123");

    expect(result?.lastErrorMessage).toBeNull();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("owner@example.test");
    expect(serialized).not.toContain("refresh_token=secret");
  });

  it("persists webhook receipt timestamps with one set-based write", async () => {
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        deviceConnection: {
          updateMany,
        },
      } as never,
    });

    await store.markWebhookReceived("dsc_123", "2026-03-25T06:00:00.000Z");
    await expect(
      store.markWebhookReceived("dsc_missing", "2026-03-25T06:01:00.000Z"),
    ).resolves.toBeUndefined();

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "dsc_123",
        OR: [
          { lastWebhookAt: null },
          { lastWebhookAt: { lt: new Date("2026-03-25T06:00:00.000Z") } },
        ],
      },
      data: {
        lastWebhookAt: new Date("2026-03-25T06:00:00.000Z"),
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: "dsc_missing",
        OR: [
          { lastWebhookAt: null },
          { lastWebhookAt: { lt: new Date("2026-03-25T06:01:00.000Z") } },
        ],
      },
      data: {
        lastWebhookAt: new Date("2026-03-25T06:01:00.000Z"),
      },
    });
  });

  it("materializes a preloaded connection row without another connection query", async () => {
    const findFirst = vi.fn();
    const findUnique = vi.fn();
    const connection = {
      ...createConnection({
        accessTokenEncrypted: "enc:access-token",
        accessTokenExpiresAt: new Date("2026-03-25T06:30:00.000Z"),
        externalAccountIdEncrypted: "enc:acct_456",
        keyVersion: "v1",
        refreshTokenEncrypted: "enc:refresh-token",
        status: "active",
        tokenVersion: 2,
      }),
      credentialMetadataJson: {},
      metadataJson: {},
      scopesJson: [],
    } satisfies HostedConnectionRecord;
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst,
          findUnique,
        },
      } as never,
    });

    const stored = await store.materializeStoredConnectionAccount(connection);
    const durable = await store.materializeDurableConnectionRecord(connection);

    expect(stored).toMatchObject({
      externalAccountId: "acct_456",
      id: "dsc_123",
      tokenVersion: 2,
    });
    expect(durable).toMatchObject({
      externalAccountId: "acct_456",
      id: "dsc_123",
    });
    expect(findFirst).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("persists a prepared runtime token write and clears only an obsolete refresh lease", async () => {
    const record = {
      ...createConnection({
        credentialKind: "provider_config",
        providerConfigKey: "legacy-profile",
        refreshLeaseExpiresAt: new Date("2026-03-25T04:05:00.000Z"),
        refreshLeaseOwner: "agent-refresh:obsolete",
        refreshLeaseTokenVersion: 1,
        tokenVersion: 2,
      }),
      credentialMetadataJson: { profile: "legacy" },
      metadataJson: {},
      scopesJson: [],
    } satisfies HostedConnectionRecord;
    const written = {
      ...createConnection({
        accessTokenEncrypted: "sealed-access-token",
        accessTokenExpiresAt: new Date("2026-03-26T04:00:00.000Z"),
        credentialKind: "oauth_tokens",
        externalAccountIdEncrypted: "sealed-account-id",
        keyVersion: "hosted-device-secure-box:v1",
        providerConfigKey: null,
        refreshLeaseExpiresAt: null,
        refreshLeaseOwner: null,
        refreshLeaseTokenVersion: null,
        refreshTokenEncrypted: "sealed-refresh-token",
        tokenVersion: 3,
      }),
      credentialMetadataJson: {},
      metadataJson: {},
      scopesJson: [],
    } satisfies HostedConnectionRecord;
    const update = vi.fn(async () => written);
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {} as never,
    });

    const result = await store.persistPreparedRuntimeApplyTokenWrite({
      prepared: {
        accessTokenEncrypted: "sealed-access-token",
        accessTokenExpiresAt: "2026-03-26T04:00:00.000Z",
        externalAccountIdEncrypted: "sealed-account-id",
        keyVersion: "hosted-device-secure-box:v1",
        refreshTokenEncrypted: "sealed-refresh-token",
        rootKeyId: "device-root-active",
        tokenVersion: 3,
      },
      record,
      tx: {
        deviceConnection: { update },
      } as never,
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        accessTokenEncrypted: "sealed-access-token",
        accessTokenExpiresAt: new Date("2026-03-26T04:00:00.000Z"),
        credentialKind: "oauth_tokens",
        credentialMetadataJson: {},
        externalAccountIdEncrypted: "sealed-account-id",
        keyVersion: "hosted-device-secure-box:v1",
        providerConfigKey: null,
        refreshLeaseExpiresAt: null,
        refreshLeaseOwner: null,
        refreshLeaseTokenVersion: null,
        refreshTokenEncrypted: "sealed-refresh-token",
        tokenVersion: 3,
      },
      where: { id: record.id },
    }));
    expect(result).toBe(written);
  });

  it("persists a prepared runtime token clear without changing credential ownership", async () => {
    const record = {
      ...createConnection({
        accessTokenEncrypted: "enc:access-token",
        credentialKind: "oauth_tokens",
        externalAccountIdEncrypted: "enc:acct_456",
        keyVersion: "v1",
        refreshTokenEncrypted: "enc:refresh-token",
        tokenVersion: 2,
      }),
      credentialMetadataJson: {},
      metadataJson: {},
      scopesJson: [],
    } satisfies HostedConnectionRecord;
    const written = {
      ...createConnection({
        credentialKind: "oauth_tokens",
        externalAccountIdEncrypted: "sealed-account-id",
      }),
      credentialMetadataJson: {},
      metadataJson: {},
      scopesJson: [],
    } satisfies HostedConnectionRecord;
    const update = vi.fn(async () => written);
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {} as never,
    });

    const result = await store.persistPreparedRuntimeApplyTokenWrite({
      prepared: {
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        externalAccountIdEncrypted: "sealed-account-id",
        keyVersion: null,
        refreshTokenEncrypted: null,
        rootKeyId: "device-root-active",
        tokenVersion: null,
      },
      record,
      tx: {
        deviceConnection: { update },
      } as never,
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        credentialKind: "oauth_tokens",
        externalAccountIdEncrypted: "sealed-account-id",
        keyVersion: null,
        providerConfigKey: null,
        refreshTokenEncrypted: null,
        tokenVersion: null,
      },
      where: { id: record.id },
    }));
    expect(result).toBe(written);
  });

  it("rejects a prepared runtime token write while the current refresh lease is active", async () => {
    const record = {
      ...createConnection({
        refreshLeaseExpiresAt: new Date("2026-03-25T04:05:00.000Z"),
        refreshLeaseOwner: "agent-refresh:active",
        refreshLeaseTokenVersion: 2,
        tokenVersion: 2,
      }),
      credentialMetadataJson: {},
      metadataJson: {},
      scopesJson: [],
    } satisfies HostedConnectionRecord;
    const update = vi.fn();
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {} as never,
    });

    await expect(store.persistPreparedRuntimeApplyTokenWrite({
      prepared: {
        accessTokenEncrypted: "sealed-access-token",
        accessTokenExpiresAt: null,
        externalAccountIdEncrypted: "sealed-account-id",
        keyVersion: "hosted-device-secure-box:v1",
        refreshTokenEncrypted: "sealed-refresh-token",
        rootKeyId: "device-root-active",
        tokenVersion: 3,
      },
      record,
      tx: {
        deviceConnection: { update },
      } as never,
    })).rejects.toMatchObject({
      code: "TOKEN_REFRESH_IN_PROGRESS",
      retryable: true,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("preserves the stored external account binding across token clears, tokenless reads, and retokenization", async () => {
    let connection = createConnection({
      accessTokenEncrypted: "enc:access-token",
      accessTokenExpiresAt: new Date("2026-03-25T04:00:00.000Z"),
      externalAccountIdEncrypted: "enc:acct_456",
      keyVersion: "v1",
      provider: "oura",
      refreshTokenEncrypted: "enc:refresh-token",
      tokenVersion: 2,
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
            where.id === connection.id && where.userId === connection.userId ? cloneConnection(connection) : null,
          findUnique: async ({ where }: { where: { id?: string } | { provider_providerAccountBlindIndex?: { provider: string; providerAccountBlindIndex: string } } }) =>
            "id" in where && where.id === connection.id ? cloneConnection(connection) : null,
          update: async ({ data }: { data: Record<string, unknown> }) => {
            connection = {
              ...connection,
              accessTokenEncrypted: typeof data.accessTokenEncrypted === "string"
                ? data.accessTokenEncrypted
                : data.accessTokenEncrypted === null
                  ? null
                  : connection.accessTokenEncrypted,
              accessTokenExpiresAt: data.accessTokenExpiresAt instanceof Date
                ? data.accessTokenExpiresAt
                : data.accessTokenExpiresAt === null
                  ? null
                  : connection.accessTokenExpiresAt,
              externalAccountIdEncrypted: typeof data.externalAccountIdEncrypted === "string"
                ? data.externalAccountIdEncrypted
                : data.externalAccountIdEncrypted === null
                  ? null
                  : connection.externalAccountIdEncrypted,
              keyVersion: typeof data.keyVersion === "string"
                ? data.keyVersion
                : data.keyVersion === null
                  ? null
                  : connection.keyVersion,
              refreshTokenEncrypted: typeof data.refreshTokenEncrypted === "string"
                ? data.refreshTokenEncrypted
                : data.refreshTokenEncrypted === null
                  ? null
                  : connection.refreshTokenEncrypted,
              refreshLeaseExpiresAt: data.refreshLeaseExpiresAt instanceof Date
                ? data.refreshLeaseExpiresAt
                : data.refreshLeaseExpiresAt === null
                  ? null
                  : connection.refreshLeaseExpiresAt,
              refreshLeaseOwner: typeof data.refreshLeaseOwner === "string"
                ? data.refreshLeaseOwner
                : data.refreshLeaseOwner === null
                  ? null
                  : connection.refreshLeaseOwner,
              refreshLeaseTokenVersion: typeof data.refreshLeaseTokenVersion === "number"
                ? data.refreshLeaseTokenVersion
                : data.refreshLeaseTokenVersion === null
                  ? null
                  : connection.refreshLeaseTokenVersion,
              tokenVersion: typeof data.tokenVersion === "number"
                ? data.tokenVersion
                : data.tokenVersion === null
                  ? null
                  : connection.tokenVersion,
            };

            return cloneConnection(connection);
          },
        },
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await store.persistStoredConnectionTokenBundle({
      connectionId: "dsc_123",
      externalAccountId: null,
      provider: "oura",
      tokenBundle: null,
    });

    expect(connection.accessTokenEncrypted).toBeNull();
    expect(connection.refreshTokenEncrypted).toBeNull();
    expect(connection.tokenVersion).toBeNull();
    expect(connection.externalAccountIdEncrypted).toBe("enc:acct_456");
    await expect(store.getStoredConnectionAccountForUser("user-123", "dsc_123")).resolves.toBeNull();
    await expect(store.getConnectionForUser("user-123", "dsc_123")).resolves.toEqual(expect.objectContaining({
      externalAccountId: "acct_456",
      id: "dsc_123",
      provider: "oura",
    }));

    await store.persistStoredConnectionTokenBundle({
      connectionId: "dsc_123",
      externalAccountId: null,
      provider: "oura",
      tokenBundle: {
        accessToken: "fresh-access-token",
        accessTokenExpiresAt: "2026-03-26T04:00:00.000Z",
        keyVersion: "v1",
        refreshToken: "fresh-refresh-token",
        tokenVersion: 1,
      },
    });

    await expect(store.getStoredConnectionAccountForUser("user-123", "dsc_123")).resolves.toEqual(
      expect.objectContaining({
        credential: {
          kind: "oauth_tokens",
          tokens: {
            accessToken: "fresh-access-token",
            accessTokenExpiresAt: "2026-03-26T04:00:00.000Z",
            refreshToken: "fresh-refresh-token",
          },
        },
        externalAccountId: "acct_456",
        tokenVersion: 1,
      }),
    );
  });

  it("blocks token writes while another actor owns the current refresh lease", async () => {
    const connection = createConnection({
      accessTokenEncrypted: "enc:access-token",
      accessTokenExpiresAt: new Date("2026-03-25T04:00:00.000Z"),
      externalAccountIdEncrypted: "enc:acct_456",
      keyVersion: "v1",
      provider: "oura",
      refreshLeaseExpiresAt: new Date("2026-03-25T04:05:00.000Z"),
      refreshLeaseOwner: "agent-refresh:active",
      refreshLeaseTokenVersion: 2,
      refreshTokenEncrypted: "enc:refresh-token",
      tokenVersion: 2,
      userId: "user-123",
    });
    const update = vi.fn();

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findUnique: async ({ where }: { where: { id?: string } }) =>
            where.id === connection.id ? cloneConnection(connection) : null,
          update,
        },
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.persistStoredConnectionTokenBundle({
      connectionId: "dsc_123",
      externalAccountId: null,
      provider: "oura",
      tokenBundle: {
        accessToken: "fresh-access-token",
        accessTokenExpiresAt: "2026-03-26T04:00:00.000Z",
        keyVersion: "v1",
        refreshToken: "fresh-refresh-token",
        tokenVersion: 3,
      },
    })).rejects.toMatchObject({
      code: "TOKEN_REFRESH_IN_PROGRESS",
      retryable: true,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("allows explicit token clearing to clear an active refresh lease", async () => {
    let connection = createConnection({
      accessTokenEncrypted: "enc:access-token",
      accessTokenExpiresAt: new Date("2026-03-25T04:00:00.000Z"),
      externalAccountIdEncrypted: "enc:acct_456",
      keyVersion: "v1",
      provider: "oura",
      refreshLeaseExpiresAt: new Date("2026-03-25T04:05:00.000Z"),
      refreshLeaseOwner: "agent-refresh:active",
      refreshLeaseTokenVersion: 2,
      refreshTokenEncrypted: "enc:refresh-token",
      tokenVersion: 2,
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findUnique: async ({ where }: { where: { id?: string } }) =>
            where.id === connection.id ? cloneConnection(connection) : null,
          update: async ({ data }: { data: Partial<MutableConnectionRecord> }) => {
            connection = {
              ...connection,
              ...data,
            };
            return cloneConnection(connection);
          },
        },
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await store.persistStoredConnectionTokenBundle({
      clearRefreshLease: true,
      connectionId: "dsc_123",
      externalAccountId: null,
      provider: "oura",
      tokenBundle: null,
    });

    expect(connection.accessTokenEncrypted).toBeNull();
    expect(connection.refreshTokenEncrypted).toBeNull();
    expect(connection.tokenVersion).toBeNull();
    expect(connection.refreshLeaseOwner).toBeNull();
    expect(connection.refreshLeaseExpiresAt).toBeNull();
    expect(connection.refreshLeaseTokenVersion).toBeNull();
  });

  it("allows the refresh lease owner to persist the next rotating token bundle", async () => {
    let connection = createConnection({
      accessTokenEncrypted: "enc:access-token",
      accessTokenExpiresAt: new Date("2026-03-25T04:00:00.000Z"),
      externalAccountIdEncrypted: "enc:acct_456",
      keyVersion: "v1",
      provider: "oura",
      refreshLeaseExpiresAt: new Date("2026-03-25T04:05:00.000Z"),
      refreshLeaseOwner: "agent-refresh:active",
      refreshLeaseTokenVersion: 2,
      refreshTokenEncrypted: "enc:refresh-token",
      tokenVersion: 2,
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findUnique: async ({ where }: { where: { id?: string } }) =>
            where.id === connection.id ? cloneConnection(connection) : null,
          update: async ({ data }: { data: Partial<MutableConnectionRecord> }) => {
            connection = {
              ...connection,
              ...data,
            };
            return cloneConnection(connection);
          },
        },
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await store.persistStoredConnectionTokenBundle({
      connectionId: "dsc_123",
      externalAccountId: null,
      provider: "oura",
      refreshLeaseOwner: "agent-refresh:active",
      tokenBundle: {
        accessToken: "fresh-access-token",
        accessTokenExpiresAt: "2026-03-26T04:00:00.000Z",
        keyVersion: "v1",
        refreshToken: "fresh-refresh-token",
        tokenVersion: 3,
      },
    });

    expect(connection.tokenVersion).toBe(3);
    expect(connection.refreshLeaseOwner).toBe("agent-refresh:active");
  });

  it("claims, classifies, and clears refresh leases by owner", async () => {
    let connection = createConnection({
      provider: "oura",
      refreshLeaseExpiresAt: null,
      refreshLeaseOwner: null,
      refreshLeaseTokenVersion: null,
      status: "active",
      tokenVersion: 2,
      userId: "user-123",
    });

    const updateMany = vi.fn(async (input: {
      data: Partial<MutableConnectionRecord>;
      where: Record<string, unknown>;
    }) => {
      if (input.where.id !== connection.id) {
        return { count: 0 };
      }

      if (typeof input.data.refreshLeaseOwner === "string") {
        if (
          input.where.userId === connection.userId
          && input.where.tokenVersion === connection.tokenVersion
          && input.where.refreshLeaseExpiresAt === null
          && input.where.refreshLeaseOwner === null
          && input.where.refreshLeaseTokenVersion === null
          && connection.refreshLeaseExpiresAt === null
          && connection.refreshLeaseOwner === null
          && connection.refreshLeaseTokenVersion === null
        ) {
          connection = {
            ...connection,
            refreshLeaseExpiresAt: input.data.refreshLeaseExpiresAt ?? null,
            refreshLeaseOwner: input.data.refreshLeaseOwner,
            refreshLeaseTokenVersion: input.data.refreshLeaseTokenVersion ?? null,
          };
          return { count: 1 };
        }

        return { count: 0 };
      }

      if (input.data.refreshLeaseOwner === null) {
        if (
          input.where.refreshLeaseOwner === connection.refreshLeaseOwner
          || (
            input.where.userId === connection.userId
            && Array.isArray(input.where.OR)
          )
        ) {
          connection = {
            ...connection,
            refreshLeaseExpiresAt: null,
            refreshLeaseOwner: null,
            refreshLeaseTokenVersion: null,
          };
          return { count: 1 };
        }

        return { count: 0 };
      }

      return { count: 0 };
    });
    const findFirst = vi.fn(async ({ where }: { where: { id: string; userId: string } }) =>
      where.id === connection.id && where.userId === connection.userId ? cloneConnection(connection) : null
    );

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst,
          updateMany,
        },
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.claimConnectionRefreshLease({
      connectionId: "dsc_123",
      userId: "user-123",
      tokenVersion: 2,
      leaseOwner: "agent-refresh:owner-1",
      leaseExpiresAt: "2026-03-26T03:05:00.000Z",
      now: "2026-03-26T03:00:00.000Z",
    })).resolves.toEqual({ status: "claimed" });
    expect(connection.refreshLeaseOwner).toBe("agent-refresh:owner-1");

    await expect(store.claimConnectionRefreshLease({
      connectionId: "dsc_123",
      userId: "user-123",
      tokenVersion: 2,
      leaseOwner: "agent-refresh:owner-2",
      leaseExpiresAt: "2026-03-26T03:06:00.000Z",
      now: "2026-03-26T03:01:00.000Z",
    })).resolves.toEqual({
      status: "in_progress",
      leaseExpiresAt: "2026-03-26T03:05:00.000Z",
    });

    connection = {
      ...connection,
      refreshLeaseExpiresAt: new Date("2026-03-26T02:59:00.000Z"),
    };
    await expect(store.claimConnectionRefreshLease({
      connectionId: "dsc_123",
      userId: "user-123",
      tokenVersion: 2,
      leaseOwner: "agent-refresh:owner-3",
      leaseExpiresAt: "2026-03-26T03:06:00.000Z",
      now: "2026-03-26T03:00:00.000Z",
    })).resolves.toEqual({ status: "stale" });

    connection = {
      ...connection,
      refreshLeaseExpiresAt: null,
      refreshLeaseOwner: null,
      refreshLeaseTokenVersion: null,
      tokenVersion: 3,
    };
    await expect(store.claimConnectionRefreshLease({
      connectionId: "dsc_123",
      userId: "user-123",
      tokenVersion: 2,
      leaseOwner: "agent-refresh:owner-4",
      leaseExpiresAt: "2026-03-26T03:06:00.000Z",
      now: "2026-03-26T03:00:00.000Z",
    })).resolves.toEqual({ status: "version_changed" });

    connection = {
      ...connection,
      refreshLeaseExpiresAt: new Date("2026-03-26T03:06:00.000Z"),
      refreshLeaseOwner: "agent-refresh:clear",
      refreshLeaseTokenVersion: 3,
    };
    await expect(store.clearConnectionRefreshLease({
      connectionId: "dsc_123",
      leaseOwner: "agent-refresh:wrong",
    })).resolves.toBe(false);
    expect(connection.refreshLeaseOwner).toBe("agent-refresh:clear");
    await expect(store.clearConnectionRefreshLease({
      connectionId: "dsc_123",
      leaseOwner: "agent-refresh:clear",
    })).resolves.toBe(true);
    expect(connection.refreshLeaseOwner).toBeNull();
    expect(connection.refreshLeaseExpiresAt).toBeNull();
    expect(connection.refreshLeaseTokenVersion).toBeNull();

    connection = {
      ...connection,
      accessTokenEncrypted: "enc:cleanup-access-token",
      keyVersion: "v1",
      refreshLeaseExpiresAt: null,
      refreshLeaseOwner: "",
      refreshLeaseTokenVersion: 3,
      refreshTokenEncrypted: "enc:cleanup-refresh-token",
      tokenVersion: 3,
    };
    await expect(store.clearStaleConnectionRefreshLease({
      connectionId: "dsc_123",
      userId: "user-123",
    })).resolves.toBe(true);
    expect(connection).toMatchObject({
      accessTokenEncrypted: "enc:cleanup-access-token",
      keyVersion: "v1",
      refreshLeaseExpiresAt: null,
      refreshLeaseOwner: null,
      refreshLeaseTokenVersion: null,
      refreshTokenEncrypted: "enc:cleanup-refresh-token",
      tokenVersion: 3,
    });
  });

  it("fails closed when OAuth token rows store invalid token versions", async () => {
    for (const tokenVersion of [0, -1, 1.5]) {
      const connection = createConnection({
        accessTokenEncrypted: "enc:access-token",
        accessTokenExpiresAt: new Date("2026-03-25T04:00:00.000Z"),
        externalAccountIdEncrypted: "enc:acct_456",
        keyVersion: "v1",
        provider: "oura",
        refreshTokenEncrypted: "enc:refresh-token",
        tokenVersion,
        userId: "user-123",
      });

      const store = new PrismaDeviceSyncControlPlaneStore({
        codec: TEST_CODEC,
        prisma: {
          deviceConnection: {
            findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
              where.id === connection.id && where.userId === connection.userId
                ? cloneConnection(connection)
                : null,
          },
        } as never,
      });

      await expect(
        store.getStoredConnectionAccountForUser("user-123", "dsc_123"),
      ).rejects.toThrow("Hosted device-sync tokenVersion must be a positive integer.");
    }
  });

  it("fails closed when provider-config rows contain token material", async () => {
    const connection = createConnection({
      accessTokenEncrypted: "enc:legacy-token",
      credentialKind: "provider_config",
      externalAccountIdEncrypted: "enc:junction-user-123",
      keyVersion: "v1",
      provider: "junction",
      providerConfigKey: "junction",
      refreshTokenEncrypted: "enc:legacy-refresh",
      tokenVersion: 7,
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
            where.id === connection.id && where.userId === connection.userId ? cloneConnection(connection) : null,
        },
      } as never,
    });

    await expect(
      store.getStoredConnectionAccountForUser("user-123", "dsc_123"),
    ).rejects.toThrow(/non-token credential rows must not contain token material/u);
  });

  it("fails closed when hosted credential rows use an unknown credential kind", async () => {
    const connection = createConnection({
      accessTokenEncrypted: "enc:legacy-token",
      credentialKind: "bogus" as MutableConnectionRecord["credentialKind"],
      externalAccountIdEncrypted: "enc:acct_456",
      keyVersion: "v1",
      provider: "oura",
      refreshTokenEncrypted: "enc:legacy-refresh",
      tokenVersion: 7,
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
            where.id === connection.id && where.userId === connection.userId ? cloneConnection(connection) : null,
        },
      } as never,
    });

    await expect(
      store.getStoredConnectionAccountForUser("user-123", "dsc_123"),
    ).rejects.toThrow(/credential_kind is invalid/u);
  });

  it("clears the stored external account binding only when explicitly requested", async () => {
    let connection = createConnection({
      accessTokenEncrypted: "enc:access-token",
      accessTokenExpiresAt: new Date("2026-03-25T04:00:00.000Z"),
      externalAccountIdEncrypted: "enc:acct_456",
      keyVersion: "v1",
      provider: "oura",
      refreshTokenEncrypted: "enc:refresh-token",
      tokenVersion: 2,
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
            where.id === connection.id && where.userId === connection.userId ? cloneConnection(connection) : null,
          findUnique: async ({ where }: { where: { id?: string } | { provider_providerAccountBlindIndex?: { provider: string; providerAccountBlindIndex: string } } }) =>
            "id" in where && where.id === connection.id ? cloneConnection(connection) : null,
          update: async ({ data }: { data: Record<string, unknown> }) => {
            connection = {
              ...connection,
              accessTokenEncrypted: typeof data.accessTokenEncrypted === "string"
                ? data.accessTokenEncrypted
                : data.accessTokenEncrypted === null
                  ? null
                  : connection.accessTokenEncrypted,
              accessTokenExpiresAt: data.accessTokenExpiresAt instanceof Date
                ? data.accessTokenExpiresAt
                : data.accessTokenExpiresAt === null
                  ? null
                  : connection.accessTokenExpiresAt,
              externalAccountIdEncrypted: typeof data.externalAccountIdEncrypted === "string"
                ? data.externalAccountIdEncrypted
                : data.externalAccountIdEncrypted === null
                  ? null
                  : connection.externalAccountIdEncrypted,
              keyVersion: typeof data.keyVersion === "string"
                ? data.keyVersion
                : data.keyVersion === null
                  ? null
                  : connection.keyVersion,
              refreshTokenEncrypted: typeof data.refreshTokenEncrypted === "string"
                ? data.refreshTokenEncrypted
                : data.refreshTokenEncrypted === null
                  ? null
                  : connection.refreshTokenEncrypted,
              tokenVersion: typeof data.tokenVersion === "number"
                ? data.tokenVersion
                : data.tokenVersion === null
                  ? null
                  : connection.tokenVersion,
            };

            return cloneConnection(connection);
          },
        },
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await store.persistStoredConnectionTokenBundle({
      clearExternalAccountId: true,
      connectionId: "dsc_123",
      externalAccountId: null,
      provider: "oura",
      tokenBundle: null,
    });

    expect(connection.externalAccountIdEncrypted).toBeNull();
    await expect(store.getConnectionForUser("user-123", "dsc_123")).resolves.toEqual(expect.objectContaining({
      externalAccountId: "opaque:dsc_123",
      id: "dsc_123",
      provider: "oura",
    }));
  });
});

function cloneOAuthSession(session: MutableOAuthSession | null): MutableOAuthSession | null {
  return session
    ? {
        ...session,
        createdAt: new Date(session.createdAt),
        expiresAt: new Date(session.expiresAt),
      }
    : null;
}

function createRootConnectionPreflight(
  readConnection: () => MutableConnectionRecord | null,
) {
  return {
    findUnique: vi.fn(async () => {
      const connection = readConnection();
      return connection
        ? {
            connectedAt: connection.connectedAt,
            id: connection.id,
            setupPhase: connection.setupPhase,
            status: connection.status,
            userId: connection.userId,
          }
        : null;
    }),
  };
}

function cloneConnection(record: MutableConnectionRecord | null): MutableConnectionRecord | null {
  return record
    ? {
        ...record,
        accessTokenExpiresAt: record.accessTokenExpiresAt ? new Date(record.accessTokenExpiresAt) : null,
        connectedAt: new Date(record.connectedAt),
        lastWebhookAt: record.lastWebhookAt ? new Date(record.lastWebhookAt) : null,
        lastSyncStartedAt: record.lastSyncStartedAt ? new Date(record.lastSyncStartedAt) : null,
        lastSyncCompletedAt: record.lastSyncCompletedAt ? new Date(record.lastSyncCompletedAt) : null,
        lastSyncErrorAt: record.lastSyncErrorAt ? new Date(record.lastSyncErrorAt) : null,
        nextReconcileAt: record.nextReconcileAt ? new Date(record.nextReconcileAt) : null,
        refreshLeaseExpiresAt: record.refreshLeaseExpiresAt ? new Date(record.refreshLeaseExpiresAt) : null,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
      }
    : null;
}

function createConnection(overrides: Partial<MutableConnectionRecord>): MutableConnectionRecord {
  return {
    accessTokenEncrypted: overrides.accessTokenEncrypted ?? null,
    accessTokenExpiresAt: overrides.accessTokenExpiresAt ?? null,
    id: overrides.id ?? "dsc_123",
    userId: overrides.userId ?? "user-123",
    provider: overrides.provider ?? "oura",
    providerAccountBlindIndex: overrides.providerAccountBlindIndex
      ?? buildHostedProviderAccountBlindIndex({
        key: BLIND_INDEX_KEY,
        provider: overrides.provider ?? "oura",
        externalAccountId: "acct_456",
      }),
    credentialKind: overrides.credentialKind ?? "oauth_tokens",
    credentialMetadataJson: overrides.credentialMetadataJson ?? {},
    providerConfigKey: overrides.providerConfigKey ?? null,
    providerApplicationId: overrides.providerApplicationId ?? null,
    providerApplicationRevision: overrides.providerApplicationRevision ?? null,
    displayName: overrides.displayName ?? "Oura ring",
    externalAccountIdEncrypted: overrides.externalAccountIdEncrypted ?? "enc:acct_456",
    keyVersion: overrides.keyVersion ?? null,
    metadataJson: overrides.metadataJson ?? {},
    refreshLeaseExpiresAt: overrides.refreshLeaseExpiresAt ?? null,
    refreshLeaseOwner: overrides.refreshLeaseOwner ?? null,
    refreshLeaseTokenVersion: overrides.refreshLeaseTokenVersion ?? null,
    refreshTokenEncrypted: overrides.refreshTokenEncrypted ?? null,
    scopesJson: overrides.scopesJson ?? [],
    setupExpiresAt: overrides.setupExpiresAt ?? null,
    setupPhase: overrides.setupPhase ?? null,
    status: overrides.status ?? "reauthorization_required",
    tokenVersion: overrides.tokenVersion ?? null,
    connectedAt: overrides.connectedAt ?? new Date("2026-03-25T00:00:00.000Z"),
    lastWebhookAt: overrides.lastWebhookAt ?? null,
    lastSyncStartedAt: overrides.lastSyncStartedAt ?? null,
    lastSyncCompletedAt: overrides.lastSyncCompletedAt ?? null,
    lastSyncErrorAt: overrides.lastSyncErrorAt ?? null,
    lastErrorCode: overrides.lastErrorCode ?? null,
    lastErrorMessage: overrides.lastErrorMessage ?? null,
    nextReconcileAt: overrides.nextReconcileAt ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-03-25T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-03-25T00:00:00.000Z"),
  };
}

function normalizeCreatedConnection(data: Record<string, unknown>): MutableConnectionRecord {
  return createConnection({
    id: String(data.id),
    userId: String(data.userId),
    provider: String(data.provider),
    providerAccountBlindIndex: String(data.providerAccountBlindIndex),
    credentialKind: (data.credentialKind as MutableConnectionRecord["credentialKind"]) ?? "oauth_tokens",
    credentialMetadataJson: (data.credentialMetadataJson as Record<string, unknown> | null) ?? {},
    externalAccountIdEncrypted: typeof data.externalAccountIdEncrypted === "string"
      ? data.externalAccountIdEncrypted
      : null,
    metadataJson: (data.metadataJson as Record<string, unknown> | null) ?? {},
    providerConfigKey: typeof data.providerConfigKey === "string" ? data.providerConfigKey : null,
    providerApplicationId: typeof data.providerApplicationId === "string"
      ? data.providerApplicationId
      : null,
    providerApplicationRevision: typeof data.providerApplicationRevision === "number"
      ? data.providerApplicationRevision
      : null,
    refreshLeaseExpiresAt: data.refreshLeaseExpiresAt instanceof Date ? data.refreshLeaseExpiresAt : null,
    refreshLeaseOwner: typeof data.refreshLeaseOwner === "string" ? data.refreshLeaseOwner : null,
    refreshLeaseTokenVersion: typeof data.refreshLeaseTokenVersion === "number" ? data.refreshLeaseTokenVersion : null,
    setupExpiresAt: data.setupExpiresAt instanceof Date ? data.setupExpiresAt : null,
    setupPhase: (data.setupPhase as MutableConnectionRecord["setupPhase"]) ?? null,
    status: (data.status as MutableConnectionRecord["status"]) ?? "active",
    connectedAt: data.connectedAt instanceof Date ? data.connectedAt : new Date("2026-03-25T00:00:00.000Z"),
    nextReconcileAt: data.nextReconcileAt instanceof Date ? data.nextReconcileAt : null,
  });
}
