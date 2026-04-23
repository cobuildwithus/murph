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
  writeHostedMemberStripeBillingRefIfFreshTx,
  writeHostedMemberStripeBillingTx,
  updateHostedMemberStripeBillingIfFreshTx,
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

  it("keeps the legacy freshness-named export as an alias of the locked write helper", () => {
    expect(updateHostedMemberStripeBillingIfFreshTx).toBe(writeHostedMemberStripeBillingTx);
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
