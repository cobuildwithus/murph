import { MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE } from "@murphai/contracts";
import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HostedMemberActivationCoreState,
  HostedMemberSnapshot,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import type { HostedStripeDispatchContext } from "@/src/lib/hosted-onboarding/stripe-dispatch";

type HostedMemberActivationSnapshot = HostedMemberSnapshot & {
  core: HostedMemberActivationCoreState;
};

const mocks = vi.hoisted(() => ({
  clearHostedMemberPendingActivationTimeZone: vi.fn(),
  findHostedIngressByEventId: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readHostedMemberActivationCoreState: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
  readHostedMemberIdentity: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  resolveHostedMemberActivationLinqRoute: vi.fn(),
  materializeHostedIngressEnvelopeTx: vi.fn(),
  updateHostedMemberCoreState: vi.fn(),
}));

vi.mock("@/src/lib/hosted-ingress/lifecycle", () => ({
  findHostedIngressByEventId: mocks.findHostedIngressByEventId,
  materializeHostedIngressEnvelopeTx: mocks.materializeHostedIngressEnvelopeTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    clearHostedMemberPendingActivationTimeZone: mocks.clearHostedMemberPendingActivationTimeZone,
    readHostedMemberActivationCoreState: mocks.readHostedMemberActivationCoreState,
    readHostedMemberCoreState: mocks.readHostedMemberCoreState,
    readHostedMemberEmailAuthorization: mocks.readHostedMemberEmailAuthorization,
    updateHostedMemberCoreState: mocks.updateHostedMemberCoreState,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  readHostedMemberIdentity: mocks.readHostedMemberIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

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
  buildHostedMemberActivationWelcomeRoute,
} from "@/src/lib/hosted-onboarding/member-activation";

describe("hosted onboarding member activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});

    mocks.findHostedIngressByEventId.mockResolvedValue(null);
    mocks.clearHostedMemberPendingActivationTimeZone.mockResolvedValue(undefined);
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    setActivationMemberSnapshot(makeMemberSnapshot());
    mocks.resolveHostedMemberActivationLinqRoute.mockResolvedValue({
      welcomeRoute: {
        actorId: "+15550100001",
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "chat_home_123",
        },
        identityId: "hbidx:phone:v1:lookup",
        threadId: "chat_home_123",
        threadIsDirect: true,
      },
    });
    mocks.materializeHostedIngressEnvelopeTx.mockResolvedValue({
      eventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
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
        memberId: member.core.id,
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
    expect(mocks.materializeHostedIngressEnvelopeTx).toHaveBeenNthCalledWith(1, {
      wake: expect.objectContaining({
        eventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
        kind: "member.activated",
        memberChannels: {
          email: true,
          linq: true,
          telegram: false,
        },
      }),
      tx: expect.anything(),
    });
    expect(mocks.materializeHostedIngressEnvelopeTx).toHaveBeenNthCalledWith(2, {
      wake: expect.objectContaining({
        kind: "assistant.notification.requested",
        notification: expect.objectContaining({
          deliveryDedupeToken: "signup-welcome:member_123",
          deliveryDispatchMode: "queue-only",
          deliveryIdempotencyKey: "signup-welcome:member_123",
          firstContact: {
            markSeenOnDeliveryAccepted: true,
          },
          instructions: [
            "Prepare the first in-chat onboarding reply.",
            "Use this user-facing reply only:",
            MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
          ].join("\n\n"),
          responsePolicy: {
            kind: "require_send_exact_text",
            text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
          },
          route: {
            actorId: "+15550100001",
            channel: "linq",
            delivery: {
              kind: "thread",
              target: "chat_home_123",
            },
            identityId: "hbidx:phone:v1:lookup",
            threadId: "chat_home_123",
            threadIsDirect: true,
          },
        }),
      }),
      tx: expect.anything(),
    });
  });

  it("passes through a Linq thread-materialization target when web only assigned the home line", async () => {
    const member = makeMemberSnapshot();
    mocks.resolveHostedMemberActivationLinqRoute.mockResolvedValueOnce({
      welcomeRoute: {
        actorId: "+15550100001",
        channel: "linq",
        delivery: {
          kind: "participant",
          source: {
            fromPhoneNumber: "+15550100099",
            kind: "linq",
          },
          target: "+15550100001",
        },
        identityId: "hbidx:phone:v1:lookup",
        threadId: null,
        threadIsDirect: true,
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
        memberId: member.core.id,
        prisma: makeTransactionHarness() as never,
      }),
    ).resolves.toEqual({
      activated: true,
      hostedExecutionEventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
      memberId: "member_123",
    });

    expect(mocks.materializeHostedIngressEnvelopeTx).toHaveBeenNthCalledWith(2, {
      wake: expect.objectContaining({
        kind: "assistant.notification.requested",
        notification: expect.objectContaining({
          route: {
            actorId: "+15550100001",
            channel: "linq",
            delivery: {
              kind: "participant",
              source: {
                fromPhoneNumber: "+15550100099",
                kind: "linq",
              },
              target: "+15550100001",
            },
            identityId: "hbidx:phone:v1:lookup",
            threadId: null,
            threadIsDirect: true,
          },
        }),
      }),
      tx: expect.anything(),
    });
  });

  it("passes pending signup timezone into the activation wake and clears the hosted row", async () => {
    const member = makeMemberSnapshot({
      core: {
        pendingActivationTimeZone: "America/Los_Angeles",
      },
    });
    setActivationMemberSnapshot(member);

    await activateHostedMemberForPositiveSourceTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
        occurredAt: "2026-04-12T00:00:00.000Z",
        sourceEventId: "evt_timezone",
        sourceType: "stripe.invoice.paid",
      },
      memberId: member.core.id,
      prisma: makeTransactionHarness() as never,
    });

    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.active,
      memberId: "member_123",
      prisma: expect.anything(),
    });
    expect(mocks.clearHostedMemberPendingActivationTimeZone).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: expect.anything(),
    });
    expect(mocks.materializeHostedIngressEnvelopeTx).toHaveBeenNthCalledWith(1, {
      wake: expect.objectContaining({
        kind: "member.activated",
        timeZone: "America/Los_Angeles",
      }),
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
        telegramThreadId: "telegram_user_123:business:biz-42:dm-topic:9",
        telegramUserId: "telegram_user_123",
        telegramUserLookupKey: "telegram_lookup_123",
      },
    });
    setActivationMemberSnapshot(member);

    await expect(
      activateHostedMemberForPositiveSourceTx({
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_telegram",
          sourceType: "stripe.invoice.paid",
        },
        memberId: member.core.id,
        prisma: makeTransactionHarness() as never,
      }),
    ).resolves.toEqual({
      activated: true,
      hostedExecutionEventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
      memberId: "member_123",
    });

    expect(mocks.resolveHostedMemberActivationLinqRoute).not.toHaveBeenCalled();
    expect(mocks.materializeHostedIngressEnvelopeTx).toHaveBeenNthCalledWith(2, {
      wake: expect.objectContaining({
        kind: "assistant.notification.requested",
        notification: expect.objectContaining({
          route: {
            actorId: null,
            channel: "telegram",
            delivery: {
              kind: "thread",
              target: "telegram_user_123:business:biz-42:dm-topic:9",
            },
            identityId: null,
            threadId: "telegram_user_123:business:biz-42:dm-topic:9",
            threadIsDirect: true,
          },
        }),
      }),
      tx: expect.anything(),
    });
  });

  it("builds a Telegram welcome route even when the member has no Linq thread yet", () => {
    expect(buildHostedMemberActivationWelcomeRoute({
      linqChatId: null,
      linqRecipientPhone: null,
      memberPhoneNumber: null,
      phoneLookupKey: null,
      telegramThreadId: "telegram_user_456:business:biz-42:dm-topic:9",
      telegramUserId: "telegram_user_456",
    })).toEqual({
      actorId: null,
      channel: "telegram",
      delivery: {
        kind: "thread",
        target: "telegram_user_456:business:biz-42:dm-topic:9",
      },
      identityId: null,
      threadId: "telegram_user_456:business:biz-42:dm-topic:9",
      threadIsDirect: true,
    });
  });

  it("builds a Linq participant welcome route when activation only knows the chosen home line", () => {
    expect(buildHostedMemberActivationWelcomeRoute({
      linqChatId: null,
      linqRecipientPhone: "+15550100099",
      memberPhoneNumber: "+15550100001",
      phoneLookupKey: "hbidx:phone:v1:lookup",
      telegramThreadId: null,
      telegramUserId: null,
    })).toEqual({
      actorId: "+15550100001",
      channel: "linq",
      delivery: {
        kind: "participant",
        source: {
          fromPhoneNumber: "+15550100099",
          kind: "linq",
        },
        target: "+15550100001",
      },
      identityId: "hbidx:phone:v1:lookup",
      threadId: null,
      threadIsDirect: true,
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
        telegramThreadId: "telegram_user_456:business:biz-42:dm-topic:9",
        telegramUserId: "telegram_user_456",
        telegramUserLookupKey: "telegram_lookup_456",
      },
    });
    setActivationMemberSnapshot(member);

    await activateHostedMemberForPositiveSourceTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
        occurredAt: "2026-04-12T00:00:00.000Z",
        sourceEventId: "evt_member_channels",
        sourceType: "stripe.invoice.paid",
      },
      memberId: member.core.id,
      prisma: makeTransactionHarness() as never,
    });

    expect(mocks.materializeHostedIngressEnvelopeTx).toHaveBeenCalledWith({
      wake: expect.objectContaining({
        kind: "member.activated",
        memberChannels: {
          email: false,
          linq: false,
          telegram: true,
        },
      }),
      tx: expect.anything(),
    });
  });

  it("returns the appended wake event id when activation writes a canonical wake", async () => {
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
        telegramThreadId: "telegram_user_456:business:biz-42:dm-topic:9",
        telegramUserId: "telegram_user_456",
        telegramUserLookupKey: "telegram_lookup_456",
      },
    });
    setActivationMemberSnapshot(member);
    mocks.materializeHostedIngressEnvelopeTx.mockResolvedValue({
      eventId: "member.activated:stripe.invoice.paid:member_123:evt_member_channels",
    });

    await expect(activateHostedMemberForPositiveSourceTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
        occurredAt: "2026-04-12T00:00:00.000Z",
        sourceEventId: "evt_member_channels",
        sourceType: "stripe.invoice.paid",
      },
      memberId: member.core.id,
      prisma: makeTransactionHarness() as never,
    })).resolves.toEqual({
      activated: true,
      hostedExecutionEventId: "member.activated:stripe.invoice.paid:member_123:evt_member_channels",
      memberId: "member_123",
    });

    expect(mocks.materializeHostedIngressEnvelopeTx).toHaveBeenCalledWith({
      wake: expect.objectContaining({
        eventId: "member.activated:stripe.invoice.paid:member_123:evt_member_channels",
        kind: "member.activated",
        memberChannels: {
          email: false,
          linq: false,
          telegram: true,
        },
      }),
      tx: expect.anything(),
    });
  });

  it("returns the existing activation event when billing is already active and a scheduled event already exists", async () => {
    const member = makeMemberSnapshot({
      core: {
        billingStatus: HostedBillingStatus.active,
      },
    });
    setActivationMemberSnapshot(member);
    mocks.findHostedIngressByEventId.mockResolvedValue(
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
        memberId: member.core.id,
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
    expect(mocks.materializeHostedIngressEnvelopeTx).not.toHaveBeenCalled();
  });
});

