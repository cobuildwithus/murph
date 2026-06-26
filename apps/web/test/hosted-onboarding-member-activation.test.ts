import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";
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
  hasHostedMailboxItemByKind: vi.fn(),
  hasActiveHostedCryptoDomainRootsForUserTx: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readHostedMemberActivationCoreState: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
  readHostedMemberIdentity: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  resolveHostedMemberActivationLinqRoute: vi.fn(),
  appendHostedMailboxEnvelopeTx: vi.fn(),
  provisionHostedCryptoDomainRootsForUserTx: vi.fn(),
  updateHostedMemberCoreState: vi.fn(),
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  hasActiveHostedCryptoDomainRootsForUserTx: mocks.hasActiveHostedCryptoDomainRootsForUserTx,
  provisionHostedCryptoDomainRootsForUserTx:
    mocks.provisionHostedCryptoDomainRootsForUserTx,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  hasHostedMailboxItemByKind: mocks.hasHostedMailboxItemByKind,
  readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
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
import { renderUserFacingMessage } from "@/src/lib/hosted-messages/user-facing-messages";

function expectedTelegramAssistantThreadId(input: {
  memberId: string;
  threadId: string;
}): string {
  const identifierBlind = createHostedAssistantConversationIdentifierBlind({
    secret: input.threadId,
    userId: input.memberId,
  });
  return hashHostedAssistantConversationIdentifier(identifierBlind, input.threadId);
}

function expectedSignupWelcomeText(): string {
  return renderUserFacingMessage({
    context: {},
    key: "assistant.signup_welcome",
    seed: "signup-welcome:member_123",
  }).text;
}

function expectLegacySignupWelcomeCompatibilityWake(input: {
  callIndex: number;
  route: unknown;
  sourceEventId?: string;
}): void {
  const expectedText = expectedSignupWelcomeText();

  expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenNthCalledWith(input.callIndex, {
    envelope: expect.objectContaining({
      eventId: expect.stringContaining(
        "assistant.notification.requested:signup-welcome:member_123:member.activated:",
      ),
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
          expectedText,
        ].join("\n\n"),
        responsePolicy: {
          kind: "require_send_exact_text",
          text: expectedText,
        },
        route: input.route,
      }),
    }),
    tx: expect.anything(),
  });
}

