import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";
import type { HostedStripeDispatchContext } from "@/src/lib/hosted-onboarding/stripe-dispatch";

const mocks = vi.hoisted(() => ({
  findHostedExecutionScheduledEventIdTx: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readHostedMemberSnapshot: vi.fn(),
  resolveHostedMemberActivationLinqRoute: vi.fn(),
  scheduleHostedExecutionDispatchTx: vi.fn(),
  updateHostedMemberCoreState: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/dispatch-lifecycle", () => ({
  findHostedExecutionScheduledEventIdTx: mocks.findHostedExecutionScheduledEventIdTx,
  scheduleHostedExecutionDispatchTx: mocks.scheduleHostedExecutionDispatchTx,
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
  };
});

import {
  activateHostedMemberForPositiveSourceTx,
  activateHostedMemberFromConfirmedRevnetIssuanceTx,
  buildHostedMemberActivationFirstContact,
} from "@/src/lib/hosted-onboarding/member-activation";

describe("hosted onboarding member activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});

    mocks.findHostedExecutionScheduledEventIdTx.mockResolvedValue(null);
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.readHostedMemberSnapshot.mockResolvedValue(makeMemberSnapshot());
    mocks.resolveHostedMemberActivationLinqRoute.mockResolvedValue({
      firstContact: {
        channel: "linq",
        identityId: "hbidx:phone:v1:lookup",
        threadId: "chat_home_123",
        threadIsDirect: true,
      },
    });
    mocks.scheduleHostedExecutionDispatchTx.mockResolvedValue({
      eventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
      route: "outbox",
    });
    mocks.updateHostedMemberCoreState.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-04-12T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-04-12T00:00:00.000Z"),
    });
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
      activateHostedMemberForPositiveSourceTx({
        dispatchContext,
        emailLinked: true,
        member,
        prisma: makeTransactionHarness() as never,
      }),
    ).resolves.toEqual({
      activated: true,
      hostedExecutionEventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
      memberId: "member_123",
    });

    expect(mocks.resolveHostedMemberActivationLinqRoute).toHaveBeenCalledWith({
      member,
      prisma: expect.anything(),
    });
    expect(mocks.scheduleHostedExecutionDispatchTx).toHaveBeenCalledWith({
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
          memberChannels: {
            email: true,
            linq: true,
            telegram: false,
          },
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
      activateHostedMemberFromConfirmedRevnetIssuanceTx({
        member,
        occurredAt: "2026-04-12T00:00:00.000Z",
        prisma: makeTransactionHarness() as never,
        sourceEventId: "revnet_evt_123",
        sourceType: "hosted.revnet.issuance.confirmed",
      }),
    ).resolves.toEqual({
      activated: true,
      hostedExecutionEventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
      memberId: "member_123",
    });

    expect(mocks.resolveHostedMemberActivationLinqRoute).toHaveBeenCalledWith({
      member,
      prisma: expect.anything(),
    });
    expect(mocks.scheduleHostedExecutionDispatchTx).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "revnet_evt_123",
        sourceType: "hosted_revnet_issuance",
      }),
    );
  });

  it("passes through a Linq thread-materialization target when web only assigned the home line", async () => {
    const member = makeMemberSnapshot();
    mocks.resolveHostedMemberActivationLinqRoute.mockResolvedValueOnce({
      firstContact: {
        channel: "linq",
        fromPhoneNumber: "+15550100099",
        identityId: "hbidx:phone:v1:lookup",
        kind: "linq-materialize-home-thread",
        toPhoneNumber: "+15550100001",
      },
    });

    await expect(
      activateHostedMemberForPositiveSourceTx({
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_materialize",
          sourceType: "stripe.invoice.paid",
        },
        member,
        prisma: makeTransactionHarness() as never,
      }),
    ).resolves.toEqual({
      activated: true,
      hostedExecutionEventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
      memberId: "member_123",
    });

    expect(mocks.scheduleHostedExecutionDispatchTx).toHaveBeenCalledWith({
      dispatch: expect.objectContaining({
        event: expect.objectContaining({
          firstContact: {
            channel: "linq",
            fromPhoneNumber: "+15550100099",
            identityId: "hbidx:phone:v1:lookup",
            kind: "linq-materialize-home-thread",
            toPhoneNumber: "+15550100001",
          },
        }),
      }),
      sourceId: "stripe:evt_materialize",
      sourceType: "hosted_stripe_event",
      tx: expect.anything(),
    });
  });

  it("emits Telegram first-contact without a Linq lookup for phone-less members", async () => {
    const member = makeMemberSnapshot({
      identity: {
        phoneLookupKey: null,
        phoneNumber: null,
      },
      routing: {
        linqChatId: "chat_home_123",
        linqRecipientPhone: null,
        memberId: "member_123",
        pendingLinqChatId: null,
        pendingLinqRecipientPhone: null,
        telegramUserId: "telegram_user_123",
        telegramUserLookupKey: "telegram_lookup_123",
      },
    });
    mocks.readHostedMemberSnapshot.mockResolvedValue(member);

    await expect(
      activateHostedMemberForPositiveSourceTx({
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_telegram",
          sourceType: "stripe.invoice.paid",
        },
        member,
        prisma: makeTransactionHarness() as never,
      }),
    ).resolves.toEqual({
      activated: true,
      hostedExecutionEventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
      memberId: "member_123",
    });

    expect(mocks.resolveHostedMemberActivationLinqRoute).not.toHaveBeenCalled();
    expect(mocks.scheduleHostedExecutionDispatchTx).toHaveBeenCalledWith({
      dispatch: expect.objectContaining({
        event: expect.objectContaining({
          firstContact: {
            channel: "telegram",
            identityId: null,
            threadId: "telegram_user_123",
            threadIsDirect: true,
          },
          memberChannels: {
            email: false,
            linq: false,
            telegram: true,
          },
        }),
      }),
      sourceId: "stripe:evt_telegram",
      sourceType: "hosted_stripe_event",
      tx: expect.anything(),
    });
  });

  it("builds Telegram first contact even when the member has no Linq thread yet", () => {
    expect(buildHostedMemberActivationFirstContact({
      linqChatId: null,
      linqRecipientPhone: null,
      memberPhoneNumber: null,
      phoneLookupKey: null,
      telegramUserId: "telegram_user_456",
    })).toEqual({
      channel: "telegram",
      identityId: null,
      threadId: "telegram_user_456",
      threadIsDirect: true,
    });
  });

  it("builds a Linq first-contact materialization target when activation only knows the chosen home line", () => {
    expect(buildHostedMemberActivationFirstContact({
      linqChatId: null,
      linqRecipientPhone: "+15550100099",
      memberPhoneNumber: "+15550100001",
      phoneLookupKey: "hbidx:phone:v1:lookup",
      telegramUserId: null,
    })).toEqual({
      channel: "linq",
      fromPhoneNumber: "+15550100099",
      identityId: "hbidx:phone:v1:lookup",
      kind: "linq-materialize-home-thread",
      toPhoneNumber: "+15550100001",
    });
  });

  it("encodes explicit member channels on activation dispatches", async () => {
    const member = makeMemberSnapshot({
      identity: {
        phoneLookupKey: null,
        phoneNumber: null,
      },
      routing: {
        linqChatId: null,
        linqRecipientPhone: null,
        memberId: "member_123",
        pendingLinqChatId: null,
        pendingLinqRecipientPhone: null,
        telegramUserId: "telegram_user_456",
        telegramUserLookupKey: "telegram_lookup_456",
      },
    });
    mocks.readHostedMemberSnapshot.mockResolvedValue(member);

    await activateHostedMemberForPositiveSourceTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
        occurredAt: "2026-04-12T00:00:00.000Z",
        sourceEventId: "evt_member_channels",
        sourceType: "stripe.invoice.paid",
      },
      member,
      prisma: makeTransactionHarness() as never,
    });

    expect(mocks.scheduleHostedExecutionDispatchTx).toHaveBeenCalledWith({
      dispatch: expect.objectContaining({
        event: expect.objectContaining({
          kind: "member.activated",
          memberChannels: {
            email: false,
            linq: false,
            telegram: true,
          },
        }),
      }),
      sourceId: "stripe:evt_member_channels",
      sourceType: "hosted_stripe_event",
      tx: expect.anything(),
    });
  });

  it("returns the scheduled wake event id when routing chooses HostedWake", async () => {
    const member = makeMemberSnapshot({
      identity: {
        phoneLookupKey: null,
        phoneNumber: null,
      },
      routing: {
        linqChatId: null,
        linqRecipientPhone: null,
        memberId: "member_123",
        pendingLinqChatId: null,
        pendingLinqRecipientPhone: null,
        telegramUserId: "telegram_user_456",
        telegramUserLookupKey: "telegram_lookup_456",
      },
    });
    mocks.readHostedMemberSnapshot.mockResolvedValue(member);
    mocks.scheduleHostedExecutionDispatchTx.mockResolvedValue({
      eventId: "member.activated:stripe.invoice.paid:member_123:evt_member_channels",
      route: "wake",
    });

    await expect(activateHostedMemberForPositiveSourceTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
        occurredAt: "2026-04-12T00:00:00.000Z",
        sourceEventId: "evt_member_channels",
        sourceType: "stripe.invoice.paid",
      },
      member,
      prisma: makeTransactionHarness() as never,
    })).resolves.toEqual({
      activated: true,
      hostedExecutionEventId: "member.activated:stripe.invoice.paid:member_123:evt_member_channels",
      memberId: "member_123",
    });

    expect(mocks.scheduleHostedExecutionDispatchTx).toHaveBeenCalledWith({
      dispatch: expect.objectContaining({
        eventId: "member.activated:stripe.invoice.paid:member_123:evt_member_channels",
        event: expect.objectContaining({
          kind: "member.activated",
          memberChannels: {
            email: false,
            linq: false,
            telegram: true,
          },
        }),
      }),
      sourceId: "stripe:evt_member_channels",
      sourceType: "hosted_stripe_event",
      tx: expect.anything(),
    });
  });

  it("returns the existing activation event when billing is already active and a scheduled event already exists", async () => {
    const member = makeMemberSnapshot({
      core: {
        billingStatus: HostedBillingStatus.active,
      },
    });
    mocks.readHostedMemberSnapshot.mockResolvedValue(member);
    mocks.findHostedExecutionScheduledEventIdTx.mockResolvedValue(
      "member.activated:stripe.customer.subscription.updated:member_123:evt_123",
    );

    await expect(
      activateHostedMemberForPositiveSourceTx({
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_123",
          sourceType: "stripe.customer.subscription.updated",
        },
        member,
        prisma: makeTransactionHarness() as never,
        skipIfBillingAlreadyActive: true,
      }),
    ).resolves.toEqual({
      activated: false,
      hostedExecutionEventId: "member.activated:stripe.customer.subscription.updated:member_123:evt_123",
      memberId: "member_123",
    });

    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.resolveHostedMemberActivationLinqRoute).not.toHaveBeenCalled();
    expect(mocks.scheduleHostedExecutionDispatchTx).not.toHaveBeenCalled();
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

function makeTransactionHarness() {
  return {};
}
