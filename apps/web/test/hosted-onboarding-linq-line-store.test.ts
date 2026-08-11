import { Buffer } from "node:buffer";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  assertHostedLinqAssignableHomeLinePoolReady,
  claimHostedLinqProactiveConversationCapacityTx,
  hasActiveHostedLinqManagedLine,
  readActiveHostedLinqManagedLineLookupKeys,
  HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT,
  listHostedLinqAssignableHomeLines,
  listHostedLinqContactCardLines,
  readHostedLinqRecentMessageEffectCountsTx,
  readHostedLinqIncomingLineState,
  readHostedLinqReceiptCorrelatedRecoveryLineTx,
  syncHostedLinqConfiguredLinesTx,
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
          configuredAt: new Date("2026-06-30T11:00:00.000Z"),
          providerLastSeenAt: new Date("2026-06-30T12:00:00.000Z"),
          providerReputationStatus: "HEALTHY",
          providerServiceStatus: "ACTIVE",
        }),
      ])
      .mockResolvedValueOnce([
        buildLineRow("+15550100002", {
          providerLastSeenAt: new Date("2026-06-30T12:10:00.000Z"),
          providerReputationStatus: "AT_RISK",
          providerServiceStatus: "ACTIVE",
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
        isConfigured: true,
        phoneNumber: "+15550100001",
        phoneNumberHint: "*** 0001",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      },
      {
        isConfigured: false,
        phoneNumber: "+15550100002",
        phoneNumberHint: "*** 0002",
        providerReputationStatus: "AT_RISK",
        providerServiceStatus: "ACTIVE",
      },
    ]);

    expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      take: 2,
      where: {
        configuredAt: { not: null },
        phoneNumberEncrypted: { not: null },
        providerInventoryConfirmedAt: { gte: expect.any(Date) },
        providerPhoneNumberId: { not: null },
      },
    }));
    expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      take: 1,
      where: {
        configuredAt: null,
        phoneNumberEncrypted: { not: null },
        providerInventoryConfirmedAt: { gte: expect.any(Date) },
        providerPhoneNumberId: { not: null },
        providerSeenAt: { not: null },
      },
    }));
  });

  it("excludes provider-only rows that the phone-number inventory has not vouched for", async () => {
    // Chat-health sync stamps providerSeenAt on lines derived from chat
    // handles, which can reference numbers the account no longer owns. Only
    // inventory-backed rows (providerPhoneNumberId set) may join the batch.
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      hostedLinqLine: {
        findMany,
      },
    } as never;

    await expect(
      listHostedLinqContactCardLines({
        prisma,
      }),
    ).resolves.toEqual([]);

    expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        providerPhoneNumberId: { not: null },
      }),
    }));
  });
});

describe("hasActiveHostedLinqManagedLine", () => {
  it("recognizes configured inbound lines independently of outbound health", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      phoneNumberLookupKey: "lookup:line",
    }]);

    await expect(hasActiveHostedLinqManagedLine({
      phoneNumberLookupKeys: ["lookup:line"],
      prisma: {
        hostedLinqLine: { findMany },
      } as never,
    })).resolves.toBe(true);

    expect(findMany).toHaveBeenCalledWith({
      select: { phoneNumberLookupKey: true },
      where: {
        configuredAt: { not: null },
        phoneNumberEncrypted: { not: null },
        phoneNumberLookupKey: { in: ["lookup:line"] },
      },
    });
  });

  it("returns every active managed line from one set read", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { phoneNumberLookupKey: "lookup:a" },
      { phoneNumberLookupKey: "lookup:b" },
    ]);

    await expect(readActiveHostedLinqManagedLineLookupKeys({
      phoneNumberLookupKeys: ["lookup:b", "lookup:a", "lookup:b"],
      prisma: { hostedLinqLine: { findMany } } as never,
    })).resolves.toEqual(new Set(["lookup:a", "lookup:b"]));

    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      select: { phoneNumberLookupKey: true },
      where: {
        configuredAt: { not: null },
        phoneNumberEncrypted: { not: null },
        phoneNumberLookupKey: { in: ["lookup:b", "lookup:a"] },
      },
    });
  });
});

