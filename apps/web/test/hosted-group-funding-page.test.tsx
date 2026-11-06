import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  getPrisma: vi.fn(() => ({ label: "test-prisma" })),
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
  GroupFundingCheckout: vi.fn((_props: Record<string, unknown>) =>
    React.createElement("div", null, "funding-checkout")
  ),
  readHostedActiveUsageCreditPurchaseForPayer: vi.fn(),
  readHostedGroupChatName: vi.fn(),
  readHostedGroupSponsorshipAuthorizationByPurchase: vi.fn(),
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

vi.mock("@/src/components/hosted-groups/group-funding-checkout", () => ({
  GroupFundingCheckout: mocks.GroupFundingCheckout,
}));

vi.mock("@/src/components/hosted-groups/group-sponsorship-management-card", () => ({
  GroupSponsorshipManagementCard: mocks.GroupSponsorshipManagementCard,
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: (props: { children?: React.ReactNode }) =>
    React.createElement("button", null, props.children),
  buttonVariants: () => "button-variant",
}));

vi.mock("@/src/lib/hosted-groups/group-chat-name", () => ({
  readHostedGroupChatName: mocks.readHostedGroupChatName,
}));

vi.mock("@/src/lib/hosted-groups/group-usage-funding", () => ({
  readHostedGroupUsageFundingManagementTargetByLocator:
    mocks.readHostedGroupUsageFundingManagementTargetByLocator,
  readHostedGroupUsageFundingTargetByJoinCode:
    mocks.readHostedGroupUsageFundingTargetByJoinCode,
  readHostedGroupUsageStatus: mocks.readHostedGroupUsageStatus,
}));

