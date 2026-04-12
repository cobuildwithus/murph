import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";
import type { HostedStripeDispatchContext } from "@/src/lib/hosted-onboarding/stripe-dispatch";

const mocks = vi.hoisted(() => ({
  enqueueHostedExecutionOutbox: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  provisionManagedUserCryptoInHostedExecution: vi.fn(),
  readHostedMemberSnapshot: vi.fn(),
  resolveHostedMemberActivationLinqRoute: vi.fn(),
  updateHostedMemberCoreState: vi.fn(),
  withHostedOnboardingTransaction: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  provisionManagedUserCryptoInHostedExecution:
    mocks.provisionManagedUserCryptoInHostedExecution,
}));

vi.mock("@/src/lib/hosted-execution/outbox", () => ({
  enqueueHostedExecutionOutbox: mocks.enqueueHostedExecutionOutbox,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    readHostedMemberSnapshot: mocks.readHostedMemberSnapshot,
    updateHostedMemberCoreState: mocks.updateHostedMemberCoreState,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-home-routing", () => ({
  resolveHostedMemberActivationLinqRoute: mocks.resolveHostedMemberActivationLinqRoute,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/shared")
  >("@/src/lib/hosted-onboarding/shared");

  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
    withHostedOnboardingTransaction: mocks.withHostedOnboardingTransaction,
  };
});

import {
  activateHostedMemberForPositiveSource,
  activateHostedMemberFromConfirmedRevnetIssuance,
  runHostedMemberActivationPostCommitEffects,
} from "@/src/lib/hosted-onboarding/member-activation";

