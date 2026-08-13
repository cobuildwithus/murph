import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteHostedPrivyUser: vi.fn(),
  deleteHostedRuntimeLogDataForUsers: vi.fn(),
  deleteHostedRunnerUserDataBestEffort: vi.fn(),
  getHostedOnboardingStripe: vi.fn(),
  getHostedWebCryptoConfig: vi.fn(),
  kmsDecrypt: vi.fn(),
  kmsEncrypt: vi.fn(),
}));

vi.mock("@/src/lib/hosted-crypto/env", () => ({
  getHostedWebCryptoConfig: mocks.getHostedWebCryptoConfig,
}));

vi.mock("@/src/lib/hosted-execution/user-data-delete", () => ({
  deleteHostedRunnerUserDataBestEffort:
    mocks.deleteHostedRunnerUserDataBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  deleteHostedPrivyUser: mocks.deleteHostedPrivyUser,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingStripe: mocks.getHostedOnboardingStripe,
}));

vi.mock("@/src/lib/hosted-runtime-log/store", () => ({
  deleteHostedRuntimeLogDataForUsers:
    mocks.deleteHostedRuntimeLogDataForUsers,
}));

import {
  drainHostedAccountDeletionCleanupBatch,
  persistHostedAccountDeletionCleanupTx,
  prepareHostedAccountDeletionCleanup,
  runHostedAccountDeletionCleanup,
} from "@/src/lib/hosted-privacy/account-deletion-cleanup";

const KMS_KEY_NAME =
  "projects/murph-test/locations/global/keyRings/test/cryptoKeys/account-cleanup";
const KMS_KEY_VERSION_NAME = `${KMS_KEY_NAME}/cryptoKeyVersions/7`;

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.kmsEncrypt.mockImplementation(async (input: {
    plaintext: Uint8Array;
  }) => ({
    ciphertext: Buffer.from(input.plaintext).toString("base64"),
    keyName: KMS_KEY_NAME,
  }));
  mocks.kmsDecrypt.mockImplementation(async (input: {
    ciphertext: string;
  }) => ({
    plaintext: new Uint8Array(Buffer.from(input.ciphertext, "base64")),
  }));
  mocks.getHostedWebCryptoConfig.mockReturnValue({
    env: "test",
    gcpKms: {
      decrypt: mocks.kmsDecrypt,
      encrypt: mocks.kmsEncrypt,
    },
    webWrapKmsKeyName: KMS_KEY_NAME,
  });
  mocks.deleteHostedRunnerUserDataBestEffort.mockResolvedValue(
    makeCloudflareDeletionResult({ deleted: true }),
  );
  mocks.deleteHostedRuntimeLogDataForUsers.mockResolvedValue(0);
  mocks.deleteHostedPrivyUser.mockResolvedValue(true);
  mocks.getHostedOnboardingStripe.mockReturnValue({
    customers: {
      del: vi.fn(async () => ({ deleted: true })),
    },
  });
});

