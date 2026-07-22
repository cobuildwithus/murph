import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyHostedCodexAuthUpdate,
  beginHostedCodexAuthAccessSeedAttempt,
  beginHostedCodexAuthAttempt,
  disconnectHostedCodexAuthAccessSeed,
  markHostedCodexAuthAccessSeedDisconnected,
  markHostedCodexAuthAccessSeedReady,
  readHostedCodexAuthAccessSeedForRuntime,
  readHostedCodexAuthCompanionView,
  readHostedCodexAuthConnectionView,
} from "@/src/lib/codex-auth/store";
import {
  HostedCodexAuthAccessSeedPayloadError,
  type HostedCodexAuthAccessSeedCrypto,
} from "@/src/lib/codex-auth/access-seed";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  lockHostedMemberSponsoredAccessRows: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/src/lib/hosted-onboarding/shared")>();
  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
    lockHostedMemberSponsoredAccessRows: mocks.lockHostedMemberSponsoredAccessRows,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed: mocks.assertActiveHostedMemberAccessAllowed,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
}));

type CodexAuthPrismaForTest = NonNullable<
  Parameters<typeof beginHostedCodexAuthAttempt>[0]["prisma"]
>;

interface StoredCodexAuthConnection {
  accessSeedEncrypted: string | null;
  accessSeedExpiresAt: Date | null;
  attemptId: string;
  memberId: string;
  state: string;
  updatedAt: Date;
  userCode: string | null;
  verificationUrl: string | null;
}

type StoredCodexAuthConnectionInput = Omit<
  StoredCodexAuthConnection,
  "accessSeedEncrypted" | "accessSeedExpiresAt"
> & Partial<Pick<
  StoredCodexAuthConnection,
  "accessSeedEncrypted" | "accessSeedExpiresAt"
>>;

interface StoredCodexAuthConnectionUpdate {
  accessSeedEncrypted?: string | null;
  accessSeedExpiresAt?: Date | null;
  attemptId?: string;
  state?: string;
  updatedAt?: Date;
  userCode?: string | null;
  verificationUrl?: string | null;
}

interface CodexAuthWhere {
  accessSeedEncrypted?: null | { not: null };
  accessSeedExpiresAt?: null | { not: null } | { gte: Date; lte: Date };
  attemptId?: string;
  memberId: string;
  state?: string | { in: readonly string[] };
}