describe("listHostedLinqAssignableHomeLines", () => {
  it("bounds the assignable pool read before decrypting line phones", async () => {
    const proactiveConversationDayUtc = new Date("2026-07-16T00:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([
      buildAssignableLineRow("+15550100001", {
        proactiveConversationCount: 12,
        proactiveConversationDayUtc,
      }),
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
        proactiveConversationCount: 12,
        proactiveConversationDayUtc,
      },
    ]);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT + 1,
      where: {
        configuredAt: { not: null },
        egressPolicy: "enabled",
        healthStatus: { in: ["healthy", "unknown"] },
        phoneNumberEncrypted: { not: null },
        AND: [
          {
            OR: [
              { providerServiceStatus: null },
              { providerServiceStatus: { not: "FLAGGED" } },
            ],
          },
          {
            OR: [
              { providerReputationStatus: null },
              { providerReputationStatus: { notIn: ["AT_RISK", "CRITICAL"] } },
            ],
          },
        ],
      },
    }));
    expect(findMany).toHaveBeenCalledTimes(1);
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

describe("readHostedLinqIncomingLineState", () => {
  it("distinguishes assignable, exact at-risk, hard-blocked, and degraded line states", async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([
        buildIncomingLineRow("+15550100001", {
          healthStatus: "healthy",
          providerReputationStatus: "HEALTHY",
          providerServiceStatus: "ACTIVE",
        }),
      ])
      .mockResolvedValueOnce([
        buildIncomingLineRow("+15550100001", {
          healthStatus: "healthy",
          providerReputationStatus: "AT_RISK",
          providerServiceStatus: "ACTIVE",
        }),
      ])
      .mockResolvedValueOnce([
        buildIncomingLineRow("+15550100001", {
          healthStatus: "healthy",
          providerReputationStatus: "HEALTHY",
          providerServiceStatus: "FLAGGED",
        }),
      ])
      .mockResolvedValueOnce([
        buildIncomingLineRow("+15550100001", {
          healthStatus: "warning",
          providerReputationStatus: "HEALTHY",
          providerServiceStatus: "ACTIVE",
        }),
      ]);
    const prisma = {
      hostedLinqLine: { findMany },
    } as never;
    const phoneNumberLookupKeys =
      createHostedPhoneLookupKeyReadCandidates("+15550100001");

    await expect(readHostedLinqIncomingLineState({
      phoneNumberLookupKeys,
      prisma,
    })).resolves.toMatchObject({ kind: "assignable" });
    await expect(readHostedLinqIncomingLineState({
      phoneNumberLookupKeys,
      prisma,
    })).resolves.toMatchObject({ kind: "at_risk" });
    await expect(readHostedLinqIncomingLineState({
      phoneNumberLookupKeys,
      prisma,
    })).resolves.toMatchObject({ kind: "hard_blocked" });
    await expect(readHostedLinqIncomingLineState({
      phoneNumberLookupKeys,
      prisma,
    })).resolves.toEqual({ kind: "degraded_unavailable" });
  });

  it("fails closed for ambiguous or structurally unavailable incoming lines", async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([
        buildIncomingLineRow("+15550100001", {
          phoneNumberLookupKey: "lookup:current",
        }),
        buildIncomingLineRow("+15550100001", {
          phoneNumberLookupKey: "lookup:legacy",
        }),
      ])
      .mockResolvedValueOnce([
        buildIncomingLineRow("+15550100001", {
          configuredAt: null,
          healthStatus: "unhealthy",
          providerReputationStatus: "CRITICAL",
        }),
      ]);
    const prisma = {
      hostedLinqLine: { findMany },
    } as never;

    await expect(readHostedLinqIncomingLineState({
      phoneNumberLookupKeys: ["lookup:current", "lookup:legacy"],
      prisma,
    })).resolves.toEqual({ kind: "conflicting" });
    await expect(readHostedLinqIncomingLineState({
      phoneNumberLookupKeys: ["lookup:current"],
      prisma,
    })).resolves.toEqual({ kind: "structurally_unavailable" });
  });
});

