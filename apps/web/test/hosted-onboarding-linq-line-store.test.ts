import { Buffer } from "node:buffer";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  assertHostedLinqAssignableHomeLinePoolReady,
  HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT,
  listHostedLinqAssignableHomeLines,
  listHostedLinqContactCardLines,
  upsertHostedLinqLineForPhoneTx,
} from "@/src/lib/hosted-onboarding/linq-line-store";
import {
  encryptHostedLinqLinePhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-line-phone-codec";

const TEST_KEYRING_ENTRIES = {
  v1: Buffer.from("1".repeat(32), "utf8").toString("base64"),
  v2: Buffer.from("2".repeat(32), "utf8").toString("base64"),
};

let restoreContactPrivacyKeyring: (() => void) | null = null;

afterEach(() => {
  restoreContactPrivacyKeyring?.();
  restoreContactPrivacyKeyring = null;
});

describe("listHostedLinqContactCardLines", () => {
  it("fills the contact-card batch with configured sending lines before provider-only inventory", async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([
        buildLineRow("+15550100001", {
          providerLastSeenAt: new Date("2026-06-30T12:00:00.000Z"),
          providerStatus: "ACTIVE",
        }),
      ])
      .mockResolvedValueOnce([
        buildLineRow("+15550100002", {
          providerLastSeenAt: new Date("2026-06-30T12:10:00.000Z"),
          providerStatus: "ACTIVE",
        }),
      ]);
    const prisma = {
      hostedLinqLine: {
        findMany,
      },
    } as never;

    await expect(
      listHostedLinqContactCardLines({
        limit: 2,
        prisma,
      }),
    ).resolves.toMatchObject([
      {
        phoneNumber: "+15550100001",
        phoneNumberHint: "*** 0001",
      },
      {
        phoneNumber: "+15550100002",
        phoneNumberHint: "*** 0002",
      },
    ]);

    expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      take: 2,
      where: {
        configuredAt: { not: null },
        phoneNumberEncrypted: { not: null },
      },
    }));
    expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      take: 1,
      where: {
        configuredAt: null,
        phoneNumberEncrypted: { not: null },
        providerSeenAt: { not: null },
      },
    }));
  });
});

describe("listHostedLinqAssignableHomeLines", () => {
  it("bounds the assignable pool read before decrypting line phones", async () => {
    const findMany = vi.fn().mockResolvedValue([
      buildAssignableLineRow("+15550100001"),
    ]);
    const prisma = {
      hostedLinqLine: {
        findMany,
      },
    } as never;

    await expect(
      listHostedLinqAssignableHomeLines({
        prisma,
      }),
    ).resolves.toMatchObject([
      {
        phoneNumber: "+15550100001",
        phoneNumberHint: "*** 0001",
      },
    ]);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT + 1,
      where: {
        configuredAt: { not: null },
        egressPolicy: "enabled",
        healthStatus: { in: ["healthy", "unknown"] },
        phoneNumberEncrypted: { not: null },
      },
    }));
  });

  it("fails closed when the configured assignable pool exceeds the reviewed cap", async () => {
    const findMany = vi.fn().mockResolvedValue(
      Array.from(
        { length: HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT + 1 },
        (_, index) => buildAssignableLineRow(`+1555010${String(index).padStart(4, "0")}`),
      ),
    );
    const prisma = {
      hostedLinqLine: {
        findMany,
      },
    } as never;

    await expect(
      listHostedLinqAssignableHomeLines({
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_ASSIGNABLE_LINE_LIMIT_EXCEEDED",
      httpStatus: 500,
    });
  });
});

describe("assertHostedLinqAssignableHomeLinePoolReady", () => {
  it("passes when at least one configured assignable DB line exists", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      phoneNumberLookupKey: "lookup:line",
    });
    const prisma = {
      hostedLinqLine: {
        findFirst,
      },
    } as never;

    await expect(
      assertHostedLinqAssignableHomeLinePoolReady({
        prisma,
      }),
    ).resolves.toBeUndefined();
  });

  it("fails visibly when production cutover would leave the DB line pool empty", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = {
      hostedLinqLine: {
        findFirst,
      },
    } as never;

    await expect(
      assertHostedLinqAssignableHomeLinePoolReady({
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_ASSIGNABLE_LINE_POOL_REQUIRED",
      httpStatus: 500,
    });
  });
});

