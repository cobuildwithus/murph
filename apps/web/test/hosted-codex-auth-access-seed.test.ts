import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_CODEX_AUTH_ACCESS_SEED_MAX_REMAINING_MS,
  HOSTED_CODEX_AUTH_ACCESS_SEED_MIN_REMAINING_MS,
  HOSTED_CODEX_AUTH_ACCESS_TOKEN_MAX_LENGTH,
  hostedCodexAuthAccessSeedCrypto,
  hostedCodexAuthAccessSeedHasUsableLifetime,
  parseHostedCodexAuthAccessSeedSubmission,
} from "@/src/lib/codex-auth/access-seed";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-07-21T20:00:00.000Z");
const ATTEMPT_ID = "hca_abcdefghijklmnop";

afterEach(() => {
  setHostedSecureBoxStringTestCodecForTests(null);
});

describe("hosted Codex auth access seed", () => {
  it("accepts only the exact bounded v1 access-token payload", () => {
    expect(parseHostedCodexAuthAccessSeedSubmission(validSubmission(), NOW)).toEqual({
      accessToken: "synthetic-access-value",
      chatgptAccountId: "account_123",
      expiresAt: new Date("2026-07-21T21:00:00.000Z"),
      schemaVersion: 1,
    });
    expect(parseHostedCodexAuthAccessSeedSubmission(validSubmission({
      accessToken: "a".repeat(HOSTED_CODEX_AUTH_ACCESS_TOKEN_MAX_LENGTH),
      expiresAt: new Date(
        NOW.getTime() + HOSTED_CODEX_AUTH_ACCESS_SEED_MIN_REMAINING_MS,
      ).toISOString(),
    }), NOW).accessToken).toHaveLength(HOSTED_CODEX_AUTH_ACCESS_TOKEN_MAX_LENGTH);

    for (const invalid of [
      validSubmission({ refreshToken: "forbidden" }),
      validSubmission({ idToken: "forbidden" }),
      validSubmission({ accessToken: "a".repeat(HOSTED_CODEX_AUTH_ACCESS_TOKEN_MAX_LENGTH + 1) }),
      validSubmission({ accessToken: "contains whitespace" }),
      validSubmission({ chatgptAccountId: "account\ncontrol" }),
      validSubmission({ schemaVersion: 2 }),
      validSubmission({ expiresAt: "2026-07-21T16:30:00.000-04:00" }),
      validSubmission({ expiresAt: "2026-02-30T20:30:00.000Z" }),
      validSubmission({
        expiresAt: new Date(
          NOW.getTime() + HOSTED_CODEX_AUTH_ACCESS_SEED_MIN_REMAINING_MS - 1,
        ).toISOString(),
      }),
      validSubmission({
        expiresAt: new Date(
          NOW.getTime() + HOSTED_CODEX_AUTH_ACCESS_SEED_MAX_REMAINING_MS + 1,
        ).toISOString(),
      }),
    ]) {
      expect(() => parseHostedCodexAuthAccessSeedSubmission(invalid, NOW)).toThrow(
        "ChatGPT credential is invalid.",
      );
    }
  });

  it("does not echo rejected credential values", () => {
    const sentinel = "sensitive-sentinel-that-must-not-echo";
    let error: unknown;
    try {
      parseHostedCodexAuthAccessSeedSubmission(validSubmission({
        accessToken: `${sentinel}\n`,
      }), NOW);
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).not.toContain(sentinel);
  });

  it("binds one exact encrypted token/account payload to member, field, and attempt", async () => {
    const encrypt = vi.fn((input: { value: string }) => `ciphertext:${input.value.length}`);
    const decrypt = vi.fn(() => JSON.stringify({
      accessToken: "synthetic-access-value",
      chatgptAccountId: "account_123",
      schemaVersion: 1,
    }));
    setHostedSecureBoxStringTestCodecForTests({ decrypt, encrypt });
    const prisma = codexAuthSeedPrismaForTest();

    const ciphertext = await hostedCodexAuthAccessSeedCrypto.encrypt({
      attemptId: ATTEMPT_ID,
      memberId: "member_123",
      prisma,
      value: {
        accessToken: "synthetic-access-value",
        chatgptAccountId: "account_123",
        schemaVersion: 1,
      },
    });
    expect(ciphertext).toMatch(/^ciphertext:/u);
    expect(encrypt).toHaveBeenCalledWith({
      aad: {
        field: "access_seed_encrypted",
        purpose: "hosted-codex-auth-access-seed",
        rowId: "member_123",
        sequence: ATTEMPT_ID,
        table: "hosted_codex_auth_connection",
      },
      lane: "hosted-member-private-field",
      scope: "hosted-codex-auth:access-seed:v1",
      userId: "member_123",
      value: JSON.stringify({
        accessToken: "synthetic-access-value",
        chatgptAccountId: "account_123",
        schemaVersion: 1,
      }),
    });

    await expect(hostedCodexAuthAccessSeedCrypto.decrypt({
      attemptId: ATTEMPT_ID,
      memberId: "member_123",
      prisma,
      value: ciphertext,
    })).resolves.toEqual({
      accessToken: "synthetic-access-value",
      chatgptAccountId: "account_123",
      schemaVersion: 1,
    });
    expect(decrypt).toHaveBeenCalledWith(expect.objectContaining({
      aad: expect.objectContaining({
        rowId: "member_123",
        sequence: ATTEMPT_ID,
      }),
      value: ciphertext,
    }));
  });

  it("rejects decrypted payload drift and enforces the full persisted lifetime window", async () => {
    setHostedSecureBoxStringTestCodecForTests({
      decrypt: () => JSON.stringify({
        accessToken: "synthetic-access-value",
        chatgptAccountId: "account_123",
        refreshToken: "forbidden",
        schemaVersion: 1,
      }),
      encrypt: () => "ciphertext",
    });

    await expect(hostedCodexAuthAccessSeedCrypto.decrypt({
      attemptId: ATTEMPT_ID,
      memberId: "member_123",
      prisma: codexAuthSeedPrismaForTest(),
      value: "ciphertext",
    })).rejects.toThrow("Hosted Codex auth access seed plaintext is invalid.");
    expect(hostedCodexAuthAccessSeedHasUsableLifetime(
      new Date(NOW.getTime() + HOSTED_CODEX_AUTH_ACCESS_SEED_MIN_REMAINING_MS),
      NOW,
    )).toBe(true);
    expect(hostedCodexAuthAccessSeedHasUsableLifetime(
      new Date(NOW.getTime() + HOSTED_CODEX_AUTH_ACCESS_SEED_MAX_REMAINING_MS),
      NOW,
    )).toBe(true);
    expect(hostedCodexAuthAccessSeedHasUsableLifetime(
      new Date(NOW.getTime() + HOSTED_CODEX_AUTH_ACCESS_SEED_MAX_REMAINING_MS + 1),
      NOW,
    )).toBe(false);
    expect(hostedCodexAuthAccessSeedHasUsableLifetime(new Date(Number.NaN), NOW)).toBe(false);
  });
});

function validSubmission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    accessToken: "synthetic-access-value",
    chatgptAccountId: "account_123",
    expiresAt: "2026-07-21T21:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

function codexAuthSeedPrismaForTest(): Parameters<
  typeof hostedCodexAuthAccessSeedCrypto.encrypt
>[0]["prisma"] {
  // The configured test codec returns before the secure-box code touches Prisma.
  return {} as Parameters<typeof hostedCodexAuthAccessSeedCrypto.encrypt>[0]["prisma"];
}
