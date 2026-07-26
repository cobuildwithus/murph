import {
  HostedUsageCreditPurchaseStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendMailbox: vi.fn(),
  readMailboxItem: vi.fn(),
  resolveDestination: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendMailbox,
  readHostedMailboxItemByDedupeKey: mocks.readMailboxItem,
}));

vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  isHostedThreadContainerNotificationDestination: (destination: {
    conversationShape: string;
  }) => destination.conversationShape === "thread-container",
  resolveHostedAssistantNotificationDestination: mocks.resolveDestination,
}));

import {
  appendHostedGroupUsageFundedNotificationIfApplicable,
} from "@/src/lib/hosted-groups/group-usage-funded-notification";

const FIXED_NOW = new Date("2026-07-25T22:05:00.000Z");
const DESTINATION = {
  conversationShape: "thread-container" as const,
  externalThreadRouteAuthority: {
    channel: "telegram" as const,
    containerMemberId: "member-group-runtime",
    threadId: "telegram-group-123",
  },
  route: {
    actorId: null,
    channel: "telegram" as const,
    delivery: {
      kind: "thread" as const,
      target: "telegram-group-123",
    },
    identityId: "identity-group-123",
    threadId: "thread-group-123",
    threadIsDirect: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readMailboxItem.mockResolvedValue(null);
  mocks.resolveDestination.mockResolvedValue(DESTINATION);
  mocks.appendMailbox.mockResolvedValue({
    dedupeConflict: false,
    duplicate: false,
    inserted: true,
    item: { id: "mailbox-item-1" },
  });
});