describe("hosted Codex auth store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedMailboxEnvelopeTx.mockImplementation(async () => ({
      item: {
        id: "mailbox_item_codex_auth",
      },
    }));
    mocks.assertActiveHostedMemberAccessAllowed.mockResolvedValue(undefined);
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.lockHostedMemberSponsoredAccessRows.mockResolvedValue(undefined);
    mocks.readHostedMailboxItemByDedupeKey.mockImplementation(async () => ({
      id: "mailbox_item_codex_auth",
    }));
  });

  it("dedupes fresh connect attempts and replaces stale ones with a new runtime wake", async () => {
    const now = new Date("2026-06-23T12:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness();

    const first = await beginHostedCodexAuthAttempt({
      action: "connect",
      memberId: "member_123",
      now,
      prisma: prisma.client,
    });

    expect(first.attemptId).toMatch(/^hca_[A-Za-z0-9_-]{16,64}$/u);
    expect(first.mailboxItemId).toBe("mailbox_item_codex_auth");
    expect(first.view).toEqual({
      state: "connecting",
      userCode: null,
      verificationUrl: null,
    });
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(prisma.tx, "member_123");
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        action: "connect",
        attemptId: first.attemptId,
        eventId: `codex-auth:connect:${first.attemptId}`,
        kind: "runtime.codex-auth-requested",
        occurredAt: "2026-06-23T12:00:00.000Z",
        userId: "member_123",
      }),
      tx: prisma.tx,
    });

    const retry = await beginHostedCodexAuthAttempt({
      action: "connect",
      memberId: "member_123",
      now: new Date("2026-06-23T12:01:00.000Z"),
      prisma: prisma.client,
    });

    expect(retry).toEqual({
      attemptId: first.attemptId,
      mailboxItemId: "mailbox_item_codex_auth",
      view: {
        state: "connecting",
        userCode: null,
        verificationUrl: null,
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMailboxItemByDedupeKey).toHaveBeenCalledWith({
      dedupeKey: `codex-auth:connect:${first.attemptId}`,
      prisma: prisma.tx,
      userId: "member_123",
    });

    prisma.setRecord({
      ...prisma.getRecord()!,
      updatedAt: new Date("2026-06-23T11:44:59.999Z"),
      userCode: "STALE-CODE",
      verificationUrl: "https://auth.openai.com/device",
    });

    const replacement = await beginHostedCodexAuthAttempt({
      action: "connect",
      memberId: "member_123",
      now,
      prisma: prisma.client,
    });

    expect(replacement.attemptId).not.toBe(first.attemptId);
    expect(replacement.mailboxItemId).toBe("mailbox_item_codex_auth");
    expect(prisma.getRecord()).toMatchObject({
      attemptId: replacement.attemptId,
      state: "connecting",
      userCode: null,
      verificationUrl: null,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
  });

  it("rotates every disconnect fence and clears any stored seed before waking runtime", async () => {
    const prisma = createCodexAuthPrismaHarness({
      accessSeedEncrypted: "encrypted-seed",
      accessSeedExpiresAt: new Date("2026-06-23T13:00:00.000Z"),
      attemptId: "hca_disconnectattempt",
      memberId: "member_123",
      state: "disconnecting",
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
      userCode: null,
      verificationUrl: null,
    });

    const retry = await beginHostedCodexAuthAttempt({
      action: "disconnect",
      memberId: "member_123",
      now: new Date("2026-06-23T12:01:00.000Z"),
      prisma: prisma.client,
    });

    expect(retry).toEqual({
      attemptId: expect.stringMatching(/^hca_[A-Za-z0-9_-]{16,64}$/u),
      mailboxItemId: "mailbox_item_codex_auth",
      view: { state: "disconnecting" },
    });
    expect(retry.attemptId).not.toBe("hca_disconnectattempt");
    expect(prisma.getRecord()).toMatchObject({
      accessSeedEncrypted: null,
      accessSeedExpiresAt: null,
      attemptId: retry.attemptId,
      state: "disconnecting",
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMailboxItemByDedupeKey).not.toHaveBeenCalled();
  });

  it("reuses a fresh legacy disconnect wake when no access seed remains", async () => {
    const prisma = createCodexAuthPrismaHarness({
      attemptId: "hca_disconnectattempt",
      memberId: "member_123",
      state: "disconnecting",
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
      userCode: null,
      verificationUrl: null,
    });

    const retry = await beginHostedCodexAuthAttempt({
      action: "disconnect",
      memberId: "member_123",
      now: new Date("2026-06-23T12:01:00.000Z"),
      prisma: prisma.client,
    });

    expect(retry).toEqual({
      attemptId: "hca_disconnectattempt",
      mailboxItemId: "mailbox_item_codex_auth",
      view: { state: "disconnecting" },
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxItemByDedupeKey).toHaveBeenCalledWith({
      dedupeKey: "codex-auth:disconnect:hca_disconnectattempt",
      prisma: prisma.tx,
      userId: "member_123",
    });
  });

  it("stores each companion seed behind a fresh opaque fence after locked authority checks", async () => {
    const now = new Date("2026-07-21T20:00:00.000Z");
    const expiresAt = new Date("2026-07-21T21:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness();
    const crypto = createAccessSeedCrypto();

    const first = await beginHostedCodexAuthAccessSeedAttempt({
      crypto,
      memberId: "member_123",
      now,
      prisma: prisma.client,
      seed: {
        accessToken: "synthetic-access-value",
        chatgptAccountId: "account_123",
        expiresAt,
        schemaVersion: 1,
      },
    });

    expect(first).toEqual({
      attemptId: expect.stringMatching(/^hca_[A-Za-z0-9_-]{16,64}$/u),
      view: {
        connectionVersion: first.attemptId,
        expiresAt: expiresAt.toISOString(),
        schemaVersion: 1,
        state: "connecting",
      },
    });
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(prisma.tx, "member_123");
    expect(mocks.lockHostedMemberSponsoredAccessRows).toHaveBeenCalledWith(
      prisma.tx,
      "member_123",
    );
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.tx,
    });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.tx,
    });
    expect(crypto.encrypt).toHaveBeenCalledWith({
      attemptId: first.attemptId,
      memberId: "member_123",
      prisma: prisma.tx,
      value: {
        accessToken: "synthetic-access-value",
        chatgptAccountId: "account_123",
        schemaVersion: 1,
      },
    });
    expect(prisma.getRecord()).toMatchObject({
      accessSeedEncrypted: `encrypted:${first.attemptId}`,
      accessSeedExpiresAt: expiresAt,
      attemptId: first.attemptId,
      state: "connecting",
      userCode: null,
      verificationUrl: null,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();

    const replacement = await beginHostedCodexAuthAccessSeedAttempt({
      crypto,
      memberId: "member_123",
      now,
      prisma: prisma.client,
      seed: {
        accessToken: "replacement-access-value",
        chatgptAccountId: "account_456",
        expiresAt,
        schemaVersion: 1,
      },
    });
    expect(replacement.attemptId).not.toBe(first.attemptId);
    expect(prisma.getRecord()?.attemptId).toBe(replacement.attemptId);
  });

  it("rechecks the expiry floor at the locked write boundary", async () => {
    const now = new Date("2026-07-21T20:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness();
    const crypto = createAccessSeedCrypto();

    await expect(beginHostedCodexAuthAccessSeedAttempt({
      crypto,
      memberId: "member_123",
      now,
      prisma: prisma.client,
      seed: {
        accessToken: "synthetic-access-value",
        chatgptAccountId: "account_123",
        expiresAt: new Date("2026-07-21T20:04:59.999Z"),
        schemaVersion: 1,
      },
    })).rejects.toMatchObject({
      code: "HOSTED_CODEX_AUTH_ACCESS_SEED_INVALID",
    });
    expect(crypto.encrypt).toHaveBeenCalledTimes(1);
    expect(prisma.getRecord()).toBeNull();
  });

  it("acknowledges readiness only for the same usable seed fence", async () => {
    const now = new Date("2026-07-21T20:00:00.000Z");
    const expiresAt = new Date("2026-07-21T21:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness();
    const crypto = createAccessSeedCrypto();
    const first = await beginHostedCodexAuthAccessSeedAttempt({
      crypto,
      memberId: "member_123",
      now,
      prisma: prisma.client,
      seed: accessSeedForStore(expiresAt),
    });
    const replacement = await beginHostedCodexAuthAccessSeedAttempt({
      crypto,
      memberId: "member_123",
      now,
      prisma: prisma.client,
      seed: accessSeedForStore(expiresAt),
    });

    await expect(markHostedCodexAuthAccessSeedReady({
      attemptId: first.attemptId,
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toBeNull();
    expect(prisma.getRecord()).toMatchObject({
      attemptId: replacement.attemptId,
      state: "connecting",
    });

    await expect(markHostedCodexAuthAccessSeedReady({
      attemptId: replacement.attemptId,
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toMatchObject({
      connectionVersion: replacement.attemptId,
      state: "connected",
    });
    await expect(markHostedCodexAuthAccessSeedReady({
      attemptId: replacement.attemptId,
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toMatchObject({
      connectionVersion: replacement.attemptId,
      state: "connected",
    });
  });

  it("authenticates the encrypted seed on every runtime read and fails closed for drift", async () => {
    const now = new Date("2026-07-21T20:00:00.000Z");
    const expiresAt = new Date("2026-07-21T21:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness({
      accessSeedEncrypted: "encrypted:hca_seedattempt12345",
      accessSeedExpiresAt: expiresAt,
      attemptId: "hca_seedattempt12345",
      memberId: "member_123",
      state: "connected",
      updatedAt: now,
      userCode: null,
      verificationUrl: null,
    });
    const crypto = createAccessSeedCrypto();

    await expect(readHostedCodexAuthAccessSeedForRuntime({
      crypto,
      includeCredentials: true,
      knownConnectionVersion: null,
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      accessToken: "synthetic-access-value",
      chatgptAccountId: "account_123",
      connectionVersion: "hca_seedattempt12345",
      expiresAt: expiresAt.toISOString(),
      schemaVersion: 1,
      status: "available",
    });
    expect(crypto.decrypt).toHaveBeenCalledTimes(1);

    await expect(readHostedCodexAuthAccessSeedForRuntime({
      crypto,
      includeCredentials: true,
      knownConnectionVersion: "hca_seedattempt12345",
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: "hca_seedattempt12345",
      schemaVersion: 1,
      status: "unchanged",
    });
    expect(crypto.decrypt).toHaveBeenCalledTimes(2);

    crypto.decrypt.mockRejectedValueOnce(new HostedCodexAuthAccessSeedPayloadError());
    await expect(readHostedCodexAuthAccessSeedForRuntime({
      crypto,
      includeCredentials: true,
      knownConnectionVersion: "hca_seedattempt12345",
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: "hca_seedattempt12345",
      reason: "needs_attention",
      schemaVersion: 1,
      status: "unavailable",
    });
    expect(crypto.decrypt).toHaveBeenCalledTimes(3);

    prisma.setRecord({
      ...prisma.getRecord()!,
      accessSeedExpiresAt: new Date("2026-07-21T22:00:00.001Z"),
    });
    await expect(readHostedCodexAuthAccessSeedForRuntime({
      crypto,
      includeCredentials: true,
      knownConnectionVersion: null,
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: "hca_seedattempt12345",
      reason: "needs_attention",
      schemaVersion: 1,
      status: "unavailable",
    });
  });

  it("returns only connection metadata without decrypting credential plaintext", async () => {
    const now = new Date("2026-07-21T20:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness({
      accessSeedEncrypted: "encrypted:hca_metadataonly123",
      accessSeedExpiresAt: new Date("2026-07-21T21:00:00.000Z"),
      attemptId: "hca_metadataonly123",
      memberId: "member_123",
      state: "connected",
      updatedAt: now,
      userCode: null,
      verificationUrl: null,
    });
    const crypto = createAccessSeedCrypto();

    await expect(readHostedCodexAuthAccessSeedForRuntime({
      crypto,
      includeCredentials: false,
      knownConnectionVersion: "hca_metadataonly123",
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: "hca_metadataonly123",
      schemaVersion: 1,
      status: "available_metadata",
    });
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it("projects an expired server lease as off so the phone can safely reseed it", async () => {
    const now = new Date("2026-07-21T20:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness({
      accessSeedEncrypted: "encrypted:hca_expiredlease123",
      accessSeedExpiresAt: new Date("2026-07-21T20:04:59.999Z"),
      attemptId: "hca_expiredlease123",
      memberId: "member_123",
      state: "connected",
      updatedAt: now,
      userCode: null,
      verificationUrl: null,
    });
    const crypto = createAccessSeedCrypto();

    await expect(readHostedCodexAuthCompanionView({
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: "hca_expiredlease123",
      expiresAt: null,
      schemaVersion: 1,
      state: "off",
    });
    await expect(readHostedCodexAuthAccessSeedForRuntime({
      crypto,
      includeCredentials: true,
      knownConnectionVersion: null,
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: "hca_expiredlease123",
      reason: "expired",
      schemaVersion: 1,
      status: "unavailable",
    });
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it.each([
    {
      accessSeedEncrypted: "encrypted:hca_ciphertextonly",
      accessSeedExpiresAt: null,
      expectedExpiresAt: null,
      label: "ciphertext-only",
    },
    {
      accessSeedEncrypted: null,
      accessSeedExpiresAt: new Date("2026-07-21T21:00:00.000Z"),
      expectedExpiresAt: "2026-07-21T21:00:00.000Z",
      label: "expiry-only",
    },
  ])("fails closed on a $label seed pair without decrypting", async ({
    accessSeedEncrypted,
    accessSeedExpiresAt,
    expectedExpiresAt,
  }) => {
    const now = new Date("2026-07-21T20:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness({
      accessSeedEncrypted,
      accessSeedExpiresAt,
      attemptId: "hca_incompleteseed12",
      memberId: "member_123",
      state: "connected",
      updatedAt: now,
      userCode: null,
      verificationUrl: null,
    });
    const crypto = createAccessSeedCrypto();

    await expect(readHostedCodexAuthCompanionView({
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: "hca_incompleteseed12",
      expiresAt: expectedExpiresAt,
      schemaVersion: 1,
      state: "needs_attention",
    });
    await expect(readHostedCodexAuthAccessSeedForRuntime({
      crypto,
      includeCredentials: true,
      knownConnectionVersion: null,
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: "hca_incompleteseed12",
      reason: "needs_attention",
      schemaVersion: 1,
      status: "unavailable",
    });
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it("returns token-free needs-attention when access or consent is revoked", async () => {
    const now = new Date("2026-07-21T20:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness({
      accessSeedEncrypted: "encrypted:hca_policyseed123456",
      accessSeedExpiresAt: new Date("2026-07-21T21:00:00.000Z"),
      attemptId: "hca_policyseed123456",
      memberId: "member_123",
      state: "connected",
      updatedAt: now,
      userCode: null,
      verificationUrl: null,
    });
    const crypto = createAccessSeedCrypto();
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Hosted access is required.",
    }));

    await expect(readHostedCodexAuthAccessSeedForRuntime({
      crypto,
      includeCredentials: true,
      knownConnectionVersion: null,
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: "hca_policyseed123456",
      reason: "needs_attention",
      schemaVersion: 1,
      status: "unavailable",
    });
    expect(crypto.decrypt).not.toHaveBeenCalled();
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();

    mocks.assertHostedLaunchRequiredConsentGranted.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Hosted consent is required.",
    }));
    await expect(readHostedCodexAuthAccessSeedForRuntime({
      crypto,
      includeCredentials: true,
      knownConnectionVersion: null,
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: "hca_policyseed123456",
      reason: "needs_attention",
      schemaVersion: 1,
      status: "unavailable",
    });
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it("returns unconfigured without auth-policy checks when no connection exists", async () => {
    const prisma = createCodexAuthPrismaHarness(null);
    const crypto = createAccessSeedCrypto();
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Hosted access is required.",
    }));

    await expect(readHostedCodexAuthAccessSeedForRuntime({
      crypto,
      includeCredentials: true,
      knownConnectionVersion: null,
      memberId: "member_123",
      now: new Date("2026-07-21T20:00:00.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: null,
      reason: "unconfigured",
      schemaVersion: 1,
      status: "unavailable",
    });
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "disconnected",
      record: {
        attemptId: "hca_disconnectedpolicy",
        memberId: "member_123",
        state: "disconnected",
        updatedAt: new Date("2026-07-21T20:00:00.000Z"),
        userCode: null,
        verificationUrl: null,
      },
      version: "hca_disconnectedpolicy",
    },
    {
      label: "legacy device code",
      record: {
        attemptId: "hca_legacydevicepolicy",
        memberId: "member_123",
        state: "connecting",
        updatedAt: new Date("2026-07-21T20:00:00.000Z"),
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.openai.com/device",
      },
      version: "hca_legacydevicepolicy",
    },
  ])("checks policy before returning a $label seed mode", async ({ record, version }) => {
    const prisma = createCodexAuthPrismaHarness(record);
    const crypto = createAccessSeedCrypto();
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Hosted access is required.",
    }));

    await expect(readHostedCodexAuthAccessSeedForRuntime({
      crypto,
      includeCredentials: true,
      knownConnectionVersion: null,
      memberId: "member_123",
      now: new Date("2026-07-21T20:00:00.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: version,
      reason: "needs_attention",
      schemaVersion: 1,
      status: "unavailable",
    });
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it("rechecks lifetime after decrypt and preserves transient crypto failures as retryable errors", async () => {
    const now = new Date("2026-07-21T20:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness({
      accessSeedEncrypted: "encrypted:hca_boundaryseed1234",
      accessSeedExpiresAt: new Date("2026-07-21T20:05:00.000Z"),
      attemptId: "hca_boundaryseed1234",
      memberId: "member_123",
      state: "connected",
      updatedAt: now,
      userCode: null,
      verificationUrl: null,
    });
    const crypto = createAccessSeedCrypto();
    const clock = vi.fn()
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(new Date("2026-07-21T20:00:00.001Z"));

    await expect(readHostedCodexAuthAccessSeedForRuntime({
      clock,
      crypto,
      includeCredentials: true,
      knownConnectionVersion: null,
      memberId: "member_123",
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: "hca_boundaryseed1234",
      reason: "expired",
      schemaVersion: 1,
      status: "unavailable",
    });
    expect(crypto.decrypt).toHaveBeenCalledTimes(1);

    const transientCrypto = createAccessSeedCrypto();
    transientCrypto.decrypt.mockRejectedValueOnce(new Error("crypto service unavailable"));
    await expect(readHostedCodexAuthAccessSeedForRuntime({
      crypto: transientCrypto,
      includeCredentials: true,
      knownConnectionVersion: null,
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).rejects.toThrow("crypto service unavailable");
  });

  it("rotates and clears companion authority before an asynchronous disconnect recheck", async () => {
    const now = new Date("2026-07-21T20:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness({
      accessSeedEncrypted: "encrypted:hca_oldseedattempt",
      accessSeedExpiresAt: new Date("2026-07-21T21:00:00.000Z"),
      attemptId: "hca_oldseedattempt",
      memberId: "member_123",
      state: "connected",
      updatedAt: now,
      userCode: null,
      verificationUrl: null,
    });

    const disconnect = await disconnectHostedCodexAuthAccessSeed({
      memberId: "member_123",
      now,
      prisma: prisma.client,
    });
    expect(disconnect.attemptId).not.toBe("hca_oldseedattempt");
    expect(disconnect.view).toMatchObject({
      connectionVersion: disconnect.attemptId,
      state: "disconnecting",
    });
    expect(prisma.getRecord()).toMatchObject({
      accessSeedEncrypted: null,
      accessSeedExpiresAt: null,
      attemptId: disconnect.attemptId,
      state: "disconnecting",
    });

    await expect(markHostedCodexAuthAccessSeedDisconnected({
      attemptId: disconnect.attemptId,
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: disconnect.attemptId,
      expiresAt: null,
      schemaVersion: 1,
      state: "off",
    });
    await expect(markHostedCodexAuthAccessSeedDisconnected({
      attemptId: disconnect.attemptId,
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: disconnect.attemptId,
      expiresAt: null,
      schemaVersion: 1,
      state: "off",
    });
  });

  it("does not acknowledge a disconnect fence superseded by a newer upload", async () => {
    const now = new Date("2026-07-21T20:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness({
      accessSeedEncrypted: "encrypted:hca_oldseedattempt",
      accessSeedExpiresAt: new Date("2026-07-21T21:00:00.000Z"),
      attemptId: "hca_oldseedattempt",
      memberId: "member_123",
      state: "connected",
      updatedAt: now,
      userCode: null,
      verificationUrl: null,
    });
    const disconnect = await disconnectHostedCodexAuthAccessSeed({
      memberId: "member_123",
      now,
      prisma: prisma.client,
    });
    const replacement = await beginHostedCodexAuthAccessSeedAttempt({
      crypto: createAccessSeedCrypto(),
      memberId: "member_123",
      now,
      prisma: prisma.client,
      seed: accessSeedForStore(new Date("2026-07-21T21:00:00.000Z")),
    });

    await expect(markHostedCodexAuthAccessSeedDisconnected({
      attemptId: disconnect.attemptId,
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toBeNull();
    expect(prisma.getRecord()).toMatchObject({
      attemptId: replacement.attemptId,
      state: "connecting",
    });
  });

  it("rejects legacy device-code callbacks against a seeded attempt", async () => {
    const prisma = createCodexAuthPrismaHarness({
      accessSeedEncrypted: "encrypted:hca_seedattempt12345",
      accessSeedExpiresAt: new Date("2026-07-21T21:00:00.000Z"),
      attemptId: "hca_seedattempt12345",
      memberId: "member_123",
      state: "connecting",
      updatedAt: new Date("2026-07-21T20:00:00.000Z"),
      userCode: null,
      verificationUrl: null,
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_seedattempt12345",
        phase: "device_code",
        userCode: "FORBIDDEN-CODE",
        verificationUrl: "https://auth.openai.com/device",
      },
    })).resolves.toEqual({
      applied: false,
      status: "superseded",
    });
    expect(prisma.getRecord()).toMatchObject({
      userCode: null,
      verificationUrl: null,
    });
  });

  it("keeps seeded connected callbacks idempotent and fences terminal cleanup", async () => {
    const now = new Date("2026-07-21T20:00:00.000Z");
    const expiresAt = new Date("2026-07-21T21:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness({
      accessSeedEncrypted: "encrypted:hca_seedcallback1234",
      accessSeedExpiresAt: expiresAt,
      attemptId: "hca_seedcallback1234",
      memberId: "member_123",
      state: "connecting",
      updatedAt: now,
      userCode: null,
      verificationUrl: null,
    });
    const crypto = createAccessSeedCrypto();

    await expect(applyHostedCodexAuthUpdate({
      crypto,
      memberId: "member_123",
      now,
      prisma: prisma.client,
      update: {
        attemptId: "hca_seedcallback1234",
        phase: "connected",
      },
    })).resolves.toEqual({ applied: true, status: "applied" });
    expect(prisma.getRecord()).toMatchObject({
      accessSeedEncrypted: "encrypted:hca_seedcallback1234",
      accessSeedExpiresAt: expiresAt,
      state: "connected",
    });
    await expect(applyHostedCodexAuthUpdate({
      crypto,
      memberId: "member_123",
      now,
      prisma: prisma.client,
      update: {
        attemptId: "hca_seedcallback1234",
        phase: "connected",
      },
    })).resolves.toEqual({ applied: true, status: "already_applied" });
    expect(crypto.decrypt).toHaveBeenCalledTimes(2);

    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_seedcallback1234",
        phase: "failed",
      },
    })).resolves.toEqual({ applied: true, status: "applied" });
    expect(prisma.getRecord()).toMatchObject({
      accessSeedEncrypted: null,
      accessSeedExpiresAt: null,
      attemptId: "hca_seedcallback1234",
      state: "error",
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_seedcallback1234",
        phase: "connected",
      },
    })).resolves.toEqual({ applied: false, status: "superseded" });
    expect(prisma.getRecord()).toMatchObject({
      accessSeedEncrypted: null,
      accessSeedExpiresAt: null,
      attemptId: "hca_seedcallback1234",
      state: "error",
    });

    prisma.setRecord({
      accessSeedEncrypted: "encrypted:hca_newseedcallback",
      accessSeedExpiresAt: expiresAt,
      attemptId: "hca_newseedcallback1",
      memberId: "member_123",
      state: "connecting",
      updatedAt: now,
      userCode: null,
      verificationUrl: null,
    });
    for (const phase of ["connected", "failed"] as const) {
      await expect(applyHostedCodexAuthUpdate({
        memberId: "member_123",
        prisma: prisma.client,
        update: {
          attemptId: "hca_seedcallback1234",
          phase,
        },
      })).resolves.toEqual({ applied: false, status: "superseded" });
    }
    expect(prisma.getRecord()).toMatchObject({
      accessSeedEncrypted: "encrypted:hca_newseedcallback",
      attemptId: "hca_newseedcallback1",
      state: "connecting",
    });
  });

  it("rechecks access and consent under locks before accepting a seeded connected callback", async () => {
    const now = new Date("2026-07-21T20:00:00.000Z");
    const expiresAt = new Date("2026-07-21T21:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness({
      accessSeedEncrypted: "encrypted:hca_policycallback1",
      accessSeedExpiresAt: expiresAt,
      attemptId: "hca_policycallback123",
      memberId: "member_123",
      state: "connecting",
      updatedAt: now,
      userCode: null,
      verificationUrl: null,
    });
    const crypto = createAccessSeedCrypto();
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Hosted access is required.",
    }));

    await expect(applyHostedCodexAuthUpdate({
      crypto,
      memberId: "member_123",
      now,
      prisma: prisma.client,
      update: {
        attemptId: "hca_policycallback123",
        phase: "connected",
      },
    })).resolves.toEqual({ applied: false, status: "superseded" });
    expect(prisma.getRecord()).toMatchObject({ state: "connecting" });
    expect(mocks.lockHostedMemberRow).toHaveBeenLastCalledWith(prisma.tx, "member_123");
    expect(mocks.lockHostedMemberSponsoredAccessRows).toHaveBeenLastCalledWith(
      prisma.tx,
      "member_123",
    );

    mocks.assertHostedLaunchRequiredConsentGranted.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Hosted consent is required.",
    }));
    await expect(applyHostedCodexAuthUpdate({
      crypto,
      memberId: "member_123",
      now,
      prisma: prisma.client,
      update: {
        attemptId: "hca_policycallback123",
        phase: "connected",
      },
    })).resolves.toEqual({ applied: false, status: "superseded" });
    expect(prisma.getRecord()).toMatchObject({ state: "connecting" });
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it("fails a seeded connected callback when its lease or ciphertext is invalid", async () => {
    const now = new Date("2026-07-21T20:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness({
      accessSeedEncrypted: "encrypted:hca_callbackinvalid",
      accessSeedExpiresAt: new Date("2026-07-21T20:04:59.999Z"),
      attemptId: "hca_callbackinvalid1",
      memberId: "member_123",
      state: "connecting",
      updatedAt: now,
      userCode: null,
      verificationUrl: null,
    });
    const crypto = createAccessSeedCrypto();

    await expect(applyHostedCodexAuthUpdate({
      crypto,
      memberId: "member_123",
      now,
      prisma: prisma.client,
      update: {
        attemptId: "hca_callbackinvalid1",
        phase: "connected",
      },
    })).resolves.toEqual({ applied: false, status: "superseded" });
    expect(crypto.decrypt).not.toHaveBeenCalled();

    prisma.setRecord({
      ...prisma.getRecord()!,
      accessSeedExpiresAt: new Date("2026-07-21T21:00:00.000Z"),
    });
    crypto.decrypt.mockRejectedValueOnce(new HostedCodexAuthAccessSeedPayloadError());
    await expect(applyHostedCodexAuthUpdate({
      crypto,
      memberId: "member_123",
      now,
      prisma: prisma.client,
      update: {
        attemptId: "hca_callbackinvalid1",
        phase: "connected",
      },
    })).resolves.toEqual({ applied: false, status: "superseded" });
    expect(crypto.decrypt).toHaveBeenCalledTimes(1);
    expect(prisma.getRecord()).toMatchObject({ state: "connecting" });
  });

  it("preserves legacy connect-error recovery while policy remains active", async () => {
    const prisma = createCodexAuthPrismaHarness({
      attemptId: "hca_legacyrecovery123",
      memberId: "member_123",
      state: "connect_error",
      updatedAt: new Date("2026-07-21T20:00:00.000Z"),
      userCode: null,
      verificationUrl: null,
    });

    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_legacyrecovery123",
        phase: "connected",
      },
    })).resolves.toEqual({ applied: true, status: "applied" });
    expect(prisma.getRecord()).toMatchObject({
      accessSeedEncrypted: null,
      accessSeedExpiresAt: null,
      state: "connected",
    });
  });

  it("projects a stale seeded handoff as needs-attention without decrypting it", async () => {
    const prisma = createCodexAuthPrismaHarness({
      accessSeedEncrypted: "encrypted:hca_staleseedattempt",
      accessSeedExpiresAt: new Date("2026-07-21T21:00:00.000Z"),
      attemptId: "hca_staleseedattempt",
      memberId: "member_123",
      state: "connecting",
      updatedAt: new Date("2026-07-21T19:44:59.999Z"),
      userCode: null,
      verificationUrl: null,
    });
    const now = new Date("2026-07-21T20:00:00.000Z");
    const crypto = createAccessSeedCrypto();

    await expect(readHostedCodexAuthCompanionView({
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: "hca_staleseedattempt",
      expiresAt: "2026-07-21T21:00:00.000Z",
      schemaVersion: 1,
      state: "needs_attention",
    });
    await expect(readHostedCodexAuthAccessSeedForRuntime({
      crypto,
      includeCredentials: true,
      knownConnectionVersion: null,
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      connectionVersion: "hca_staleseedattempt",
      reason: "needs_attention",
      schemaVersion: 1,
      status: "unavailable",
    });
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it("applies callback updates only to the active attempt", async () => {
    const prisma = createCodexAuthPrismaHarness({
      attemptId: "hca_abcdefghijklmnop",
      memberId: "member_123",
      state: "connecting",
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
      userCode: null,
      verificationUrl: null,
    });

    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_supersededattempt",
        phase: "device_code",
        userCode: "STALE-CODE",
        verificationUrl: "https://auth.openai.com/device",
      },
    })).resolves.toEqual({
      applied: false,
      status: "superseded",
    });
    expect(prisma.getRecord()).toMatchObject({
      attemptId: "hca_abcdefghijklmnop",
      userCode: null,
      verificationUrl: null,
    });

    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_abcdefghijklmnop",
        phase: "device_code",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.openai.com/device",
      },
    })).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    expect(prisma.getRecord()).toMatchObject({
      state: "connecting",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/device",
    });

    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_supersededattempt",
        phase: "connected",
      },
    })).resolves.toEqual({
      applied: false,
      status: "superseded",
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_abcdefghijklmnop",
        phase: "connected",
      },
    })).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_abcdefghijklmnop",
        phase: "connected",
      },
    })).resolves.toEqual({
      applied: true,
      status: "already_applied",
    });
    expect(prisma.getRecord()).toMatchObject({
      state: "connected",
      userCode: null,
      verificationUrl: null,
    });

    prisma.setRecord({
      attemptId: "hca_disconnectattempt",
      memberId: "member_123",
      state: "disconnecting",
      updatedAt: new Date("2026-06-23T12:02:00.000Z"),
      userCode: null,
      verificationUrl: null,
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_supersededattempt",
        phase: "disconnected",
      },
    })).resolves.toEqual({
      applied: false,
      status: "superseded",
    });
    expect(prisma.getRecord()).toMatchObject({
      attemptId: "hca_disconnectattempt",
      state: "disconnecting",
    });

    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_disconnectattempt",
        phase: "disconnected",
      },
    })).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    expect(prisma.getRecord()).toMatchObject({
      attemptId: "hca_disconnectattempt",
      state: "disconnected",
      userCode: null,
      verificationUrl: null,
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_disconnectattempt",
        phase: "disconnected",
      },
    })).resolves.toEqual({
      applied: true,
      status: "already_applied",
    });
    await expect(readHostedCodexAuthConnectionView({
      memberId: "member_123",
      prisma: prisma.client,
    })).resolves.toEqual({ state: "disconnected" });
  });

  it("preserves the failed in-flight action in projected error states", async () => {
    const prisma = createCodexAuthPrismaHarness({
      attemptId: "hca_connectattempt",
      memberId: "member_123",
      state: "connecting",
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/device",
    });

    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_connectattempt",
        phase: "failed",
      },
    })).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    expect(prisma.getRecord()).toMatchObject({
      state: "connect_error",
      userCode: null,
      verificationUrl: null,
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_connectattempt",
        phase: "failed",
      },
    })).resolves.toEqual({
      applied: true,
      status: "already_applied",
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_connectattempt",
        phase: "connected",
      },
    })).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    expect(prisma.getRecord()).toMatchObject({
      state: "connected",
      userCode: null,
      verificationUrl: null,
    });

    prisma.setRecord({
      attemptId: "hca_disconnectattempt",
      memberId: "member_123",
      state: "disconnecting",
      updatedAt: new Date("2026-06-23T12:02:00.000Z"),
      userCode: null,
      verificationUrl: null,
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_disconnectattempt",
        phase: "failed",
      },
    })).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    expect(prisma.getRecord()).toMatchObject({
      state: "disconnect_error",
      userCode: null,
      verificationUrl: null,
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_disconnectattempt",
        phase: "disconnected",
      },
    })).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    expect(prisma.getRecord()).toMatchObject({
      state: "disconnected",
      userCode: null,
      verificationUrl: null,
    });
  });

  it("projects stale in-flight attempts to action-specific errors", async () => {
    const prisma = createCodexAuthPrismaHarness({
      attemptId: "hca_connectattempt",
      memberId: "member_123",
      state: "connecting",
      updatedAt: new Date("2026-06-23T11:44:59.999Z"),
      userCode: null,
      verificationUrl: null,
    });

    await expect(readHostedCodexAuthConnectionView({
      memberId: "member_123",
      now: new Date("2026-06-23T12:00:00.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({ state: "connect_error" });

    prisma.setRecord({
      attemptId: "hca_disconnectattempt",
      memberId: "member_123",
      state: "disconnecting",
      updatedAt: new Date("2026-06-23T11:44:59.999Z"),
      userCode: null,
      verificationUrl: null,
    });
    await expect(readHostedCodexAuthConnectionView({
      memberId: "member_123",
      now: new Date("2026-06-23T12:00:00.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({ state: "disconnect_error" });
  });
});

function createCodexAuthPrismaHarness(initial: StoredCodexAuthConnectionInput | null = null): {
  client: CodexAuthPrismaForTest;
  getRecord: () => StoredCodexAuthConnection | null;
  setRecord: (record: StoredCodexAuthConnectionInput | null) => void;
  tx: object;
} {
  let record: StoredCodexAuthConnection | null = normalizeStoredConnection(initial);
  const delegate = {
    deleteMany: vi.fn(async (args: { where: CodexAuthWhere }) => {
      if (matchesRecordWhere(record, args.where)) {
        record = null;
        return { count: 1 };
      }
      return { count: 0 };
    }),
    findUnique: vi.fn(async (args: { where: { memberId: string } }) =>
      record?.memberId === args.where.memberId ? { ...record } : null),
    updateMany: vi.fn(async (args: {
      data: StoredCodexAuthConnectionUpdate;
      where: CodexAuthWhere;
    }) => {
      const current = record;
      if (!current || !matchesRecordWhere(current, args.where)) {
        return { count: 0 };
      }
      record = applyRecordUpdate(current, args.data);
      return { count: 1 };
    }),
    upsert: vi.fn(async (args: {
      create: StoredCodexAuthConnection;
      update: StoredCodexAuthConnectionUpdate;
      where: { memberId: string };
    }) => {
      if (record?.memberId === args.where.memberId) {
        record = applyRecordUpdate(record, args.update);
      } else {
        record = { ...args.create };
      }
      return { ...record };
    }),
  };
  const tx = {
    hostedCodexAuthConnection: delegate,
  };
  const client = {
    $transaction: vi.fn(async (
      callback: (transactionClient: typeof tx) => Promise<unknown>,
    ) => callback(tx)),
    hostedCodexAuthConnection: delegate,
  };

  // Narrow test double: the store touches only this delegate plus $transaction.
  return {
    client: codexAuthPrismaClientForTest(client),
    getRecord: () => record,
    setRecord: (next) => {
      record = normalizeStoredConnection(next);
    },
    tx,
  };
}

function codexAuthPrismaClientForTest(client: {
  $transaction: (
    callback: (transactionClient: { hostedCodexAuthConnection: object }) => Promise<unknown>,
  ) => Promise<unknown>;
  hostedCodexAuthConnection: object;
}): CodexAuthPrismaForTest {
  // Documented test boundary: the store test mocks every dependency that would
  // touch the rest of Prisma's transaction surface.
  const narrowClient = client as Pick<
    CodexAuthPrismaForTest,
    "$transaction" | "hostedCodexAuthConnection"
  >;
  return narrowClient as CodexAuthPrismaForTest;
}

function applyRecordUpdate(
  record: StoredCodexAuthConnection,
  update: StoredCodexAuthConnectionUpdate,
): StoredCodexAuthConnection {
  return {
    accessSeedEncrypted: update.accessSeedEncrypted === undefined
      ? record.accessSeedEncrypted
      : update.accessSeedEncrypted,
    accessSeedExpiresAt: update.accessSeedExpiresAt === undefined
      ? record.accessSeedExpiresAt
      : update.accessSeedExpiresAt,
    attemptId: update.attemptId ?? record.attemptId,
    memberId: record.memberId,
    state: update.state ?? record.state,
    updatedAt: update.updatedAt ?? record.updatedAt,
    userCode: update.userCode === undefined ? record.userCode : update.userCode,
    verificationUrl: update.verificationUrl === undefined
      ? record.verificationUrl
      : update.verificationUrl,
  };
}

function matchesRecordWhere(
  record: StoredCodexAuthConnection | null,
  where: CodexAuthWhere,
): boolean {
  if (!record || record.memberId !== where.memberId) {
    return false;
  }
  if (where.attemptId !== undefined && record.attemptId !== where.attemptId) {
    return false;
  }
  if (!matchesNullableField(record.accessSeedEncrypted, where.accessSeedEncrypted)) {
    return false;
  }
  if (!matchesNullableDateField(record.accessSeedExpiresAt, where.accessSeedExpiresAt)) {
    return false;
  }
  if (where.state === undefined) {
    return true;
  }
  if (typeof where.state === "string") {
    return record.state === where.state;
  }
  return where.state.in.includes(record.state);
}

function normalizeStoredConnection(
  record: StoredCodexAuthConnectionInput | null,
): StoredCodexAuthConnection | null {
  return record
    ? {
        ...record,
        accessSeedEncrypted: record.accessSeedEncrypted ?? null,
        accessSeedExpiresAt: record.accessSeedExpiresAt ?? null,
      }
    : null;
}

function matchesNullableField<T>(
  value: T | null,
  filter: null | { not: null } | undefined,
): boolean {
  if (filter === undefined) {
    return true;
  }
  if (filter === null) {
    return value === null;
  }
  return value !== null;
}

function matchesNullableDateField(
  value: Date | null,
  filter: null | { not: null } | { gte: Date; lte: Date } | undefined,
): boolean {
  if (filter === undefined) {
    return true;
  }
  if (filter === null) {
    return value === null;
  }
  if ("not" in filter) {
    return value !== null;
  }
  return value !== null && value >= filter.gte && value <= filter.lte;
}

function createAccessSeedCrypto() {
  return {
    decrypt: vi.fn(async () => ({
      accessToken: "synthetic-access-value",
      chatgptAccountId: "account_123",
      schemaVersion: 1 as const,
    })),
    encrypt: vi.fn(async (input) => `encrypted:${input.attemptId}`),
  } satisfies HostedCodexAuthAccessSeedCrypto;
}

function accessSeedForStore(
  expiresAt: Date,
): Parameters<typeof beginHostedCodexAuthAccessSeedAttempt>[0]["seed"] {
  return {
    accessToken: "synthetic-access-value",
    chatgptAccountId: "account_123",
    expiresAt,
    schemaVersion: 1,
  };
}
