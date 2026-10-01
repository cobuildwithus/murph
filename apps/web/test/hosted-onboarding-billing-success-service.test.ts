import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  getHostedDomainRootUnwrapCache,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";

const mocks = vi.hoisted(() => {
  const stripe = {
    checkout: {
      sessions: {
        retrieve: vi.fn(),
      },
    },
  };

  const state = {
    applyStripeCheckoutCompleted: vi.fn(),
    cleanupHostedFamilySponsoredDirectSubscription: vi.fn(),
    cleanupHostedStandardCheckoutLoser: vi.fn(),
    findMemberForStripeObject: vi.fn(),
    getHostedInviteStatus: vi.fn(),
    listHostedStripeCheckoutSessionMemberIds: vi.fn(),
    prepareHostedStripeCheckoutCompletion: vi.fn(),
    sendHostedSignupWelcomeEmailForMemberBestEffort: vi.fn(),
    readHostedMemberCoreState: vi.fn(),
    requireHostedInviteForAuthentication: vi.fn(),
    requireHostedStripeApi: vi.fn(),
    stripe,
  };

  return state;
});

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


vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApi: mocks.requireHostedStripeApi,
}));

vi.mock("@/src/lib/hosted-onboarding/signup-welcome-email", () => ({
  sendHostedSignupWelcomeEmailForMemberBestEffort:
    mocks.sendHostedSignupWelcomeEmailForMemberBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-lookup", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-lookup")
  >("@/src/lib/hosted-onboarding/stripe-billing-lookup");

  return {
    ...actual,
    findMemberForStripeCheckoutSession: mocks.findMemberForStripeObject,
    listHostedStripeCheckoutSessionMemberIds: mocks.listHostedStripeCheckoutSessionMemberIds,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", () => ({
  applyStripeCheckoutCompleted: mocks.applyStripeCheckoutCompleted,
  cleanupHostedFamilySponsoredDirectSubscription:
    mocks.cleanupHostedFamilySponsoredDirectSubscription,
  cleanupHostedStandardCheckoutAndRetireAttempt:
    mocks.cleanupHostedStandardCheckoutLoser,
  prepareHostedStripeCheckoutCompletion:
    mocks.prepareHostedStripeCheckoutCompletion,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-checkout-loser-cleanup", () => ({
  cleanupHostedStandardCheckoutLoser:
    mocks.cleanupHostedStandardCheckoutLoser,
}));

import { reconcileHostedBillingCheckoutSuccess } from "@/src/lib/hosted-onboarding/billing-success-service";