describe("group usage-funded notification", () => {
  it("appends one model-owned group thank-you with only the audio tools", async () => {
    const prisma = createPrismaHarness();

    await expect(appendHostedGroupUsageFundedNotificationIfApplicable({
      // @ts-expect-error - focused harness implements the exact delegates used here.
      prisma,
      purchaseId: "purchase-secret-123",
      now: FIXED_NOW,
    })).resolves.toBe(true);

    expect(mocks.appendMailbox).toHaveBeenCalledWith(expect.objectContaining({
      expiresAt: new Date("2026-07-25T22:30:00.000Z"),
    }));
    const envelope = mocks.appendMailbox.mock.calls[0]?.[0]?.envelope;
    expect(envelope).toMatchObject({
      kind: "assistant.notification.requested",
      userId: "member-group-runtime",
      notification: {
        deliveryDedupeToken: expect.stringMatching(/^group-usage-funded:v1:[a-f0-9]{40}$/u),
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey: expect.stringMatching(/^group-usage-funded:v1:[a-f0-9]{40}$/u),
        externalThreadRouteAuthority:
          DESTINATION.externalThreadRouteAuthority,
        notificationToolProfile: "response-audio",
        responsePolicy: { kind: "require_send" },
        route: DESTINATION.route,
      },
    });
    expect(envelope.notification.instructions).toContain(
      "Someone added more Murph usage to this group.",
    );
    expect(envelope.notification.instructions).toContain(
      "without naming or guessing who they are",
    );
    expect(envelope.notification.instructions).toContain(
      "Choose exactly one of murph.generate_voice_memo or murph.generate_song.",
    );
    expect(JSON.stringify(envelope)).not.toContain("purchase-secret-123");
    expect(JSON.stringify(envelope)).not.toContain("member-payer");
    expect(envelope.notification).not.toHaveProperty("amount");
    expect(envelope.notification).not.toHaveProperty("offerCode");
    expect(envelope.notification).not.toHaveProperty("purchaseId");
  });

  it("treats an existing mailbox item as the exact-once completion", async () => {
    const prisma = createPrismaHarness();
    mocks.readMailboxItem.mockResolvedValueOnce({
      kind: "assistant.notification.requested",
    });

    await expect(appendHostedGroupUsageFundedNotificationIfApplicable({
      // @ts-expect-error - focused harness implements the exact delegates used here.
      prisma,
      purchaseId: "purchase-secret-123",
      now: FIXED_NOW,
    })).resolves.toBe(true);

    expect(mocks.resolveDestination).not.toHaveBeenCalled();
    expect(mocks.appendMailbox).not.toHaveBeenCalled();
  });

  it("rejects a dedupe identity already owned by another mailbox kind", async () => {
    const prisma = createPrismaHarness();
    mocks.readMailboxItem.mockResolvedValueOnce({
      kind: "conversation.message",
    });

    await expect(appendHostedGroupUsageFundedNotificationIfApplicable({
      // @ts-expect-error - focused harness implements the exact delegates used here.
      prisma,
      purchaseId: "purchase-secret-123",
      now: FIXED_NOW,
    })).rejects.toThrow(
      "Group usage-funded notification identity belongs to another mailbox kind.",
    );

    expect(mocks.appendMailbox).not.toHaveBeenCalled();
  });

  it("never falls back to a contributor's direct notification destination", async () => {
    const prisma = createPrismaHarness();
    mocks.resolveDestination.mockResolvedValueOnce({
      conversationShape: "direct-member",
      externalThreadRouteAuthority: null,
      route: {
        ...DESTINATION.route,
        threadIsDirect: true,
      },
    });

    await expect(appendHostedGroupUsageFundedNotificationIfApplicable({
      // @ts-expect-error - focused harness implements the exact delegates used here.
      prisma,
      purchaseId: "purchase-secret-123",
      now: FIXED_NOW,
    })).resolves.toBe(false);

    expect(mocks.appendMailbox).not.toHaveBeenCalled();
  });

  it("expires a stale celebration before destination or provider work", async () => {
    const prisma = createPrismaHarness();

    await expect(appendHostedGroupUsageFundedNotificationIfApplicable({
      // @ts-expect-error - focused harness implements the exact delegates used here.
      prisma,
      purchaseId: "purchase-secret-123",
      now: new Date("2026-07-25T22:30:00.000Z"),
    })).resolves.toBe(false);

    expect(mocks.resolveDestination).not.toHaveBeenCalled();
    expect(mocks.appendMailbox).not.toHaveBeenCalled();
  });

  it.each([
    {
      overrides: { remainingCreditUsdMicros: 0n },
      reason: "fully reversed",
    },
    {
      overrides: { status: HostedUsageCreditPurchaseStatus.payment_pending },
      reason: "not fulfilled",
    },
  ])("does nothing when the purchase is $reason", async ({ overrides }) => {
    const prisma = createPrismaHarness(overrides);

    await expect(appendHostedGroupUsageFundedNotificationIfApplicable({
      // @ts-expect-error - focused harness implements the exact delegates used here.
      prisma,
      purchaseId: "purchase-secret-123",
      now: FIXED_NOW,
    })).resolves.toBe(false);

    expect(mocks.resolveDestination).not.toHaveBeenCalled();
    expect(mocks.appendMailbox).not.toHaveBeenCalled();
  });
});

function createPrismaHarness(
  overrides: Partial<{
    remainingCreditUsdMicros: bigint;
    status: HostedUsageCreditPurchaseStatus;
  }> = {},
) {
  const purchase = {
    beneficiaryMemberId: "member-group-runtime",
    paidAt: new Date("2026-07-25T22:00:00.000Z"),
    remainingCreditUsdMicros:
      overrides.remainingCreditUsdMicros ?? 5_000_000n,
    status: overrides.status ?? HostedUsageCreditPurchaseStatus.fulfilled,
  };
  const tx = { kind: "tx" };
  return {
    $transaction: vi.fn(async (run: (value: typeof tx) => Promise<unknown>) =>
      run(tx)
    ),
    hostedUsageCreditPurchase: {
      findUnique: vi.fn(async () => purchase),
    },
  };
}
