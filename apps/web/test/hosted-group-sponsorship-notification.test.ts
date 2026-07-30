import { HostedUsageCreditPurchaseStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activateMoment: vi.fn(),
  appendMailbox: vi.fn(),
  hasCustomizationAuthority: vi.fn(),
  projectTarget: vi.fn(),
  readMailboxItem: vi.fn(),
  readMoment: vi.fn(),
  resolveDestination: vi.fn(),
  signalRuntime: vi.fn(),
  withMemberLock: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendMailbox,
  readHostedMailboxItemByDedupeKey: mocks.readMailboxItem,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalRuntime,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  withHostedMemberStripeMutationLock: mocks.withMemberLock,
}));

vi.mock("@/src/lib/hosted-onboarding/usage-credit-purchase-status-service", () => ({
  projectHostedUsageCreditPurchaseTarget: mocks.projectTarget,
}));

vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  isHostedThreadContainerNotificationDestination: (value: {
    conversationShape: string;
  }) => value.conversationShape === "thread-container",
  resolveHostedAssistantNotificationDestination: mocks.resolveDestination,
}));

vi.mock("@/src/lib/hosted-groups/group-sponsorship-store", () => ({
  activateHostedGroupSponsorshipMomentTx: mocks.activateMoment,
  hasHostedGroupSponsorshipCustomizationAuthority:
    mocks.hasCustomizationAuthority,
  readHostedGroupSponsorshipMomentForNotification: mocks.readMoment,
}));

import {
  materializeHostedGroupSponsorshipIfApplicable,
} from "@/src/lib/hosted-groups/group-sponsorship-notification";

const PAID_AT = new Date("2026-07-27T12:00:00.000Z");
const DESTINATION = {
  conversationShape: "thread-container" as const,
  externalThreadRouteAuthority: {
    channel: "telegram" as const,
    containerMemberId: "member_group_runtime",
    threadId: "telegram_group",
  },
  route: {
    actorId: null,
    channel: "telegram" as const,
    delivery: { kind: "thread" as const, target: "telegram_group" },
    identityId: "identity_group",
    threadId: "thread_group",
    threadIsDirect: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activateMoment.mockResolvedValue(undefined);
  mocks.appendMailbox.mockResolvedValue({
    dedupeConflict: false,
    duplicate: false,
    inserted: true,
    item: { id: "mailbox_item" },
  });
  mocks.hasCustomizationAuthority.mockResolvedValue(true);
  mocks.projectTarget.mockReturnValue({ kind: "group" });
  mocks.readMailboxItem.mockResolvedValue(null);
  mocks.readMoment.mockResolvedValue({
    celebrationScale: "medium",
    expiresAt: new Date("2026-07-28T12:00:00.000Z"),
    publicAlias: "Jake’s Lower Back",
    runningBitRequest: "Treat me like the exhausted CFO.",
    sponsorMessage: "Please stop inviting Jake to basketball.",
  });
  mocks.resolveDestination.mockResolvedValue(DESTINATION);
  mocks.signalRuntime.mockResolvedValue(undefined);
  mocks.withMemberLock.mockImplementation(async (input: {
    prisma: unknown;
    run: (tx: unknown) => Promise<unknown>;
  }) => input.run(input.prisma));
});

