import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedMemberNotSuspended: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  manageHostedGroupSponsorshipAuthorization: vi.fn(),
  normalizeHostedGroupUsageFundingLocator: vi.fn(),
  parseHostedGroupSponsorshipManagementAction: vi.fn(),
  readHostedGroupSponsorshipManagementProjection: vi.fn(),
  readHostedGroupUsageFundingManagementTargetByLocator: vi.fn(),
  readHostedGroupUsageFundingTargetByLocator: vi.fn(),
  recoverHostedGroupSponsorshipUsageCreditCheckout: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  resolveDecodedRouteParam: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));
vi.mock("@/src/lib/hosted-onboarding/entitlement", () => ({
  assertHostedMemberNotSuspended: mocks.assertHostedMemberNotSuspended,
}));
vi.mock("@/src/lib/hosted-onboarding/http", () => ({
  jsonOk: (value: unknown) => value,
  readHostedOnboardingJsonObject: (request: Request) => request.json(),
  withJsonError: (handler: unknown) => handler,
}));
vi.mock("@/src/lib/hosted-groups/group-sponsorship-authorization", () => ({
  manageHostedGroupSponsorshipAuthorization:
    mocks.manageHostedGroupSponsorshipAuthorization,
  parseHostedGroupSponsorshipManagementAction:
    mocks.parseHostedGroupSponsorshipManagementAction,
  readHostedGroupSponsorshipManagementProjection:
    mocks.readHostedGroupSponsorshipManagementProjection,
}));
vi.mock("@/src/lib/hosted-groups/group-usage-funding", () => ({
  normalizeHostedGroupUsageFundingLocator:
    mocks.normalizeHostedGroupUsageFundingLocator,
  readHostedGroupUsageFundingManagementTargetByLocator:
    mocks.readHostedGroupUsageFundingManagementTargetByLocator,
  readHostedGroupUsageFundingTargetByLocator:
    mocks.readHostedGroupUsageFundingTargetByLocator,
}));
vi.mock("@/src/lib/hosted-onboarding/usage-credit-purchase-service", () => ({
  recoverHostedGroupSponsorshipUsageCreditCheckout:
    mocks.recoverHostedGroupSponsorshipUsageCreditCheckout,
}));
vi.mock("@/src/lib/http", () => ({
  resolveDecodedRouteParam: mocks.resolveDecodedRouteParam,
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));

import { GET, POST } from "@/app/api/groups/fund/[joinCode]/sponsorship/route";

describe("group sponsorship management route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getPrisma.mockReturnValue({ label: "prisma" });
    mocks.normalizeHostedGroupUsageFundingLocator.mockReturnValue(
      "group_join_code_1234",
    );
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_payer",
        suspendedAt: new Date("2026-08-10T00:00:00.000Z"),
      },
    });
    mocks.resolveDecodedRouteParam.mockResolvedValue("group_join_code_1234");
    mocks.readHostedGroupUsageFundingManagementTargetByLocator.mockResolvedValue({
      runtimeMemberId: "member_group_runtime",
    });
    mocks.readHostedGroupUsageFundingTargetByLocator.mockResolvedValue({
      runtimeMemberId: "member_group_runtime",
    });
    mocks.manageHostedGroupSponsorshipAuthorization.mockResolvedValue(null);
  });

  it("reads the exact payer management projection without starting recovery again", async () => {
    const management = {
      authorizationId: "hgsa_abcdefghijklmnop",
      status: "active",
    };
    mocks.readHostedGroupSponsorshipManagementProjection.mockResolvedValue(
      management,
    );

    await expect(GET(new Request(
      "https://join.example.test/api/groups/fund/group_join_code_1234/sponsorship",
    ), {
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }) as Promise<unknown>).resolves.toEqual({ management });

    expect(
      mocks.readHostedGroupUsageFundingManagementTargetByLocator,
    ).toHaveBeenCalledWith({
      locator: "group_join_code_1234",
      prisma: { label: "prisma" },
    });
    expect(
      mocks.readHostedGroupSponsorshipManagementProjection,
    ).toHaveBeenCalledWith({
      beneficiaryMemberId: "member_group_runtime",
      payerMemberId: "member_payer",
      prisma: { label: "prisma" },
    });
    expect(
      mocks.recoverHostedGroupSponsorshipUsageCreditCheckout,
    ).not.toHaveBeenCalled();
    expect(mocks.assertHostedOnboardingMutationOrigin).not.toHaveBeenCalled();
  });

  it("allows the exact suspended payer to cancel through an inactive target", async () => {
    const action = {
      action: "cancel",
      authorizationId: "hgsa_abcdefghijklmnop",
    } as const;
    mocks.parseHostedGroupSponsorshipManagementAction.mockReturnValue(action);

    await expect(POST(new Request(
      "https://join.example.test/api/groups/fund/group_join_code_1234/sponsorship",
      {
        body: JSON.stringify(action),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ), {
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }) as Promise<unknown>).resolves.toEqual({ management: null });

    expect(mocks.assertHostedMemberNotSuspended).not.toHaveBeenCalled();
    expect(mocks.readHostedGroupUsageFundingTargetByLocator).not.toHaveBeenCalled();
    expect(
      mocks.readHostedGroupUsageFundingManagementTargetByLocator,
    ).toHaveBeenCalledWith({
      locator: "group_join_code_1234",
      prisma: { label: "prisma" },
    });
    expect(mocks.manageHostedGroupSponsorshipAuthorization).toHaveBeenCalledWith({
      action,
      beneficiaryMemberId: "member_group_runtime",
      payerMemberId: "member_payer",
      prisma: { label: "prisma" },
    });
  });

  it("keeps payment-affecting management actions blocked for a suspended payer", async () => {
    const action = {
      action: "resume",
      authorizationId: "hgsa_abcdefghijklmnop",
    } as const;
    mocks.parseHostedGroupSponsorshipManagementAction.mockReturnValue(action);
    mocks.assertHostedMemberNotSuspended.mockImplementationOnce(() => {
      throw new Error("suspended");
    });

    await expect(POST(new Request(
      "https://join.example.test/api/groups/fund/group_join_code_1234/sponsorship",
      {
        body: JSON.stringify(action),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ), {
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }) as Promise<unknown>).rejects.toThrow("suspended");

    expect(mocks.readHostedGroupUsageFundingTargetByLocator).not.toHaveBeenCalled();
    expect(mocks.manageHostedGroupSponsorshipAuthorization).not.toHaveBeenCalled();
  });

  it.each(["payment_pending", "fulfilled"] as const)(
    "returns the current management projection with a no-URL %s recovery",
    async (status) => {
      const action = {
        action: "recover",
        authorizationId: "hgsa_abcdefghijklmnop",
      } as const;
      const checkout = {
        purchaseId: "hucp_recovery_abcdefghijkl",
        status,
      };
      const management = {
        authorizationId: action.authorizationId,
        status: status === "fulfilled" ? "active" : "recovery_required",
      };
      mocks.parseHostedGroupSponsorshipManagementAction.mockReturnValue(action);
      mocks.recoverHostedGroupSponsorshipUsageCreditCheckout.mockResolvedValue(
        checkout,
      );
      mocks.readHostedGroupSponsorshipManagementProjection.mockResolvedValue(
        management,
      );

      await expect(POST(new Request(
        "https://join.example.test/api/groups/fund/group_join_code_1234/sponsorship",
        {
          body: JSON.stringify(action),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ), {
        params: Promise.resolve({ joinCode: "group_join_code_1234" }),
      }) as Promise<unknown>).resolves.toEqual({ checkout, management });

      expect(
        mocks.readHostedGroupSponsorshipManagementProjection,
      ).toHaveBeenCalledWith({
        beneficiaryMemberId: "member_group_runtime",
        payerMemberId: "member_payer",
        prisma: { label: "prisma" },
      });
    },
  );

  it("does not project management for a recovery that still needs Checkout", async () => {
    const action = {
      action: "recover",
      authorizationId: "hgsa_abcdefghijklmnop",
    } as const;
    const checkout = {
      purchaseId: "hucp_recovery_abcdefghijkl",
      status: "reconciling",
    };
    mocks.parseHostedGroupSponsorshipManagementAction.mockReturnValue(action);
    mocks.recoverHostedGroupSponsorshipUsageCreditCheckout.mockResolvedValue(
      checkout,
    );

    await expect(POST(new Request(
      "https://join.example.test/api/groups/fund/group_join_code_1234/sponsorship",
      {
        body: JSON.stringify(action),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ), {
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }) as Promise<unknown>).resolves.toEqual({ checkout });

    expect(
      mocks.readHostedGroupSponsorshipManagementProjection,
    ).not.toHaveBeenCalled();
  });
});