const checkoutSubscriptionStatuses = [
  "active",
  "trialing",
  "past_due",
  "paused",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
] as const;

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
    mocks.listHostedStripeCheckoutSessionMemberIds.mockResolvedValue(["member_123"]);
    mocks.prepareHostedStripeCheckoutCompletion.mockResolvedValue(
      null,
    );
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: "member_123",
      customer: "cus_123",
      id: "cs_123",
      metadata: {
        memberId: "member_123",
      },
      status: "complete",
      subscription: {
        id: "sub_123",
        status: "active",
      },
    });
    mocks.applyStripeCheckoutCompleted.mockResolvedValue({
      welcomeEmailMemberId: null,
    });
    mocks.cleanupHostedFamilySponsoredDirectSubscription.mockResolvedValue(undefined);
    mocks.cleanupHostedStandardCheckoutLoser.mockResolvedValue(undefined);
    mocks.sendHostedSignupWelcomeEmailForMemberBestEffort.mockResolvedValue(undefined);
    mocks.getHostedInviteStatus.mockResolvedValue(createStatus({
      stage: "activating",
    }));
  });

  it.each(checkoutSubscriptionStatuses)(
    "delegates a complete %s Checkout to the billing owner under the member lock",
    async (status) => {
      const tx = {
        __tag: "tx",
        $queryRaw: vi.fn(async () => []),
      };
      const prisma = {
        $transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
      };

      mocks.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
        client_reference_id: "member_123",
        customer: "cus_123",
        id: `cs_${status}`,
        metadata: {
          memberId: "member_123",
        },
        status: "complete",
        subscription: {
          id: `sub_${status}`,
          status,
        },
      });

      await expect(reconcileHostedBillingCheckoutSuccess({
        inviteCode: "invite-code",
        linkedAccounts: [{
          address: "user@example.test",
          type: "email",
          verifiedAt: 1_714_700_800,
        }],
        member: createAuthenticatedMember(),
        prisma: prisma as never,
        sessionId: `cs_${status}`,
      })).resolves.toEqual(createStatus({
        stage: "activating",
      }));

      expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(`cs_${status}`, {
        expand: ["subscription"],
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.$queryRaw).toHaveBeenCalledOnce();
      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        {
          ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
          timeout: 780_000,
        },
      );
      expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: "cus_123",
          id: `cs_${status}`,
          subscription: {
            id: `sub_${status}`,
            status,
          },
        }),
        tx,
      );
      expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).not.toHaveBeenCalled();
      expect(mocks.cleanupHostedStandardCheckoutLoser).not.toHaveBeenCalled();
    },
  );

  it("prepares direct Checkout bindings before opening the member transaction", async () => {
    let cacheWasActiveDuringPreparation = false;
    let cacheWasActiveDuringTransaction = false;
    const tx = {
      __tag: "tx",
      $queryRaw: vi.fn(async () => []),
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (innerTx: typeof tx) => Promise<unknown>) => {
          cacheWasActiveDuringTransaction =
            getHostedDomainRootUnwrapCache() !== undefined;
          return callback(tx);
        },
      ),
    };
    const preparedCheckoutCompletion = {
      billingCompletion: {
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeCustomerIdEncrypted: "encrypted-customer",
        stripeCustomerLookupKey: "customer-lookup",
        stripeSubscriptionId: "sub_123",
        stripeSubscriptionIdEncrypted: "encrypted-subscription",
        stripeSubscriptionLookupKey: "subscription-lookup",
      },
      canonicalSubscription: null,
      memberId: "member_123",
      stripeCheckoutEmail: null,
    };
    mocks.prepareHostedStripeCheckoutCompletion.mockImplementationOnce(
      async () => {
        cacheWasActiveDuringPreparation =
          getHostedDomainRootUnwrapCache() !== undefined;
        return preparedCheckoutCompletion;
      },
    );

    await reconcileHostedBillingCheckoutSuccess({
      inviteCode: "invite-code",
      member: createAuthenticatedMember(),
      prisma: prisma as never,
      sessionId: "cs_123",
    });

    expect(
      mocks.prepareHostedStripeCheckoutCompletion
        .mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0] ?? 0);
    expect(cacheWasActiveDuringPreparation).toBe(true);
    expect(cacheWasActiveDuringTransaction).toBe(true);
    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cs_123" }),
      tx,
      undefined,
      preparedCheckoutCompletion,
    );
  });

  it("delegates Checkout reconciliation when linked accounts are present", async () => {
    const tx = {
      __tag: "tx",
      $queryRaw: vi.fn(async () => []),
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

    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_123",
        id: "cs_123",
        subscription: {
          id: "sub_123",
          status: "active",
        },
      }),
      tx,
    );
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it("cancels a direct checkout superseded by Family sponsorship on the browser path", async () => {
    const tx = {
      __tag: "tx",
      $queryRaw: vi.fn(async () => []),
    };
    const prisma = {
      $transaction: vi.fn(async (
        callback: (innerTx: typeof tx) => Promise<unknown>,
      ) => callback(tx)),
    };
    mocks.applyStripeCheckoutCompleted.mockResolvedValueOnce({
      cleanupFamilySponsoredCheckout: {
        checkoutSessionId: "cs_123",
        subscriptionId: "sub_superseded",
      },
      welcomeEmailMemberId: null,
    });

    await expect(reconcileHostedBillingCheckoutSuccess({
      inviteCode: "invite-code",
      member: createAuthenticatedMember(),
      prisma: prisma as never,
      sessionId: "cs_123",
    })).resolves.toEqual(createStatus({ stage: "activating" }));

    expect(mocks.cleanupHostedFamilySponsoredDirectSubscription).toHaveBeenCalledWith({
      checkoutSessionId: "cs_123",
      memberId: "member_123",
      prisma,
      sourceEventId:
        "checkout-success:cs_123:family-sponsored-checkout-cleanup",
      subscriptionId: "sub_superseded",
    });
    expect(mocks.cleanupHostedStandardCheckoutLoser).not.toHaveBeenCalled();
  });

  it("cleans up a superseded standard checkout on the browser path", async () => {
    const tx = {
      __tag: "tx",
      $queryRaw: vi.fn(async () => []),
    };
    const prisma = {
      $transaction: vi.fn(async (
        callback: (innerTx: typeof tx) => Promise<unknown>,
      ) => callback(tx)),
    };
    mocks.applyStripeCheckoutCompleted.mockResolvedValueOnce({
      cleanupStandardCheckout: {
        checkoutSessionId: "cs_123",
        subscriptionId: "sub_loser",
      },
      welcomeEmailMemberId: null,
    });

    await expect(reconcileHostedBillingCheckoutSuccess({
      inviteCode: "invite-code",
      member: createAuthenticatedMember(),
      prisma: prisma as never,
      sessionId: "cs_123",
    })).resolves.toEqual(createStatus({ stage: "activating" }));

    expect(mocks.cleanupHostedStandardCheckoutLoser).toHaveBeenCalledWith({
      checkoutSessionId: "cs_123",
      memberId: "member_123",
      prisma,
      stripe: mocks.stripe,
      subscriptionId: "sub_loser",
    });
  });

  it("keeps an expanded terminal Family handoff out of browser loser cleanup", async () => {
    const tx = {
      __tag: "tx",
      $queryRaw: vi.fn(async () => []),
    };
    const prisma = {
      $transaction: vi.fn(async (
        callback: (innerTx: typeof tx) => Promise<unknown>,
      ) => callback(tx)),
    };
    const canonicalFamilySubscription = {
      customer: "cus_123",
      id: "sub_123",
      metadata: {
        accountGroupId: "hbag_family",
        billingPlanCode: "launch_family_monthly",
        kind: "hosted_family_plan",
        ownerMemberId: "member_123",
      },
      status: "canceled",
    };
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
      client_reference_id: "member_123",
      customer: "cus_123",
      id: "cs_accepted_before_family",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutAttemptId: "attempt_accepted_before_family",
        checkoutIntentHash: "intent_accepted_before_family",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "complete",
      subscription: canonicalFamilySubscription,
    });

    await expect(reconcileHostedBillingCheckoutSuccess({
      inviteCode: "invite-code",
      member: createAuthenticatedMember(),
      prisma: prisma as never,
      sessionId: "cs_accepted_before_family",
    })).resolves.toEqual(createStatus({ stage: "activating" }));

    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cs_accepted_before_family",
        subscription: canonicalFamilySubscription,
      }),
      tx,
    );
    expect(mocks.cleanupHostedFamilySponsoredDirectSubscription).not.toHaveBeenCalled();
    expect(mocks.cleanupHostedStandardCheckoutLoser).not.toHaveBeenCalled();
  });

  it("passes checkout welcome candidates through the durable welcome gate", async () => {
    const tx = {
      __tag: "tx",
      $queryRaw: vi.fn(async () => []),
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    mocks.applyStripeCheckoutCompleted.mockResolvedValueOnce({
      welcomeEmailMemberId: "member_123",
    });

    await expect(reconcileHostedBillingCheckoutSuccess({
      inviteCode: "invite-code",
      member: createAuthenticatedMember(),
      prisma: prisma as never,
      sessionId: "cs_123",
    })).resolves.toEqual(createStatus({
      stage: "activating",
    }));

    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
    });
  });

  it("delegates a Checkout without an expanded subscription to the billing owner", async () => {
    const tx = {
      __tag: "tx",
      $queryRaw: vi.fn(async () => []),
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
      status: "complete",
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
      {
        ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
        timeout: 780_000,
      },
    );
    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_123",
        id: "cs_no_subscription",
        subscription: null,
      }),
      tx,
    );
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it("rejects success reconciliation until the checkout session is complete", async () => {
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
      client_reference_id: "member_123",
      customer: "cus_123",
      id: "cs_open_123",
      metadata: {
        memberId: "member_123",
      },
      status: "open",
      subscription: {
        id: "sub_open_123",
        status: "incomplete",
      },
    });

    await expect(reconcileHostedBillingCheckoutSuccess({
      inviteCode: "invite-code",
      member: createAuthenticatedMember(),
      prisma: {
        $transaction: vi.fn(),
      } as never,
      sessionId: "cs_open_123",
    })).rejects.toMatchObject({
      code: "STRIPE_CHECKOUT_SESSION_NOT_COMPLETE",
      httpStatus: 409,
    });

    expect(mocks.applyStripeCheckoutCompleted).not.toHaveBeenCalled();
  });

  it("trusts the explicit checkout member identifiers before any Stripe-object lookup", async () => {
    const tx = {
      __tag: "tx",
      $queryRaw: vi.fn(async () => []),
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
    mocks.listHostedStripeCheckoutSessionMemberIds.mockResolvedValueOnce(["member_other"]);
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
      client_reference_id: "member_other",
      customer: "cus_other",
      id: "cs_other",
      metadata: {
        memberId: "member_other",
      },
      status: "complete",
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

    expect(mocks.applyStripeCheckoutCompleted).not.toHaveBeenCalled();
  });
});

function createAuthenticatedMember() {
  return {
    billingStatus: HostedBillingStatus.not_started,
    createdAt: new Date("2026-03-27T12:00:00.000Z"),
    id: "member_123",
    pendingActivationTimeZone: null,
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
      phoneAuthTarget: {
        kind: "saved",
        phoneHint: "+1 415 555 2671",
      },
      phoneHint: "+1 415 555 2671",
      verificationMode: "invite_phone",
    },
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: true,
    },
    messagingSetupRequired: false,
    stage: input?.stage ?? "checkout",
    telegramStartRequired: false,
  };
}