vi.mock("@/src/lib/hosted-groups/group-sponsorship-authorization", () => ({
  readHostedGroupSponsorshipAuthorizationByPurchase:
    mocks.readHostedGroupSponsorshipAuthorizationByPurchase,
  readHostedGroupSponsorshipManagementProjection:
    mocks.readHostedGroupSponsorshipManagementProjection,
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

import GroupFundingPage, {
  generateMetadata as generateGroupFundingMetadata,
} from "@/app/groups/fund/[joinCode]/page";

const PURCHASE_ID = "hucp_abcdefghijklmnop";

describe("hosted group funding page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticatedMember: { id: "member_payer", suspendedAt: null },
    });
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
    mocks.readHostedGroupSponsorshipManagementProjection.mockResolvedValue(null);
    mocks.readHostedUsageCreditPurchaseStatus.mockResolvedValue({
      purchaseId: PURCHASE_ID,
      status: "fulfilled",
    });
  });

  it("exposes the sponsor share card through the page module", async () => {
    // Proves the route-owner re-export, not just the metadata helper module.
    const metadata = await generateGroupFundingMetadata({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    });

    expect(metadata.title).toBe("Sponsor Murph in this chat");
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({
        url: "/groups/fund/group_join_code_1234/opengraph-image",
      }),
    ]);
  });

  it("passes a checkout return only after payer and group beneficiary validation", async () => {
    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
      searchParams: Promise.resolve({
        usageCheckout: "success",
        usagePurchase: PURCHASE_ID,
      }),
    }));

    assert.doesNotMatch(markup, /Group usage|Running low/u);
    assert.doesNotMatch(markup, /Supporters|Personalize/u);
    assert.match(markup, /funding-checkout/u);
    expect(mocks.readHostedUsageCreditPurchaseStatus).toHaveBeenCalledWith({
      beneficiaryMemberId: "member_group_runtime",
      payerMemberId: "member_payer",
      prisma: { label: "test-prisma" },
      purchaseId: PURCHASE_ID,
    });
    expect(mocks.GroupFundingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        groupName: "Sunday sleep crew",
        payerMemberId: "member_payer",
        purchaseReturn: { kind: "success", purchaseId: PURCHASE_ID },
      }),
      undefined,
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
  });

  it("marks a payer-wide target conflict as nonpayable", async () => {
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

    expect(mocks.GroupFundingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        activePurchase: expect.objectContaining({
          purchaseId: "hucp_familyactive12",
          retryAllowed: false,
          targetConflict: true,
          url: undefined,
        }),
      }),
      undefined,
    );
  });

  it("hands an open purchase to the checkout on the signed locator", async () => {
    const signedFundingLocator =
      "gf1.member_group_runtime.signed_exhaustion_locator";
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
    expect(mocks.GroupFundingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        activePurchase: expect.objectContaining({
          purchaseId: "hucp_groupactive12",
        }),
        initialMode: "one_time",
      }),
      undefined,
    );
    const renderedActivePurchase = mocks.GroupFundingCheckout.mock.calls[0]?.[0]
      ?.activePurchase;
    expect(renderedActivePurchase).not.toHaveProperty("targetConflict");
    expect(renderedActivePurchase).not.toHaveProperty("target");
    for (const [props] of mocks.GroupFundingCheckout.mock.calls) {
      expect(props.checkoutUrl).toBe(
        `/api/groups/fund/${encodeURIComponent(signedFundingLocator)}/usage-credit/checkout`,
      );
      expect(JSON.stringify(props)).not.toContain("group_join_code_1234");
    }
  });

  it("resumes a monthly activation with the cap the payer chose", async () => {
    mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValueOnce({
      offerCode: "usage_5_usd",
      purchaseId: "hucp_activation12",
      retryAllowed: true,
      status: "checkout_open",
      target: {
        beneficiaryMemberId: "member_group_runtime",
        groupJoinCode: "group_join_code_1234",
        kind: "group",
      },
      url: "https://checkout.stripe.test/session",
    });
    mocks.readHostedGroupSponsorshipManagementProjection.mockResolvedValueOnce({
      authorizationId: "hgsa_abcdefghijklmnop",
      chargedThisPeriodMinor: 0,
      monthlyCapMinor: 5_000,
      pendingThisPeriodMinor: 0,
      pendingMonthlyCapMinor: null,
      periodEnd: "2026-08-30T12:00:00.000Z",
      status: "pending_activation",
    });

    renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    expect(mocks.GroupSponsorshipManagementCard).not.toHaveBeenCalled();
    expect(mocks.GroupFundingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        initialMode: "monthly",
        initialMonthlyCapMinor: 5_000,
        monthly: expect.objectContaining({
          offer: expect.objectContaining({ offerCode: "usage_5_usd" }),
        }),
      }),
      undefined,
    );
  });

  it.each([
    { authorizationId: "hgsa_abcdefghijklmnop", expected: true },
    { authorizationId: "hgsa_othersponsorship", expected: false },
  ])("keeps only a sponsor's own activating return for the next refresh ($expected)", async ({
    authorizationId,
    expected,
  }) => {
    mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValueOnce({
      offerCode: "usage_5_usd",
      purchaseId: PURCHASE_ID,
      retryAllowed: false,
      status: "payment_pending",
      target: {
        beneficiaryMemberId: "member_group_runtime",
        groupJoinCode: "group_join_code_1234",
        kind: "group",
      },
    });
    mocks.readHostedGroupSponsorshipManagementProjection.mockResolvedValueOnce({
      authorizationId: "hgsa_abcdefghijklmnop",
      chargedThisPeriodMinor: 0,
      monthlyCapMinor: 2_000,
      pendingThisPeriodMinor: 0,
      pendingMonthlyCapMinor: null,
      periodEnd: "2026-08-30T12:00:00.000Z",
      status: "pending_activation",
    });
    mocks.readHostedGroupSponsorshipAuthorizationByPurchase.mockResolvedValueOnce({
      authorizationId,
      chargeOrdinal: 1,
      monthlyCapMinor: 2_000,
      payerMemberId: "member_payer",
      periodStartedAt: new Date("2026-08-01T12:00:00.000Z"),
    });

    renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
      searchParams: Promise.resolve({
        usageCheckout: "success",
        usagePurchase: PURCHASE_ID,
      }),
    }));

    expect(mocks.GroupFundingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ keepPurchaseReturnQuery: expected }),
      undefined,
    );
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

    expect(mocks.GroupFundingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ purchaseReturn: null }),
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

    assert.match(markup, /funding-checkout/u);
    assert.doesNotMatch(markup, /No refill needed right now\./u);
    assert.doesNotMatch(markup, /becomes available when capacity runs low/iu);
    expect(mocks.GroupFundingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        monthly: {
          capOptions: [
            { amountLabel: "$5", monthlyCapMinor: 500 },
            { amountLabel: "$10", monthlyCapMinor: 1_000 },
            { amountLabel: "$20", monthlyCapMinor: 2_000 },
            { amountLabel: "$50", monthlyCapMinor: 5_000 },
          ],
          offer: { amountLabel: "$5", offerCode: "usage_5_usd" },
        },
        oneTimeOffers: [{ amountLabel: "$5", offerCode: "usage_5_usd" }],
      }),
      undefined,
    );
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
    expect(mocks.GroupFundingCheckout).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.GroupSponsorshipManagementCard.mock.calls))
      .not.toContain("group_join_code_1234");
  });

  it("names an unnamed group by its chat title only for its sponsor", async () => {
    mocks.readHostedGroupUsageFundingTargetByJoinCode.mockResolvedValue({
      displayName: null,
      joinCode: "group_join_code_1234",
      kind: "custom",
      runtimeMemberId: "member_group_runtime",
    });
    mocks.readHostedGroupChatName.mockResolvedValue({
      displayName: "Saturday long run",
      status: "ok",
    });
    mocks.readHostedGroupSponsorshipManagementProjection.mockResolvedValueOnce({
      authorizationId: "hgsa_abcdefghijklmnop",
      chargedThisPeriodMinor: 0,
      monthlyCapMinor: 2_000,
      pendingThisPeriodMinor: 0,
      pendingMonthlyCapMinor: null,
      periodEnd: "2026-08-30T12:00:00.000Z",
      status: "recovery_required",
    });

    const sponsorMarkup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    expect(mocks.GroupSponsorshipManagementCard).toHaveBeenCalledWith(
      expect.objectContaining({ groupName: "Saturday long run" }),
      undefined,
    );
    // A monthly sponsor raises the limit instead of starting a one-time payment.
    assert.doesNotMatch(sponsorMarkup, /funding-checkout/u);
    expect(mocks.readHostedGroupChatName).toHaveBeenCalledWith({
      memberId: "member_group_runtime",
    });

    mocks.readHostedGroupChatName.mockClear();
    const participantMarkup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    expect(mocks.GroupFundingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ groupName: "your group chat" }),
      undefined,
    );
    assert.doesNotMatch(participantMarkup, /Saturday long run/u);
    expect(mocks.readHostedGroupChatName).not.toHaveBeenCalled();
  });

  it.each([
    { authorizationId: "hgsa_abcdefghijklmnop", expected: true },
    { authorizationId: "hgsa_othersponsorship", expected: false },
  ])("confirms a sponsor's Checkout return only for its own sponsorship ($expected)", async ({
    authorizationId,
    expected,
  }) => {
    mocks.readHostedGroupSponsorshipManagementProjection.mockResolvedValueOnce({
      authorizationId: "hgsa_abcdefghijklmnop",
      chargedThisPeriodMinor: 500,
      monthlyCapMinor: 2_000,
      pendingThisPeriodMinor: 0,
      pendingMonthlyCapMinor: null,
      periodEnd: "2026-08-30T12:00:00.000Z",
      status: "active",
    });
    mocks.readHostedGroupSponsorshipAuthorizationByPurchase.mockResolvedValueOnce({
      authorizationId,
      chargeOrdinal: 1,
      monthlyCapMinor: 2_000,
      payerMemberId: "member_payer",
      periodStartedAt: new Date("2026-08-01T12:00:00.000Z"),
    });

    renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
      searchParams: Promise.resolve({
        usageCheckout: "success",
        usagePurchase: PURCHASE_ID,
      }),
    }));

    expect(mocks.readHostedGroupSponsorshipAuthorizationByPurchase)
      .toHaveBeenCalledWith({
        prisma: { label: "test-prisma" },
        purchaseId: PURCHASE_ID,
      });
    expect(mocks.GroupSponsorshipManagementCard).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutReturned: expected }),
      undefined,
    );
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
    expect(mocks.GroupFundingCheckout).not.toHaveBeenCalled();
  });

  it("names the group for a signed-out visitor on a public link", async () => {
    mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
      authenticatedMember: null,
    });

    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    assert.match(markup, /<h1[^>]*>Keep Murph in Sunday sleep crew\.<\/h1>/u);
    assert.match(markup, /Sign in/u);
    expect(mocks.GroupFundingCheckout).not.toHaveBeenCalled();
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
    assert.doesNotMatch(markup, /This link isn’t working\./u);
    expect(mocks.readHostedGroupUsageFundingManagementTargetByLocator)
      .not.toHaveBeenCalled();
    expect(mocks.readHostedGroupSponsorshipManagementProjection)
      .not.toHaveBeenCalled();
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

    assert.match(markup, /This link isn’t working\./u);
    assert.doesNotMatch(markup, /management:/u);
    expect(mocks.readHostedGroupSponsorshipManagementProjection)
      .toHaveBeenCalledWith({
        beneficiaryMemberId: "member_group_runtime",
        payerMemberId: "member_payer",
        prisma: { label: "test-prisma" },
      });
  });

  it("offers only a one-time contribution when someone else sponsors the chat", async () => {
    mocks.readHostedGroupUsageStatus.mockResolvedValueOnce({
      fundingNeeded: false,
      fundingUrl: null,
      sponsorshipStatus: "sponsored",
    });

    renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    expect(mocks.GroupFundingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        activePurchase: null,
        monthly: null,
        sponsoredByAnother: true,
      }),
      undefined,
    );
  });

  it("says the chat is sponsored when this account can't contribute", async () => {
    mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
      authenticatedMember: {
        id: "member_payer",
        suspendedAt: new Date("2026-08-10T00:00:00.000Z"),
      },
    });
    mocks.readHostedGroupUsageStatus.mockResolvedValueOnce({
      fundingNeeded: false,
      fundingUrl: null,
      sponsorshipStatus: "sponsored",
    });

    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    assert.match(markup, /Murph is sponsored in this chat/u);
    expect(mocks.GroupFundingCheckout).not.toHaveBeenCalled();
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

    renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    expect(mocks.GroupSponsorshipManagementCard).not.toHaveBeenCalled();
    expect(mocks.GroupFundingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        activePurchase: expect.objectContaining({
          purchaseId: "hucp_onetimerecover",
        }),
        initialMode: "one_time",
        monthly: null,
      }),
      undefined,
    );
  });

  it("fails closed when the linked runtime has no group usage projection", async () => {
    mocks.readHostedGroupUsageStatus.mockResolvedValueOnce(null);

    const markup = renderToStaticMarkup(await GroupFundingPage({
      params: Promise.resolve({ joinCode: "group_join_code_1234" }),
    }));

    assert.match(markup, /<h1[^>]*>This link isn’t working\.<\/h1>/u);
    expect(mocks.GroupFundingCheckout).not.toHaveBeenCalled();
  });
});
