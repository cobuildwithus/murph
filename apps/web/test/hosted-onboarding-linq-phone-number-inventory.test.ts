import { afterEach, describe, expect, it, vi } from "vitest";

const lineStoreMocks = vi.hoisted(() => ({
  upsertHostedLinqLineForPhoneTx: vi.fn(),
}));

const providerHealthStoreMocks = vi.hoisted(() => ({
  projectHostedLinqLineProviderStateTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  acquireHostedLinqInventoryApplyLockTx: async (
    input: { prisma: { $executeRaw: (...args: unknown[]) => Promise<unknown> } },
  ) => {
    await input.prisma.$executeRaw();
  },
  upsertHostedLinqLineForPhoneTx: lineStoreMocks.upsertHostedLinqLineForPhoneTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-provider-health-store", () => ({
  projectHostedLinqLineProviderStateTx: providerHealthStoreMocks.projectHostedLinqLineProviderStateTx,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingLinqConfig: () => ({
    apiBaseUrl: "https://linq.example.test/api/partner/v3",
    apiToken: "linq-token",
  }),
}));

import { createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy-core";
import {
  parseHostedLinqPhoneNumberInventory,
  syncHostedLinqPhoneNumberInventory,
} from "@/src/lib/hosted-onboarding/linq-phone-number-inventory";

afterEach(() => {
  vi.unstubAllGlobals();
  lineStoreMocks.upsertHostedLinqLineForPhoneTx.mockReset();
  providerHealthStoreMocks.projectHostedLinqLineProviderStateTx.mockReset();
});

describe("syncHostedLinqPhoneNumberInventory", () => {
  const stubInventoryFetch = (payload: unknown, status = 200) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      typeof payload === "string" ? payload : JSON.stringify(payload),
      { headers: { "content-type": "application/json" }, status },
    )));
  };

  it("revokes relinquished and moved provider-id pairings before upserting", async () => {
    const keptLookupKey = createHostedPhoneLookupKey("+15550000001");
    const callOrder: string[] = [];
    const findMany = vi.fn(async () => [
      { phoneNumberLookupKey: keptLookupKey, providerPhoneNumberId: "line_current" },
      { phoneNumberLookupKey: "lookup:moved", providerPhoneNumberId: "line_moving" },
      { phoneNumberLookupKey: "lookup:relinquished", providerPhoneNumberId: "line_gone" },
    ]);
    const updateMany = vi.fn(async () => {
      callOrder.push("revoke");
      return { count: 2 };
    });
    lineStoreMocks.upsertHostedLinqLineForPhoneTx.mockImplementation(async () => {
      callOrder.push("upsert");
      return { phoneNumberLookupKey: "lookup:any" };
    });
    providerHealthStoreMocks.projectHostedLinqLineProviderStateTx.mockResolvedValue(undefined);
    stubInventoryFetch({
      phone_numbers: [
        {
          id: "line_current",
          phone_number: "+15550000001",
          reputation: { status: "HEALTHY" },
          status: "ACTIVE",
        },
        {
          id: "line_moving",
          phone_number: "+15550000002",
          reputation: { status: "HEALTHY" },
          status: "ACTIVE",
        },
      ],
    });

    await expect(syncHostedLinqPhoneNumberInventory({
      prisma: { $executeRaw: vi.fn(), hostedLinqLine: { findMany, updateMany } } as never,
    })).resolves.toEqual({ syncedCount: 2 });

    // line_current keeps its pairing; line_moving is held at a lookup key
    // that is not a candidate for its snapshot phone (a move) and line_gone
    // is absent from the snapshot, so exactly those two rows are cleared.
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        providerInventoryConfirmedAt: null,
        providerPhoneNumberId: null,
      },
      where: {
        phoneNumberLookupKey: { in: ["lookup:moved", "lookup:relinquished"] },
      },
    });
    expect(callOrder[0]).toBe("revoke");
    expect(callOrder).toContain("upsert");
  });

  it("clears every held provider id when the provider reports an explicitly empty inventory", async () => {
    const findMany = vi.fn(async () => [
      { phoneNumberLookupKey: "lookup:only", providerPhoneNumberId: "line_prior" },
    ]);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    stubInventoryFetch({ phone_numbers: [] });

    await expect(syncHostedLinqPhoneNumberInventory({
      prisma: { $executeRaw: vi.fn(), hostedLinqLine: { findMany, updateMany } } as never,
    })).resolves.toEqual({ syncedCount: 0 });

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        providerInventoryConfirmedAt: null,
        providerPhoneNumberId: null,
      },
      where: {
        phoneNumberLookupKey: { in: ["lookup:only"] },
      },
    });
  });

  it("applies the snapshot inside one owning transaction that takes the inventory lock first", async () => {
    const callOrder: string[] = [];
    const tx = {
      $executeRaw: vi.fn(async () => {
        callOrder.push("lock");
        return 0;
      }),
      hostedLinqLine: {
        findMany: vi.fn(async () => {
          callOrder.push("read-held");
          return [];
        }),
        updateMany: vi.fn(),
      },
    };
    const $transaction = vi.fn(async (callback: (client: unknown) => Promise<unknown>) => {
      callOrder.push("transaction");
      return callback(tx);
    });
    stubInventoryFetch({ phone_numbers: [] });

    await expect(syncHostedLinqPhoneNumberInventory({
      prisma: { $transaction, hostedLinqLine: { findMany: vi.fn(), updateMany: vi.fn() } } as never,
    })).resolves.toEqual({ syncedCount: 0 });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["transaction", "lock", "read-held"]);
  });

  it("does not revoke inventory backing when the provider read fails", async () => {
    const findMany = vi.fn();
    const updateMany = vi.fn();
    stubInventoryFetch("upstream error", 503);

    await expect(syncHostedLinqPhoneNumberInventory({
      prisma: { $executeRaw: vi.fn(), hostedLinqLine: { findMany, updateMany } } as never,
    })).rejects.toMatchObject({
      code: "LINQ_PHONE_NUMBER_INVENTORY_FAILED",
    });

    expect(findMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(lineStoreMocks.upsertHostedLinqLineForPhoneTx).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing collection field", {}],
    ["an aliased collection field", { data: [{ id: "line_1", phone_number: "+15550000001" }] }],
    ["a non-array collection field", { phone_numbers: "+15550000001" }],
  ])("rejects %s without touching stored ownership", async (_label, payload) => {
    const findMany = vi.fn();
    const updateMany = vi.fn();
    stubInventoryFetch(payload);

    await expect(syncHostedLinqPhoneNumberInventory({
      prisma: { $executeRaw: vi.fn(), hostedLinqLine: { findMany, updateMany } } as never,
    })).rejects.toMatchObject({
      code: "LINQ_PHONE_NUMBER_INVENTORY_INVALID",
    });

    expect(findMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(lineStoreMocks.upsertHostedLinqLineForPhoneTx).not.toHaveBeenCalled();
  });

  it.each([
    ["an invalid phone number", [{ id: "line_1", phone_number: "not-a-phone" }]],
    ["a duplicate phone number", [
      { id: "line_1", phone_number: "+15550000001" },
      { id: "line_2", phone_number: "+1 (555) 000-0001" },
    ]],
    ["a missing provider id", [{ phone_number: "+15550000001" }]],
    ["a duplicate provider id", [
      { id: "line_1", phone_number: "+15550000001" },
      { id: "line_1", phone_number: "+15550000002" },
    ]],
  ])("rejects a snapshot containing %s without touching stored ownership", async (_label, records) => {
    const findMany = vi.fn();
    const updateMany = vi.fn();
    stubInventoryFetch({ phone_numbers: records });

    await expect(syncHostedLinqPhoneNumberInventory({
      prisma: { $executeRaw: vi.fn(), hostedLinqLine: { findMany, updateMany } } as never,
    })).rejects.toMatchObject({
      code: "LINQ_PHONE_NUMBER_INVENTORY_INVALID",
    });

    expect(findMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(lineStoreMocks.upsertHostedLinqLineForPhoneTx).not.toHaveBeenCalled();
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
