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
  it("encrypts the minimal cleanup payload with receipt-bound AAD", async () => {
    const now = new Date("2026-07-25T18:00:00.000Z");

    const cleanup = await prepareHostedAccountDeletionCleanup({
      now,
      privyUserId: "privy_user_1",
      runtimeMemberIds: ["member_1", "member_group_1", "member_1"],
      stripeCustomerIds: ["cus_1", "cus_1"],
    });

    expect(cleanup.runtimeMemberIds).toEqual(["member_1", "member_group_1"]);
    const encryptInput = mocks.kmsEncrypt.mock.calls[0]?.[0];
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

  it("persists independent target progress and skips completed targets on retry", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-25T18:00:00.000Z");
    const stripeCustomerDelete = vi.fn(async () => ({ deleted: true }));
    mocks.getHostedOnboardingStripe.mockReturnValue({
      customers: { del: stripeCustomerDelete },
    });
    mocks.deleteHostedRunnerUserDataBestEffort
      .mockResolvedValueOnce(makeCloudflareDeletionResult({
        configured: false,
        deleted: false,
      }))
      .mockResolvedValueOnce(makeCloudflareDeletionResult({ deleted: true }));

    const prepared = await prepareHostedAccountDeletionCleanup({
      now,
      privyUserId: "privy_user_1",
      runtimeMemberIds: ["member_1"],
      stripeCustomerIds: ["cus_1"],
    });
    await persistHostedAccountDeletionCleanupTx({
      cleanup: prepared,
      prisma: store.prisma as never,
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
      nextAttemptAt: new Date("2026-07-25T19:00:00.000Z"),
      privyCompletedAt: now,
      stripeCompletedAt: now,
    });

    await expect(runHostedAccountDeletionCleanup({
      cleanupId: prepared.id,
      now: new Date("2026-07-25T19:00:00.000Z"),
      prisma: store.prisma as never,
    })).resolves.toMatchObject({
      cleanupPending: false,
      cloudflare: { deleted: true },
    });

    expect(store.row).toBeNull();
    expect(mocks.deleteHostedRunnerUserDataBestEffort).toHaveBeenCalledTimes(2);
    expect(stripeCustomerDelete).toHaveBeenCalledTimes(1);
    expect(mocks.deleteHostedPrivyUser).toHaveBeenCalledTimes(1);
  });

  it("does not report convergence while the durable receipt still exists", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-25T18:00:00.000Z");
    store.blockReceiptDelete = true;
    const prepared = await prepareHostedAccountDeletionCleanup({
      now,
      privyUserId: null,
      runtimeMemberIds: ["member_1"],
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
    })).resolves.toMatchObject({
      cleanupPending: true,
      cloudflare: { deleted: true },
    });
    expect(store.row).toMatchObject({
      cloudflareCompletedAt: now,
      privyCompletedAt: now,
      stripeCompletedAt: now,
    });
  });

  it("keeps required vendor cleanup pending while clients are unconfigured", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-25T18:00:00.000Z");
    mocks.getHostedOnboardingStripe.mockReturnValue(null);
    mocks.deleteHostedPrivyUser.mockResolvedValue(false);
    const prepared = await prepareHostedAccountDeletionCleanup({
      now,
      privyUserId: "privy_user_1",
      runtimeMemberIds: ["member_1"],
      stripeCustomerIds: ["cus_1"],
    });
    await persistHostedAccountDeletionCleanupTx({
      cleanup: prepared,
      prisma: store.prisma as never,
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

  it("bounds a stalled target and keeps its durable receipt pending", async () => {
    vi.useFakeTimers();
    try {
      const store = new CleanupStore();
      const now = new Date("2026-07-25T18:00:00.000Z");
      mocks.deleteHostedRunnerUserDataBestEffort.mockReturnValueOnce(
        new Promise(() => undefined),
      );
      const prepared = await prepareHostedAccountDeletionCleanup({
        now,
        privyUserId: null,
        runtimeMemberIds: ["member_1"],
        stripeCustomerIds: [],
      });
      await persistHostedAccountDeletionCleanupTx({
        cleanup: prepared,
        prisma: store.prisma as never,
      });

      const run = runHostedAccountDeletionCleanup({
        cleanupId: prepared.id,
        now,
        prisma: store.prisma as never,
      });
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(run).resolves.toMatchObject({
        cleanupPending: true,
        cloudflare: {
          deleted: false,
          errorCode: "ACCOUNT_DELETION_CLEANUP_TIMEOUT",
        },
      });
      expect(store.row).toMatchObject({
        lastErrorCode: "ACCOUNT_DELETION_CLEANUP_TIMEOUT",
        nextAttemptAt: new Date("2026-07-25T19:00:00.000Z"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats confirmed vendor absence as idempotent success", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-25T18:00:00.000Z");
    mocks.getHostedOnboardingStripe.mockReturnValue({
      customers: {
        del: vi.fn(async () => {
          throw { code: "resource_missing", type: "StripeInvalidRequestError" };
        }),
      },
    });
    mocks.deleteHostedPrivyUser.mockRejectedValue({ status: 404 });
    const prepared = await prepareHostedAccountDeletionCleanup({
      now,
      privyUserId: "privy_missing",
      runtimeMemberIds: ["member_1"],
      stripeCustomerIds: ["cus_missing"],
    });
    await persistHostedAccountDeletionCleanupTx({
      cleanup: prepared,
      prisma: store.prisma as never,
    });

    await expect(runHostedAccountDeletionCleanup({
      cleanupId: prepared.id,
      now,
      prisma: store.prisma as never,
    })).resolves.toMatchObject({
      cleanupPending: false,
      vendorAccounts: {
        privyUser: { status: "completed" },
        stripeCustomer: { status: "completed" },
      },
    });
    expect(store.row).toBeNull();
  });

  it("backs off a receipt when decrypting its retry payload fails", async () => {
    const store = new CleanupStore();
    const now = new Date("2026-07-25T18:00:00.000Z");
    const prepared = await prepareHostedAccountDeletionCleanup({
      now,
      privyUserId: null,
      runtimeMemberIds: ["member_1"],
      stripeCustomerIds: [],
    });
    await persistHostedAccountDeletionCleanupTx({
      cleanup: prepared,
      prisma: store.prisma as never,
    });
    mocks.kmsDecrypt.mockRejectedValueOnce(
      Object.assign(new Error("KMS unavailable"), { code: "KMS_UNAVAILABLE" }),
    );

    await expect(runHostedAccountDeletionCleanup({
      cleanupId: prepared.id,
      now,
      prisma: store.prisma as never,
    })).rejects.toMatchObject({ code: "KMS_UNAVAILABLE" });

    expect(store.row).toMatchObject({
      lastAttemptedAt: now,
      lastErrorCode: "KMS_UNAVAILABLE",
      nextAttemptAt: new Date("2026-07-25T19:00:00.000Z"),
    });
  });

  it("drains due receipts in bounded order and isolates per-receipt failures", async () => {
    const now = new Date("2026-07-25T18:00:00.000Z");
    const rows = new Map<string, CleanupRow>();
    for (const [id, runtimeMemberId] of [
      ["cleanup_complete", "member_complete"],
      ["cleanup_failed", "member_failed"],
      ["cleanup_pending", "member_pending"],
    ] as const) {
      rows.set(id, makeCleanupRow({
        id,
        now,
        payloadCiphertext: Buffer.from(JSON.stringify({
          privyUserId: null,
          runtimeMemberIds: [runtimeMemberId],
          schema: "murph.hosted-account-deletion-cleanup.v1",
          stripeCustomerIds: [],
        })).toString("base64"),
      }));
    }
    const hostedAccountDeletionCleanup = {
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        const deleted = rows.delete(where.id);
        return { count: deleted ? 1 : 0 };
      }),
      findMany: vi.fn(async () => [
        { id: "cleanup_complete" },
        { id: "cleanup_failed" },
        { id: "cleanup_pending" },
      ]),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        rows.get(where.id) ?? null
      ),
      updateMany: vi.fn(async ({
        data,
        where,
      }: {
        data: Partial<CleanupRow>;
        where: { id: string };
      }) => {
        const row = rows.get(where.id);
        if (!row) {
          return { count: 0 };
        }
        rows.set(where.id, { ...row, ...data, updatedAt: now });
        return { count: 1 };
      }),
    };
    const prisma = { hostedAccountDeletionCleanup };
    mocks.kmsDecrypt.mockImplementation(async (input: {
      ciphertext: string;
    }) => {
      const plaintext = new Uint8Array(Buffer.from(input.ciphertext, "base64"));
      const payload = JSON.parse(new TextDecoder().decode(plaintext)) as {
        runtimeMemberIds?: unknown;
      };
      if (
        Array.isArray(payload.runtimeMemberIds)
        && payload.runtimeMemberIds.includes("member_failed")
      ) {
        throw Object.assign(new Error("KMS unavailable"), { code: "KMS_UNAVAILABLE" });
      }
      return { plaintext };
    });
    mocks.deleteHostedRunnerUserDataBestEffort.mockImplementation(
      async ({ userId }: { userId: string }) =>
        userId === "member_pending"
          ? makeCloudflareDeletionResult({ configured: false, deleted: false })
          : makeCloudflareDeletionResult({ deleted: true }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(drainHostedAccountDeletionCleanupBatch({
        now,
        prisma: prisma as never,
      })).resolves.toEqual({
        completed: 1,
        failed: 1,
        pending: 1,
        selected: 3,
      });
    } finally {
      consoleError.mockRestore();
    }

    expect(hostedAccountDeletionCleanup.findMany).toHaveBeenCalledWith({
      orderBy: [
        { nextAttemptAt: "asc" },
        { createdAt: "asc" },
      ],
      select: { id: true },
      take: 5,
      where: {
        nextAttemptAt: { lte: now },
      },
    });
    expect(rows.has("cleanup_complete")).toBe(false);
    expect(rows.get("cleanup_failed")).toMatchObject({
      lastAttemptedAt: now,
      lastErrorCode: "KMS_UNAVAILABLE",
      nextAttemptAt: new Date("2026-07-25T19:00:00.000Z"),
    });
    expect(rows.get("cleanup_pending")).toMatchObject({
      lastAttemptedAt: now,
      lastErrorCode: "CLOUDFLARE_NOT_CONFIGURED",
      nextAttemptAt: new Date("2026-07-25T19:00:00.000Z"),
    });
    expect(mocks.deleteHostedRunnerUserDataBestEffort).toHaveBeenCalledWith({
      context: "account-deletion-cleanup",
      userId: "member_pending",
    });
  });
});

interface CleanupRow {
  cloudflareCompletedAt: Date | null;
  createdAt: Date;
  environment: string;
  id: string;
  kmsKeyName: string;
  lastAttemptedAt: Date | null;
  lastErrorCode: string | null;
  nextAttemptAt: Date;
  payloadCiphertext: string;
  privyCompletedAt: Date | null;
  stripeCompletedAt: Date | null;
  updatedAt: Date;
}

function makeCleanupRow(input: {
  id: string;
  now: Date;
  payloadCiphertext: string;
}): CleanupRow {
  return {
    cloudflareCompletedAt: null,
    createdAt: input.now,
    environment: "test",
    id: input.id,
    kmsKeyName: KMS_KEY_NAME,
    lastAttemptedAt: null,
    lastErrorCode: null,
    nextAttemptAt: input.now,
    payloadCiphertext: input.payloadCiphertext,
    privyCompletedAt: input.now,
    stripeCompletedAt: input.now,
    updatedAt: input.now,
  };
}

class CleanupStore {
  blockReceiptDelete = false;
  row: CleanupRow | null = null;

  readonly prisma = {
    hostedAccountDeletionCleanup: {
      create: async ({ data }: { data: Omit<
        CleanupRow,
        "createdAt" | "lastAttemptedAt" | "lastErrorCode" | "updatedAt"
      > }) => {
        const now = new Date();
        this.row = {
          ...data,
          createdAt: now,
          lastAttemptedAt: null,
          lastErrorCode: null,
          updatedAt: now,
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
      findUnique: async ({ where }: { where: CleanupWhere }) =>
        this.matches(where) ? this.row : null,
      updateMany: async ({
        data,
        where,
      }: {
        data: Partial<CleanupRow>;
        where: CleanupWhere;
      }) => {
        if (!this.matches(where) || !this.row) {
          return { count: 0 };
        }
        this.row = {
          ...this.row,
          ...data,
          updatedAt: new Date(),
        };
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
    for (const [field, filter] of [
      ["cloudflareCompletedAt", where.cloudflareCompletedAt],
      ["privyCompletedAt", where.privyCompletedAt],
      ["stripeCompletedAt", where.stripeCompletedAt],
    ] as const) {
      if (filter?.not === null && row[field] === null) {
        return false;
      }
    }
    return true;
  }
}

type CleanupWhere = {
  cloudflareCompletedAt?: { not: null };
  id?: string;
  privyCompletedAt?: { not: null };
  stripeCompletedAt?: { not: null };
};

function makeCloudflareDeletionResult(input: {
  configured?: boolean;
  deleted: boolean;
}) {
  return {
    alarmCleared: input.deleted,
    configured: input.configured ?? true,
    deleted: input.deleted,
    errorCode: null,
    r2DeletedObjectCount: input.deleted ? 0 : null,
    r2SkippedUserScopedPrefixes: input.deleted ? false : null,
    r2Supported: input.deleted ? true : null,
    r2UserScopedSkipReason: null,
    runnerStateDeleted: input.deleted,
  };
}