describe("readHostedLinqReceiptCorrelatedRecoveryLineTx", () => {
  const expectedFailureReceiptEventId =
    "hbidx:linq-provider-event:failed-recovery";
  const phoneNumber = "+15550100042";
  const phoneNumberLookupKey =
    createHostedPhoneLookupKey(phoneNumber) ?? "lookup:recovery";

  it("allows the exact warning projection caused by the failed recovery receipt", async () => {
    const findUnique = vi.fn().mockResolvedValue(
      buildReceiptCorrelatedRecoveryLineRow(phoneNumber, {
        healthStatus: "warning",
        lastReceiptEventId: expectedFailureReceiptEventId,
      }),
    );
    const prisma = {
      hostedLinqLine: { findUnique },
    } as never;

    await expect(readHostedLinqReceiptCorrelatedRecoveryLineTx({
      expectedFailureReceiptEventId,
      phoneNumberLookupKey,
      prisma,
    })).resolves.toEqual({
      phoneNumber,
      phoneNumberLookupKey,
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: { phoneNumberLookupKey },
      select: {
        configuredAt: true,
        egressPolicy: true,
        healthStatus: true,
        lastReceiptEventId: true,
        phoneNumberEncrypted: true,
        phoneNumberLookupKey: true,
        providerReputationStatus: true,
        providerServiceStatus: true,
      },
    });
  });

  it("continues to allow a healthy pinned line without requiring a stale receipt match", async () => {
    const prisma = {
      hostedLinqLine: {
        findUnique: vi.fn().mockResolvedValue(
          buildReceiptCorrelatedRecoveryLineRow(phoneNumber, {
            healthStatus: "healthy",
            lastReceiptEventId: "hbidx:linq-provider-event:later-success",
          }),
        ),
      },
    } as never;

    await expect(readHostedLinqReceiptCorrelatedRecoveryLineTx({
      expectedFailureReceiptEventId,
      phoneNumberLookupKey,
      prisma,
    })).resolves.toEqual({
      phoneNumber,
      phoneNumberLookupKey,
    });
  });

  it.each([
    {
      label: "a newer receipt replaced the failed recovery receipt",
      overrides: {
        healthStatus: "warning",
        lastReceiptEventId: "hbidx:linq-provider-event:newer-failure",
      },
    },
    {
      label: "the provider reports the line at risk",
      overrides: {
        healthStatus: "warning",
        lastReceiptEventId: expectedFailureReceiptEventId,
        providerReputationStatus: "AT_RISK",
      },
    },
    {
      label: "the provider hard-blocked the line",
      overrides: {
        healthStatus: "warning",
        lastReceiptEventId: expectedFailureReceiptEventId,
        providerReputationStatus: "CRITICAL",
      },
    },
    {
      label: "the line became unhealthy",
      overrides: {
        healthStatus: "unhealthy",
        lastReceiptEventId: expectedFailureReceiptEventId,
      },
    },
    {
      label: "the line is disabled",
      overrides: {
        egressPolicy: "disabled",
        healthStatus: "warning",
        lastReceiptEventId: expectedFailureReceiptEventId,
      },
    },
    {
      label: "the line is no longer configured",
      overrides: {
        configuredAt: null,
        healthStatus: "warning",
        lastReceiptEventId: expectedFailureReceiptEventId,
      },
    },
    {
      label: "the line phone cannot be decrypted",
      overrides: {
        healthStatus: "warning",
        lastReceiptEventId: expectedFailureReceiptEventId,
        phoneNumberEncrypted: "not-an-encrypted-phone-envelope",
      },
    },
  ])("fails closed when $label", async ({ overrides }) => {
    const prisma = {
      hostedLinqLine: {
        findUnique: vi.fn().mockResolvedValue(
          buildReceiptCorrelatedRecoveryLineRow(phoneNumber, overrides),
        ),
      },
    } as never;

    await expect(readHostedLinqReceiptCorrelatedRecoveryLineTx({
      expectedFailureReceiptEventId,
      phoneNumberLookupKey,
      prisma,
    })).resolves.toBeNull();
  });
});