describe("hosted onboarding member activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});

    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
    mocks.hasHostedMailboxItemByKind.mockResolvedValue(false);
    mocks.hasActiveHostedCryptoDomainRootsForUserTx.mockResolvedValue(false);
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
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      item: {
        dedupeKey: "member.activated:stripe.invoice.paid:member_123:evt_123",
      },
    });
    mocks.provisionHostedCryptoDomainRootsForUserTx.mockResolvedValue(undefined);
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
    const expectedText = expectedSignupWelcomeText();

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
    expect(mocks.provisionHostedCryptoDomainRootsForUserTx).toHaveBeenCalledWith({
      reason: "hosted-member.activation",
      tx: expect.anything(),
      userId: "member_123",
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenNthCalledWith(1, {
      envelope: expect.objectContaining({
        eventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
        kind: "member.activated",
        memberChannels: {
          email: true,
          linq: true,
          telegram: false,
        },
        signupWelcome: expect.objectContaining({
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
          text: expectedText,
        }),
      }),
      tx: expect.anything(),
    });
    const activationEnvelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    expect(activationEnvelope.signupWelcome).toEqual({
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
      text: expectedText,
    });
    expectLegacySignupWelcomeCompatibilityWake({
      callIndex: 2,
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
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
  });

  it("keeps signup welcome text stable across source events sharing the per-member delivery identity", async () => {
    const member = makeMemberSnapshot();

    await activateHostedMemberForPositiveSourceTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
        occurredAt: "2026-04-12T00:00:00.000Z",
        sourceEventId: "evt_checkout_activation",
        sourceType: "stripe.checkout.session.completed",
      },
      emailLinked: true,
      memberId: member.core.id,
      prisma: makeTransactionHarness() as never,
    });
    await activateHostedMemberForPositiveSourceTx({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-12T00:01:00.000Z"),
        occurredAt: "2026-04-12T00:01:00.000Z",
        sourceEventId: "evt_invoice_activation",
        sourceType: "stripe.invoice.paid",
      },
      emailLinked: true,
      memberId: member.core.id,
      prisma: makeTransactionHarness() as never,
    });

    const expectedText = expectedSignupWelcomeText();
    const firstActivationEnvelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    const firstNotificationEnvelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[1]?.[0]?.envelope;
    const secondActivationEnvelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[2]?.[0]?.envelope;
    const secondNotificationEnvelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[3]?.[0]?.envelope;

    expect(firstActivationEnvelope.signupWelcome?.text).toBe(expectedText);
    expect(secondActivationEnvelope.signupWelcome?.text).toBe(expectedText);
    expect(firstNotificationEnvelope.notification).toMatchObject({
      deliveryDedupeToken: "signup-welcome:member_123",
      deliveryIdempotencyKey: "signup-welcome:member_123",
      responsePolicy: {
        kind: "require_send_exact_text",
        text: expectedText,
      },
    });
    expect(secondNotificationEnvelope.notification).toMatchObject({
      deliveryDedupeToken: "signup-welcome:member_123",
      deliveryIdempotencyKey: "signup-welcome:member_123",
      responsePolicy: {
        kind: "require_send_exact_text",
        text: expectedText,
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(4);
  });

  it("does not enqueue a signup welcome when Linq only assigned a home line", async () => {
    const member = makeMemberSnapshot();
    mocks.resolveHostedMemberActivationLinqRoute.mockResolvedValueOnce({
      welcomeRoute: null,
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

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenNthCalledWith(1, {
      envelope: expect.objectContaining({
        kind: "member.activated",
        signupWelcome: null,
      }),
      tx: expect.anything(),
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
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
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenNthCalledWith(1, {
      envelope: expect.objectContaining({
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
        pendingLinqParticipantContact: null,
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
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenNthCalledWith(1, {
      envelope: expect.objectContaining({
        kind: "member.activated",
        signupWelcome: expect.objectContaining({
          route: {
            actorId: null,
            channel: "telegram",
            delivery: {
              kind: "thread",
              target: "telegram_user_123:business:biz-42:dm-topic:9",
            },
            identityId: null,
            threadId: expectedTelegramAssistantThreadId({
              memberId: "member_123",
              threadId: "telegram_user_123:business:biz-42:dm-topic:9",
            }),
            threadIsDirect: true,
          },
        }),
      }),
      tx: expect.anything(),
    });
    expectLegacySignupWelcomeCompatibilityWake({
      callIndex: 2,
      sourceEventId: "evt_telegram",
      route: {
        actorId: null,
        channel: "telegram",
        delivery: {
          kind: "thread",
          target: "telegram_user_123:business:biz-42:dm-topic:9",
        },
        identityId: null,
        threadId: expectedTelegramAssistantThreadId({
          memberId: "member_123",
          threadId: "telegram_user_123:business:biz-42:dm-topic:9",
        }),
        threadIsDirect: true,
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
  });

  it("prefers Telegram first-contact for email-linked phone-less members without a reusable Linq thread", async () => {
    const member = makeMemberSnapshot({
      emailAuthorization: {
        directPublicSender: null,
        memberId: "member_123",
        stripeCheckoutEmail: null,
        verifiedEmail: {
          address: "member@example.com",
          lookupKey: "hbidx:email:v1:lookup",
          verifiedAt: new Date("2026-04-12T00:02:00.000Z"),
        },
      },
      identity: {
        phoneLookupKey: null,
        phoneNumber: null,
      },
      routing: {
        linqChatId: null,
        linqRecipientPhone: null,
        memberId: "member_123",
        pendingLinqChatId: null,
        pendingLinqParticipantContact: null,
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
          sourceEventId: "evt_email_telegram",
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
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenNthCalledWith(1, {
      envelope: expect.objectContaining({
        kind: "member.activated",
        memberChannels: {
          email: true,
          linq: false,
          telegram: true,
        },
        signupWelcome: expect.objectContaining({
          route: {
            actorId: null,
            channel: "telegram",
            delivery: {
              kind: "thread",
              target: "telegram_user_123:business:biz-42:dm-topic:9",
            },
            identityId: null,
            threadId: expectedTelegramAssistantThreadId({
              memberId: "member_123",
              threadId: "telegram_user_123:business:biz-42:dm-topic:9",
            }),
            threadIsDirect: true,
          },
        }),
      }),
      tx: expect.anything(),
    });
    expectLegacySignupWelcomeCompatibilityWake({
      callIndex: 2,
      sourceEventId: "evt_email_telegram",
      route: {
        actorId: null,
        channel: "telegram",
        delivery: {
          kind: "thread",
          target: "telegram_user_123:business:biz-42:dm-topic:9",
        },
        identityId: null,
        threadId: expectedTelegramAssistantThreadId({
          memberId: "member_123",
          threadId: "telegram_user_123:business:biz-42:dm-topic:9",
        }),
        threadIsDirect: true,
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
  });

  it("builds a Telegram welcome route even when the member has no Linq thread yet", () => {
    const rawTelegramThreadId = "telegram_user_456:business:biz-42:dm-topic:9";
    const route = buildHostedMemberActivationWelcomeRoute({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_telegram_route",
      memberPhoneNumber: null,
      phoneLookupKey: null,
      telegramThreadId: rawTelegramThreadId,
      telegramUserId: "telegram_user_456",
    });

    expect(route).toEqual({
      actorId: null,
      channel: "telegram",
      delivery: {
        kind: "thread",
        target: rawTelegramThreadId,
      },
      identityId: null,
      threadId: expectedTelegramAssistantThreadId({
        memberId: "member_telegram_route",
        threadId: rawTelegramThreadId,
      }),
      threadIsDirect: true,
    });
    expect(route?.threadId).toMatch(/^hid_[0-9a-f]{32}$/u);
    expect(route?.threadId).not.toBe(rawTelegramThreadId);
  });

  it("does not build a Linq welcome route when activation only knows the chosen home line", () => {
    expect(buildHostedMemberActivationWelcomeRoute({
      linqChatId: null,
      linqRecipientPhone: "+15550100099",
      memberId: "member_linq_participant_route",
      memberPhoneNumber: "+15550100001",
      phoneLookupKey: "hbidx:phone:v1:lookup",
      telegramThreadId: null,
      telegramUserId: null,
    })).toBeNull();
  });

  it("builds a Linq thread welcome route with blinded assistant identifiers", () => {
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:lookup",
      userId: "member_linq_thread_route",
    });

    expect(buildHostedMemberActivationWelcomeRoute({
      linqChatId: "chat_home_123",
      linqRecipientPhone: null,
      memberId: "member_linq_thread_route",
      memberPhoneNumber: "+15550100001",
      phoneLookupKey: "hbidx:phone:v1:lookup",
      telegramThreadId: null,
      telegramUserId: null,
    })).toEqual({
      actorId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        "+15550100001",
      ),
      channel: "linq",
      delivery: {
        kind: "thread",
        target: "chat_home_123",
      },
      identityId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        "hbidx:phone:v1:lookup",
      ),
      threadId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        "chat_home_123",
      ),
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
        pendingLinqParticipantContact: null,
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

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
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
        pendingLinqParticipantContact: null,
        pendingLinqRecipientPhone: null,
        telegramThreadId: "telegram_user_456:business:biz-42:dm-topic:9",
        telegramUserId: "telegram_user_456",
        telegramUserLookupKey: "telegram_lookup_456",
      },
    });
    setActivationMemberSnapshot(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      item: {
        dedupeKey: "member.activated:stripe.invoice.paid:member_123:evt_member_channels",
      },
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

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
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
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue({
      dedupeKey: "member.activated:stripe.customer.subscription.updated:member_123:evt_123",
    });

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
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("skips activation side effects for later positive invoices when billing is already active", async () => {
    const member = makeMemberSnapshot({
      core: {
        billingStatus: HostedBillingStatus.active,
        pendingActivationTimeZone: "America/Los_Angeles",
      },
    });
    setActivationMemberSnapshot(member);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);

    await expect(
      activateHostedMemberForPositiveSourceTx({
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "invoice:in_renewal_123",
          sourceType: "stripe.invoice.paid",
        },
        memberId: member.core.id,
        prisma: makeTransactionHarness() as never,
        skipIfBillingAlreadyActive: true,
      }),
    ).resolves.toEqual({
      activated: false,
      hostedExecutionEventId: null,
      memberId: "member_123",
    });

    expect(mocks.clearHostedMemberPendingActivationTimeZone).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: expect.anything(),
    });
    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.resolveHostedMemberActivationLinqRoute).not.toHaveBeenCalled();
    expect(mocks.provisionHostedCryptoDomainRootsForUserTx).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("skips activation side effects for payment recovery after a retained mailbox activation marker", async () => {
    const member = makeMemberSnapshot({
      core: {
        billingStatus: HostedBillingStatus.active,
        pendingActivationTimeZone: "America/Los_Angeles",
      },
    });
    setActivationMemberSnapshot(member);
    mocks.hasHostedMailboxItemByKind.mockResolvedValueOnce(true);

    await expect(
      activateHostedMemberForPositiveSourceTx({
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "invoice:in_recovered_mailbox_123",
          sourceType: "stripe.invoice.paid",
        },
        memberId: member.core.id,
        prisma: makeTransactionHarness() as never,
        skipIfBillingAlreadyActive: false,
        skipIfPreviouslyActivated: true,
      }),
    ).resolves.toEqual({
      activated: false,
      hostedExecutionEventId: null,
      memberId: "member_123",
    });

    expect(mocks.hasHostedMailboxItemByKind).toHaveBeenCalledWith({
      kind: "member.activated",
      prisma: expect.anything(),
      userId: "member_123",
    });
    expect(mocks.hasActiveHostedCryptoDomainRootsForUserTx).not.toHaveBeenCalled();
    expect(mocks.clearHostedMemberPendingActivationTimeZone).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: expect.anything(),
    });
    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.resolveHostedMemberActivationLinqRoute).not.toHaveBeenCalled();
    expect(mocks.provisionHostedCryptoDomainRootsForUserTx).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("skips activation side effects for payment recovery after a retained prior activation marker", async () => {
    const member = makeMemberSnapshot({
      core: {
        billingStatus: HostedBillingStatus.active,
        pendingActivationTimeZone: "America/Los_Angeles",
      },
    });
    setActivationMemberSnapshot(member);
    mocks.hasHostedMailboxItemByKind.mockResolvedValueOnce(false);
    mocks.hasActiveHostedCryptoDomainRootsForUserTx.mockResolvedValueOnce(true);

    await expect(
      activateHostedMemberForPositiveSourceTx({
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "invoice:in_recovered_123",
          sourceType: "stripe.invoice.paid",
        },
        memberId: member.core.id,
        prisma: makeTransactionHarness() as never,
        skipIfBillingAlreadyActive: false,
        skipIfPreviouslyActivated: true,
      }),
    ).resolves.toEqual({
      activated: false,
      hostedExecutionEventId: null,
      memberId: "member_123",
    });

    expect(mocks.hasHostedMailboxItemByKind).toHaveBeenCalledWith({
      kind: "member.activated",
      prisma: expect.anything(),
      userId: "member_123",
    });
    expect(mocks.hasActiveHostedCryptoDomainRootsForUserTx).toHaveBeenCalledWith({
      tx: expect.anything(),
      userId: "member_123",
    });
    expect(mocks.clearHostedMemberPendingActivationTimeZone).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: expect.anything(),
    });
    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.resolveHostedMemberActivationLinqRoute).not.toHaveBeenCalled();
    expect(mocks.provisionHostedCryptoDomainRootsForUserTx).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
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
