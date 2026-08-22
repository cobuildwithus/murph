import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

const mocks = vi.hoisted(() => ({
  readHostedPrivyUserById: vi.fn(),
  resolveHostedPublicOrigin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  readHostedPrivyUserById: mocks.readHostedPrivyUserById,
}));
vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicOrigin: mocks.resolveHostedPublicOrigin,
}));

import {
  buildSensitiveActionMessage,
  buildSettingsSensitiveActionBinding,
  createSensitiveActionChallenge,
  verifyAndConsumeSensitiveActionChallenge,
} from "@/src/lib/sensitive-actions/server";

const PRIVATE_KEY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const account = privateKeyToAccount(PRIVATE_KEY);
const now = new Date("2026-06-24T12:00:00.000Z");

describe("sensitive action challenges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveHostedPublicOrigin.mockReturnValue("https://withmurph.ai");
    mocks.readHostedPrivyUserById.mockResolvedValue({
      id: "privy-user-123",
      linked_accounts: [
        {
          address: account.address,
          chain_type: "ethereum",
          connector_type: "embedded",
          type: "wallet",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
      mfa_methods: [{ type: "passkey" }],
    });
  });

  it("builds a deterministic session-bound settings binding and message", () => {
    const bindingHash = buildSettingsSensitiveActionBinding({
      kind: "vault.export",
      memberId: "member_123",
      sessionId: "session_123",
    });

    expect(bindingHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(buildSensitiveActionMessage({
      bindingHash,
      expiresAt: new Date("2026-06-24T12:15:00.000Z"),
      kind: "vault.export",
      origin: "https://withmurph.ai",
      token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
    })).toBe([
      "Murph sensitive action authorization",
      "Version: 1",
      "Origin: https://withmurph.ai",
      "Action: vault.export",
      `Binding: sha256:${bindingHash}`,
      "Challenge: sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
      "Expires At: 2026-06-24T12:15:00.000Z",
    ].join("\n"));
  });

  it("accepts one matching signature and rejects replay", async () => {
    const prisma = createPrismaFake();
    const bindingHash = buildSettingsSensitiveActionBinding({
      kind: "vault.export",
      memberId: "member_123",
      sessionId: "session_123",
    });
    const challenge = await createSensitiveActionChallenge({
      bindingHash,
      kind: "vault.export",
      memberId: "member_123",
      now,
      prisma,
    });
    const signature = await account.signMessage({ message: challenge.message });
    const input = {
      authorization: { signature, token: challenge.token },
      bindingHash,
      kind: "vault.export" as const,
      memberId: "member_123",
      now,
      prisma,
      privyUserId: "privy-user-123",
    };

    await expect(verifyAndConsumeSensitiveActionChallenge(input)).resolves.toBeUndefined();
    await expect(verifyAndConsumeSensitiveActionChallenge(input)).rejects.toMatchObject({
      code: "SENSITIVE_ACTION_UNAVAILABLE",
    });
  });

  it("rejects cross-action and cross-session bindings without consuming the challenge", async () => {
    const prisma = createPrismaFake();
    const bindingHash = buildSettingsSensitiveActionBinding({
      kind: "vault.export",
      memberId: "member_123",
      sessionId: "session_123",
    });
    const challenge = await createSensitiveActionChallenge({
      bindingHash,
      kind: "vault.export",
      memberId: "member_123",
      now,
      prisma,
    });
    const signature = await account.signMessage({ message: challenge.message });

    await expect(verifyAndConsumeSensitiveActionChallenge({
      authorization: { signature, token: challenge.token },
      bindingHash: buildSettingsSensitiveActionBinding({
        kind: "account.delete",
        memberId: "member_123",
        sessionId: "session_456",
      }),
      kind: "account.delete",
      memberId: "member_123",
      now,
      prisma,
      privyUserId: "privy-user-123",
    })).rejects.toMatchObject({ code: "SENSITIVE_ACTION_UNAVAILABLE" });

    expect(prisma.__rows.size).toBe(1);
  });

  it("rejects expired challenges before consulting Privy", async () => {
    const prisma = createPrismaFake();
    const bindingHash = buildSettingsSensitiveActionBinding({
      kind: "vault.export",
      memberId: "member_123",
      sessionId: "session_123",
    });
    const challenge = await createSensitiveActionChallenge({
      bindingHash,
      kind: "vault.export",
      memberId: "member_123",
      now,
      prisma,
    });
    const signature = await account.signMessage({ message: challenge.message });

    await expect(verifyAndConsumeSensitiveActionChallenge({
      authorization: { signature, token: challenge.token },
      bindingHash,
      kind: "vault.export",
      memberId: "member_123",
      now: new Date(now.getTime() + 16 * 60 * 1000),
      prisma,
      privyUserId: "privy-user-123",
    })).rejects.toMatchObject({ code: "SENSITIVE_ACTION_UNAVAILABLE" });

    expect(mocks.readHostedPrivyUserById).not.toHaveBeenCalled();
    expect(prisma.__rows.size).toBe(1);
  });

  it("leaves unrelated expired challenges for the bounded retention owner", async () => {
    const prisma = createPrismaFake();
    const bindingHash = buildSettingsSensitiveActionBinding({
      kind: "vault.export",
      memberId: "member_123",
      sessionId: "session_123",
    });
    await createSensitiveActionChallenge({
      bindingHash,
      kind: "vault.export",
      memberId: "member_123",
      now,
      prisma,
    });
    await createSensitiveActionChallenge({
      bindingHash,
      kind: "vault.export",
      memberId: "member_123",
      now: new Date(now.getTime() + 16 * 60 * 1000),
      prisma,
    });

    expect(prisma.__rows.size).toBe(2);
  });

  it("allows exactly one concurrent consume", async () => {
    const prisma = createPrismaFake();
    const bindingHash = buildSettingsSensitiveActionBinding({
      kind: "vault.export",
      memberId: "member_123",
      sessionId: "session_123",
    });
    const challenge = await createSensitiveActionChallenge({
      bindingHash,
      kind: "vault.export",
      memberId: "member_123",
      now,
      prisma,
    });
    const signature = await account.signMessage({ message: challenge.message });
    const input = {
      authorization: { signature, token: challenge.token },
      bindingHash,
      kind: "vault.export" as const,
      memberId: "member_123",
      now,
      prisma,
      privyUserId: "privy-user-123",
    };

    const results = await Promise.allSettled([
      verifyAndConsumeSensitiveActionChallenge(input),
      verifyAndConsumeSensitiveActionChallenge(input),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(prisma.__rows.size).toBe(0);
  });

  it("does not consume when the Privy lookup is unavailable", async () => {
    const prisma = createPrismaFake();
    mocks.readHostedPrivyUserById.mockRejectedValueOnce(new Error("provider unavailable"));
    const bindingHash = buildSettingsSensitiveActionBinding({
      kind: "account.delete",
      memberId: "member_123",
      sessionId: "session_123",
    });
    const challenge = await createSensitiveActionChallenge({
      bindingHash,
      kind: "account.delete",
      memberId: "member_123",
      now,
      prisma,
    });
    const signature = await account.signMessage({ message: challenge.message });

    await expect(verifyAndConsumeSensitiveActionChallenge({
      authorization: { signature, token: challenge.token },
      bindingHash,
      kind: "account.delete",
      memberId: "member_123",
      now,
      prisma,
      privyUserId: "privy-user-123",
    })).rejects.toMatchObject({ code: "SENSITIVE_ACTION_PROVIDER_UNAVAILABLE" });

    expect(prisma.__rows.size).toBe(1);
  });

  it("does not consume a challenge signed by another wallet", async () => {
    const prisma = createPrismaFake();
    const bindingHash = buildSettingsSensitiveActionBinding({
      kind: "account.delete",
      memberId: "member_123",
      sessionId: "session_123",
    });
    const challenge = await createSensitiveActionChallenge({
      bindingHash,
      kind: "account.delete",
      memberId: "member_123",
      now,
      prisma,
    });
    const other = privateKeyToAccount(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const,
    );
    const signature = await other.signMessage({ message: challenge.message });

    await expect(verifyAndConsumeSensitiveActionChallenge({
      authorization: { signature, token: challenge.token },
      bindingHash,
      kind: "account.delete",
      memberId: "member_123",
      now,
      prisma,
      privyUserId: "privy-user-123",
    })).rejects.toMatchObject({ code: "SENSITIVE_ACTION_INVALID_SIGNATURE" });

    expect(prisma.__rows.size).toBe(1);
  });

  it("fails closed when passkey-only MFA is not enrolled", async () => {
    const prisma = createPrismaFake();
    mocks.readHostedPrivyUserById.mockResolvedValueOnce({
      id: "privy-user-123",
      linked_accounts: [{
        address: account.address,
        chain_type: "ethereum",
        connector_type: "embedded",
        type: "wallet",
        wallet_client_type: "privy",
        wallet_index: 0,
      }],
      mfa_methods: [{ type: "passkey" }, { type: "sms" }],
    });
    const bindingHash = buildSettingsSensitiveActionBinding({
      kind: "vault.export",
      memberId: "member_123",
      sessionId: "session_123",
    });
    const challenge = await createSensitiveActionChallenge({
      bindingHash,
      kind: "vault.export",
      memberId: "member_123",
      now,
      prisma,
    });
    const signature = await account.signMessage({ message: challenge.message });

    await expect(verifyAndConsumeSensitiveActionChallenge({
      authorization: { signature, token: challenge.token },
      bindingHash,
      kind: "vault.export",
      memberId: "member_123",
      now,
      prisma,
      privyUserId: "privy-user-123",
    })).rejects.toMatchObject({ code: "SENSITIVE_ACTION_SETUP_REQUIRED" });
    expect(prisma.__rows.size).toBe(1);
  });
});

function createPrismaFake() {
  type Row = {
    bindingHash: string;
    createdAt: Date;
    expiresAt: Date;
    kind: string;
    memberId: string;
    tokenHash: string;
  };
  const rows = new Map<string, Row>();
  const prisma = {
    __rows: rows,
    async $transaction<T>(callback: (tx: PrismaClient) => Promise<T>) {
      return callback(prisma as unknown as PrismaClient);
    },
    hostedSensitiveActionChallenge: {
      async create({ data }: { data: Row }) {
        rows.set(data.tokenHash, data);
        return data;
      },
      async deleteMany({ where }: {
        where: {
          bindingHash?: string;
          expiresAt?: { gt?: Date; lte?: Date };
          kind?: string;
          memberId?: string;
          tokenHash?: string;
        };
      }) {
        let count = 0;
        for (const [tokenHash, row] of rows) {
          const matchesExpiryCleanup = where.expiresAt?.lte instanceof Date
            && row.expiresAt <= where.expiresAt.lte;
          const matchesExact = where.tokenHash === tokenHash
            && (!where.memberId || where.memberId === row.memberId)
            && (!where.kind || where.kind === row.kind)
            && (!where.bindingHash || where.bindingHash === row.bindingHash)
            && (!(where.expiresAt?.gt instanceof Date) || row.expiresAt > where.expiresAt.gt);
          if (matchesExpiryCleanup || matchesExact) {
            rows.delete(tokenHash);
            count += 1;
          }
        }
        return { count };
      },
      async findUnique({ where }: { where: { tokenHash: string } }) {
        return rows.get(where.tokenHash) ?? null;
      },
    },
  };
  return prisma as unknown as PrismaClient & { __rows: Map<string, Row> };
}
