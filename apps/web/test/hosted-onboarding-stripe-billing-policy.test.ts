import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberBillingSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  lockHostedMemberRow: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
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
  suspendHostedMemberForBillingReversalTx,
  terminalizeHostedFamilySponsoredDirectBillingTx,
  writeHostedMemberStripeBillingRefIfFreshTx,
  writeHostedMemberStripeBillingTx,
} from "@/src/lib/hosted-onboarding/stripe-billing-policy";

describe("hosted onboarding stripe billing policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const member = makeMemberSnapshot();
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(member);
    mocks.updateHostedMemberCoreState.mockResolvedValue(member.core);
    mocks.writeHostedMemberStripeBillingRef.mockResolvedValue({
      lastStripeEventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
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
        lastStripeEventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
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
      writeHostedMemberStripeBillingTx({
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
      "locked-billing-read",
      "write-core:past_due",
      "write-billing-ref",
      "locked-billing-read",
    ]);
    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledWith({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeEventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
      stripeSubscriptionId: "sub_456",
      tx,
    });
  });

  it("clears a pending schedule once Stripe reports its target as current", async () => {
    const member = makeMemberSnapshot({
      billingRef: {
        currentBillingPlanCode: "launch_monthly",
        memberId: "member_123",
        scheduledBillingEffectiveAt: new Date("2026-05-12T00:00:00.000Z"),
        scheduledBillingPlanCode: "launch_group_monthly",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        stripeSubscriptionScheduleId: "sub_sched_123",
      },
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(member);

    await writeHostedMemberStripeBillingTx({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: HostedBillingStatus.active,
      currentBillingPlanCode: "launch_group_monthly",
      dispatchContext: {
        eventCreatedAt: new Date("2026-05-12T00:00:00.000Z"),
        occurredAt: "2026-05-12T00:00:00.000Z",
        sourceEventId: "evt_group_applied",
        sourceType: "stripe.customer.subscription.updated",
      },
      member,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      tx: {} as never,
    });

    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBillingPlanCode: "launch_group_monthly",
        scheduledBillingEffectiveAt: null,
        scheduledBillingPlanCode: null,
        stripeSubscriptionScheduleId: null,
      }),
    );
  });

  it("preserves a pending schedule while Stripe still reports the current plan", async () => {
    const member = makeMemberSnapshot({
      billingRef: {
        currentBillingPlanCode: "launch_monthly",
        memberId: "member_123",
        scheduledBillingEffectiveAt: new Date("2026-05-12T00:00:00.000Z"),
        scheduledBillingPlanCode: "launch_group_monthly",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        stripeSubscriptionScheduleId: "sub_sched_123",
      },
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(member);

    await writeHostedMemberStripeBillingTx({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: HostedBillingStatus.active,
      currentBillingPlanCode: "launch_monthly",
      dispatchContext: {
        eventCreatedAt: new Date("2026-05-01T00:00:00.000Z"),
        occurredAt: "2026-05-01T00:00:00.000Z",
        sourceEventId: "evt_pulse_still_current",
        sourceType: "stripe.customer.subscription.updated",
      },
      member,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      tx: {} as never,
    });

    const [writeInput] = mocks.writeHostedMemberStripeBillingRef.mock.calls[0] ?? [];
    expect(writeInput).not.toHaveProperty("scheduledBillingEffectiveAt");
    expect(writeInput).not.toHaveProperty("scheduledBillingPlanCode");
    expect(writeInput).not.toHaveProperty("stripeSubscriptionScheduleId");
  });

  it("writes billing progress before applying an intentional reversal suspension", async () => {
    const eventCreatedAt = new Date("2026-04-25T00:00:00.000Z");
    const tx = { __tag: "tx" };

    await suspendHostedMemberForBillingReversalTx({
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: {
        eventCreatedAt,
        sourceEventId: "evt_refund_full",
        sourceType: "stripe.refund.created",
      },
      member: makeMemberSnapshot(),
      stripeCustomerId: "cus_123",
      tx: tx as never,
    });

    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledOnce();
    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledOnce();
    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.unpaid,
      memberId: "member_123",
      prisma: tx,
      suspendedAt: eventCreatedAt,
    });
    expect(
      mocks.writeHostedMemberStripeBillingRef.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.updateHostedMemberCoreState.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("applies an older proven-current refund without moving the billing cursor backward", async () => {
    const refundCreatedAt = new Date("2026-04-25T00:00:00.000Z");
    const newerBillingCursor = new Date("2026-04-25T00:05:00.000Z");
    const member = makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: newerBillingCursor,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(member);

    await suspendHostedMemberForBillingReversalTx({
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: {
        eventCreatedAt: refundCreatedAt,
        sourceEventId: "evt_refund_older_current_invoice",
        sourceType: "stripe.refund.updated",
      },
      freshnessPolicy: "proven-current-refund",
      member,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      tx: {} as never,
    });

    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeEventCreatedAt: newerBillingCursor,
        stripeSubscriptionId: "sub_123",
      }),
    );
    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.unpaid,
      memberId: "member_123",
      prisma: {},
      suspendedAt: newerBillingCursor,
    });
  });

  it("rejects an older refund when the proven subscription identity no longer matches", async () => {
    const member = makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: new Date("2026-04-25T00:05:00.000Z"),
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_new",
      },
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(member);

    await suspendHostedMemberForBillingReversalTx({
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_refund_old_subscription",
        sourceType: "stripe.refund.updated",
      },
      freshnessPolicy: "proven-current-refund",
      member,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_old",
      tx: {} as never,
    });

    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
  });

  it("treats replay of an already-applied reversal suspension as idempotent", async () => {
    const eventCreatedAt = new Date("2026-04-25T00:00:00.000Z");
    const suspendedMember = makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: eventCreatedAt,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
      core: {
        billingStatus: HostedBillingStatus.unpaid,
        suspendedAt: eventCreatedAt,
      },
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(suspendedMember);

    await suspendHostedMemberForBillingReversalTx({
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: {
        eventCreatedAt,
        sourceEventId: "evt_dispute_funds_withdrawn",
        sourceType: "stripe.charge.dispute.funds_withdrawn",
      },
      member: suspendedMember,
      stripeCustomerId: "cus_123",
      tx: {} as never,
    });

    expect(mocks.lockHostedMemberRow).toHaveBeenCalledOnce();
    expect(mocks.updateHostedMemberCoreState).toHaveBeenNthCalledWith(1, {
      billingStatus: HostedBillingStatus.unpaid,
      memberId: "member_123",
      prisma: {},
      suspendedAt: null,
    });
    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledOnce();
    expect(mocks.updateHostedMemberCoreState).toHaveBeenNthCalledWith(2, {
      billingStatus: HostedBillingStatus.unpaid,
      memberId: "member_123",
      prisma: {},
      suspendedAt: eventCreatedAt,
    });
  });

  it("leaves billing-owned suspension untouched across ordinary billing progress", async () => {
    const reversalCreatedAt = new Date("2026-04-25T00:00:00.000Z");
    const invoicePaidCreatedAt = new Date("2026-04-25T00:05:00.000Z");
    const suspendedMember = makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: reversalCreatedAt,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
      core: {
        billingStatus: HostedBillingStatus.unpaid,
        suspendedAt: reversalCreatedAt,
      },
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(suspendedMember);

    await expect(writeHostedMemberStripeBillingTx({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: {
        eventCreatedAt: invoicePaidCreatedAt,
        occurredAt: invoicePaidCreatedAt.toISOString(),
        sourceEventId: "evt_invoice_paid_while_reversed",
        sourceType: "stripe.invoice.paid",
      },
      member: suspendedMember,
      tx: {} as never,
    })).resolves.toBe(suspendedMember);

    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
  });

  it("terminalizes only the exact Family-sponsored direct subscription", async () => {
    const activeMember = makeMemberSnapshot({
      billingRef: {
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_loser",
      },
    });
    const canceledMember = makeMemberSnapshot({
      billingRef: activeMember.billingRef,
      core: {
        billingStatus: HostedBillingStatus.canceled,
      },
    });
    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(activeMember)
      .mockResolvedValueOnce(activeMember)
      .mockResolvedValueOnce(canceledMember);

    await expect(terminalizeHostedFamilySponsoredDirectBillingTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-25T00:10:00.000Z"),
        occurredAt: "2026-04-25T00:10:00.000Z",
        sourceEventId: "evt_family_cleanup",
        sourceType: "stripe.customer.subscription.deleted",
      },
      memberId: "member_123",
      stripeSubscriptionId: "sub_loser",
      tx: {} as never,
    })).resolves.toBe(true);

    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.canceled,
      memberId: "member_123",
      prisma: {},
      suspendedAt: undefined,
    });
    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_loser",
      }),
    );
  });

  it("does not terminalize a replacement direct subscription during Family cleanup", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(
      makeMemberSnapshot({
        billingRef: {
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_replacement",
        },
      }),
    );

    await expect(terminalizeHostedFamilySponsoredDirectBillingTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-25T00:10:00.000Z"),
        occurredAt: "2026-04-25T00:10:00.000Z",
        sourceEventId: "evt_family_cleanup_stale",
        sourceType: "stripe.customer.subscription.deleted",
      },
      memberId: "member_123",
      stripeSubscriptionId: "sub_loser",
      tx: {} as never,
    })).resolves.toBe(false);

    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
  });

  it("clears only billing-owned suspension while terminalizing Family cleanup", async () => {
    const reversalCreatedAt = new Date("2026-04-25T00:05:00.000Z");
    const suspendedMember = makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: reversalCreatedAt,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_loser",
      },
      core: {
        billingStatus: HostedBillingStatus.unpaid,
        suspendedAt: reversalCreatedAt,
      },
    });
    const canceledMember = makeMemberSnapshot({
      billingRef: suspendedMember.billingRef,
      core: {
        billingStatus: HostedBillingStatus.canceled,
        suspendedAt: null,
      },
    });
    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(suspendedMember)
      .mockResolvedValueOnce(suspendedMember)
      .mockResolvedValueOnce(canceledMember);

    await expect(terminalizeHostedFamilySponsoredDirectBillingTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-25T00:10:00.000Z"),
        occurredAt: "2026-04-25T00:10:00.000Z",
        sourceEventId: "evt_family_cleanup_reversed",
        sourceType: "stripe.customer.subscription.deleted",
      },
      memberId: "member_123",
      stripeSubscriptionId: "sub_loser",
      tx: {} as never,
    })).resolves.toBe(true);

    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.canceled,
      memberId: "member_123",
      prisma: {},
      suspendedAt: null,
    });
  });

  it("binds missing provider identity from a stale event during billing-owned suspension", async () => {
    const subscriptionCreatedAt = new Date("2026-04-25T00:00:00.000Z");
    const reversalCreatedAt = new Date("2026-04-25T00:05:00.000Z");
    const suspendedMember = makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: reversalCreatedAt,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: null,
      },
      core: {
        billingStatus: HostedBillingStatus.unpaid,
        suspendedAt: reversalCreatedAt,
      },
    });
    const boundSuspendedMember = makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: reversalCreatedAt,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
      core: {
        billingStatus: HostedBillingStatus.unpaid,
        suspendedAt: reversalCreatedAt,
      },
    });
    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(suspendedMember)
      .mockResolvedValueOnce(boundSuspendedMember);

    await expect(writeHostedMemberStripeBillingTx({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: {
        eventCreatedAt: subscriptionCreatedAt,
        occurredAt: subscriptionCreatedAt.toISOString(),
        sourceEventId: "evt_subscription_while_reversed",
        sourceType: "stripe.customer.subscription.updated",
      },
      member: suspendedMember,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      tx: {} as never,
    })).resolves.toEqual(boundSuspendedMember);

    expect(mocks.updateHostedMemberCoreState).toHaveBeenNthCalledWith(1, {
      memberId: "member_123",
      prisma: {},
      suspendedAt: null,
    });
    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledWith({
      memberId: "member_123",
      stripeCustomerId: undefined,
      stripeSubscriptionId: "sub_123",
      tx: {},
    });
    expect(mocks.updateHostedMemberCoreState).toHaveBeenNthCalledWith(2, {
      memberId: "member_123",
      prisma: {},
      suspendedAt: reversalCreatedAt,
    });
  });

  it("does not mistake the account-deletion fence for a billing-owned suspension", async () => {
    const billingEventCreatedAt = new Date("2026-04-25T00:00:00.000Z");
    const deletionStartedAt = new Date("2026-04-25T00:05:00.000Z");
    const deletingMember = makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: billingEventCreatedAt,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
      core: {
        billingStatus: HostedBillingStatus.unpaid,
        suspendedAt: deletionStartedAt,
      },
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(deletingMember);

    await expect(suspendHostedMemberForBillingReversalTx({
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-25T00:10:00.000Z"),
        sourceEventId: "evt_dispute_newer",
        sourceType: "stripe.charge.dispute.funds_withdrawn",
      },
      member: deletingMember,
      stripeCustomerId: "cus_123",
      tx: {} as never,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });

    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
  });

  it("does not let an older restore clear the account-deletion fence", async () => {
    const billingEventCreatedAt = new Date("2026-04-25T00:00:00.000Z");
    const deletingMember = makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: billingEventCreatedAt,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
      core: {
        billingStatus: HostedBillingStatus.unpaid,
        suspendedAt: new Date("2026-04-25T00:05:00.000Z"),
      },
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(deletingMember);

    await expect(writeHostedMemberStripeBillingTx({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-25T00:10:00.000Z"),
        occurredAt: "2026-04-25T00:10:00.000Z",
        sourceEventId: "evt_dispute_restore",
        sourceType: "stripe.charge.dispute.funds_reinstated",
      },
      member: deletingMember,
      suspendedAtOverride: null,
      tx: {} as never,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });

    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
  });

  it("does not let invoice.payment_failed promote a non-active member back to active", async () => {
    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeMemberSnapshot({
        billingRef: {
          lastStripeEventCreatedAt: new Date("2026-04-11T23:00:00.000Z"),
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_456",
        },
        core: {
          billingStatus: HostedBillingStatus.past_due,
        },
      }))
      .mockResolvedValueOnce(makeMemberSnapshot({
        billingRef: {
          lastStripeEventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_456",
        },
        core: {
          billingStatus: HostedBillingStatus.past_due,
        },
      }));

    await expect(
      writeHostedMemberStripeBillingTx({
        billingStatus: HostedBillingStatus.past_due,
        canonicalBillingStatus: HostedBillingStatus.active,
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_failed_late",
          sourceType: "stripe.invoice.payment_failed",
        },
        member: makeMemberSnapshot({
          core: {
            billingStatus: HostedBillingStatus.past_due,
          },
        }),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_456",
        tx: {} as never,
      }),
    ).resolves.toEqual(makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_456",
      },
      core: {
        billingStatus: HostedBillingStatus.past_due,
      },
    }));

    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.past_due,
      memberId: "member_123",
      prisma: {},
      suspendedAt: undefined,
    });
  });

  it("keeps subscription.resumed incomplete for an expired trial phase until invoice.paid", async () => {
    const trialEndedAt = new Date("2026-06-21T12:00:00.000Z");

    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeMemberSnapshot({
        billingRef: {
          currentBillingPhase: "trial",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "pulse_trial_7d",
          currentTrialEndsAt: trialEndedAt,
          currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
          lastStripeEventCreatedAt: new Date("2026-06-21T12:00:00.000Z"),
          memberId: "member_123",
          pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
          pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
          stripeCustomerId: "cus_trial",
          stripeSubscriptionId: "sub_trial",
        },
        core: {
          billingStatus: HostedBillingStatus.paused,
        },
      }))
      .mockResolvedValueOnce(makeMemberSnapshot({
        billingRef: {
          currentBillingPhase: "trial",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "pulse_trial_7d",
          currentTrialEndsAt: trialEndedAt,
          currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
          lastStripeEventCreatedAt: new Date("2026-06-22T12:00:00.000Z"),
          memberId: "member_123",
          pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
          pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
          stripeCustomerId: "cus_trial",
          stripeSubscriptionId: "sub_trial",
        },
        core: {
          billingStatus: HostedBillingStatus.incomplete,
        },
      }));

    await expect(
      writeHostedMemberStripeBillingTx({
        billingStatus: HostedBillingStatus.paused,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialEndsAt: trialEndedAt,
        currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
        dispatchContext: {
          eventCreatedAt: new Date("2026-06-22T12:00:00.000Z"),
          occurredAt: "2026-06-22T12:00:00.000Z",
          sourceEventId: "evt_resumed_trial",
          sourceType: "stripe.customer.subscription.resumed",
        },
        member: makeMemberSnapshot({
          core: {
            billingStatus: HostedBillingStatus.paused,
          },
        }),
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
        stripeCustomerId: "cus_trial",
        stripeSubscriptionId: "sub_trial",
        tx: {} as never,
      }),
    ).resolves.toMatchObject({
      billingRef: {
        currentBillingPhase: "trial",
        currentTrialEndsAt: trialEndedAt,
        stripeSubscriptionId: "sub_trial",
      },
      core: {
        billingStatus: HostedBillingStatus.incomplete,
      },
    });

    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.incomplete,
      memberId: "member_123",
      prisma: {},
      suspendedAt: undefined,
    });
  });

  it("does not preserve active access for an active subscription event after Pulse Trial expiry", async () => {
    const trialEndedAt = new Date("2026-06-21T12:00:00.000Z");

    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeMemberSnapshot({
        billingRef: {
          currentBillingPhase: "trial",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "pulse_trial_7d",
          currentTrialEndsAt: trialEndedAt,
          currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
          lastStripeEventCreatedAt: new Date("2026-06-21T11:59:00.000Z"),
          memberId: "member_123",
          pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
          pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
          stripeCustomerId: "cus_trial",
          stripeSubscriptionId: "sub_trial",
        },
        core: {
          billingStatus: HostedBillingStatus.active,
        },
      }))
      .mockResolvedValueOnce(makeMemberSnapshot({
        billingRef: {
          currentBillingPhase: "trial",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "pulse_trial_7d",
          currentTrialEndsAt: trialEndedAt,
          currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
          lastStripeEventCreatedAt: new Date("2026-06-21T12:00:00.000Z"),
          memberId: "member_123",
          pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
          pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
          stripeCustomerId: "cus_trial",
          stripeSubscriptionId: "sub_trial",
        },
        core: {
          billingStatus: HostedBillingStatus.incomplete,
        },
      }));

    await expect(
      writeHostedMemberStripeBillingTx({
        billingStatus: HostedBillingStatus.active,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
        dispatchContext: {
          eventCreatedAt: new Date("2026-06-21T12:00:00.000Z"),
          occurredAt: "2026-06-21T12:00:00.000Z",
          sourceEventId: "evt_active_after_trial",
          sourceType: "stripe.customer.subscription.updated",
        },
        member: makeMemberSnapshot({
          core: {
            billingStatus: HostedBillingStatus.active,
          },
        }),
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
        stripeCustomerId: "cus_trial",
        stripeSubscriptionId: "sub_trial",
        tx: {} as never,
      }),
    ).resolves.toMatchObject({
      billingRef: {
        currentBillingPhase: "trial",
        currentTrialEndsAt: trialEndedAt,
        stripeSubscriptionId: "sub_trial",
      },
      core: {
        billingStatus: HostedBillingStatus.incomplete,
      },
    });

    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.incomplete,
      memberId: "member_123",
      prisma: {},
      suspendedAt: undefined,
    });
  });

  it("ignores Stripe billing writes from strictly older sources", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: new Date("2026-04-12T01:00:00.000Z"),
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_456",
      },
      core: {
        billingStatus: HostedBillingStatus.active,
      },
    }));

    await expect(
      writeHostedMemberStripeBillingTx({
        billingStatus: HostedBillingStatus.past_due,
        canonicalBillingStatus: HostedBillingStatus.past_due,
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_older",
          sourceType: "stripe.invoice.payment_failed",
        },
        member: makeMemberSnapshot(),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_456",
        tx: {} as never,
      }),
    ).resolves.toBeNull();

    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
  });

  it("lets a positive paid invoice survive newer passive Stripe freshness and preserves the newer marker", async () => {
    const passiveStripeEventCreatedAt = new Date("2026-04-25T05:13:10.000Z");
    const invoicePaidStripeEventCreatedAt = new Date("2026-04-25T05:13:09.000Z");

    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeMemberSnapshot({
        billingRef: {
          lastStripeEventCreatedAt: passiveStripeEventCreatedAt,
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        },
        core: {
          billingStatus: HostedBillingStatus.incomplete,
        },
      }))
      .mockResolvedValueOnce(makeMemberSnapshot({
        billingRef: {
          lastStripeEventCreatedAt: passiveStripeEventCreatedAt,
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        },
        core: {
          billingStatus: HostedBillingStatus.active,
        },
      }));

    await expect(
      writeHostedMemberStripeBillingTx({
        billingStatus: HostedBillingStatus.active,
        canonicalBillingStatus: HostedBillingStatus.active,
        dispatchContext: {
          eventCreatedAt: invoicePaidStripeEventCreatedAt,
          occurredAt: invoicePaidStripeEventCreatedAt.toISOString(),
          sourceEventId: "evt_invoice_paid",
          sourceType: "stripe.invoice.paid",
        },
        freshnessPolicy: "positive-invoice-entitlement",
        member: makeMemberSnapshot({
          core: {
            billingStatus: HostedBillingStatus.incomplete,
          },
        }),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        tx: {} as never,
      }),
    ).resolves.toEqual(makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: passiveStripeEventCreatedAt,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
      core: {
        billingStatus: HostedBillingStatus.active,
      },
    }));

    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.active,
      memberId: "member_123",
      prisma: {},
      suspendedAt: undefined,
    });
    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledWith({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeEventCreatedAt: passiveStripeEventCreatedAt,
      stripeSubscriptionId: "sub_123",
      tx: {},
    });
  });

  it("lets an auto Pulse Trial entitlement survive newer passive same-subscription freshness", async () => {
    const passiveStripeEventCreatedAt = new Date("2026-06-14T12:00:10.000Z");
    const autoTrialEventCreatedAt = new Date("2026-06-14T12:00:05.000Z");

    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeMemberSnapshot({
        billingRef: {
          lastStripeEventCreatedAt: passiveStripeEventCreatedAt,
          memberId: "member_123",
          stripeCustomerId: "cus_auto_trial",
          stripeSubscriptionId: "sub_auto_trial",
        },
        core: {
          billingStatus: HostedBillingStatus.incomplete,
        },
      }))
      .mockResolvedValueOnce(makeMemberSnapshot({
        billingRef: {
          currentBillingPhase: "trial",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "pulse_trial_7d",
          currentTrialEndsAt: new Date("2026-06-21T12:00:00.000Z"),
          currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
          lastStripeEventCreatedAt: passiveStripeEventCreatedAt,
          memberId: "member_123",
          pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
          pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
          stripeCustomerId: "cus_auto_trial",
          stripeSubscriptionId: "sub_auto_trial",
        },
        core: {
          billingStatus: HostedBillingStatus.active,
        },
      }));

    await expect(
      writeHostedMemberStripeBillingTx({
        billingStatus: HostedBillingStatus.active,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialEndsAt: new Date("2026-06-21T12:00:00.000Z"),
        currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
        dispatchContext: {
          eventCreatedAt: autoTrialEventCreatedAt,
          occurredAt: autoTrialEventCreatedAt.toISOString(),
          sourceEventId: "auto-pulse-trial:sub_auto_trial",
          sourceType: "hosted.auto_pulse_trial.enrolled",
        },
        freshnessPolicy: "auto-pulse-trial-entitlement",
        member: makeMemberSnapshot({
          core: {
            billingStatus: HostedBillingStatus.not_started,
          },
        }),
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
        stripeCustomerId: "cus_auto_trial",
        stripeSubscriptionId: "sub_auto_trial",
        tx: {} as never,
      }),
    ).resolves.toMatchObject({
      billingRef: {
        lastStripeEventCreatedAt: passiveStripeEventCreatedAt,
        stripeCustomerId: "cus_auto_trial",
        stripeSubscriptionId: "sub_auto_trial",
      },
      core: {
        billingStatus: HostedBillingStatus.active,
      },
    });

    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.active,
      memberId: "member_123",
      prisma: {},
      suspendedAt: undefined,
    });
    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledWith(expect.objectContaining({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      memberId: "member_123",
      stripeCustomerId: "cus_auto_trial",
      stripeEventCreatedAt: passiveStripeEventCreatedAt,
      stripeSubscriptionId: "sub_auto_trial",
      tx: {},
    }));
  });

  it("rejects auto Pulse Trial entitlement when the locked current row is already paid", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: null,
        lastStripeEventCreatedAt: new Date("2026-06-14T12:00:02.000Z"),
        memberId: "member_123",
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        stripeCustomerId: "cus_paid",
        stripeSubscriptionId: "sub_paid",
      },
      core: {
        billingStatus: HostedBillingStatus.active,
      },
    }));

    await expect(
      writeHostedMemberStripeBillingTx({
        billingStatus: HostedBillingStatus.active,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialEndsAt: new Date("2026-06-21T12:00:00.000Z"),
        currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
        dispatchContext: {
          eventCreatedAt: new Date("2026-06-14T12:00:05.000Z"),
          occurredAt: "2026-06-14T12:00:05.000Z",
          sourceEventId: "auto-pulse-trial:sub_auto_trial",
          sourceType: "hosted.auto_pulse_trial.enrolled",
        },
        freshnessPolicy: "auto-pulse-trial-entitlement",
        member: makeMemberSnapshot({
          core: {
            billingStatus: HostedBillingStatus.not_started,
          },
        }),
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
        stripeCustomerId: "cus_auto_trial",
        stripeSubscriptionId: "sub_auto_trial",
        tx: {} as never,
      }),
    ).resolves.toBeNull();

    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
  });

  it.each([
    {
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        lastStripeEventCreatedAt: new Date("2026-06-14T12:00:02.000Z"),
        memberId: "member_123",
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        pulseTrialRedeemedAt: new Date("2026-06-10T12:00:00.000Z"),
        stripeCustomerId: "cus_prior_trial",
        stripeSubscriptionId: "sub_prior_trial",
      },
      billingStatus: HostedBillingStatus.incomplete,
      label: "already redeemed a Pulse Trial",
    },
    {
      billingRef: {
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: null,
        lastStripeEventCreatedAt: new Date("2026-06-14T12:00:02.000Z"),
        memberId: "member_123",
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        stripeCustomerId: "cus_active",
        stripeSubscriptionId: "sub_active",
      },
      billingStatus: HostedBillingStatus.active,
      label: "already active outside trial state",
    },
  ])("rejects auto Pulse Trial entitlement when the locked current row $label", async ({
    billingRef,
    billingStatus,
  }) => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot({
      billingRef,
      core: {
        billingStatus,
      },
    }));

    await expect(
      writeHostedMemberStripeBillingTx({
        billingStatus: HostedBillingStatus.active,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialEndsAt: new Date("2026-06-21T12:00:00.000Z"),
        currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
        dispatchContext: {
          eventCreatedAt: new Date("2026-06-14T12:00:05.000Z"),
          occurredAt: "2026-06-14T12:00:05.000Z",
          sourceEventId: "auto-pulse-trial:sub_auto_trial",
          sourceType: "hosted.auto_pulse_trial.enrolled",
        },
        freshnessPolicy: "auto-pulse-trial-entitlement",
        member: makeMemberSnapshot({
          core: {
            billingStatus: HostedBillingStatus.not_started,
          },
        }),
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
        stripeCustomerId: "cus_auto_trial",
        stripeSubscriptionId: "sub_auto_trial",
        tx: {} as never,
      }),
    ).resolves.toBeNull();

    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
  });

  it("keeps stale positive invoice writes blocked when they do not match the current Stripe refs", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: new Date("2026-04-25T05:13:10.000Z"),
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_existing",
      },
      core: {
        billingStatus: HostedBillingStatus.incomplete,
      },
    }));

    await expect(
      writeHostedMemberStripeBillingTx({
        billingStatus: HostedBillingStatus.active,
        canonicalBillingStatus: HostedBillingStatus.active,
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-25T05:13:09.000Z"),
          occurredAt: "2026-04-25T05:13:09.000Z",
          sourceEventId: "evt_invoice_paid_mismatch",
          sourceType: "stripe.invoice.paid",
        },
        freshnessPolicy: "positive-invoice-entitlement",
        member: makeMemberSnapshot({
          core: {
            billingStatus: HostedBillingStatus.incomplete,
          },
        }),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_other",
        tx: {} as never,
      }),
    ).resolves.toBeNull();

    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
  });

  it("does not let older positive invoices override a newer failed-payment billing state", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: new Date("2026-04-25T05:13:10.000Z"),
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
      core: {
        billingStatus: HostedBillingStatus.past_due,
      },
    }));

    await expect(
      writeHostedMemberStripeBillingTx({
        billingStatus: HostedBillingStatus.active,
        canonicalBillingStatus: HostedBillingStatus.active,
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-25T05:13:09.000Z"),
          occurredAt: "2026-04-25T05:13:09.000Z",
          sourceEventId: "evt_invoice_paid_after_failure",
          sourceType: "stripe.invoice.paid",
        },
        freshnessPolicy: "positive-invoice-entitlement",
        member: makeMemberSnapshot({
          core: {
            billingStatus: HostedBillingStatus.incomplete,
          },
        }),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        tx: {} as never,
      }),
    ).resolves.toBeNull();

    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
  });

  it("preserves newer Stripe refs when a stale positive invoice is missing an optional ref", async () => {
    const passiveStripeEventCreatedAt = new Date("2026-04-25T05:13:10.000Z");
    const invoicePaidStripeEventCreatedAt = new Date("2026-04-25T05:13:09.000Z");

    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeMemberSnapshot({
        billingRef: {
          lastStripeEventCreatedAt: passiveStripeEventCreatedAt,
          memberId: "member_123",
          stripeCustomerId: "cus_passive",
          stripeSubscriptionId: "sub_123",
        },
        core: {
          billingStatus: HostedBillingStatus.incomplete,
        },
      }))
      .mockResolvedValueOnce(makeMemberSnapshot({
        billingRef: {
          lastStripeEventCreatedAt: passiveStripeEventCreatedAt,
          memberId: "member_123",
          stripeCustomerId: "cus_passive",
          stripeSubscriptionId: "sub_123",
        },
        core: {
          billingStatus: HostedBillingStatus.active,
        },
      }));

    await expect(
      writeHostedMemberStripeBillingTx({
        billingStatus: HostedBillingStatus.active,
        canonicalBillingStatus: HostedBillingStatus.active,
        dispatchContext: {
          eventCreatedAt: invoicePaidStripeEventCreatedAt,
          occurredAt: invoicePaidStripeEventCreatedAt.toISOString(),
          sourceEventId: "evt_invoice_paid_missing_customer",
          sourceType: "stripe.invoice.paid",
        },
        freshnessPolicy: "positive-invoice-entitlement",
        member: makeMemberSnapshot({
          core: {
            billingStatus: HostedBillingStatus.incomplete,
          },
        }),
        stripeCustomerId: null,
        stripeSubscriptionId: "sub_123",
        tx: {} as never,
      }),
    ).resolves.toEqual(makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: passiveStripeEventCreatedAt,
        memberId: "member_123",
        stripeCustomerId: "cus_passive",
        stripeSubscriptionId: "sub_123",
      },
      core: {
        billingStatus: HostedBillingStatus.active,
      },
    }));

    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledWith({
      memberId: "member_123",
      stripeCustomerId: "cus_passive",
      stripeEventCreatedAt: passiveStripeEventCreatedAt,
      stripeSubscriptionId: "sub_123",
      tx: {},
    });
  });

  it("still allows same-second Stripe billing writes to proceed because source ids are not monotonic", async () => {
    const freshnessAt = new Date("2026-04-12T01:00:00.000Z");
    let currentBillingStatus = HostedBillingStatus.active;
    let currentBillingRef = {
      lastStripeEventCreatedAt: freshnessAt,
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_456",
    };

    mocks.readHostedMemberBillingSnapshot.mockImplementation(async () => makeMemberSnapshot({
      billingRef: currentBillingRef,
      core: {
        billingStatus: currentBillingStatus,
      },
    }));
    mocks.updateHostedMemberCoreState.mockImplementation(async ({ billingStatus }) => {
      currentBillingStatus = billingStatus;
      return makeMemberSnapshot({
        billingRef: currentBillingRef,
        core: {
          billingStatus,
        },
      }).core;
    });
    mocks.writeHostedMemberStripeBillingRef.mockImplementation(async ({
      stripeEventCreatedAt,
      stripeCustomerId,
      stripeSubscriptionId,
    }) => {
      currentBillingRef = {
        lastStripeEventCreatedAt: stripeEventCreatedAt ?? null,
        memberId: "member_123",
        stripeCustomerId: stripeCustomerId ?? null,
        stripeSubscriptionId: stripeSubscriptionId ?? null,
      };
    });

    await expect(
      writeHostedMemberStripeBillingTx({
        billingStatus: HostedBillingStatus.past_due,
        canonicalBillingStatus: HostedBillingStatus.past_due,
        dispatchContext: {
          eventCreatedAt: freshnessAt,
          occurredAt: freshnessAt.toISOString(),
          sourceEventId: "evt_same_second",
          sourceType: "stripe.invoice.payment_failed",
        },
        member: makeMemberSnapshot(),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_456",
        tx: {} as never,
      }),
    ).resolves.toEqual(makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: freshnessAt,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_456",
      },
      core: {
        billingStatus: HostedBillingStatus.past_due,
      },
    }));

    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledWith({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeEventCreatedAt: freshnessAt,
      stripeSubscriptionId: "sub_456",
      tx: {},
    });
  });

  it("persists Stripe freshness markers for ref-only checkout bindings", async () => {
    const tx = {
      __tag: "tx",
    };

    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        memberId: "member_123",
        stripeCustomerId: "cus_existing",
        stripeSubscriptionId: "sub_existing",
      },
    })).mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
        memberId: "member_123",
        stripeCustomerId: "cus_checkout",
        stripeSubscriptionId: "sub_checkout",
      },
    }));

    await expect(
      writeHostedMemberStripeBillingRefIfFreshTx({
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          sourceEventId: "evt_checkout",
        },
        memberId: "member_123",
        stripeCustomerId: "cus_checkout",
        stripeSubscriptionId: "sub_checkout",
        tx: tx as never,
      }),
    ).resolves.toEqual(makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
        memberId: "member_123",
        stripeCustomerId: "cus_checkout",
        stripeSubscriptionId: "sub_checkout",
      },
    }));

    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledWith({
      memberId: "member_123",
      stripeCustomerId: "cus_checkout",
      stripeEventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
      stripeSubscriptionId: "sub_checkout",
      tx,
    });
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
