import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  decryptHostedWebNullableString: vi.fn(),
  encryptHostedWebNullableString: vi.fn(),
  nudgeHostedRunnerBestEffort: vi.fn(),
}));

vi.mock("@/src/lib/hosted-web/encryption", () => ({
  decryptHostedWebNullableString: mocks.decryptHostedWebNullableString,
  encryptHostedWebNullableString: mocks.encryptHostedWebNullableString,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerBestEffort: mocks.nudgeHostedRunnerBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    publicBaseUrl: "https://join.example.test",
  }),
}));

import {
  generateHostedVaultSyncPairingCode,
  hashHostedVaultSyncSecret,
  HOSTED_VAULT_SYNC_SESSION_TTL_MS,
  normalizeHostedVaultSyncPairingCode,
  normalizeHostedVaultSyncSessionStatus,
  projectHostedVaultSyncPayload,
  projectHostedVaultSyncSessionView,
  requireHostedVaultSyncAgentSession,
} from "@/src/lib/vault-sync/shared";
import {
  completeHostedVaultSyncAgentUpload,
  createHostedVaultSyncSession,
  listHostedVaultSyncSessions,
  recordHostedVaultSyncImportResult,
} from "@/src/lib/vault-sync/session-service";

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe("vault sync agent session auth", () => {
  it("accepts the active session when the bearer token hash matches", async () => {
    const agentToken = "vst_test_agent_token";
    const session = buildVaultSyncAgentSession({
      agentTokenHash: hashHostedVaultSyncSecret(agentToken),
    });
    const prisma = buildVaultSyncAuthPrisma(session);

    await expect(requireHostedVaultSyncAgentSession({
      prisma,
      request: buildVaultSyncAgentRequest(agentToken),
      sessionId: session.id,
    })).resolves.toBe(session);
  });

  it("rejects an active session when the bearer token hash does not match", async () => {
    const session = buildVaultSyncAgentSession({
      agentTokenHash: hashHostedVaultSyncSecret("vst_expected_agent_token"),
    });
    const prisma = buildVaultSyncAuthPrisma(session);

    await expect(requireHostedVaultSyncAgentSession({
      prisma,
      request: buildVaultSyncAgentRequest("vst_wrong_agent_token"),
      sessionId: session.id,
    })).rejects.toMatchObject({
      code: "HOSTED_VAULT_SYNC_SESSION_NOT_FOUND",
      httpStatus: 404,
    });
  });

  it("rejects malformed stored token hashes without length-comparison errors", async () => {
    const session = buildVaultSyncAgentSession({
      agentTokenHash: "short-hash",
    });
    const prisma = buildVaultSyncAuthPrisma(session);

    await expect(requireHostedVaultSyncAgentSession({
      prisma,
      request: buildVaultSyncAgentRequest("vst_test_agent_token"),
      sessionId: session.id,
    })).rejects.toMatchObject({
      code: "HOSTED_VAULT_SYNC_SESSION_NOT_FOUND",
      httpStatus: 404,
    });
  });
});

