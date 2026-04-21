import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberBillingSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  lockHostedMemberRow: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  updateHostedMemberCoreState: vi.fn(),
  writeHostedMemberStripeBillingRef: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  writeHostedMemberStripeBillingRefTx: mocks.writeHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    readHostedMemberBillingSnapshot: mocks.readHostedMemberBillingSnapshot,
    readHostedMemberCoreState: mocks.readHostedMemberCoreState,
    updateHostedMemberCoreState: mocks.updateHostedMemberCoreState,
  };
});

vi.mock("@/src/lib/hosted-onboarding/shared", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/shared")
  >("@/src/lib/hosted-onboarding/shared");

  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
  };
});

import {
  prepareHostedMemberStripeBillingWrite,
  updateHostedMemberStripeBillingIfFreshTx,
} from "@/src/lib/hosted-onboarding/stripe-billing-policy";

describe("hosted onboarding stripe billing policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const member = makeMemberSnapshot();
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(member);
    mocks.readHostedMemberCoreState.mockResolvedValue(member.core);
    mocks.updateHostedMemberCoreState.mockResolvedValue(member.core);
    mocks.writeHostedMemberStripeBillingRef.mockResolvedValue({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
  });

  it("passes through the pre-resolved canonical Stripe status before the transaction write", async () => {
    const member = makeMemberSnapshot({
      billingRef: {
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    });

    await expect(
      prepareHostedMemberStripeBillingWrite({
        canonicalBillingStatus: HostedBillingStatus.active,
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_123",
          sourceType: "stripe.customer.subscription.updated",
        },
        member,
      }),
    ).resolves.toEqual({
      canonicalBillingStatus: HostedBillingStatus.active,
      member,
    });
  });

  it("requires callers to resolve canonical Stripe status before subscription-backed billing writes", async () => {
    await expect(
      prepareHostedMemberStripeBillingWrite({
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_456",
          sourceType: "stripe.invoice.payment_failed",
        },
        member: makeMemberSnapshot(),
      }),
    ).rejects.toThrow(
      "Canonical Stripe subscription state must be resolved before stripe.invoice.payment_failed billing writes.",
    );
  });

  it("updates billing using only transaction-local reads and writes", async () => {
    const trace: string[] = [];
    const tx = {
      __tag: "tx",
    };

    let currentBillingStatus = HostedBillingStatus.active;
    mocks.lockHostedMemberRow.mockImplementation(async () => {
      trace.push("lock-row");
    });
    mocks.readHostedMemberCoreState.mockImplementation(async () => {
      trace.push("locked-core-read");
      return makeMemberSnapshot({
        core: {
          billingStatus: currentBillingStatus,
        },
      }).core;
    });
    mocks.updateHostedMemberCoreState.mockImplementation(async ({ billingStatus }) => {
      trace.push(`write-core:${billingStatus}`);
      currentBillingStatus = billingStatus;
      return makeMemberSnapshot({
        core: {
          billingStatus,
        },
      }).core;
    });
    mocks.writeHostedMemberStripeBillingRef.mockImplementation(async () => {
      trace.push("write-billing-ref");
      return {
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_456",
      };
    });
    mocks.readHostedMemberBillingSnapshot.mockImplementation(async ({ prisma }) => {
      trace.push(prisma === tx ? "locked-billing-read" : "unexpected-pre-lock-read");
      return makeMemberSnapshot({
        billingRef: {
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_456",
        },
        core: {
          billingStatus: currentBillingStatus,
        },
      });
    });

    await expect(
      updateHostedMemberStripeBillingIfFreshTx({
        billingStatus: HostedBillingStatus.past_due,
        canonicalBillingStatus: HostedBillingStatus.past_due,
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_456",
          sourceType: "stripe.invoice.payment_failed",
        },
        member: makeMemberSnapshot({
          billingRef: {
            memberId: "member_123",
            stripeCustomerId: "cus_123",
            stripeSubscriptionId: "sub_456",
          },
        }),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_456",
        tx: tx as never,
      }),
    ).resolves.toEqual(
      makeMemberSnapshot({
        billingRef: {
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_456",
        },
        core: {
          billingStatus: HostedBillingStatus.past_due,
        },
      }),
    );

    expect(trace).toEqual([
      "lock-row",
      "locked-core-read",
      "write-core:past_due",
      "write-billing-ref",
      "locked-billing-read",
    ]);
  });
});

function makeMemberSnapshot(overrides?: {
  billingRef?: HostedMemberBillingSnapshot["billingRef"];
  core?: Partial<HostedMemberBillingSnapshot["core"]>;
}): HostedMemberBillingSnapshot {
  const core = overrides?.core ?? {};

  return {
    billingRef: overrides?.billingRef ?? null,
    core: {
      billingStatus: core.billingStatus ?? HostedBillingStatus.active,
      createdAt: core.createdAt ?? new Date("2026-04-12T00:00:00.000Z"),
      id: core.id ?? "member_123",
      suspendedAt: core.suspendedAt ?? null,
      updatedAt: core.updatedAt ?? new Date("2026-04-12T00:00:00.000Z"),
    },
  };
}
