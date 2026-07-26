import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  getPrisma: vi.fn(() => ({ label: "test-prisma" })),
  HostedUsageTopUpDialog: vi.fn((props: Record<string, unknown>) =>
    React.createElement("div", null, `top-up:${String(props.scope)}`)
  ),
  readHostedActiveUsageCreditPurchaseForPayer: vi.fn(),
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
}));

vi.mock("@/src/components/settings/hosted-usage-top-up-dialog", () => ({
  HostedUsageTopUpDialog: mocks.HostedUsageTopUpDialog,
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
  readHostedGroupUsageFundingTargetByJoinCode:
    mocks.readHostedGroupUsageFundingTargetByJoinCode,
  readHostedGroupUsageStatus: mocks.readHostedGroupUsageStatus,
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
    mocks.readHostedGroupUsageFundingTargetByJoinCode.mockResolvedValue({
      displayName: "Sunday sleep crew",
      joinCode: "group_join_code_1234",
      kind: "friends",
      runtimeMemberId: "member_group_runtime",
    });
    mocks.readHostedGroupUsageStatus.mockResolvedValue({
      capacityState: "low",
      fundingUrl: "https://www.withmurph.ai/groups/fund/group_join_code_1234",
      periodEnd: "2026-08-01T00:00:00.000Z",
    });
    mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValue(null);
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
    assert.match(markup, /<h1[^>]*>Keep Murph going<\/h1>/u);
    assert.match(markup, /Add messages for everyone in the chat\./u);
    assert.doesNotMatch(markup, /Group usage|Running low/u);
    assert.match(markup, /top-up:group/u);
    assert.match(markup, /href="\/home"[^>]*>Go home<\/a>/u);
    expect(mocks.readHostedUsageCreditPurchaseStatus).toHaveBeenCalledWith({
      beneficiaryMemberId: "member_group_runtime",
      payerMemberId: "member_payer",
      prisma: { label: "test-prisma" },
      purchaseId: PURCHASE_ID,
    });
    expect(mocks.HostedUsageTopUpDialog).toHaveBeenCalledWith(
      expect.objectContaining({
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