describe("vault sync mailbox producer", () => {
  it("lists product-owned session status without reading legacy hosted run summaries", async () => {
    const prisma = {
      hostedVaultSyncSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            createdAt: new Date("2026-04-21T00:00:00.000Z"),
            expiresAt: new Date("2026-04-21T01:00:00.000Z"),
            id: "vsi_first",
            localManifestHash: null,
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
            revokedAt: null,
            sourceVaultId: "vault_local",
            sourceVaultTitle: "Local Vault",
            status: "queued",
          },
        ]),
      },
      hostedIngressEvent: {
        findUnique: vi.fn(),
      },
    } as never;

    await expect(listHostedVaultSyncSessions({
      memberId: "member_123",
      prisma,
    })).resolves.toEqual([
      expect.objectContaining({
        id: "vsi_first",
        status: "queued",
      }),
      expect.objectContaining({
        id: "vsi_second",
        status: "queued",
      }),
    ]);
    expect((prisma as {
      hostedIngressEvent: { findUnique: ReturnType<typeof vi.fn> };
    }).hostedIngressEvent.findUnique).not.toHaveBeenCalled();
  });

  it("claims the upload session and appends the vault-sync mailbox item in one transaction before nudging", async () => {
    const order: string[] = [];
    const session = buildVaultSyncAgentSession({
      agentTokenHash: hashHostedVaultSyncSecret("vst_test_agent_token"),
    });
    const tx = buildVaultSyncUploadTx({
      onPayload: () => order.push("payload"),
      onSessionUpdate: () => order.push("session"),
      session,
    });
    const prisma = buildVaultSyncUploadPrisma({ session, tx, order });
    mocks.encryptHostedWebNullableString.mockReturnValue("encrypted-vault-sync-payload");
    mocks.appendHostedMailboxEnvelopeTx.mockImplementation(async ({ envelope, tx: actualTx }) => {
      order.push("mailbox");
      expect(actualTx).toBe(tx);
      expect(envelope).toMatchObject({
        eventId: "vault-sync.import:vsi_123",
        kind: "vault.sync.import",
        userId: "member_123",
        vaultSync: {
          localManifestHash: "manifest-hash",
          sessionId: "vsi_123",
          sourceSchemaVersion: "murph.vault.v1",
          sourceVaultId: "vault_local",
          sourceVaultTitle: "Local Vault",
        },
      });
      return {
        dedupeConflict: false,
        duplicate: false,
        inserted: true,
        item: {},
      };
    });
    mocks.nudgeHostedRunnerBestEffort.mockImplementation(async () => {
      order.push("nudge");
    });

    await expect(completeHostedVaultSyncAgentUpload({
      bundleBase64: "AQID",
      localManifestHash: "manifest-hash",
      prisma,
      request: buildVaultSyncAgentRequest("vst_test_agent_token"),
      sessionId: "vsi_123",
      sourceSchemaVersion: "murph.vault.v1",
      sourceVaultId: "vault_local",
      sourceVaultTitle: "Local Vault",
    })).resolves.toEqual(expect.objectContaining({
      id: "vsi_123",
      localManifestHash: "manifest-hash",
      status: "queued",
    }));

    expect(tx.hostedVaultSyncSession.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        localManifestHash: "manifest-hash",
        status: "queued",
      }),
      where: expect.objectContaining({
        agentTokenHash: hashHostedVaultSyncSecret("vst_test_agent_token"),
        id: "vsi_123",
        memberId: "member_123",
        status: "exchanged",
      }),
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.nudgeHostedRunnerBestEffort).toHaveBeenCalledWith({
      context: "vault-sync.import",
      userId: "member_123",
    });
    expect(order).toEqual(["session", "payload", "mailbox", "commit", "nudge"]);
  });

  it("does not append a vault-sync mailbox item or nudge when the product mutation fails", async () => {
    const order: string[] = [];
    const session = buildVaultSyncAgentSession({
      agentTokenHash: hashHostedVaultSyncSecret("vst_test_agent_token"),
    });
    const tx = buildVaultSyncUploadTx({
      onPayload: () => order.push("payload"),
      onSessionUpdate: () => {
        order.push("session");
        throw new Error("session update failed");
      },
      session,
    });
    const prisma = buildVaultSyncUploadPrisma({ session, tx, order });
    mocks.encryptHostedWebNullableString.mockReturnValue("encrypted-vault-sync-payload");

    await expect(completeHostedVaultSyncAgentUpload({
      bundleBase64: "AQID",
      localManifestHash: "manifest-hash",
      prisma,
      request: buildVaultSyncAgentRequest("vst_test_agent_token"),
      sessionId: "vsi_123",
    })).rejects.toThrow("session update failed");

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerBestEffort).not.toHaveBeenCalled();
    expect(order).toEqual(["session"]);
  });

  it("does not recreate side input or mailbox rows when a concurrent upload already queued the session", async () => {
    const order: string[] = [];
    const session = buildVaultSyncAgentSession({
      agentTokenHash: hashHostedVaultSyncSecret("vst_test_agent_token"),
    });
    const queuedSession = {
      ...session,
      localManifestHash: "manifest-hash",
      queuedAt: new Date("2026-04-21T00:01:00.000Z"),
      status: "queued",
      uploadedAt: new Date("2026-04-21T00:01:00.000Z"),
    };
    const tx = buildVaultSyncUploadTx({
      onPayload: () => order.push("payload"),
      onSessionUpdate: () => order.push("session"),
      session,
      sessionUpdateCount: 0,
      staleClaimSession: queuedSession,
    });
    const prisma = buildVaultSyncUploadPrisma({ session, tx, order });
    mocks.encryptHostedWebNullableString.mockReturnValue("encrypted-vault-sync-payload");
    mocks.nudgeHostedRunnerBestEffort.mockImplementation(async () => {
      order.push("nudge");
    });

    await expect(completeHostedVaultSyncAgentUpload({
      bundleBase64: "AQID",
      localManifestHash: "manifest-hash",
      prisma,
      request: buildVaultSyncAgentRequest("vst_test_agent_token"),
      sessionId: "vsi_123",
    })).resolves.toEqual(expect.objectContaining({
      id: "vsi_123",
      status: "queued",
    }));

    expect(tx.hostedVaultSyncPayload.create).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerBestEffort).toHaveBeenCalledWith({
      context: "vault-sync.import",
      userId: "member_123",
    });
    expect(order).toEqual(["session", "commit", "nudge"]);
  });

  it("records runtime import completion and deletes the vault-sync side input in one transaction", async () => {
    const order: string[] = [];
    const tx = {
      hostedVaultSyncPayload: {
        deleteMany: vi.fn(async () => {
          order.push("delete-payload");
          return { count: 1 };
        }),
      },
      hostedVaultSyncSession: {
        updateMany: vi.fn(async () => {
          order.push("update-session");
          return { count: 1 };
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (actualTx: typeof tx) => Promise<unknown>) => {
        const result = await callback(tx);
        order.push("commit");
        return result;
      }),
    } as never;

    await expect(recordHostedVaultSyncImportResult({
      memberId: "member_123",
      prisma,
      request: {
        importedAt: "2026-04-21T00:02:00.000Z",
        sessionId: "vsi_123",
        status: "imported_with_conflicts",
        summary: {
          conflictCount: 2,
          importedJsonlRecords: 10,
          importedRawFiles: 1,
          importedTextFiles: 3,
          skippedDuplicates: 4,
          skippedExcludedFiles: 5,
        },
      },
    })).resolves.toEqual({
      recorded: true,
      sessionId: "vsi_123",
      status: "imported_with_conflicts",
    });

    expect(tx.hostedVaultSyncSession.updateMany).toHaveBeenCalledWith({
      data: {
        agentTokenHash: null,
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
    expect(tx.hostedVaultSyncPayload.deleteMany).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
        sessionId: "vsi_123",
      },
    });
    expect(order).toEqual(["update-session", "delete-payload", "commit"]);
  });

  it("does not delete vault-sync side input when the runtime import callback cannot claim the session", async () => {
    const tx = {
      hostedVaultSyncPayload: {
        deleteMany: vi.fn(),
      },
      hostedVaultSyncSession: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (actualTx: typeof tx) => Promise<unknown>) => callback(tx)),
    } as never;

    await expect(recordHostedVaultSyncImportResult({
      memberId: "member_123",
      prisma,
      request: {
        importedAt: "2026-04-21T00:02:00.000Z",
        sessionId: "vsi_123",
        status: "failed",
        summary: {
          conflictCount: 0,
          importedJsonlRecords: 0,
          importedRawFiles: 0,
          importedTextFiles: 0,
          skippedDuplicates: 0,
          skippedExcludedFiles: 0,
        },
      },
    })).resolves.toEqual({
      recorded: false,
      sessionId: "vsi_123",
      status: "failed",
    });

    expect(tx.hostedVaultSyncPayload.deleteMany).not.toHaveBeenCalled();
  });
});

