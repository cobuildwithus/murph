import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  getPrisma: vi.fn(() => ({ label: "test-prisma" })),
  hasHostedGroupSponsorshipCustomizationAuthority: vi.fn(),
  GroupSponsorshipManagementCard: vi.fn((props: {
    management: {
      chargedThisPeriodMinor: number;
      monthlyCapMinor: number;
      pendingThisPeriodMinor: number;
      status: string;
    };
  }) => React.createElement(
    "div",
    null,
    `management:${props.management.status}:${props.management.chargedThisPeriodMinor}:${props.management.pendingThisPeriodMinor}:${props.management.monthlyCapMinor}`,
  )),
  HostedUsageTopUpDialog: vi.fn((props: Record<string, unknown>) =>
    React.createElement("div", null, `top-up:${String(props.scope)}`)
  ),
  readHostedActiveUsageCreditPurchaseForPayer: vi.fn(),
  readHostedGroupFundingSupporters: vi.fn(),
  readHostedGroupSponsorshipDraftForCreator: vi.fn(),
  readHostedGroupSponsorshipManagementProjection: vi.fn(),
  readHostedGroupUsageFundingManagementTargetByLocator: vi.fn(),
  readHostedGroupUsageFundingTargetByJoinCode: vi.fn(),
  readHostedGroupUsageStatus: vi.fn(),
  readHostedUsageCreditPurchaseStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default: (props: { children?: React.ReactNode; href: string }) =>
    React.createElement("a", { href: props.href }, props.children),
}));

vi.mock("@/src/components/hosted-groups/group-funding-sign-in-button", () => ({
  GroupFundingSignInButton: () => React.createElement("button", null, "Sign in"),
  GroupFundingSignInRequired: () => React.createElement("button", null, "Sign in"),
}));

vi.mock("@/src/components/settings/hosted-usage-top-up-dialog", () => ({
  HostedUsageTopUpDialog: mocks.HostedUsageTopUpDialog,
}));

vi.mock("@/src/components/hosted-groups/group-sponsorship-management-card", () => ({
  GroupSponsorshipManagementCard: mocks.GroupSponsorshipManagementCard,
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: (props: { children?: React.ReactNode }) =>
    React.createElement("button", null, props.children),
  buttonVariants: () => "button-variant",
}));

vi.mock("@/src/components/ui/card", () => ({
  Card: (props: { children?: React.ReactNode }) =>
    React.createElement("section", null, props.children),
  CardContent: (props: { children?: React.ReactNode }) =>
    React.createElement("div", null, props.children),
  CardDescription: (props: { children?: React.ReactNode }) =>
    React.createElement("p", null, props.children),
  CardFooter: (props: { children?: React.ReactNode }) =>
    React.createElement("footer", null, props.children),
  CardHeader: (props: { children?: React.ReactNode }) =>
    React.createElement("header", null, props.children),
  CardTitle: (props: { children?: React.ReactNode }) =>
    React.createElement("div", null, props.children),
}));

vi.mock("@/src/lib/hosted-groups/group-usage-funding", () => ({
  readHostedGroupUsageFundingManagementTargetByLocator:
    mocks.readHostedGroupUsageFundingManagementTargetByLocator,
  readHostedGroupUsageFundingTargetByJoinCode:
    mocks.readHostedGroupUsageFundingTargetByJoinCode,
  readHostedGroupUsageStatus: mocks.readHostedGroupUsageStatus,
}));

vi.mock("@/src/lib/hosted-groups/group-sponsorship-authorization", () => ({
  readHostedGroupSponsorshipManagementProjection:
    mocks.readHostedGroupSponsorshipManagementProjection,
}));

vi.mock("@/src/lib/hosted-groups/group-sponsorship-store", () => ({
  hasHostedGroupSponsorshipCustomizationAuthority:
    mocks.hasHostedGroupSponsorshipCustomizationAuthority,
  readHostedGroupFundingSupporters:
    mocks.readHostedGroupFundingSupporters,
  readHostedGroupSponsorshipDraftForCreator:
    mocks.readHostedGroupSponsorshipDraftForCreator,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/personal-usage-credit-eligibility", () => ({
  readHostedConfiguredUsageCreditOfferCodes: () => ["usage_5_usd"],
}));

