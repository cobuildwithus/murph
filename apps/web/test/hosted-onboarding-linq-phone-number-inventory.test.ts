import { Buffer } from "node:buffer";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingLinqConfig: () => ({
    apiBaseUrl: "https://linq.example.test/api/partner/v3",
    apiToken: "linq-token",
  }),
}));

import {
  parseHostedLinqPhoneNumberInventory,
  syncHostedLinqPhoneNumberInventory,
} from "@/src/lib/hosted-onboarding/linq-phone-number-inventory";

const TEST_KEYRING_ENTRIES = {
  v1: Buffer.from("1".repeat(32), "utf8").toString("base64"),
  v2: Buffer.from("2".repeat(32), "utf8").toString("base64"),
};

let restoreContactPrivacyKeyring: (() => void) | null = null;

beforeEach(() => {
  restoreContactPrivacyKeyring = configureHostedContactPrivacyKeyringForTest({
    currentVersion: "v1",
    entries: { v1: TEST_KEYRING_ENTRIES.v1 },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  restoreContactPrivacyKeyring?.();
  restoreContactPrivacyKeyring = null;
});

describe("syncHostedLinqPhoneNumberInventory", () => {
  const stubInventoryFetch = (payload: unknown, status = 200) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      typeof payload === "string" ? payload : JSON.stringify(payload),
      { headers: { "content-type": "application/json" }, status },
    )));
  };

  it("prepares the bounded snapshot before transaction entry and applies one bulk statement", async () => {
    const events: string[] = [];
    const queryRaw = vi.fn().mockImplementation(() => {
      events.push("bulk-statement");
      return Promise.resolve([{ syncedCount: 2n }]);
    });
    const tx = { $queryRaw: queryRaw };
    const transaction = vi.fn(async (
      callback: (client: typeof tx) => Promise<unknown>,
      options: unknown,
    ) => {
      events.push("transaction:start");
      expect(options).toEqual({ isolationLevel: "Serializable" });
      // Prepared lookup candidates and ciphertext must already be detached
      // from keyring state when transaction ownership begins.
      restoreContactPrivacyKeyring?.();
      restoreContactPrivacyKeyring = null;
      const result = await callback(tx);
      events.push("transaction:commit");
      return result;
    });
    stubInventoryFetch({
      phone_numbers: [
        {
          id: "line_2",
          phone_number: "+15550000002",
          reputation: { status: "AT_RISK" },
          status: "FLAGGED",
        },
        {
          id: "line_1",
          phone_number: "+1 (555) 000-0001",
          reputation: { status: "HEALTHY" },
          status: "ACTIVE",
        },
      ],
    });

    await expect(syncHostedLinqPhoneNumberInventory({
      observedAt: new Date("2026-07-01T12:00:00.000Z"),
      prisma: { $transaction: transaction } as never,
    })).resolves.toEqual({ syncedCount: 2 });

    expect(events).toEqual([
      "transaction:start",
      "bulk-statement",
      "transaction:commit",
    ]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const query = queryRaw.mock.calls[0]?.[0] as {
      sql: string;
      values: unknown[];
    };
    expect(query.sql).toContain("released_line AS");
    expect(query.sql).toContain("upserted_line AS");
    expect(query.sql).toContain("ON CONFLICT (phone_number_lookup_key)");
    expect(query.sql).not.toContain("pg_advisory_xact_lock");
    expect(query.sql).not.toContain("FOR UPDATE");
    expect(query.values).toEqual(expect.arrayContaining([
      "line_1",
      "line_2",
      "*** 0001",
      "*** 0002",
      "HEALTHY",
      "ACTIVE",
      "AT_RISK",
      "FLAGGED",
    ]));
    expect(JSON.stringify(query.values)).not.toContain("+1555000000");
  });

  it("uses one authoritative bulk statement for an explicitly empty inventory", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ syncedCount: 0n }]);
    stubInventoryFetch({ phone_numbers: [] });

    await expect(syncHostedLinqPhoneNumberInventory({
      prisma: { $queryRaw: queryRaw } as never,
    })).resolves.toEqual({ syncedCount: 0 });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const query = queryRaw.mock.calls[0]?.[0] as { sql: string };
    expect(query.sql).toContain("WHERE FALSE");
    expect(query.sql).toContain("provider_phone_number_id = NULL");
  });

  it("retries unique-key convergence without repeating preprocessing", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ syncedCount: 1n }]);
    const tx = { $queryRaw: queryRaw };
    let attempts = 0;
    const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
      attempts += 1;
      if (attempts === 1) {
        restoreContactPrivacyKeyring?.();
        restoreContactPrivacyKeyring = null;
        throw {
          code: "P2010",
          meta: {
            driverAdapterError: { cause: { originalCode: "23505" } },
          },
        };
      }
      return callback(tx);
    });
    stubInventoryFetch({
      phone_numbers: [{ id: "line_1", phone_number: "+15550000001" }],
    });

    await expect(syncHostedLinqPhoneNumberInventory({
      prisma: { $transaction: transaction } as never,
    })).resolves.toEqual({ syncedCount: 1 });

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("does not enter a transaction when the provider read fails", async () => {
    const transaction = vi.fn();
    stubInventoryFetch("upstream error", 503);

    await expect(syncHostedLinqPhoneNumberInventory({
      prisma: { $transaction: transaction } as never,
    })).rejects.toMatchObject({
      code: "LINQ_PHONE_NUMBER_INVENTORY_FAILED",
    });

    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing collection field", {}],
    ["an invalid phone number", {
      phone_numbers: [{ id: "line_1", phone_number: "not-a-phone" }],
    }],
    ["a duplicate phone number", {
      phone_numbers: [
        { id: "line_1", phone_number: "+15550000001" },
        { id: "line_2", phone_number: "+1 (555) 000-0001" },
      ],
    }],
    ["a missing provider id", {
      phone_numbers: [{ phone_number: "+15550000001" }],
    }],
    ["a duplicate provider id", {
      phone_numbers: [
        { id: "line_1", phone_number: "+15550000001" },
        { id: "line_1", phone_number: "+15550000002" },
      ],
    }],
  ])("rejects %s before transaction entry", async (_label, payload) => {
    const transaction = vi.fn();
    stubInventoryFetch(payload);

    await expect(syncHostedLinqPhoneNumberInventory({
      prisma: { $transaction: transaction } as never,
    })).rejects.toMatchObject({
      code: "LINQ_PHONE_NUMBER_INVENTORY_INVALID",
    });

    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("parseHostedLinqPhoneNumberInventory", () => {
  it("keeps line service and reputation independent", () => {
    expect(
      parseHostedLinqPhoneNumberInventory({
        phone_numbers: [
          {
            id: "line_1",
            phone_number: "+1 (555) 000-0001",
            reputation: {
              doc_url: "https://docs.example.test/reputation",
              status: "AT_RISK",
            },
            status: "ACTIVE",
          },
          {
            id: "duplicate",
            phone_number: "+15550000001",
            reputation: { status: "HEALTHY" },
          },
          {
            health_status: {
              status: "HEALTHY",
            },
            id: "line_2",
            phone_number: "+15550000002",
            status: "FLAGGED",
          },
          {
            phone_number: "not-a-phone",
            reputation: { status: "HEALTHY" },
          },
        ],
      }),
    ).toEqual([
      {
        phoneNumber: "+15550000001",
        providerPhoneNumberId: "line_1",
        providerReputationStatus: "AT_RISK",
        providerServiceStatus: "ACTIVE",
      },
      {
        phoneNumber: "+15550000002",
        providerPhoneNumberId: "line_2",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "FLAGGED",
      },
    ]);
  });

  it("does not coerce unknown provider states", () => {
    expect(parseHostedLinqPhoneNumberInventory({
      phone_numbers: [{
        id: "line_future",
        phone_number: "+15550000003",
        reputation: { status: "PAUSED" },
        status: "WARMING",
      }],
    })).toEqual([{
      phoneNumber: "+15550000003",
      providerPhoneNumberId: "line_future",
      providerReputationStatus: null,
      providerServiceStatus: null,
    }]);
  });

  it("does not accept ad hoc collection or phone field aliases", () => {
    expect(
      parseHostedLinqPhoneNumberInventory({
        data: [
          {
            id: "line_1",
            number: "+15550000001",
            status: "ACTIVE",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("fails visibly when provider inventory exceeds the configured sync limit", () => {
    expect(() => parseHostedLinqPhoneNumberInventory({
      phone_numbers: [
        { id: "line_1", phone_number: "+15550000001" },
        { id: "line_2", phone_number: "+15550000002" },
      ],
    }, {
      maxLines: 1,
    })).toThrow(/exceeds the configured 1 line limit/u);
  });
});

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