function buildVaultSyncAgentRequest(agentToken: string): Request {
  return new Request("https://join.example.test/api/vault-sync/agent/sessions/vsi_123", {
    headers: {
      authorization: `Bearer ${agentToken}`,
    },
  });
}

function buildVaultSyncAgentSession(overrides: {
  agentTokenHash: string | null;
}) {
  return {
    agentTokenHash: overrides.agentTokenHash,
    createdAt: new Date("2026-04-21T00:00:00.000Z"),
    direction: "local_to_hosted",
    expiresAt: new Date("2099-04-21T01:00:00.000Z"),
    id: "vsi_123",
    localManifestHash: null,
    memberId: "member_123",
    pairingCodeHash: null,
    queuedAt: null,
    revokedAt: null,
    sourceSchemaVersion: null,
    sourceVaultId: null,
    sourceVaultTitle: null,
    status: "exchanged",
    updatedAt: new Date("2026-04-21T00:00:00.000Z"),
    uploadedAt: null,
  };
}

function buildVaultSyncAuthPrisma(session: ReturnType<typeof buildVaultSyncAgentSession>) {
  return {
    hostedVaultSyncSession: {
      findUnique: vi.fn().mockResolvedValue(session),
    },
  } as never;
}

function buildVaultSyncUploadTx(input: {
  onPayload: () => void;
  onSessionUpdate: () => void;
  session: ReturnType<typeof buildVaultSyncAgentSession>;
  sessionUpdateCount?: number;
  staleClaimSession?: object | null;
}) {
  return {
    hostedVaultSyncPayload: {
      create: vi.fn(async () => {
        input.onPayload();
      }),
    },
    hostedVaultSyncSession: {
      findFirst: vi.fn(async () => input.staleClaimSession ?? null),
      findUniqueOrThrow: vi.fn(async () => ({
        ...input.session,
        localManifestHash: "manifest-hash",
        queuedAt: new Date("2026-04-21T00:01:00.000Z"),
        sourceSchemaVersion: "murph.vault.v1",
        sourceVaultId: "vault_local",
        sourceVaultTitle: "Local Vault",
        status: "queued",
        updatedAt: new Date("2026-04-21T00:01:00.000Z"),
        uploadedAt: new Date("2026-04-21T00:01:00.000Z"),
      })),
      updateMany: vi.fn(async () => {
        input.onSessionUpdate();
        return { count: input.sessionUpdateCount ?? 1 };
      }),
    },
  };
}

function buildVaultSyncUploadPrisma(input: {
  order: string[];
  session: ReturnType<typeof buildVaultSyncAgentSession>;
  tx: ReturnType<typeof buildVaultSyncUploadTx>;
}) {
  return {
    $transaction: vi.fn(async (
      callback: (tx: ReturnType<typeof buildVaultSyncUploadTx>) => Promise<unknown>,
    ) => {
      const result = await callback(input.tx);
      input.order.push("commit");
      return result;
    }),
    hostedVaultSyncSession: {
      findUnique: vi.fn().mockResolvedValue(input.session),
    },
  } as never;
}