describe("hosted account deletion cleanup", () => {
  it("encrypts only the identifiers needed for cleanup with receipt-bound AAD", async () => {
    const now = new Date("2026-07-26T18:00:00.000Z");
    const captured: { plaintextSnapshot?: Uint8Array } = {};
    mocks.kmsEncrypt.mockImplementationOnce(async (input: { plaintext: Uint8Array }) => {
      captured.plaintextSnapshot = new Uint8Array(input.plaintext);
      return {
        ciphertext: Buffer.from(input.plaintext).toString("base64"),
        keyName: KMS_KEY_VERSION_NAME,
      };
    });
    const cleanup = await prepareHostedAccountDeletionCleanup({
      now,
      privyUserId: "privy_user_1",
      runtimeMemberIds: ["member_1", "member_group_1", "member_1"],
      stripeCustomerIds: ["cus_1", "cus_1"],
    });

    expect(cleanup.runtimeMemberIds).toEqual(["member_1", "member_group_1"]);
    expect(cleanup.privyUserLookupKey).toMatch(/^hbidx:privy-user:/u);
    const encryptInput = mocks.kmsEncrypt.mock.calls[0]?.[0];
    expect(encryptInput?.keyName).toBe(KMS_KEY_NAME);
    expect(JSON.parse(String(encryptInput?.additionalAuthenticatedData))).toEqual({
      environment: "test",
      id: cleanup.id,
      schema: "murph.hosted-account-deletion-cleanup.v1",
    });
    expect(JSON.parse(new TextDecoder().decode(captured.plaintextSnapshot))).toEqual({
      privyUserId: "privy_user_1",
      runtimeMemberIds: ["member_1", "member_group_1"],
      schema: "murph.hosted-account-deletion-cleanup.v1",
      stripeCustomerIds: ["cus_1"],
    });
    expect(encryptInput?.plaintext.every((byte: number) => byte === 0)).toBe(true);
    expect(cleanup.payloadCiphertext).not.toContain("privy_user_1");
    expect(cleanup.kmsKeyName).toBe(KMS_KEY_NAME);
  });

  it("repairs a legacy versioned KMS receipt before provider cleanup starts", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-26T18:00:00.000Z");
    const deleteStripeCustomer = vi.fn(async () => ({ deleted: true }));
    mocks.getHostedOnboardingStripe.mockReturnValue({
      customers: { del: deleteStripeCustomer },
    });
    const prepared = await createCleanup(store, now, {
      privyUserId: "privy_user_1",
      stripeCustomerIds: ["cus_1"],
    });
    if (!store.row) {
      throw new Error("Expected a persisted cleanup receipt.");
    }
    store.row = { ...store.row, kmsKeyName: KMS_KEY_VERSION_NAME };
    const captured: { plaintext?: Uint8Array } = {};
    mocks.kmsDecrypt.mockImplementationOnce(async (decryptInput: { ciphertext: string }) => {
      captured.plaintext = new Uint8Array(Buffer.from(decryptInput.ciphertext, "base64"));
      return { plaintext: captured.plaintext };
    });

    await expect(runHostedAccountDeletionCleanup({
      cleanupId: prepared.id,
      now,
      prisma: store.prisma as never,
    })).resolves.toMatchObject({ cleanupPending: false });

    expect(mocks.kmsDecrypt).toHaveBeenCalledWith(expect.objectContaining({
      keyName: KMS_KEY_NAME,
    }));
    expect(mocks.deleteHostedRunnerUserDataBestEffort).toHaveBeenCalledTimes(1);
    expect(mocks.deleteHostedRuntimeLogDataForUsers).toHaveBeenCalledTimes(1);
    expect(mocks.deleteHostedPrivyUser).toHaveBeenCalledTimes(1);
    expect(deleteStripeCustomer).toHaveBeenCalledTimes(1);
    expect(captured.plaintext?.every((byte) => byte === 0)).toBe(true);
  });

  it("fails closed on malformed persisted KMS resource names", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-26T18:00:00.000Z");
    const prepared = await createCleanup(store, now, {
      privyUserId: "privy_user_1",
      stripeCustomerIds: ["cus_1"],
    });
    if (!store.row) {
      throw new Error("Expected a persisted cleanup receipt.");
    }
    store.row = {
      ...store.row,
      kmsKeyName: `${KMS_KEY_NAME}/cryptoKeyVersions/latest`,
    };

    await expect(runHostedAccountDeletionCleanup({
      cleanupId: prepared.id,
      now,
      prisma: store.prisma as never,
    })).rejects.toThrow(/CryptoKey or CryptoKeyVersion resource name/u);

    expect(mocks.kmsDecrypt).not.toHaveBeenCalled();
    expect(mocks.deleteHostedRunnerUserDataBestEffort).not.toHaveBeenCalled();
    expect(mocks.deleteHostedPrivyUser).not.toHaveBeenCalled();
    expect(mocks.getHostedOnboardingStripe).not.toHaveBeenCalled();
    expect(store.row).toMatchObject({
      attemptCount: 1,
      lastErrorCode: "TypeError",
      leaseToken: null,
    });
    expect(store.row?.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("persists target progress and retries only unfinished targets", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-26T18:00:00.000Z");
    const deleteStripeCustomer = vi.fn(async () => ({ deleted: true }));
    mocks.getHostedOnboardingStripe.mockReturnValue({
      customers: { del: deleteStripeCustomer },
    });
    mocks.deleteHostedRunnerUserDataBestEffort
      .mockResolvedValueOnce(makeCloudflareDeletionResult({
        configured: false,
        deleted: false,
      }))
      .mockResolvedValueOnce(makeCloudflareDeletionResult({ deleted: true }));
    const prepared = await createCleanup(store, now, {
      privyUserId: "privy_user_1",
      stripeCustomerIds: ["cus_1"],
    });

    await expect(runHostedAccountDeletionCleanup({
      cleanupId: prepared.id,
      now,
      prisma: store.prisma as never,
    })).resolves.toMatchObject({
      cleanupPending: true,
      cloudflare: { configured: false, deleted: false },
      vendorAccounts: {
        privyUser: { status: "completed" },
        stripeCustomer: { status: "completed" },
      },
    });
    expect(store.row).toMatchObject({
      cloudflareCompletedAt: null,
      privyCompletedAt: now,
      runtimeLogsCompletedAt: now,
      stripeCompletedAt: now,
    });
    expect(
      JSON.parse(String(mocks.kmsDecrypt.mock.calls[0]?.[0].additionalAuthenticatedData)),
    ).toEqual({
      environment: "test",
      id: prepared.id,
      schema: "murph.hosted-account-deletion-cleanup.v1",
    });

    const retryAt = store.row?.nextAttemptAt;
    expect(retryAt).toBeInstanceOf(Date);
    await expect(runHostedAccountDeletionCleanup({
      cleanupId: prepared.id,
      now: retryAt,
      prisma: store.prisma as never,
    })).resolves.toMatchObject({ cleanupPending: false });

    expect(store.row).toBeNull();
    expect(mocks.deleteHostedRunnerUserDataBestEffort).toHaveBeenCalledTimes(2);
    expect(mocks.deleteHostedRuntimeLogDataForUsers).toHaveBeenCalledTimes(1);
    expect(mocks.deleteHostedRuntimeLogDataForUsers).toHaveBeenCalledWith({
      timeoutMs: expect.any(Number),
      userIds: ["member_1"],
    });
    expect(deleteStripeCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.deleteHostedPrivyUser).toHaveBeenCalledTimes(1);
  });

  it("keeps unconfigured required targets pending", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-26T18:00:00.000Z");
    mocks.getHostedOnboardingStripe.mockReturnValue(null);
    mocks.deleteHostedPrivyUser.mockResolvedValue(false);
    const prepared = await createCleanup(store, now, {
      privyUserId: "privy_user_1",
      stripeCustomerIds: ["cus_1"],
    });

    await expect(runHostedAccountDeletionCleanup({
      cleanupId: prepared.id,
      now,
      prisma: store.prisma as never,
    })).resolves.toMatchObject({
      cleanupPending: true,
      vendorAccounts: {
        privyUser: { status: "skipped_not_configured" },
        stripeCustomer: { status: "skipped_not_configured" },
      },
    });
    expect(store.row).not.toBeNull();
  });

  it("keeps isolated runtime-log deletion pending and retries only that target", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-26T18:00:00.000Z");
    mocks.deleteHostedRuntimeLogDataForUsers
      .mockRejectedValueOnce(new Error("isolated database unavailable"))
      .mockResolvedValueOnce(0);
    const prepared = await createCleanup(store, now);

    await expect(runHostedAccountDeletionCleanup({
      cleanupId: prepared.id,
      now,
      prisma: store.prisma as never,
    })).resolves.toMatchObject({
      cleanupPending: true,
    });
    expect(store.row).toMatchObject({
      cloudflareCompletedAt: now,
      runtimeLogsCompletedAt: null,
    });

    const retryAt = store.row?.nextAttemptAt;
    expect(retryAt).toBeInstanceOf(Date);
    await expect(runHostedAccountDeletionCleanup({
      cleanupId: prepared.id,
      now: retryAt,
      prisma: store.prisma as never,
    })).resolves.toMatchObject({
      cleanupPending: false,
    });

    expect(mocks.deleteHostedRuntimeLogDataForUsers).toHaveBeenCalledTimes(2);
    expect(mocks.deleteHostedRunnerUserDataBestEffort).toHaveBeenCalledTimes(1);
    expect(store.row).toBeNull();
  });

  it("treats already-absent vendor records as completed", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-26T18:00:00.000Z");
    const deleteStripeCustomer = vi.fn().mockRejectedValue({
      code: "resource_missing",
      type: "StripeInvalidRequestError",
    });
    mocks.getHostedOnboardingStripe.mockReturnValue({
      customers: { del: deleteStripeCustomer },
    });
    mocks.deleteHostedPrivyUser.mockRejectedValue({ status: 404 });
    const prepared = await createCleanup(store, now, {
      privyUserId: "privy_user_1",
      stripeCustomerIds: ["cus_1"],
    });

    await expect(runHostedAccountDeletionCleanup({
      cleanupId: prepared.id,
      now,
      prisma: store.prisma as never,
    })).resolves.toMatchObject({
      cleanupPending: false,
      vendorAccounts: {
        privyUser: { errorCode: null, status: "completed" },
        stripeCustomer: { errorCode: null, status: "completed" },
      },
    });

    expect(store.row).toBeNull();
    expect(deleteStripeCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.deleteHostedPrivyUser).toHaveBeenCalledTimes(1);
  });

  it("keeps Privy cleanup pending when the identity is bound to a live member", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-26T18:00:00.000Z");
    store.livePrivyMemberId = "member_recreated";
    const prepared = await createCleanup(store, now, {
      privyUserId: "privy_user_1",
    });

    await expect(runHostedAccountDeletionCleanup({
      cleanupId: prepared.id,
      now,
      prisma: store.prisma as never,
    })).resolves.toMatchObject({
      cleanupPending: true,
      vendorAccounts: {
        privyUser: {
          errorCode: "ACCOUNT_DELETION_PRIVY_IDENTITY_REBOUND",
          status: "failed",
        },
      },
    });

    expect(mocks.deleteHostedPrivyUser).not.toHaveBeenCalled();
    expect(store.row?.privyCompletedAt).toBeNull();
  });

  it("bounds Cloudflare deletion work with a fixed worker pool", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-26T18:00:00.000Z");
    let active = 0;
    let maxActive = 0;
    mocks.deleteHostedRunnerUserDataBestEffort.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return makeCloudflareDeletionResult({ deleted: true });
    });
    const prepared = await prepareHostedAccountDeletionCleanup({
      now,
      privyUserId: null,
      runtimeMemberIds: Array.from({ length: 12 }, (_, index) => `member_${index}`),
      stripeCustomerIds: [],
    });
    await persistHostedAccountDeletionCleanupTx({
      cleanup: prepared,
      prisma: store.prisma as never,
    });

    await expect(runHostedAccountDeletionCleanup({
      cleanupId: prepared.id,
      now,
      prisma: store.prisma as never,
    })).resolves.toMatchObject({ cleanupPending: false });

    expect(mocks.deleteHostedRunnerUserDataBestEffort).toHaveBeenCalledTimes(12);
    expect(maxActive).toBe(4);
  });

  it("does not report completion after losing the receipt lease", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-26T18:00:00.000Z");
    store.blockReceiptDelete = true;
    const prepared = await createCleanup(store, now);

    await expect(runHostedAccountDeletionCleanup({
      cleanupId: prepared.id,
      now,
      prisma: store.prisma as never,
    })).resolves.toMatchObject({
      cleanupPending: true,
      cloudflare: { deleted: true },
    });
    expect(store.row).not.toBeNull();
  });

  it("isolates one broken receipt while draining the retry batch", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-26T18:00:00.000Z");
    const prepared = await createCleanup(store, now);
    mocks.kmsDecrypt.mockRejectedValueOnce(new Error("kms unavailable"));

    await expect(drainHostedAccountDeletionCleanupBatch({
      now,
      prisma: store.prisma as never,
    })).resolves.toEqual({
      completed: 0,
      failed: 1,
      pending: 0,
      selected: 1,
    });
    expect(store.row).toMatchObject({
      attemptCount: 1,
      leaseToken: null,
    });
    expect(store.row?.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    expect(prepared.id).toBe(store.row?.id);
  });

  it("returns a pending receipt when external targets exceed the attempt budget", async () => {
    vi.useFakeTimers();
    const store = new CleanupStore();
    const now = new Date("2026-07-26T18:00:00.000Z");
    mocks.deleteHostedRunnerUserDataBestEffort.mockImplementation(
      ({ signal }: { signal: AbortSignal }) => new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve(makeCloudflareDeletionResult({
          deleted: false,
          errorCode: "AbortError",
        })), { once: true });
      }),
    );
    mocks.deleteHostedPrivyUser.mockImplementation(
      (_userId: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), {
            once: true,
          });
        }),
    );
    mocks.getHostedOnboardingStripe.mockReturnValue({
      customers: {
        del: vi.fn((
          _customerId: string,
          _params: unknown,
          options: { timeout: number },
        ) => new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("Stripe request timed out")), options.timeout);
        })),
      },
    });
    const prepared = await createCleanup(store, now, {
      privyUserId: "privy_user_1",
      stripeCustomerIds: ["cus_1"],
    });

    const run = runHostedAccountDeletionCleanup({
      attemptTimeoutMs: 50,
      cleanupId: prepared.id,
      now,
      prisma: store.prisma as never,
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(run).resolves.toMatchObject({
      cleanupPending: true,
      cloudflare: {
        deleted: false,
        errorCode: "ACCOUNT_DELETION_CLEANUP_TARGET_TIMEOUT",
      },
      vendorAccounts: {
        privyUser: {
          errorCode: "ACCOUNT_DELETION_CLEANUP_TARGET_TIMEOUT",
          status: "failed",
        },
        stripeCustomer: {
          errorCode: "ACCOUNT_DELETION_CLEANUP_TARGET_TIMEOUT",
          status: "failed",
        },
      },
    });
    expect(store.row).toMatchObject({
      attemptCount: 1,
      leaseToken: null,
    });
  });

  it("starts the shared attempt deadline before decrypting the cleanup payload", async () => {
    vi.useFakeTimers();
    const store = new CleanupStore();
    const now = new Date("2026-07-26T18:00:00.000Z");
    const prepared = await createCleanup(store, now, {
      privyUserId: "privy_user_1",
      stripeCustomerIds: ["cus_1"],
    });
    mocks.kmsDecrypt.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );

    const run = runHostedAccountDeletionCleanup({
      attemptTimeoutMs: 50,
      cleanupId: prepared.id,
      now,
      prisma: store.prisma as never,
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(run).rejects.toMatchObject({ name: "TimeoutError" });
    expect(mocks.kmsDecrypt).toHaveBeenCalledWith(expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(mocks.deleteHostedRunnerUserDataBestEffort).not.toHaveBeenCalled();
    expect(mocks.deleteHostedPrivyUser).not.toHaveBeenCalled();
    expect(store.row).toMatchObject({
      attemptCount: 1,
      leaseToken: null,
    });
  });

  it("does not launch queued runtime deletions after the deadline", async () => {
    vi.useFakeTimers();
    const store = new CleanupStore();
    const now = new Date("2026-07-26T18:00:00.000Z");
    mocks.deleteHostedRunnerUserDataBestEffort.mockImplementation(
      ({ signal }: { signal: AbortSignal }) => new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve(makeCloudflareDeletionResult({
          deleted: false,
          errorCode: "AbortError",
        })), { once: true });
      }),
    );
    const prepared = await prepareHostedAccountDeletionCleanup({
      now,
      privyUserId: null,
      runtimeMemberIds: Array.from({ length: 12 }, (_, index) => `member_${index}`),
      stripeCustomerIds: [],
    });
    await persistHostedAccountDeletionCleanupTx({
      cleanup: prepared,
      prisma: store.prisma as never,
    });

    const run = runHostedAccountDeletionCleanup({
      attemptTimeoutMs: 50,
      cleanupId: prepared.id,
      now,
      prisma: store.prisma as never,
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(run).resolves.toMatchObject({
      cleanupPending: true,
      cloudflare: {
        errorCode: "ACCOUNT_DELETION_CLEANUP_TARGET_TIMEOUT",
      },
    });
    expect(mocks.deleteHostedRunnerUserDataBestEffort).toHaveBeenCalledTimes(4);
  });
});