describe("group sponsorship notification", () => {
  it("queues one exact-group creative thank-you after verified fulfillment", async () => {
    const prisma = createPrismaHarness();

    await expect(materializeHostedGroupSponsorshipIfApplicable({
      now: new Date("2026-07-27T12:05:00.000Z"),
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(true);

    expect(mocks.withMemberLock).toHaveBeenCalledWith(expect.objectContaining({
      memberId: "member_group_runtime",
      prisma,
    }));
    expect(mocks.activateMoment).toHaveBeenCalledWith(expect.objectContaining({
      activatedAt: PAID_AT,
      customContentAuthorized: true,
      offerCode: "usage_10_usd",
      purchaseId: "purchase_private_123",
    }));
    const envelope = mocks.appendMailbox.mock.calls[0]?.[0]?.envelope;
    expect(envelope).toMatchObject({
      kind: "assistant.notification.requested",
      notification: {
        deliveryDedupeToken: expect.stringMatching(
          /^group-sponsorship:v1:[a-f0-9]{40}$/u,
        ),
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey: expect.stringMatching(
          /^group-sponsorship:v1:[a-f0-9]{40}$/u,
        ),
        externalThreadRouteAuthority:
          DESTINATION.externalThreadRouteAuthority,
        notificationPromptProfile: "creative-response",
        responsePolicy: { kind: "require_send" },
        route: DESTINATION.route,
      },
      userId: "member_group_runtime",
    });
    expect(envelope.notification.instructions).toContain(
      '"publicAlias":"Jake’s Lower Back"',
    );
    expect(envelope.notification.instructions).toContain(
      "untrusted participant-authored creative material",
    );
    expect(envelope.notification.instructions).toContain(
      "urgent, medical, serious, sensitive, or conflict-heavy",
    );
    expect(envelope.notification.instructions).toContain(
      "calling murph.generate_song exactly once",
    );
    expect(envelope.notification.instructions).toContain(
      "current group conversation",
    );
    expect(envelope.notification.instructions).toContain(
      "a surprising hook that could only belong to this group",
    );
    expect(envelope.notification.instructions).toContain(
      "prefer it as the creative seed and blend it with the current conversation",
    );
    expect(envelope.notification.instructions).toContain(
      "fill the song naturally instead of treating it as a short sting",
    );
    expect(envelope.notification.instructions).not.toContain("5–15 seconds");
    expect(envelope.notification.instructions).toContain(
      "gentle, respectful, and non-comedic",
    );
    expect(JSON.stringify(envelope)).not.toContain("purchase_private_123");
    expect(envelope.notification).not.toHaveProperty("amount");
    expect(envelope.notification).not.toHaveProperty("offerCode");
    expect(mocks.signalRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_group_runtime",
      mailboxItemId: "mailbox_item",
      prisma,
    });
  });

  it("re-signals an existing item without rebuilding participant content", async () => {
    const prisma = createPrismaHarness();
    mocks.readMailboxItem.mockResolvedValueOnce({
      id: "mailbox_existing",
      kind: "assistant.notification.requested",
    });

    await expect(materializeHostedGroupSponsorshipIfApplicable({
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(true);

    expect(mocks.withMemberLock).not.toHaveBeenCalled();
    expect(mocks.readMoment).not.toHaveBeenCalled();
    expect(mocks.appendMailbox).not.toHaveBeenCalled();
    expect(mocks.signalRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_group_runtime",
      mailboxItemId: "mailbox_existing",
      prisma,
    });
  });

  it("suppresses custom content when participant authority expired", async () => {
    const prisma = createPrismaHarness();
    mocks.hasCustomizationAuthority.mockResolvedValueOnce(false);
    mocks.readMoment.mockResolvedValueOnce({
      celebrationScale: "medium",
      expiresAt: null,
      publicAlias: null,
      runningBitRequest: null,
      sponsorMessage: null,
    });

    await expect(materializeHostedGroupSponsorshipIfApplicable({
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(true);

    expect(mocks.activateMoment).toHaveBeenCalledWith(expect.objectContaining({
      customContentAuthorized: false,
    }));
    expect(mocks.readMoment).toHaveBeenCalledWith(expect.objectContaining({
      customContentAuthorized: false,
    }));
    expect(mocks.appendMailbox.mock.calls[0]?.[0]?.envelope.notification.instructions)
      .not.toContain("Jake’s Lower Back");
  });

  it.each([
    {
      currentOverrides: { targetKind: "personal" as const },
      destination: DESTINATION,
      reason: "purchase target is not a group",
    },
    {
      currentOverrides: {},
      destination: {
        ...DESTINATION,
        conversationShape: "direct-member",
        externalThreadRouteAuthority: null,
        route: { ...DESTINATION.route, threadIsDirect: true },
      },
      reason: "only a direct fallback exists",
    },
  ])("does not notify when $reason", async ({
    currentOverrides,
    destination,
  }) => {
    const prisma = createPrismaHarness(currentOverrides);
    mocks.projectTarget.mockReturnValueOnce({
      kind: currentOverrides.targetKind ?? "group",
    });
    mocks.resolveDestination.mockReset();
    mocks.resolveDestination.mockResolvedValue(destination);

    await expect(materializeHostedGroupSponsorshipIfApplicable({
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(false);

    expect(mocks.appendMailbox).not.toHaveBeenCalled();
  });

  it("does nothing before fulfillment and rejects a conflicting mailbox identity", async () => {
    const pending = createPrismaHarness({
      status: HostedUsageCreditPurchaseStatus.payment_pending,
    });
    await expect(materializeHostedGroupSponsorshipIfApplicable({
      prisma: pending as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(false);

    const fulfilled = createPrismaHarness();
    mocks.readMailboxItem.mockResolvedValueOnce({
      id: "mailbox_conflict",
      kind: "conversation.message",
    });
    await expect(materializeHostedGroupSponsorshipIfApplicable({
      prisma: fulfilled as never,
      purchaseId: "purchase_private_123",
    })).rejects.toThrow(/belongs to another mailbox kind/u);
  });
});

function createPrismaHarness(input: {
  status?: HostedUsageCreditPurchaseStatus;
  targetKind?: "group" | "personal";
} = {}) {
  const status = input.status ?? HostedUsageCreditPurchaseStatus.fulfilled;
  const purchase = {
    beneficiaryMemberId: "member_group_runtime",
    groupSponsorshipMoment: { creatorMemberId: "member_sponsor" },
    id: "purchase_private_123",
    offerCode: "usage_10_usd",
    paidAt: PAID_AT,
    status,
    targetKind: input.targetKind ?? "group",
  };
  return {
    hostedUsageCreditPurchase: {
      findUnique: vi.fn(async (query: { include?: unknown }) =>
        query.include
          ? purchase
          : {
              beneficiaryMemberId: purchase.beneficiaryMemberId,
              id: purchase.id,
              status: purchase.status,
            }
      ),
    },
  };
}
