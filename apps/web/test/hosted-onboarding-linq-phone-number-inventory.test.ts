import { afterEach, describe, expect, it, vi } from "vitest";

const lineStoreMocks = vi.hoisted(() => ({
  upsertHostedLinqLineForPhoneTx: vi.fn(),
}));

const providerHealthStoreMocks = vi.hoisted(() => ({
  projectHostedLinqLineProviderStateTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
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
  it("revokes inventory backing from lines absent in a successful snapshot before upserting", async () => {
    const callOrder: string[] = [];
    const updateMany = vi.fn(async () => {
      callOrder.push("revoke");
      return { count: 1 };
    });
    lineStoreMocks.upsertHostedLinqLineForPhoneTx.mockImplementation(async () => {
      callOrder.push("upsert");
      return { phoneNumberLookupKey: "lookup:1" };
    });
    providerHealthStoreMocks.projectHostedLinqLineProviderStateTx.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      phone_numbers: [
        {
          id: "line_current",
          phone_number: "+15550000001",
          reputation: { status: "HEALTHY" },
          status: "ACTIVE",
        },
      ],
    }), { headers: { "content-type": "application/json" }, status: 200 })));

    await expect(syncHostedLinqPhoneNumberInventory({
      prisma: { hostedLinqLine: { updateMany } } as never,
    })).resolves.toEqual({ syncedCount: 1 });

    expect(updateMany).toHaveBeenCalledWith({
      data: { providerPhoneNumberId: null },
      where: {
        providerPhoneNumberId: {
          not: null,
          notIn: ["line_current"],
        },
      },
    });
    expect(callOrder[0]).toBe("revoke");
    expect(callOrder).toContain("upsert");
  });

  it("does not revoke inventory backing when the provider read fails", async () => {
    const updateMany = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream error", { status: 503 })));

    await expect(syncHostedLinqPhoneNumberInventory({
      prisma: { hostedLinqLine: { updateMany } } as never,
    })).rejects.toMatchObject({
      code: "LINQ_PHONE_NUMBER_INVENTORY_FAILED",
    });

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