async function createCleanup(
  store: CleanupStore,
  now: Date,
  input: {
    privyUserId?: string | null;
    stripeCustomerIds?: string[];
  } = {},
) {
  const prepared = await prepareHostedAccountDeletionCleanup({
    now,
    privyUserId: input.privyUserId ?? null,
    runtimeMemberIds: ["member_1"],
    stripeCustomerIds: input.stripeCustomerIds ?? [],
  });
  await persistHostedAccountDeletionCleanupTx({
    cleanup: prepared,
    prisma: store.prisma as never,
  });
  return prepared;
}

interface CleanupRow {
  attemptCount: number;
  cloudflareCompletedAt: Date | null;
  createdAt: Date;
  environment: string;
  id: string;
  kmsKeyName: string;
  lastAttemptedAt: Date | null;
  lastErrorCode: string | null;
  leaseExpiresAt: Date | null;
  leaseToken: string | null;
  nextAttemptAt: Date;
  payloadCiphertext: string;
  privyCompletedAt: Date | null;
  privyUserLookupKey: string | null;
  runtimeLogsCompletedAt: Date | null;
  stripeCompletedAt: Date | null;
  updatedAt: Date;
}

type CleanupWhere = {
  id?: string;
  leaseExpiresAt?: null | { lt: Date };
  leaseToken?: string;
  nextAttemptAt?: { lte: Date };
  OR?: CleanupWhere[];
};

