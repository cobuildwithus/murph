import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

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

  return {
    activateHostedMemberForPositiveSource: vi.fn(),
    drainHostedExecutionOutboxBestEffort: vi.fn(),
    findMemberForStripeObject: vi.fn(),
    getHostedInviteStatus: vi.fn(),
    readHostedMemberSnapshot: vi.fn(),
    requireHostedInviteForAuthentication: vi.fn(),
    requireHostedStripeApi: vi.fn(),
    runHostedMemberActivationPostCommitEffects: vi.fn(),
    stripe,
    updateHostedMemberStripeBillingIfFresh: vi.fn(),
    writeHostedMemberStripeBillingRef: vi.fn(),
  };
});

vi.mock("@/src/lib/hosted-execution/outbox", () => ({
  drainHostedExecutionOutboxBestEffort: mocks.drainHostedExecutionOutboxBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberSnapshot: mocks.readHostedMemberSnapshot,
}));

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
  activateHostedMemberForPositiveSource: mocks.activateHostedMemberForPositiveSource,
  runHostedMemberActivationPostCommitEffects: mocks.runHostedMemberActivationPostCommitEffects,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApi: mocks.requireHostedStripeApi,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-lookup", () => ({
  findMemberForStripeObject: mocks.findMemberForStripeObject,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-policy", () => ({
  updateHostedMemberStripeBillingIfFresh: mocks.updateHostedMemberStripeBillingIfFresh,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  writeHostedMemberStripeBillingRef: mocks.writeHostedMemberStripeBillingRef,
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
    mocks.readHostedMemberSnapshot.mockResolvedValue(createMemberSnapshot());
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
    mocks.activateHostedMemberForPositiveSource.mockResolvedValue({
      activated: true,
      hostedExecutionEventId: "member.activated:stripe.checkout.session.success_redirect:member_123:cs_123",
      memberId: "member_123",
      postCommitProvisionUserId: "member_123",
    });
    mocks.getHostedInviteStatus.mockResolvedValue(createStatus({
      activationPending: true,
      stage: "active",
    }));
  });

  it("reconciles a paid checkout session and returns the refreshed invite status", async () => {
    const prisma = {} as never;

    await expect(reconcileHostedBillingCheckoutSuccess({
      inviteCode: "invite-code",
      member: createAuthenticatedMember(),
      prisma,
      sessionId: "cs_123",
    })).resolves.toEqual(createStatus({
      activationPending: true,
      stage: "active",
    }));

    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_123", {
      expand: ["subscription"],
    });
    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    expect(mocks.updateHostedMemberStripeBillingIfFresh).toHaveBeenCalledWith(expect.objectContaining({
      billingStatus: HostedBillingStatus.active,
      dispatchContext: expect.objectContaining({
        sourceEventId: "cs_123",
        sourceType: "stripe.checkout.session.success_redirect",
      }),
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    }));
    expect(mocks.activateHostedMemberForPositiveSource).toHaveBeenCalledWith(expect.objectContaining({
      member: expect.objectContaining({
        core: expect.objectContaining({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
        }),
      }),
      skipIfBillingAlreadyActive: false,
    }));
    expect(mocks.runHostedMemberActivationPostCommitEffects).toHaveBeenCalledWith({
      postCommitProvisionUserId: "member_123",
    });
    expect(mocks.drainHostedExecutionOutboxBestEffort).toHaveBeenCalledWith({
      eventIds: ["member.activated:stripe.checkout.session.success_redirect:member_123:cs_123"],
      limit: 1,
      prisma,
    });
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
    mocks.findMemberForStripeObject.mockResolvedValueOnce({
      ...createMemberSnapshot(),
      core: {
        ...createMemberSnapshot().core,
        id: "member_other",
      },
    });

    await expect(reconcileHostedBillingCheckoutSuccess({
      inviteCode: "invite-code",
      member: createAuthenticatedMember(),
      prisma: {} as never,
      sessionId: "cs_other",
    })).rejects.toMatchObject({
      code: "STRIPE_CHECKOUT_MEMBER_MISMATCH",
    });

    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSource).not.toHaveBeenCalled();
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
  activationPending?: boolean;
  stage?: HostedInviteStatusPayload["stage"];
}): HostedInviteStatusPayload {
  return {
    activationPending: input?.activationPending ?? false,
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