describe("assertHostedLinqAssignableHomeLinePoolReady", () => {
  it("passes when at least one configured provider-eligible line exists", async () => {
    const prisma = {
      hostedLinqLine: {
        findMany: vi.fn().mockResolvedValue([
          buildAssignableLineRow("+15550100001"),
        ]),
      },
    } as never;

    await expect(assertHostedLinqAssignableHomeLinePoolReady({ prisma }))
      .resolves.toBeUndefined();
  });

  it("fails visibly when no provider-eligible configured line remains", async () => {
    const prisma = {
      hostedLinqLine: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as never;

    await expect(assertHostedLinqAssignableHomeLinePoolReady({ prisma }))
      .rejects.toMatchObject({
        code: "HOSTED_LINQ_ASSIGNABLE_LINE_POOL_REQUIRED",
        httpStatus: 500,
      });
  });
});

describe("readHostedLinqRecentMessageEffectCountsTx", () => {
  it("reads one bounded trailing-window aggregate from canonical message owners", async () => {
    const now = new Date("2026-07-29T15:00:00.000Z");
    const queryRaw = vi.fn().mockResolvedValue([
      {
        messageEffectCount: 101n,
        phoneNumberLookupKey: "lookup:line-1",
      },
      {
        messageEffectCount: 7n,
        phoneNumberLookupKey: "lookup:line-2",
      },
    ]);

    await expect(
      readHostedLinqRecentMessageEffectCountsTx({
        lineLookupKeys: [
          "lookup:line-1",
          "lookup:line-2",
          "lookup:line-1",
        ],
        now,
        prisma: { $queryRaw: queryRaw } as never,
      }),
    ).resolves.toEqual(new Map([
      ["lookup:line-1", 101],
      ["lookup:line-2", 7],
    ]));

    const query = queryRaw.mock.calls[0]?.[0] as {
      sql: string;
      values: unknown[];
    };
    expect(query.sql).toContain('FROM "hosted_linq_delivery"');
    expect(query.sql).toContain('"accepted_at" >=');
    expect(query.sql).toContain('FROM "hosted_linq_provider_event"');
    expect(query.sql).toContain('"event_type" = \'message.received\'');
    expect(query.sql).toContain('"direction" = \'inbound\'');
    expect(query.sql).toContain('"received_at" >=');
    expect(query.sql).toContain('SUM("message_effect_count")');
    expect(query.values).toEqual([
      "lookup:line-1",
      "lookup:line-2",
      new Date("2026-07-22T15:00:00.000Z"),
      now,
      "lookup:line-1",
      "lookup:line-2",
      new Date("2026-07-22T15:00:00.000Z"),
      now,
    ]);
  });

  it("does not query when there are no candidate lines", async () => {
    const queryRaw = vi.fn();

    await expect(
      readHostedLinqRecentMessageEffectCountsTx({
        lineLookupKeys: [],
        now: new Date("2026-07-29T15:00:00.000Z"),
        prisma: { $queryRaw: queryRaw } as never,
      }),
    ).resolves.toEqual(new Map());

    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("fails before querying beyond the reviewed candidate bound", async () => {
    const queryRaw = vi.fn();

    await expect(
      readHostedLinqRecentMessageEffectCountsTx({
        lineLookupKeys: Array.from(
          { length: HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT + 1 },
          (_, index) => `lookup:line-${index}`,
        ),
        now: new Date("2026-07-29T15:00:00.000Z"),
        prisma: { $queryRaw: queryRaw } as never,
      }),
    ).rejects.toThrow(/at most 250 candidate line/u);

    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("hosted Linq proactive-conversation capacity", () => {
  const dayUtc = new Date("2026-07-16T00:00:00.000Z");

  it("increments the current day only while the hard limit has room", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });

    await expect(
      claimHostedLinqProactiveConversationCapacityTx({
        dayUtc,
        limit: 50,
        phoneNumberLookupKey: "lookup:line-1",
        prisma: {
          hostedLinqLine: { updateMany },
        } as never,
      }),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        phoneNumberLookupKey: "lookup:line-1",
        proactiveConversationCount: { lt: 50 },
        proactiveConversationDayUtc: dayUtc,
      },
      data: {
        proactiveConversationCount: { increment: 1 },
      },
    });
  });

  it("lazily starts a new UTC day without carrying yesterday's count", async () => {
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(
      claimHostedLinqProactiveConversationCapacityTx({
        dayUtc,
        limit: 50,
        phoneNumberLookupKey: "lookup:line-1",
        prisma: {
          hostedLinqLine: { updateMany },
        } as never,
      }),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        phoneNumberLookupKey: "lookup:line-1",
        OR: [
          { proactiveConversationDayUtc: null },
          { proactiveConversationDayUtc: { not: dayUtc } },
        ],
      },
      data: {
        proactiveConversationCount: 1,
        proactiveConversationDayUtc: dayUtc,
      },
    });
  });

  it("fails closed when the selected line reached its limit", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });

    await expect(
      claimHostedLinqProactiveConversationCapacityTx({
        dayUtc,
        limit: 50,
        phoneNumberLookupKey: "lookup:line-1",
        prisma: {
          hostedLinqLine: { updateMany },
        } as never,
      }),
    ).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("can require the selected line to remain healthy while claiming capacity", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });

    await expect(
      claimHostedLinqProactiveConversationCapacityTx({
        dayUtc,
        limit: 50,
        phoneNumberLookupKey: "lookup:line-1",
        prisma: {
          hostedLinqLine: { updateMany },
        } as never,
        requiredHealthStatus: "healthy",
      }),
    ).resolves.toBe(false);

    for (const call of updateMany.mock.calls) {
      expect(call[0].where).toMatchObject({
        configuredAt: { not: null },
        egressPolicy: "enabled",
        healthStatus: "healthy",
        phoneNumberEncrypted: { not: null },
        phoneNumberLookupKey: "lookup:line-1",
      });
    }
  });
});