type CleanupUpdate = Partial<Omit<CleanupRow, "attemptCount">> & {
  attemptCount?: { increment: number };
};

class CleanupStore {
  blockReceiptDelete = false;
  livePrivyMemberId: string | null = null;
  row: CleanupRow | null = null;

  readonly prisma = {
    hostedMemberIdentity: {
      findFirst: async () => this.livePrivyMemberId
        ? { memberId: this.livePrivyMemberId }
        : null,
    },
    hostedAccountDeletionCleanup: {
      create: async ({ data }: {
        data: Omit<CleanupRow,
          | "attemptCount"
          | "createdAt"
          | "lastAttemptedAt"
          | "lastErrorCode"
          | "leaseExpiresAt"
          | "leaseToken"
          | "updatedAt"
        >;
      }) => {
        const createdAt = new Date();
        this.row = {
          ...data,
          attemptCount: 0,
          createdAt,
          lastAttemptedAt: null,
          lastErrorCode: null,
          leaseExpiresAt: null,
          leaseToken: null,
          updatedAt: createdAt,
        };
        return this.row;
      },
      deleteMany: async ({ where }: { where: CleanupWhere }) => {
        if (!this.matches(where) || this.blockReceiptDelete) {
          return { count: 0 };
        }
        this.row = null;
        return { count: 1 };
      },
      findFirst: async ({ where }: { where: CleanupWhere }) =>
        this.matches(where) ? this.row : null,
      findMany: async () => this.row ? [{ id: this.row.id }] : [],
      findUnique: async ({ where }: { where: CleanupWhere }) =>
        this.matches(where) ? this.row : null,
      updateMany: async ({
        data,
        where,
      }: {
        data: CleanupUpdate;
        where: CleanupWhere;
      }) => {
        if (!this.matches(where) || !this.row) {
          return { count: 0 };
        }
        const increment = typeof data.attemptCount === "object"
          ? data.attemptCount.increment
          : null;
        this.row = {
          ...this.row,
          ...data,
          attemptCount: increment === null
            ? this.row.attemptCount
            : this.row.attemptCount + increment,
          updatedAt: new Date(),
        } as CleanupRow;
        return { count: 1 };
      },
    },
  };