describe("upsertHostedLinqLineForPhoneTx", () => {
  it("keeps the advisory lock, candidate lookup, and upsert inside one transaction for plain clients", async () => {
    const events: string[] = [];
    const transactionClient = {
      $executeRaw: vi.fn().mockImplementation(() => {
        events.push("lock");
        return Promise.resolve([]);
      }),
      hostedLinqLine: {
        findMany: vi.fn().mockImplementation(() => {
          events.push("candidate-read");
          return Promise.resolve([]);
        }),
        upsert: vi.fn().mockImplementation((input: { create: { phoneNumberLookupKey: string } }) => {
          events.push("write");
          return Promise.resolve({
            phoneNumberLookupKey: input.create.phoneNumberLookupKey,
          });
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (
        callback: (tx: typeof transactionClient) => Promise<unknown>,
      ) => {
        events.push("transaction:start");
        const result = await callback(transactionClient);
        events.push("transaction:commit");
        return result;
      }),
    };

    await expect(
      upsertHostedLinqLineForPhoneTx({
        observedAt: new Date("2026-06-30T12:00:00.000Z"),
        phoneNumber: "+15550100001",
        prisma: prisma as never,
        source: "webhook",
      }),
    ).resolves.toEqual({
      phoneNumberLookupKey: expect.stringMatching(/^hbidx:phone:/u),
    });

    expect(events).toEqual([
      "transaction:start",
      "lock",
      "candidate-read",
      "write",
      "transaction:commit",
    ]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.hostedLinqLine.upsert).toHaveBeenCalledTimes(1);
  });

  it("updates an existing legacy lookup-key row and bootstraps missing configured caps", async () => {
    restoreContactPrivacyKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: TEST_KEYRING_ENTRIES,
    });
    const phoneNumber = "+15550100001";
    const legacyLookupKey = createHostedPhoneLookupKey(phoneNumber);

    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v2";
    clearHostedOnboardingEnvCache();
    const currentLookupKey = createHostedPhoneLookupKey(phoneNumber);

    if (!legacyLookupKey || !currentLookupKey) {
      throw new Error("Expected hosted phone lookup keys for test phone number.");
    }

    expect(legacyLookupKey).toMatch(/^hbidx:phone:v1:/u);
    expect(currentLookupKey).toMatch(/^hbidx:phone:v2:/u);

    const executeRaw = vi.fn().mockResolvedValue([]);
    const findMany = vi.fn().mockResolvedValue([
      {
        phoneNumberLookupKey: legacyLookupKey,
      },
    ]);
    const update = vi.fn().mockResolvedValue({
      phoneNumberLookupKey: legacyLookupKey,
    });
    const create = vi.fn();
    const updateMany = vi.fn();
    const prisma = {
      $executeRaw: executeRaw,
      hostedLinqLine: {
        create,
        findMany,
        update,
        updateMany,
      },
    } as never;
    const observedAt = new Date("2026-06-30T12:00:00.000Z");

    await expect(
      upsertHostedLinqLineForPhoneTx({
        activeMemberLimit: 250,
        observedAt,
        phoneNumber,
        prisma,
        source: "configured",
      }),
    ).resolves.toEqual({
      phoneNumberLookupKey: legacyLookupKey,
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        phoneNumberLookupKey: {
          in: expect.arrayContaining([currentLookupKey, legacyLookupKey]),
        },
      },
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        phoneNumberLookupKey: legacyLookupKey,
      },
      data: expect.objectContaining({
        configuredAt: observedAt,
        phoneNumberHint: "*** 0001",
        source: "configured",
      }),
    }));
    expect(update.mock.calls[0]?.[0].data).not.toHaveProperty("activeMemberLimit");
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        activeMemberLimit: null,
        phoneNumberLookupKey: legacyLookupKey,
      },
      data: {
        activeMemberLimit: 250,
      },
    });
    expect(create).not.toHaveBeenCalled();
  });
});

function buildLineRow(
  phoneNumber: string,
  input: {
    providerLastSeenAt: Date;
    providerStatus: string;
  },
) {
  return {
    phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(phoneNumber),
    phoneNumberHint: `*** ${phoneNumber.slice(-4)}`,
    phoneNumberLookupKey: `lookup:${phoneNumber}`,
    providerLastSeenAt: input.providerLastSeenAt,
    providerStatus: input.providerStatus,
  };
}

function buildAssignableLineRow(phoneNumber: string) {
  return {
    activeMemberLimit: null,
    assignmentWeight: 100,
    maxNewConversationsPerDay: null,
    phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(phoneNumber),
    phoneNumberHint: `*** ${phoneNumber.slice(-4)}`,
    phoneNumberLookupKey: createHostedPhoneLookupKey(phoneNumber) ?? `lookup:${phoneNumber}`,
  };
}

function configureHostedContactPrivacyKeyringForTest(input: {
  currentVersion: string;
  entries: Record<string, string>;
}): () => void {
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousCurrentVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

  process.env.HOSTED_CONTACT_PRIVACY_KEYS = Object.entries(input.entries)
    .map(([version, key]) => `${version}:${key}`)
    .join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = input.currentVersion;
  clearHostedOnboardingEnvCache();

  return () => {
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", previousCurrentVersion);
    clearHostedOnboardingEnvCache();
  };
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
