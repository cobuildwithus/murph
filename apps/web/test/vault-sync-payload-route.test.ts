import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  isHostedVaultSyncPayloadTerminalStatus: vi.fn((status: string) =>
    ["committed", "committed_with_conflicts", "expired", "failed", "revoked"].includes(status)
  ),
  normalizeHostedVaultSyncSessionStatus: vi.fn((session: { expiresAt: Date; revokedAt: Date | null; status: string }, now = new Date()) => {
    if (session.revokedAt) {
      return "revoked";
    }
    if (
      session.expiresAt <= now
      && !["queued", "committed", "committed_with_conflicts", "failed"].includes(session.status)
    ) {
      return "expired";
    }
    return session.status;
  }),
  projectHostedVaultSyncPayload: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/vault-sync/shared", () => ({
  HOSTED_VAULT_SYNC_PAYLOAD_SCHEMA: "murph.hosted-vault-sync-payload.v1",
  isHostedVaultSyncPayloadTerminalStatus: mocks.isHostedVaultSyncPayloadTerminalStatus,
  normalizeHostedVaultSyncSessionStatus: mocks.normalizeHostedVaultSyncSessionStatus,
  projectHostedVaultSyncPayload: mocks.projectHostedVaultSyncPayload,
}));

type HostedVaultSyncPayloadRouteModule = typeof import("../app/api/internal/hosted-execution/vault-sync/[sessionId]/payload/route");

let hostedVaultSyncPayloadRoute: HostedVaultSyncPayloadRouteModule;

describe("hosted vault sync payload route", () => {
  beforeAll(async () => {
    hostedVaultSyncPayloadRoute = await import(
      "../app/api/internal/hosted-execution/vault-sync/[sessionId]/payload/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.projectHostedVaultSyncPayload.mockReturnValue({
      bundleBase64: "AQID",
      sessionId: "vsi_123",
      sourceSchemaVersion: "murph.vault.v1",
    });
  });

  it("returns the hydrated payload only when the caller owns the session and it is still active", async () => {
    const prisma = {
      hostedVaultSyncPayload: {
        findUnique: vi.fn(async () => ({
          memberId: "member_123",
          payloadEncrypted: "ciphertext",
          payloadSchema: "murph.hosted-vault-sync-payload.v1",
          session: {
            expiresAt: new Date("2099-04-21T00:00:00.000Z"),
            revokedAt: null,
            status: "queued",
          },
          sessionId: "vsi_123",
        })),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma as never);

    const response = await hostedVaultSyncPayloadRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/vault-sync/vsi_123/payload"),
      {
        params: Promise.resolve({
          sessionId: "vsi_123",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      fetchedAt: expect.any(String),
      payload: {
        bundleBase64: "AQID",
        payloadSchema: "murph.hosted-vault-sync-payload.v1",
        sessionId: "vsi_123",
        sourceSchemaVersion: "murph.vault.v1",
      },
      unavailable: null,
    });
    expect(mocks.projectHostedVaultSyncPayload).toHaveBeenCalledWith({
      memberId: "member_123",
      payloadEncrypted: "ciphertext",
      payloadSchema: "murph.hosted-vault-sync-payload.v1",
      session: {
        expiresAt: new Date("2099-04-21T00:00:00.000Z"),
        revokedAt: null,
        status: "queued",
      },
      sessionId: "vsi_123",
    });
  });

  it("fails closed when the payload row is missing, revoked, or owned by another member", async () => {
    const prisma = {
      hostedVaultSyncPayload: {
        findUnique: vi.fn(async () => ({
          memberId: "member_other",
          payloadEncrypted: "ciphertext",
          payloadSchema: "murph.hosted-vault-sync-payload.v1",
          session: {
            expiresAt: new Date("2099-04-21T00:00:00.000Z"),
            revokedAt: null,
            status: "queued",
          },
          sessionId: "vsi_123",
        })),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma as never);

    const response = await hostedVaultSyncPayloadRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/vault-sync/vsi_123/payload"),
      {
        params: Promise.resolve({
          sessionId: "vsi_123",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.projectHostedVaultSyncPayload).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      fetchedAt: expect.any(String),
      payload: null,
      unavailable: {
        code: "not_found",
        retryable: false,
      },
    });
  });

  it("keeps queued payloads fetchable after pairing expiry", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-21T12:00:00.000Z"));
      const prisma = {
        hostedVaultSyncPayload: {
          findUnique: vi.fn(async () => ({
            memberId: "member_123",
            payloadEncrypted: "ciphertext",
            payloadSchema: "murph.hosted-vault-sync-payload.v1",
            session: {
              expiresAt: new Date("2026-04-21T11:59:59.000Z"),
              revokedAt: null,
              status: "queued",
            },
            sessionId: "vsi_123",
          })),
        },
      };
      mocks.getPrisma.mockReturnValue(prisma as never);

      const response = await hostedVaultSyncPayloadRoute.GET(
        new Request("https://join.example.test/api/internal/hosted-execution/vault-sync/vsi_123/payload"),
        {
          params: Promise.resolve({
            sessionId: "vsi_123",
          }),
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        fetchedAt: "2026-04-21T12:00:00.000Z",
        payload: {
          bundleBase64: "AQID",
          payloadSchema: "murph.hosted-vault-sync-payload.v1",
          sessionId: "vsi_123",
          sourceSchemaVersion: "murph.vault.v1",
        },
        unavailable: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns pre-runner expiry as terminal state without mutating payload rows", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-21T12:00:00.000Z"));
      const prisma = {
        hostedVaultSyncPayload: {
          findUnique: vi.fn(async () => ({
            memberId: "member_123",
            payloadEncrypted: "ciphertext",
            payloadSchema: "murph.hosted-vault-sync-payload.v1",
            session: {
              expiresAt: new Date("2026-04-21T11:59:59.000Z"),
              revokedAt: null,
              status: "exchanged",
            },
            sessionId: "vsi_123",
          })),
        },
      };
      mocks.getPrisma.mockReturnValue(prisma as never);

      const response = await hostedVaultSyncPayloadRoute.GET(
        new Request("https://join.example.test/api/internal/hosted-execution/vault-sync/vsi_123/payload"),
        {
          params: Promise.resolve({
            sessionId: "vsi_123",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(mocks.projectHostedVaultSyncPayload).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        fetchedAt: "2026-04-21T12:00:00.000Z",
        payload: null,
        unavailable: {
          code: "expired",
          retryable: false,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports completed imports as gone even after session expiry", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-21T12:00:00.000Z"));
      const prisma = {
        hostedVaultSyncPayload: {
          findUnique: vi.fn(async () => ({
            memberId: "member_123",
            payloadEncrypted: "ciphertext",
            payloadSchema: "murph.hosted-vault-sync-payload.v1",
            session: {
              expiresAt: new Date("2026-04-21T11:59:59.000Z"),
              revokedAt: null,
              status: "committed",
            },
            sessionId: "vsi_123",
          })),
        },
      };
      mocks.getPrisma.mockReturnValue(prisma as never);

      const response = await hostedVaultSyncPayloadRoute.GET(
        new Request("https://join.example.test/api/internal/hosted-execution/vault-sync/vsi_123/payload"),
        {
          params: Promise.resolve({
            sessionId: "vsi_123",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(mocks.projectHostedVaultSyncPayload).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        fetchedAt: "2026-04-21T12:00:00.000Z",
        payload: null,
        unavailable: {
          code: "gone",
          retryable: false,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
