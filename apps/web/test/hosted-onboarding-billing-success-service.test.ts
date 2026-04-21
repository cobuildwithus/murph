import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";

const mocks = vi.hoisted(() => {
  const stripe = {
    checkout: {
      sessions: {
        retrieve: vi.fn(),
      },
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
  };

  const state = {
    activateHostedMemberForPositiveSourceTx: vi.fn(),
    findMemberForStripeObject: vi.fn(),
    getHostedInviteStatus: vi.fn(),
    nudgeHostedRunBestEffort: vi.fn(),
    readHostedMemberCoreState: vi.fn(),
    requireHostedInviteForAuthentication: vi.fn(),
    requireHostedStripeApi: vi.fn(),
    stripe,
    updateHostedMemberStripeBillingIfFresh: vi.fn(),
    writeHostedMemberStripeBillingRef: vi.fn(),
  };

  return state;
});

vi.mock("@/src/lib/hosted-ingress/control", () => ({
  nudgeHostedRunBestEffort: mocks.nudgeHostedRunBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    composeHostedMemberBillingSnapshot: actual.composeHostedMemberBillingSnapshot,
    readHostedMemberCoreState: mocks.readHostedMemberCoreState,
  };
});

vi.mock("@/src/lib/hosted-onboarding/invite-service", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/invite-service")>(
    "@/src/lib/hosted-onboarding/invite-service",
  );

  return {
    ...actual,
    getHostedInviteStatus: mocks.getHostedInviteStatus,
    requireHostedInviteForAuthentication: mocks.requireHostedInviteForAuthentication,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForPositiveSourceTx: mocks.activateHostedMemberForPositiveSourceTx,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApi: mocks.requireHostedStripeApi,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-lookup", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-lookup")
  >("@/src/lib/hosted-onboarding/stripe-billing-lookup");

  return {
    ...actual,
    findMemberForStripeCheckoutSession: mocks.findMemberForStripeObject,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-policy", () => ({
  updateHostedMemberStripeBillingIfFreshTx: mocks.updateHostedMemberStripeBillingIfFresh,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  writeHostedMemberStripeBillingRefTx: mocks.writeHostedMemberStripeBillingRef,
}));

import { reconcileHostedBillingCheckoutSuccess } from "@/src/lib/hosted-onboarding/billing-success-service";

describe("reconcileHostedBillingCheckoutSuccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedStripeApi.mockReturnValue(mocks.stripe);
    mocks.requireHostedInviteForAuthentication.mockResolvedValue({
      inviteCode: "invite-code",
      memberId: "member_123",
    });
    mocks.readHostedMemberCoreState.mockResolvedValue(createMemberSnapshot().core);
    mocks.findMemberForStripeObject.mockResolvedValue(createMemberSnapshot());
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: "member_123",
      customer: "cus_123",
      id: "cs_123",
      metadata: {
        memberId: "member_123",
      },
      subscription: {
        id: "sub_123",
        status: "active",
      },
    });
    mocks.updateHostedMemberStripeBillingIfFresh.mockResolvedValue(
      createMemberSnapshot({
        billingStatus: HostedBillingStatus.active,
      }),
    );
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValue({
      activated: true,
      hostedExecutionEventId: "member.activated:stripe.checkout.session.success_redirect:member_123:cs_123",
      memberId: "member_123",
    });
    mocks.getHostedInviteStatus.mockResolvedValue(createStatus({
      stage: "activating",
    }));
  });

  it("reconciles a paid checkout session and returns the refreshed invite status", async () => {
    const tx = {
      __tag: "tx",
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    await expect(reconcileHostedBillingCheckoutSuccess({
      inviteCode: "invite-code",
      member: createAuthenticatedMember(),
      prisma: prisma as never,
      sessionId: "cs_123",
    })).resolves.toEqual(createStatus({
      stage: "activating",
    }));

    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_123", {
      expand: ["subscription"],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    );
    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
    expect(mocks.updateHostedMemberStripeBillingIfFresh).toHaveBeenCalledWith(expect.objectContaining({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: expect.objectContaining({
        sourceEventId: "cs_123",
        sourceType: "stripe.checkout.session.success_redirect",
      }),
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      tx,
    }));
    const activationInput = mocks.activateHostedMemberForPositiveSourceTx.mock.calls[0]?.[0];
    expect(activationInput).toEqual(expect.objectContaining({
      memberId: "member_123",
      prisma: tx,
      skipIfBillingAlreadyActive: false,
    }));
    expect(activationInput).not.toHaveProperty("emailLinked");
    expect(mocks.nudgeHostedRunBestEffort).toHaveBeenCalledWith({
      context: "billing-success.redirect",
      userId: "member_123",
    });
  });

  it("passes email-linked activation through when the browser session already has a verified email account", async () => {
    const tx = {
      __tag: "tx",
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    await expect(reconcileHostedBillingCheckoutSuccess({
      inviteCode: "invite-code",
      linkedAccounts: [{
        address: "user@example.test",
        type: "email",
        verifiedAt: 1_714_700_800,
      }],
      member: createAuthenticatedMember(),
      prisma: prisma as never,
      sessionId: "cs_123",
    })).resolves.toEqual(createStatus({
      stage: "activating",
    }));

    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledWith(expect.objectContaining({
      emailLinked: true,
      memberId: "member_123",
      prisma: tx,
    }));
  });

  it("only writes the durable billing reference when the checkout session has no subscription object", async () => {
    const tx = {
      __tag: "tx",
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
      client_reference_id: "member_123",
      customer: "cus_123",
      id: "cs_no_subscription",
      metadata: {
        memberId: "member_123",
      },
      subscription: null,
    });

    await expect(reconcileHostedBillingCheckoutSuccess({
      inviteCode: "invite-code",
      member: createAuthenticatedMember(),
      prisma: prisma as never,
      sessionId: "cs_no_subscription",
    })).resolves.toEqual(createStatus({
      stage: "activating",
    }));

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    );
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledWith({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: null,
      tx,
    });
    expect(mocks.updateHostedMemberStripeBillingIfFresh).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunBestEffort).not.toHaveBeenCalled();
  });

  it("trusts the explicit checkout member identifiers before any Stripe-object lookup", async () => {
    const tx = {
      __tag: "tx",
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    mocks.findMemberForStripeObject.mockRejectedValueOnce(new Error("should not run"));

    await expect(reconcileHostedBillingCheckoutSuccess({
      inviteCode: "invite-code",
      member: createAuthenticatedMember(),
      prisma: prisma as never,
      sessionId: "cs_123",
    })).resolves.toEqual(createStatus({
      stage: "activating",
    }));

    expect(mocks.findMemberForStripeObject).not.toHaveBeenCalled();
  });

  it("rejects checkout sessions that resolve to a different member", async () => {
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
      client_reference_id: "member_other",
      customer: "cus_other",
      id: "cs_other",
      metadata: {
        memberId: "member_other",
      },
      subscription: {
        id: "sub_other",
        status: "active",
      },
    });
    await expect(reconcileHostedBillingCheckoutSuccess({
      inviteCode: "invite-code",
      member: createAuthenticatedMember(),
      prisma: {
        $transaction: vi.fn(),
      } as never,
      sessionId: "cs_other",
    })).rejects.toMatchObject({
      code: "STRIPE_CHECKOUT_MEMBER_MISMATCH",
    });

    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });
});

function createAuthenticatedMember() {
  return {
    billingStatus: HostedBillingStatus.not_started,
    createdAt: new Date("2026-03-27T12:00:00.000Z"),
    id: "member_123",
    suspendedAt: null,
    updatedAt: new Date("2026-03-27T12:00:00.000Z"),
  };
}

function createMemberSnapshot(input?: {
  billingStatus?: HostedBillingStatus;
}) {
  return {
    billingRef: {
      memberId: "member_123",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    },
    core: {
      billingStatus: input?.billingStatus ?? HostedBillingStatus.not_started,
      createdAt: new Date("2026-03-27T12:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-03-27T12:00:00.000Z"),
    },
    identity: null,
    routing: null,
  };
}

function createStatus(input?: {
  stage?: HostedInviteStatusPayload["stage"];
}): HostedInviteStatusPayload {
  return {
    billing: {
      defaultPlanCode: getHostedDefaultBillingPlanCode(),
      plans: listHostedBillingPlanPresentations(),
    },
    capabilities: {
      billingReady: true,
      phoneAuthReady: true,
    },
    invite: {
      code: "invite-code",
      expiresAt: "2026-03-27T12:00:00.000Z",
      phoneHint: "+1 415 555 2671",
    },
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: true,
    },
    messagingSetupRequired: false,
    stage: input?.stage ?? "checkout",
  };
}
