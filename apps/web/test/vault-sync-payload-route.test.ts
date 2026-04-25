import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteHostedVaultSyncPayload: vi.fn(),
  getPrisma: vi.fn(),
  isHostedVaultSyncPayloadTerminalStatus: vi.fn((status: string) =>
    ["committed", "committed_with_conflicts", "expired", "failed", "revoked"].includes(status)
  ),
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
  deleteHostedVaultSyncPayload: mocks.deleteHostedVaultSyncPayload,
  isHostedVaultSyncPayloadTerminalStatus: mocks.isHostedVaultSyncPayloadTerminalStatus,
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
      bundleBase64: "AQID",
      sessionId: "vsi_123",
      sourceSchemaVersion: "murph.vault.v1",
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

    expect(response.status).toBe(404);
    expect(mocks.projectHostedVaultSyncPayload).not.toHaveBeenCalled();
    expect(mocks.deleteHostedVaultSyncPayload).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_VAULT_SYNC_PAYLOAD_NOT_FOUND",
        message: "That vault sync payload is not available.",
        retryable: false,
      },
    });
  });

  it("prunes expired payload rows before failing closed", async () => {
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

      expect(response.status).toBe(404);
      expect(mocks.deleteHostedVaultSyncPayload).toHaveBeenCalledWith({
        memberId: "member_123",
        prisma,
        sessionId: "vsi_123",
      });
      expect(mocks.projectHostedVaultSyncPayload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