function makeMemberSnapshot(overrides?: {
  core?: Partial<HostedMemberActivationSnapshot["core"]>;
  emailAuthorization?: HostedMemberSnapshot["emailAuthorization"];
  identity?: Partial<NonNullable<HostedMemberSnapshot["identity"]>>;
  routing?: HostedMemberSnapshot["routing"];
}): HostedMemberActivationSnapshot {
  const core = overrides?.core ?? {};
  const identity = overrides?.identity ?? {};

  return {
    billingRef: null,
    core: {
      billingStatus: core.billingStatus ?? HostedBillingStatus.incomplete,
      createdAt: core.createdAt ?? new Date("2026-04-12T00:00:00.000Z"),
      id: core.id ?? "member_123",
      pendingActivationTimeZone: core.pendingActivationTimeZone ?? null,
      suspendedAt: core.suspendedAt ?? null,
      updatedAt: core.updatedAt ?? new Date("2026-04-12T00:00:00.000Z"),
    },
    emailAuthorization: overrides?.emailAuthorization ?? null,
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

function setActivationMemberSnapshot(member: HostedMemberSnapshot | null): void {
  mocks.readHostedMemberActivationCoreState.mockResolvedValue(member?.core ?? null);
  mocks.readHostedMemberCoreState.mockResolvedValue(member?.core ?? null);
  mocks.readHostedMemberEmailAuthorization.mockResolvedValue(member?.emailAuthorization ?? null);
  mocks.readHostedMemberIdentity.mockResolvedValue(member?.identity ?? null);
  mocks.readHostedMemberRoutingState.mockResolvedValue(member?.routing ?? null);
}

function makeTransactionHarness() {
  return {};
}
