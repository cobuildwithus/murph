import { Buffer } from "node:buffer";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
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

  it("updates an existing legacy lookup-key row after contact privacy key rotation", async () => {
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
        activeMemberLimit: 250,
        configuredAt: observedAt,
        phoneNumberHint: "*** 0001",
        source: "configured",
      }),
    }));
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
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
