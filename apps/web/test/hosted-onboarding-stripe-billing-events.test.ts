import { HostedBillingStatus } from "@prisma/client";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberBillingSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  activateHostedMemberForPositiveSourceTx: vi.fn(),
  findMemberForStripeInvoice: vi.fn(),
  prepareHostedMemberStripeBillingWrite: vi.fn(),
  writeHostedMemberStripeBillingTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForPositiveSourceTx: mocks.activateHostedMemberForPositiveSourceTx,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-lookup", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-lookup")
  >("@/src/lib/hosted-onboarding/stripe-billing-lookup");

  return {
    ...actual,
    findMemberForStripeInvoice: mocks.findMemberForStripeInvoice,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-policy", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-policy")
  >("@/src/lib/hosted-onboarding/stripe-billing-policy");

  return {
    ...actual,
    prepareHostedMemberStripeBillingWrite: mocks.prepareHostedMemberStripeBillingWrite,
    writeHostedMemberStripeBillingTx: mocks.writeHostedMemberStripeBillingTx,
  };
});

import { applyStripeInvoicePaid } from "@/src/lib/hosted-onboarding/stripe-billing-events";

describe("hosted onboarding stripe billing events", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const member = makeMemberSnapshot();
    mocks.findMemberForStripeInvoice.mockResolvedValue(member);
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValue({
      canonicalBillingStatus: HostedBillingStatus.active,
      member,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValue(member);
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValue({
      activated: true,
      hostedExecutionEventId: "wake_123",
      memberId: member.core.id,
    });
  });

  it("normalizes duplicate invoice.paid Stripe events onto the same activation source id", async () => {
    const invoice = makeStripeInvoice({
      id: "in_paid_123",
      subscription: "sub_123",
    });

    await expect(
      applyStripeInvoicePaid(
        invoice,
        {
          eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
          occurredAt: "2026-04-23T00:00:00.000Z",
          sourceEventId: "evt_paid_123",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      createdOrUpdatedRevnetIssuance: false,
      hostedExecutionEventId: "wake_123",
    });

    await expect(
      applyStripeInvoicePaid(
        invoice,
        {
          eventCreatedAt: new Date("2026-04-23T00:00:05.000Z"),
          occurredAt: "2026-04-23T00:00:05.000Z",
          sourceEventId: "evt_paid_456",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      createdOrUpdatedRevnetIssuance: false,
      hostedExecutionEventId: "wake_123",
    });

    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenNthCalledWith(1, {
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "invoice:in_paid_123",
        sourceType: "stripe.invoice.paid",
      },
      memberId: "member_123",
      prisma: {},
      skipIfBillingAlreadyActive: false,
    });
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenNthCalledWith(2, {
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-23T00:00:05.000Z"),
        occurredAt: "2026-04-23T00:00:05.000Z",
        sourceEventId: "invoice:in_paid_123",
        sourceType: "stripe.invoice.paid",
      },
      memberId: "member_123",
      prisma: {},
      skipIfBillingAlreadyActive: false,
    });
  });

  it("skips invoice.paid activation side effects when the billing write is stale", async () => {
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(null);

    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          id: "in_paid_stale",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
          occurredAt: "2026-04-23T00:00:00.000Z",
          sourceEventId: "evt_paid_stale",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      createdOrUpdatedRevnetIssuance: false,
      hostedExecutionEventId: null,
    });

    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });
});

function makeMemberSnapshot(): HostedMemberBillingSnapshot {
  return {
    billingRef: {
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    },
    core: {
      billingStatus: HostedBillingStatus.incomplete,
      createdAt: new Date("2026-04-23T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-04-23T00:00:00.000Z"),
    },
  };
}

function makeStripeInvoice(
  overrides?: Partial<{
    customer: string | null;
    id: string;
    subscription: string | null;
  }>,
): Stripe.Invoice {
  // @ts-expect-error - the synthetic fixture is intentionally narrower than Stripe.Invoice.
  return {
    customer: overrides?.customer ?? "cus_123",
    id: overrides?.id ?? "in_123",
    subscription: overrides?.subscription ?? "sub_123",
  } as Stripe.Invoice;
}
