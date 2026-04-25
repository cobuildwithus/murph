import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptHostedWebNullableString: vi.fn(),
}));

vi.mock("@/src/lib/hosted-web/encryption", () => ({
  decryptHostedWebNullableString: mocks.decryptHostedWebNullableString,
  encryptHostedWebNullableString: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    publicBaseUrl: "https://join.example.test",
  }),
}));

import {
  generateHostedVaultSyncPairingCode,
  HOSTED_VAULT_SYNC_SESSION_TTL_MS,
  normalizeHostedVaultSyncPairingCode,
  normalizeHostedVaultSyncSessionStatus,
  projectHostedVaultSyncPayload,
  projectHostedVaultSyncSessionView,
} from "@/src/lib/vault-sync/shared";
import {
  createHostedVaultSyncSession,
  listHostedVaultSyncSessions,
  markHostedVaultSyncSessionCommittedFromRunSummary,
} from "@/src/lib/vault-sync/session-service";

describe("vault sync pairing setup", () => {
  it("generates 10-character pairing codes in a readable display shape", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const pairingCode = generateHostedVaultSyncPairingCode();

      expect(pairingCode).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/u);
      expect(normalizeHostedVaultSyncPairingCode(pairingCode)).toHaveLength(10);
    }
  });

  it("creates pending sessions with a 10-minute expiry", async () => {
    const now = new Date("2026-04-21T00:00:00.000Z");
    const create = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      agentTokenHash: null,
      createdAt: now,
      localManifestHash: null,
      queuedAt: null,
      queuedIngressEventId: null,
      revokedAt: null,
      sourceSchemaVersion: null,
      sourceVaultId: null,
      sourceVaultTitle: null,
      updatedAt: now,
      uploadedAt: null,
    }));
    const prisma = {
      hostedVaultSyncSession: {
        create,
      },
    } as never;

    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const result = await createHostedVaultSyncSession({
        memberId: "member_123",
        prisma,
      });

      expect(HOSTED_VAULT_SYNC_SESSION_TTL_MS).toBe(10 * 60 * 1000);
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          expiresAt: new Date("2026-04-21T00:10:00.000Z"),
          memberId: "member_123",
          status: "pending",
        }),
      });
      expect(result.pairingCode).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/u);
      expect(result.session.agentCommand).toBe(
        `murph sync push --session ${result.pairingCode} --host https://join.example.test`,
      );
      expect(result.session.expiresAt).toBe("2026-04-21T00:10:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
});

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
      pairingCode: "ABCDE-FGHIJ",
      session,
      now: new Date("2026-04-21T00:30:00.000Z"),
    })).toEqual({
      agentCommand: "murph sync push --session ABCDE-FGHIJ --host https://join.example.test",
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
      pairingCode: "ABCDE-FGHIJ",
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

  it("marks committed sessions with conflicts when the plural run summary reports vault-sync conflicts", async () => {
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
          vaultSyncImports: [{
            conflictCount: 2,
            sessionId: "vsi_123",
          }],
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

  it("ignores legacy singular vault-sync summaries after the hard cut", async () => {
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

    expect(updateMany).not.toHaveBeenCalled();
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
