import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptHostedWebNullableString: vi.fn(),
}));

vi.mock("@/src/lib/hosted-web/encryption", () => ({
  decryptHostedWebNullableString: mocks.decryptHostedWebNullableString,
  encryptHostedWebNullableString: vi.fn(),
}));

import {
  normalizeHostedVaultSyncSessionStatus,
  projectHostedVaultSyncPayload,
  projectHostedVaultSyncSessionView,
} from "@/src/lib/vault-sync/shared";
import {
  listHostedVaultSyncSessions,
  markHostedVaultSyncSessionCommittedFromRunSummary,
} from "@/src/lib/vault-sync/session-service";

describe("vault sync shared projections", () => {
  it("projects pending sessions with a runnable agent command and hides the command once they expire", () => {
    const session = {
      createdAt: new Date("2026-04-21T00:00:00.000Z"),
      expiresAt: new Date("2026-04-21T01:00:00.000Z"),
      id: "vsi_123",
      localManifestHash: null,
      queuedIngressEventId: null,
      revokedAt: null,
      sourceVaultId: "vault_local",
      sourceVaultTitle: "Local Vault",
      status: "pending" as const,
    };

    expect(normalizeHostedVaultSyncSessionStatus({
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      status: session.status,
    }, new Date("2026-04-21T00:30:00.000Z"))).toBe("pending");

    expect(projectHostedVaultSyncSessionView({
      appBaseUrl: "https://join.example.test",
      pairingCode: "ABCD-EFGH",
      session,
      now: new Date("2026-04-21T00:30:00.000Z"),
    })).toEqual({
      agentCommand: "murph sync push --session ABCD-EFGH --host https://join.example.test",
      createdAt: "2026-04-21T00:00:00.000Z",
      expiresAt: "2026-04-21T01:00:00.000Z",
      id: "vsi_123",
      localManifestHash: null,
      queuedIngressEventId: null,
      sourceVaultId: "vault_local",
      sourceVaultTitle: "Local Vault",
      status: "pending",
    });

    expect(normalizeHostedVaultSyncSessionStatus({
      expiresAt: new Date("2026-04-20T23:59:59.000Z"),
      revokedAt: null,
      status: "pending",
    }, new Date("2026-04-21T00:30:00.000Z"))).toBe("expired");

    expect(projectHostedVaultSyncSessionView({
      appBaseUrl: "https://join.example.test",
      pairingCode: "ABCD-EFGH",
      session: {
        ...session,
        expiresAt: new Date("2026-04-20T23:59:59.000Z"),
      },
      now: new Date("2026-04-21T00:30:00.000Z"),
    })).toEqual(expect.objectContaining({
      agentCommand: null,
      status: "expired",
    }));
  });

  it("projects encrypted vault sync payloads back into the upload shape", () => {
    mocks.decryptHostedWebNullableString.mockReturnValue(JSON.stringify({
      bundleBase64: "AQID",
      sessionId: "vsi_123",
      sourceSchemaVersion: "murph.vault.v1",
    }));

    expect(projectHostedVaultSyncPayload({
      memberId: "member_123",
      payloadEncrypted: "ciphertext",
      payloadSchema: "murph.hosted-vault-sync-payload.v1",
      sessionId: "vsi_123",
    })).toEqual({
      bundleBase64: "AQID",
      sessionId: "vsi_123",
      sourceSchemaVersion: "murph.vault.v1",
    });
  });
});

describe("vault sync commit projection", () => {
  it("reads plural vault-sync summaries when projecting queued session run status", async () => {
    const prisma = {
      hostedVaultSyncSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            createdAt: new Date("2026-04-21T00:00:00.000Z"),
            expiresAt: new Date("2026-04-21T01:00:00.000Z"),
            id: "vsi_first",
            localManifestHash: null,
            queuedIngressEventId: "evt_first",
            revokedAt: null,
            sourceVaultId: "vault_local",
            sourceVaultTitle: "Local Vault",
            status: "queued",
          },
          {
            createdAt: new Date("2026-04-20T00:00:00.000Z"),
            expiresAt: new Date("2026-04-20T01:00:00.000Z"),
            id: "vsi_second",
            localManifestHash: null,
            queuedIngressEventId: "evt_second",
            revokedAt: null,
            sourceVaultId: "vault_local",
            sourceVaultTitle: "Local Vault",
            status: "queued",
          },
        ]),
      },
      hostedIngressEvent: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            run: {
              redactedSummaryJson: {
                details: {
                  vaultSyncImports: [
                    {
                      conflictCount: 0,
                      sessionId: "vsi_first",
                    },
                  ],
                },
              },
              status: "completed",
            },
            state: "completed",
          })
          .mockResolvedValueOnce({
            run: {
              redactedSummaryJson: {
                details: {
                  vaultSyncImports: [
                    {
                      conflictCount: 3,
                      sessionId: "vsi_second",
                    },
                  ],
                },
              },
              status: "completed",
            },
            state: "completed",
          }),
      },
    } as never;

    await expect(listHostedVaultSyncSessions({
      memberId: "member_123",
      prisma,
    })).resolves.toEqual([
      expect.objectContaining({
        id: "vsi_first",
        status: "committed",
      }),
      expect.objectContaining({
        id: "vsi_second",
        status: "committed_with_conflicts",
      }),
    ]);
  });

  it("marks committed sessions with conflicts when the run summary reports vault-sync conflicts", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      hostedVaultSyncSession: {
        updateMany,
      },
    } as never;

    await markHostedVaultSyncSessionCommittedFromRunSummary({
      memberId: "member_123",
      prisma,
      redactedSummary: {
        details: {
          vaultSyncImport: {
            conflictCount: 2,
            sessionId: "vsi_123",
          },
        },
      },
    });

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        status: "committed_with_conflicts",
      },
      where: {
        id: "vsi_123",
        memberId: "member_123",
        status: {
          in: ["exchanged", "uploaded", "queued"],
        },
      },
    });
  });

  it("marks every vault-sync session reported by one run summary", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      hostedVaultSyncSession: {
        updateMany,
      },
    } as never;

    await markHostedVaultSyncSessionCommittedFromRunSummary({
      memberId: "member_123",
      prisma,
      redactedSummary: {
        details: {
          vaultSyncImports: [
            {
              conflictCount: 0,
              sessionId: "vsi_first",
            },
            {
              conflictCount: 3,
              sessionId: "vsi_second",
            },
          ],
        },
      },
    });

    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: {
        status: "committed",
      },
      where: expect.objectContaining({
        id: "vsi_first",
        memberId: "member_123",
      }),
    }));
    expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: {
        status: "committed_with_conflicts",
      },
      where: expect.objectContaining({
        id: "vsi_second",
        memberId: "member_123",
      }),
    }));
  });
});