describe("syncHostedLinqConfiguredLinesTx", () => {
  it("prepares every line before opening one transaction and issuing one bulk statement", async () => {
    restoreContactPrivacyKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: TEST_KEYRING_ENTRIES,
    });
    const events: string[] = [];
    const queryRaw = vi.fn().mockImplementation(() => {
      events.push("bulk-statement");
      return Promise.resolve([{ syncedCount: 2n }]);
    });
    const transactionClient = { $queryRaw: queryRaw };
    const transaction = vi.fn(async (
      callback: (tx: typeof transactionClient) => Promise<unknown>,
    ) => {
      events.push("transaction:start");
      restoreContactPrivacyKeyring?.();
      restoreContactPrivacyKeyring = null;
      const result = await callback(transactionClient);
      events.push("transaction:commit");
      return result;
    });
    const phoneNumbers = ["+15550100002", "+1 (555) 010-0001"];

    await syncHostedLinqConfiguredLinesTx({
      activeMemberLimit: 250,
      observedAt: new Date("2026-06-30T12:00:00.000Z"),
      phoneNumbers,
      prisma: { $transaction: transaction } as never,
    });

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
    expect(query.sql).toContain("WITH input_line");
    expect(query.sql).toContain("ON CONFLICT (phone_number_lookup_key)");
    expect(query.sql).not.toContain("pg_advisory_xact_lock");
    expect(query.sql).not.toContain("FOR UPDATE");
    expect(query.values).toEqual(expect.arrayContaining([
      "*** 0001",
      "*** 0002",
      250,
    ]));
    expect(JSON.stringify(query.values)).not.toContain("+1555010000");
  });

  it("rejects invalid preparation before transaction entry", async () => {
    restoreContactPrivacyKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: TEST_KEYRING_ENTRIES,
    });
    const transaction = vi.fn();

    await expect(syncHostedLinqConfiguredLinesTx({
      activeMemberLimit: null,
      phoneNumbers: ["not-a-phone"],
      prisma: { $transaction: transaction } as never,
    })).rejects.toThrow(/valid phone number/u);

    expect(transaction).not.toHaveBeenCalled();
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
    configuredAt?: Date | null;
    providerLastSeenAt: Date;
    providerReputationStatus: string;
    providerServiceStatus: string;
  },
) {
  return {
    configuredAt: input.configuredAt ?? null,
    phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(phoneNumber),
    phoneNumberHint: `*** ${phoneNumber.slice(-4)}`,
    phoneNumberLookupKey: `lookup:${phoneNumber}`,
    providerLastSeenAt: input.providerLastSeenAt,
    providerReputationStatus: input.providerReputationStatus,
    providerServiceStatus: input.providerServiceStatus,
  };
}