describe("hosted onboarding member activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.provisionManagedUserCryptoInHostedExecution.mockResolvedValue(undefined);
    mocks.readHostedMemberSnapshot.mockResolvedValue(makeMemberSnapshot());
    mocks.resolveHostedMemberActivationLinqRoute.mockResolvedValue({
      firstContactLinqChatId: "chat_home_123",
    });
    mocks.updateHostedMemberCoreState.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-04-12T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-04-12T00:00:00.000Z"),
    });
    mocks.enqueueHostedExecutionOutbox.mockResolvedValue({
      eventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
    });
    mocks.withHostedOnboardingTransaction.mockImplementation(async (prisma, callback) =>
      callback(prisma as never),
    );
  });

  it("keeps the Linq routing lookup and activation dispatch ownership together for Stripe activations", async () => {
    const member = makeMemberSnapshot();
    const dispatchContext: HostedStripeDispatchContext = {
      eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
      occurredAt: "2026-04-12T00:00:00.000Z",
      sourceEventId: "evt_123",
      sourceType: "stripe.invoice.paid",
    };

    await expect(
      activateHostedMemberForPositiveSource({
        dispatchContext,
        member,
        prisma: makeTransactionHarness() as never,
      }),
    ).resolves.toEqual({
      activated: true,
      hostedExecutionEventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
      memberId: "member_123",
      postCommitProvisionUserId: "member_123",
    });

    expect(mocks.resolveHostedMemberActivationLinqRoute).toHaveBeenCalledWith({
      member,
      prisma: expect.anything(),
      sourceEventId: "evt_123",
      sourceType: "stripe.invoice.paid",
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith({
      dispatch: expect.objectContaining({
        eventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
        event: expect.objectContaining({
          firstContact: {
            channel: "linq",
            identityId: "hbidx:phone:v1:lookup",
            threadId: "chat_home_123",
            threadIsDirect: true,
          },
          kind: "member.activated",
        }),
      }),
      sourceId: "stripe:evt_123",
      sourceType: "hosted_stripe_event",
      tx: expect.anything(),
    });
  });

  it("keeps the revnet confirmation path on the same activation owner", async () => {
    const member = makeMemberSnapshot();

    await expect(
      activateHostedMemberFromConfirmedRevnetIssuance({
        member,
        occurredAt: "2026-04-12T00:00:00.000Z",
        prisma: makeTransactionHarness() as never,
        sourceEventId: "revnet_evt_123",
        sourceType: "hosted.revnet.issuance.confirmed",
      }),
    ).resolves.toEqual({
      activated: true,
      hostedExecutionEventId: "member.activated:hosted.revnet.issuance.confirmed:member_123:revnet_evt_123",
      memberId: "member_123",
    });

    expect(mocks.provisionManagedUserCryptoInHostedExecution).toHaveBeenCalledWith("member_123");
    expect(mocks.resolveHostedMemberActivationLinqRoute).toHaveBeenCalledWith({
      member,
      prisma: expect.anything(),
      sourceEventId: "revnet_evt_123",
      sourceType: "hosted.revnet.issuance.confirmed",
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "revnet_evt_123",
        sourceType: "hosted_revnet_issuance",
      }),
    );
  });

  it("returns the existing activation event when billing is already active and the outbox row exists", async () => {
    const member = makeMemberSnapshot({
      core: {
        billingStatus: HostedBillingStatus.active,
      },
    });
    const transaction = makeTransactionHarness({
      existingDispatch: {
        eventId: "member.activated:stripe.customer.subscription.updated:member_123:evt_123",
      },
    });
    mocks.readHostedMemberSnapshot.mockResolvedValue(member);

    await expect(
      activateHostedMemberForPositiveSource({
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_123",
          sourceType: "stripe.customer.subscription.updated",
        },
        member,
        prisma: transaction as never,
        skipIfBillingAlreadyActive: true,
      }),
    ).resolves.toEqual({
      activated: false,
      hostedExecutionEventId: "member.activated:stripe.customer.subscription.updated:member_123:evt_123",
      memberId: "member_123",
      postCommitProvisionUserId: "member_123",
    });

    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.resolveHostedMemberActivationLinqRoute).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("runs the shared post-commit crypto provision helper only when activation scheduled it", async () => {
    await expect(
      runHostedMemberActivationPostCommitEffects({
        postCommitProvisionUserId: null,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.provisionManagedUserCryptoInHostedExecution).not.toHaveBeenCalled();

    await expect(
      runHostedMemberActivationPostCommitEffects({
        postCommitProvisionUserId: "member_123",
      }),
    ).resolves.toBeUndefined();

    expect(mocks.provisionManagedUserCryptoInHostedExecution).toHaveBeenCalledWith("member_123");
  });
});

function makeMemberSnapshot(overrides?: {
  core?: Partial<HostedMemberSnapshot["core"]>;
  identity?: Partial<NonNullable<HostedMemberSnapshot["identity"]>>;
  routing?: HostedMemberSnapshot["routing"];
}): HostedMemberSnapshot {
  const core = overrides?.core ?? {};
  const identity = overrides?.identity ?? {};

  return {
    billingRef: null,
    core: {
      billingStatus: core.billingStatus ?? HostedBillingStatus.incomplete,
      createdAt: core.createdAt ?? new Date("2026-04-12T00:00:00.000Z"),
      id: core.id ?? "member_123",
      suspendedAt: core.suspendedAt ?? null,
      updatedAt: core.updatedAt ?? new Date("2026-04-12T00:00:00.000Z"),
    },
    identity: {
      maskedPhoneNumberHint: "*** 0001",
      memberId: "member_123",
      phoneLookupKey: "hbidx:phone:v1:lookup",
      phoneNumber: "+15550100001",
      phoneNumberVerifiedAt: new Date("2026-04-12T00:00:00.000Z"),
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
      privyUserId: null,
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
      ...identity,
    },
    routing: overrides?.routing ?? null,
  };
}

function makeTransactionHarness(options?: {
  existingDispatch?: { eventId: string } | null;
}) {
  return {
    executionOutbox: {
      findUnique: vi.fn().mockResolvedValue(options?.existingDispatch ?? null),
    },
  };
}