  private matches(where: CleanupWhere): boolean {
    const row = this.row;
    if (!row) {
      return false;
    }
    if (where.id !== undefined && where.id !== row.id) {
      return false;
    }
    if (where.leaseToken !== undefined && where.leaseToken !== row.leaseToken) {
      return false;
    }
    if (where.nextAttemptAt?.lte && row.nextAttemptAt > where.nextAttemptAt.lte) {
      return false;
    }
    if (where.OR && !where.OR.some((candidate) => this.matches(candidate))) {
      return false;
    }
    if (where.leaseExpiresAt === null && row.leaseExpiresAt !== null) {
      return false;
    }
    if (
      typeof where.leaseExpiresAt === "object"
      && where.leaseExpiresAt?.lt
      && (!row.leaseExpiresAt || row.leaseExpiresAt >= where.leaseExpiresAt.lt)
    ) {
      return false;
    }
    return true;
  }
}

function makeCloudflareDeletionResult(input: {
  configured?: boolean;
  deleted: boolean;
  errorCode?: string | null;
}) {
  return {
    alarmCleared: input.deleted,
    configured: input.configured ?? true,
    deleteAllCompleted: input.deleted,
    deleted: input.deleted,
    errorCode: input.errorCode ?? null,
    r2DeletedObjectCount: input.deleted ? 0 : null,
    r2SkippedUserScopedPrefixes: input.deleted ? false : null,
    r2Supported: input.deleted ? true : null,
    r2UserScopedSkipReason: null,
    runnerStateDeleted: input.deleted,
  };
}