vi.mock("@/src/lib/hosted-onboarding/usage-credit-purchase-service", () => ({
  readHostedActiveUsageCreditPurchaseForPayer:
    mocks.readHostedActiveUsageCreditPurchaseForPayer,
  readHostedUsageCreditPurchaseStatus:
    mocks.readHostedUsageCreditPurchaseStatus,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import GroupFundingPage from "@/app/groups/fund/[joinCode]/page";

const PURCHASE_ID = "hucp_abcdefghijklmnop";

describe("hosted group funding page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticatedMember: { id: "member_payer", suspendedAt: null },
    });
    mocks.hasHostedGroupSponsorshipCustomizationAuthority.mockResolvedValue(
      true,
    );
    mocks.readHostedGroupUsageFundingTargetByJoinCode.mockResolvedValue({
      displayName: "Sunday sleep crew",
      joinCode: "group_join_code_1234",
      kind: "friends",
      runtimeMemberId: "member_group_runtime",
    });
    mocks.readHostedGroupUsageFundingManagementTargetByLocator.mockResolvedValue(
      null,
    );
    mocks.readHostedGroupUsageStatus.mockResolvedValue({
      fundingNeeded: true,
      fundingUrl: "https://www.withmurph.ai/groups/fund/group_join_code_1234",
      sponsorshipStatus: "not_sponsored",
    });
    mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValue(null);
    mocks.readHostedGroupFundingSupporters.mockResolvedValue({
      monthlySponsor: null,
      oneTimeContributions: [],
    });
    mocks.readHostedGroupSponsorshipDraftForCreator.mockResolvedValue(null);
    mocks.readHostedGroupSponsorshipManagementProjection.mockResolvedValue(null);
    mocks.readHostedUsageCreditPurchaseStatus.mockResolvedValue({
      purchaseId: PURCHASE_ID,
      status: "fulfilled",
    });
  });

  it("passes a checkout return only after payer and group beneficiary validation", async () => {
    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
      searchParams: Promise.resolve({
        usageCheckout: "success",
        usagePurchase: PURCHASE_ID,
      }),
    }));

    assert.match(markup, /Sunday sleep crew/u);
    assert.match(
      markup,
      /<h1[^>]*>Support Murph in Sunday sleep crew<\/h1>/u,
    );
    assert.doesNotMatch(markup, /Keep Murph going/u);
    assert.doesNotMatch(markup, /Support Murph for everyone in this chat\./u);
    assert.doesNotMatch(markup, /Group usage|Running low/u);
    assert.doesNotMatch(markup, /Supporters/u);
    assert.match(markup, /top-up:group/u);
    assert.match(markup, /href="\/home"[^>]*>Back to Murph<\/a>/u);
    expect(mocks.readHostedUsageCreditPurchaseStatus).toHaveBeenCalledWith({
      beneficiaryMemberId: "member_group_runtime",
      payerMemberId: "member_payer",
      prisma: { label: "test-prisma" },
      purchaseId: PURCHASE_ID,
    });
    expect(mocks.HostedUsageTopUpDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        payerMemberId: "member_payer",
        purchaseReturn: { kind: "success", purchaseId: PURCHASE_ID },
        scope: "group",
      }),
      undefined,
    );
    expect(mocks.HostedUsageTopUpDialog.mock.calls[0]?.[0]).not.toHaveProperty(
      "contactOptions",
    );
    expect(mocks.readHostedActiveUsageCreditPurchaseForPayer).toHaveBeenCalledWith({
      serverApprovedPayableTargets: [{
        beneficiaryMemberId: "member_group_runtime",
        groupJoinCode: "group_join_code_1234",
        kind: "group",
      }],
      payerMemberId: "member_payer",
      prisma: { label: "test-prisma" },
    });
    expect(mocks.readHostedGroupFundingSupporters).toHaveBeenCalledWith({
      beneficiaryMemberId: "member_group_runtime",
      prisma: { label: "test-prisma" },
    });
  });

  it("shows a payer-wide target conflict without another amount picker", async () => {
    mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValueOnce({
      offerCode: "usage_10_usd",
      purchaseId: "hucp_familyactive12",
      retryAllowed: false,
      status: "checkout_open",
      target: {
        beneficiaryMemberId: "member_family",
        familyGroupId: "hbag_abcdefghijklmnop",
        kind: "family",
      },
    });

    renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    expect(mocks.HostedUsageTopUpDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        activePurchase: expect.objectContaining({
          purchaseId: "hucp_familyactive12",
          retryAllowed: false,
          targetConflict: true,
          url: undefined,
        }),
        offers: [],
        scope: "group",
      }),
      undefined,
    );
  });

  it("restores the payer's exact frozen sponsor details with a matching active purchase", async () => {
    const signedFundingLocator =
      "gf1.member_group_runtime.signed_exhaustion_locator";
    const frozenSponsorship = {
      publicAlias: "The Group Historian",
      runningBitRequest: "Treat me like Murph’s exhausted CFO.",
      sponsorMessage: "For whatever adventure comes next.",
    };
    mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValueOnce({
      offerCode: "usage_10_usd",
      purchaseId: "hucp_groupactive12",
      retryAllowed: true,
      status: "reconciling",
      target: {
        beneficiaryMemberId: "member_group_runtime",
        groupJoinCode: "group_join_code_1234",
        kind: "group",
      },
    });
    mocks.readHostedGroupUsageFundingTargetByJoinCode.mockResolvedValueOnce({
      displayName: "Sunday sleep crew",
      joinCode: signedFundingLocator,
      kind: "friends",
      runtimeMemberId: "member_group_runtime",
    });
    mocks.readHostedGroupSponsorshipDraftForCreator.mockResolvedValueOnce(
      frozenSponsorship,
    );

    renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: signedFundingLocator }),
    }));

    expect(mocks.readHostedGroupUsageFundingTargetByJoinCode).toHaveBeenCalledWith({
      joinCode: signedFundingLocator,
      prisma: { label: "test-prisma" },
    });
    expect(mocks.readHostedActiveUsageCreditPurchaseForPayer).toHaveBeenCalledWith({
      serverApprovedPayableTargets: [{
        beneficiaryMemberId: "member_group_runtime",
        groupJoinCode: signedFundingLocator,
        kind: "group",
      }],
      payerMemberId: "member_payer",
      prisma: { label: "test-prisma" },
    });
    expect(mocks.readHostedGroupSponsorshipDraftForCreator).toHaveBeenCalledWith({
      creatorMemberId: "member_payer",
      prisma: { label: "test-prisma" },
      purchaseId: "hucp_groupactive12",
    });
    expect(mocks.HostedUsageTopUpDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        activePurchase: expect.objectContaining({
          purchaseId: "hucp_groupactive12",
        }),
        offers: [],
        renderPurchaseDetails: expect.anything(),
        scope: "group",
      }),
      undefined,
    );
    const renderedActivePurchase = mocks.HostedUsageTopUpDialog.mock.calls[0]?.[0]
      ?.activePurchase;
    expect(renderedActivePurchase).not.toHaveProperty("targetConflict");
    expect(renderedActivePurchase).not.toHaveProperty("target");
    for (const [props] of mocks.HostedUsageTopUpDialog.mock.calls) {
      expect(props.checkoutUrl).toBe(
        `/api/groups/fund/${encodeURIComponent(signedFundingLocator)}/usage-credit/checkout`,
      );
      expect(JSON.stringify(props)).not.toContain("group_join_code_1234");
    }
  });

  it("does not offer payment recovery when the frozen sponsor draft cannot be read", async () => {
    mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValueOnce({
      offerCode: "usage_10_usd",
      purchaseId: "hucp_groupactive12",
      retryAllowed: true,
      status: "reconciling",
      target: {
        beneficiaryMemberId: "member_group_runtime",
        groupJoinCode: "group_join_code_1234",
        kind: "group",
      },
    });
    mocks.readHostedGroupSponsorshipDraftForCreator.mockRejectedValueOnce(
      new Error("secure box unavailable"),
    );

    await expect(GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    })).rejects.toThrow("secure box unavailable");

    expect(mocks.HostedUsageTopUpDialog).not.toHaveBeenCalled();
  });

  it("ignores a checkout return belonging to another funding target", async () => {
    mocks.readHostedUsageCreditPurchaseStatus.mockRejectedValueOnce(
      new Error("purchase target mismatch"),
    );

    renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
      searchParams: Promise.resolve({
        usageCheckout: "cancel",
        usagePurchase: PURCHASE_ID,
      }),
    }));

    expect(mocks.HostedUsageTopUpDialog).toHaveBeenCalledWith(
      expect.objectContaining({ purchaseReturn: null, scope: "group" }),
      undefined,
    );
  });

  it("offers monthly sponsorship while an unsponsored group is healthy", async () => {
    mocks.readHostedGroupUsageStatus.mockResolvedValueOnce({
      fundingNeeded: false,
      fundingUrl:
        "https://www.withmurph.ai/groups/fund/group_join_code_1234",
      sponsorshipStatus: "not_sponsored",
    });

    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    assert.match(markup, /top-up:group/u);
    assert.doesNotMatch(markup, /No refill needed right now\./u);
    assert.doesNotMatch(markup, /becomes available when capacity runs low/iu);
    const monthlyProps = mocks.HostedUsageTopUpDialog.mock.calls[0]?.[0];
    expect(monthlyProps).toEqual(expect.objectContaining({
      initialOpen: true,
      offers: [expect.objectContaining({ offerCode: "usage_5_usd" })],
      scope: "group",
    }));
    const buildCheckoutPayload = monthlyProps?.buildCheckoutPayload as
      | ((input: { clientRequestKey: string; offerCode: string }) => unknown)
      | undefined;
    expect(buildCheckoutPayload?.({
      clientRequestKey: "request_monthly",
      offerCode: "usage_5_usd",
    })).toEqual(expect.objectContaining({
      clientRequestKey: "request_monthly",
      monthlyCapMinor: 500,
      offerCode: "usage_5_usd",
      sponsorshipKind: "monthly",
    }));
  });

  it("shows only the authenticated payer their private sponsorship management projection", async () => {
    const signedFundingLocator =
      "gf1.member_group_runtime.signed_exhaustion_locator";
    mocks.readHostedGroupUsageFundingTargetByJoinCode.mockResolvedValueOnce({
      displayName: "Sunday sleep crew",
      joinCode: signedFundingLocator,
      kind: "friends",
      runtimeMemberId: "member_group_runtime",
    });
    mocks.readHostedGroupUsageStatus.mockResolvedValueOnce({
      fundingNeeded: false,
      fundingUrl:
        `https://www.withmurph.ai/groups/fund/${encodeURIComponent(signedFundingLocator)}`,
      sponsorshipStatus: "sponsored",
    });
    mocks.readHostedGroupSponsorshipManagementProjection.mockResolvedValueOnce({
      authorizationId: "hgsa_abcdefghijklmnop",
      chargedThisPeriodMinor: 500,
      monthlyCapMinor: 1_000,
      pendingThisPeriodMinor: 500,
      pendingMonthlyCapMinor: null,
      periodEnd: "2026-08-30T12:00:00.000Z",
      status: "active",
    });

    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: signedFundingLocator }),
    }));

    assert.match(markup, /management:active:500:500:1000/u);
    assert.doesNotMatch(markup, /remaining|messages|percentage/iu);
    expect(mocks.GroupSponsorshipManagementCard).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint:
          `/api/groups/fund/${encodeURIComponent(signedFundingLocator)}/sponsorship`,
        management: expect.objectContaining({
          chargedThisPeriodMinor: 500,
          monthlyCapMinor: 1_000,
          pendingThisPeriodMinor: 500,
          status: "active",
        }),
      }),
      undefined,
    );
    for (const [props] of mocks.HostedUsageTopUpDialog.mock.calls) {
      expect(props.checkoutUrl).toBe(
        `/api/groups/fund/${encodeURIComponent(signedFundingLocator)}/usage-credit/checkout`,
      );
      expect(JSON.stringify(props)).not.toContain("group_join_code_1234");
    }
    expect(JSON.stringify(mocks.GroupSponsorshipManagementCard.mock.calls))
      .not.toContain("group_join_code_1234");
  });

  it("keeps cancellation available after the payer and beneficiary become inactive", async () => {
    mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
      authenticatedMember: {
        id: "member_payer",
        suspendedAt: new Date("2026-08-10T00:00:00.000Z"),
      },
    });
    mocks.readHostedGroupUsageFundingTargetByJoinCode.mockResolvedValueOnce(null);
    mocks.readHostedGroupUsageFundingManagementTargetByLocator.mockResolvedValueOnce({
      displayName: "Sunday sleep crew",
      joinCode: "group_join_code_1234",
      kind: "friends",
      runtimeMemberId: "member_group_runtime",
    });
    mocks.readHostedGroupSponsorshipManagementProjection.mockResolvedValueOnce({
      authorizationId: "hgsa_abcdefghijklmnop",
      chargedThisPeriodMinor: 500,
      monthlyCapMinor: 1_000,
      pendingThisPeriodMinor: 0,
      pendingMonthlyCapMinor: null,
      periodEnd: "2026-08-30T12:00:00.000Z",
      status: "active",
    });

    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    assert.match(markup, /management:active:500:0:1000/u);
    expect(mocks.GroupSponsorshipManagementCard).toHaveBeenCalledWith(
      expect.objectContaining({ cancelOnly: true }),
      undefined,
    );
    expect(mocks.readHostedGroupUsageStatus).not.toHaveBeenCalled();
    expect(mocks.readHostedActiveUsageCreditPurchaseForPayer).not.toHaveBeenCalled();
    expect(mocks.HostedUsageTopUpDialog).not.toHaveBeenCalled();
  });

  it("offers a private sign-in handoff before resolving inactive sponsorship management", async () => {
    mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
      authenticatedMember: null,
    });
    mocks.readHostedGroupUsageFundingTargetByJoinCode.mockResolvedValueOnce(null);

    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    assert.match(markup, /Sign in/u);
    assert.doesNotMatch(markup, /This group funding link isn&#x27;t available/u);
    expect(mocks.readHostedGroupUsageFundingManagementTargetByLocator)
      .not.toHaveBeenCalled();
    expect(mocks.readHostedGroupSponsorshipManagementProjection)
      .not.toHaveBeenCalled();
  });

  it("keeps supporter recognition private until the viewer signs in", async () => {
    mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
      authenticatedMember: null,
    });

    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    assert.match(markup, /Sign in/u);
    assert.doesNotMatch(markup, /Supporters|Monthly sponsor/u);
    expect(mocks.readHostedGroupFundingSupporters).not.toHaveBeenCalled();
  });

  it("keeps inactive sponsorship management unavailable to an authenticated non-payer", async () => {
    mocks.readHostedGroupUsageFundingTargetByJoinCode.mockResolvedValueOnce(null);
    mocks.readHostedGroupUsageFundingManagementTargetByLocator.mockResolvedValueOnce({
      displayName: "Sunday sleep crew",
      joinCode: "group_join_code_1234",
      kind: "friends",
      runtimeMemberId: "member_group_runtime",
    });
    mocks.readHostedGroupSponsorshipManagementProjection.mockResolvedValueOnce(null);

    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    assert.match(markup, /This group funding link isn&#x27;t available/u);
    assert.doesNotMatch(markup, /management:/u);
    expect(mocks.readHostedGroupSponsorshipManagementProjection)
      .toHaveBeenCalledWith({
        beneficiaryMemberId: "member_group_runtime",
        payerMemberId: "member_payer",
        prisma: { label: "test-prisma" },
      });
  });

  it("shows sponsored status with a secondary one-time contribution to a non-sponsor", async () => {
    mocks.readHostedGroupUsageStatus.mockResolvedValueOnce({
      fundingNeeded: false,
      fundingUrl: null,
      sponsorshipStatus: "sponsored",
    });

    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    assert.match(markup, /Murph is sponsored in this chat/u);
    assert.match(markup, /top-up:group/u);
    const props = mocks.HostedUsageTopUpDialog.mock.calls.at(-1)?.[0];
    expect(props).toEqual(expect.objectContaining({
      initialOpen: true,
      scope: "group",
    }));
    expect(props).not.toHaveProperty("activePurchase");
    const buildCheckoutPayload = props?.buildCheckoutPayload as
      | ((input: { clientRequestKey: string; offerCode: string }) => unknown)
      | undefined;
    expect(buildCheckoutPayload?.({
      clientRequestKey: "request_one_time",
      offerCode: "usage_5_usd",
    })).toEqual(expect.objectContaining({
      clientRequestKey: "request_one_time",
      offerCode: "usage_5_usd",
      sponsorshipKind: "one_time",
    }));
  });

  it("shows the current monthly sponsor and recent one-time contributions", async () => {
    mocks.readHostedGroupFundingSupporters.mockResolvedValueOnce({
      monthlySponsor: {
        id: "hucp_monthlysponsor1",
        name: "The Group Historian",
      },
      oneTimeContributions: [
        {
          id: "hucp_onetimecontrib1",
          name: "Night Shift",
        },
        {
          id: "hucp_onetimecontrib2",
          name: "Anonymous",
        },
      ],
    });

    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    assert.match(markup, /Supporters/u);
    assert.match(markup, /The Group Historian/u);
    assert.match(markup, /Monthly sponsor/u);
    assert.match(markup, /Night Shift/u);
    assert.match(markup, /Anonymous/u);
    assert.doesNotMatch(markup, /\$/u);
  });

  it("keeps a non-sponsor's one-time recovery reachable after another monthly sponsorship activates", async () => {
    mocks.readHostedGroupUsageStatus.mockResolvedValueOnce({
      fundingNeeded: false,
      fundingUrl: null,
      sponsorshipStatus: "sponsored",
    });
    mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValueOnce({
      offerCode: "usage_5_usd",
      purchaseId: "hucp_onetimerecover",
      retryAllowed: true,
      status: "checkout_open",
      target: {
        beneficiaryMemberId: "member_group_runtime",
        groupJoinCode: "group_join_code_1234",
        kind: "group",
      },
      url: "https://checkout.stripe.test/session",
    });
    mocks.readHostedGroupSponsorshipDraftForCreator.mockResolvedValueOnce(null);

    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    assert.match(markup, /Murph is sponsored in this chat/u);
    assert.match(markup, /top-up:group/u);
    expect(mocks.GroupSponsorshipManagementCard).not.toHaveBeenCalled();
    const props = mocks.HostedUsageTopUpDialog.mock.calls.at(-1)?.[0];
    expect(props).toEqual(expect.objectContaining({
      activePurchase: expect.objectContaining({
        purchaseId: "hucp_onetimerecover",
      }),
      scope: "group",
    }));
    const buildCheckoutPayload = props?.buildCheckoutPayload as
      | ((input: { clientRequestKey: string; offerCode: string }) => unknown)
      | undefined;
    expect(buildCheckoutPayload?.({
      clientRequestKey: "request_recovery",
      offerCode: "usage_5_usd",
    })).toEqual(expect.objectContaining({
      sponsorshipKind: "one_time",
    }));
  });

  it("fails closed when the linked runtime has no group usage projection", async () => {
    mocks.readHostedGroupUsageStatus.mockResolvedValueOnce(null);

    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    assert.match(
      markup,
      /<h1[^>]*>This group funding link isn&#x27;t available<\/h1>/u,
    );
    expect(mocks.HostedUsageTopUpDialog).not.toHaveBeenCalled();
  });
});
