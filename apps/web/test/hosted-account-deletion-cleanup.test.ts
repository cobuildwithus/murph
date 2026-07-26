import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteHostedPrivyUser: vi.fn(),
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

import {
  drainHostedAccountDeletionCleanupBatch,
  persistHostedAccountDeletionCleanupTx,
  prepareHostedAccountDeletionCleanup,
  runHostedAccountDeletionCleanup,
} from "@/src/lib/hosted-privacy/account-deletion-cleanup";

const KMS_KEY_NAME =
  "projects/test/locations/global/keyRings/test/cryptoKeys/account-cleanup";

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
    const cleanup = await prepareHostedAccountDeletionCleanup({
      now,
      privyUserId: "privy_user_1",
      runtimeMemberIds: ["member_1", "member_group_1", "member_1"],
      stripeCustomerIds: ["cus_1", "cus_1"],
    });

    expect(cleanup.runtimeMemberIds).toEqual(["member_1", "member_group_1"]);
    const encryptInput = mocks.kmsEncrypt.mock.calls[0]?.[0];
    expect(encryptInput?.keyName).toBe(KMS_KEY_NAME);
    expect(JSON.parse(String(encryptInput?.additionalAuthenticatedData))).toEqual({
      environment: "test",
      id: cleanup.id,
      schema: "murph.hosted-account-deletion-cleanup.v1",
    });
    expect(JSON.parse(new TextDecoder().decode(encryptInput?.plaintext))).toEqual({
      privyUserId: "privy_user_1",
      runtimeMemberIds: ["member_1", "member_group_1"],
      schema: "murph.hosted-account-deletion-cleanup.v1",
      stripeCustomerIds: ["cus_1"],
    });
    expect(cleanup.payloadCiphertext).not.toContain("privy_user_1");
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
    const never = new Promise<never>(() => undefined);
    mocks.deleteHostedRunnerUserDataBestEffort.mockReturnValue(never);
    mocks.deleteHostedPrivyUser.mockReturnValue(never);
    mocks.getHostedOnboardingStripe.mockReturnValue({
      customers: { del: vi.fn(() => never) },
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
  row: CleanupRow | null = null;

  readonly prisma = {
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
}) {
  return {
    alarmCleared: input.deleted,
    configured: input.configured ?? true,
    deleteAllCompleted: input.deleted,
    deleted: input.deleted,
    errorCode: null,
    r2DeletedObjectCount: input.deleted ? 0 : null,
    r2SkippedUserScopedPrefixes: input.deleted ? false : null,
    r2Supported: input.deleted ? true : null,
    r2UserScopedSkipReason: null,
    runnerStateDeleted: input.deleted,
  };
}