function buildAssignableLineRow(
  phoneNumber: string,
  overrides: Partial<{
    proactiveConversationCount: number | null;
    proactiveConversationDayUtc: Date | null;
  }> = {},
) {
  return {
    activeMemberLimit: null,
    assignmentWeight: 100,
    maxNewConversationsPerDay: null,
    phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(phoneNumber),
    phoneNumberHint: `*** ${phoneNumber.slice(-4)}`,
    phoneNumberLookupKey: createHostedPhoneLookupKey(phoneNumber) ?? `lookup:${phoneNumber}`,
    proactiveConversationCount: overrides.proactiveConversationCount ?? null,
    proactiveConversationDayUtc: overrides.proactiveConversationDayUtc ?? null,
  };
}

function buildIncomingLineRow(
  phoneNumber: string,
  overrides: Partial<{
    configuredAt: Date | null;
    egressPolicy: string;
    healthStatus: string;
    phoneNumberEncrypted: string | null;
    phoneNumberLookupKey: string;
    providerReputationStatus: string | null;
    providerServiceStatus: string | null;
  }> = {},
) {
  return {
    configuredAt:
      overrides.configuredAt === undefined
        ? new Date("2026-07-16T12:00:00.000Z")
        : overrides.configuredAt,
    egressPolicy: overrides.egressPolicy ?? "enabled",
    healthStatus: overrides.healthStatus ?? "healthy",
    phoneNumberEncrypted:
      overrides.phoneNumberEncrypted === undefined
        ? encryptHostedLinqLinePhoneNumber(phoneNumber)
        : overrides.phoneNumberEncrypted,
    phoneNumberLookupKey:
      overrides.phoneNumberLookupKey
      ?? createHostedPhoneLookupKey(phoneNumber)
      ?? `lookup:${phoneNumber}`,
    providerReputationStatus:
      overrides.providerReputationStatus ?? "HEALTHY",
    providerServiceStatus: overrides.providerServiceStatus ?? "ACTIVE",
  };
}

function buildReceiptCorrelatedRecoveryLineRow(
  phoneNumber: string,
  overrides: Partial<{
    configuredAt: Date | null;
    egressPolicy: string;
    healthStatus: string;
    lastReceiptEventId: string | null;
    phoneNumberEncrypted: string | null;
    providerReputationStatus: string | null;
    providerServiceStatus: string | null;
  }> = {},
) {
  return {
    configuredAt:
      overrides.configuredAt === undefined
        ? new Date("2026-07-29T12:00:00.000Z")
        : overrides.configuredAt,
    egressPolicy: overrides.egressPolicy ?? "enabled",
    healthStatus: overrides.healthStatus ?? "healthy",
    lastReceiptEventId: overrides.lastReceiptEventId ?? null,
    phoneNumberEncrypted:
      overrides.phoneNumberEncrypted === undefined
        ? encryptHostedLinqLinePhoneNumber(phoneNumber)
        : overrides.phoneNumberEncrypted,
    phoneNumberLookupKey:
      createHostedPhoneLookupKey(phoneNumber) ?? "lookup:recovery",
    providerReputationStatus:
      overrides.providerReputationStatus ?? "HEALTHY",
    providerServiceStatus: overrides.providerServiceStatus ?? "ACTIVE",
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
