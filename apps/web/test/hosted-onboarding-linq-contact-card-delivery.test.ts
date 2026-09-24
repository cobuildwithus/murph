import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedLinqMessageLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import { queueHostedLinqHomeContactCardAfterDelivery } from "@/src/lib/hosted-onboarding/linq-contact-card-delivery";

const mocks = vi.hoisted(() => ({ share: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/linq-contact-card-share", () => ({
  isHostedLinqContactCardAutoShareEligible: ({ service }: { service: string | null }) =>
    service?.trim().toLowerCase() === "imessage",
  shareMurphHostedLinqNativeContactCardToChat: mocks.share,
}));

function fixture() {
  const owners = vi.fn().mockResolvedValue([{ memberId: "member_test" }]);
  const receipt = vi.fn().mockResolvedValue({ eventId: "receipt_test" });
  const prisma = {
    hostedMemberRouting: { findMany: owners },
    hostedLinqProviderEvent: { findFirst: receipt },
  };
  return { owners, receipt, prisma: prisma as never };
}

describe("home Linq contact-card delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.share.mockResolvedValue({ status: "sent" });
  });

  it("defers route lookup and sharing until after the delivered reply response", async () => {
    const f = fixture();
    const tasks: Array<() => Promise<void>> = [];
    queueHostedLinqHomeContactCardAfterDelivery({
      chatId: "chat_test", prisma: f.prisma, service: "iMessage",
      scheduleAfterResponse: (task) => { tasks.push(task); },
    });
    expect(f.owners).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
    await tasks[0]!();
    expect(f.owners).toHaveBeenCalledExactlyOnceWith({
      where: {
        linqChatLookupKey: { in: [...createHostedLinqChatLookupKeyReadCandidates("chat_test")] },
        member: { suspendedAt: null },
      },
      select: { memberId: true }, take: 2,
    });
    expect(f.receipt).not.toHaveBeenCalled();
    expect(mocks.share).toHaveBeenCalledExactlyOnceWith({
      chatId: "chat_test", memberId: "member_test", prisma: f.prisma,
    });
  });

  it.each(["sms", "rcs", null, "unknown"])("ignores %s deliveries", async (service) => {
    const f = fixture();
    await queueHostedLinqHomeContactCardAfterDelivery({ chatId: "chat_test", prisma: f.prisma, service });
    expect(f.owners).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it.each([{ owners: [] }, { owners: [{ memberId: "one" }, { memberId: "two" }] }])(
    "does not share without one current unsuspended home owner: %j", async ({ owners }) => {
      const f = fixture();
      f.owners.mockResolvedValue(owners);
      await queueHostedLinqHomeContactCardAfterDelivery({ chatId: "chat_test", prisma: f.prisma, service: "iMessage" });
      expect(mocks.share).not.toHaveBeenCalled();
    },
  );

  it("recovers a welcome delivered before home-route materialization", async () => {
    const f = fixture();
    f.owners.mockResolvedValueOnce([]);
    await queueHostedLinqHomeContactCardAfterDelivery({
      chatId: "chat_test", prisma: f.prisma, service: "iMessage",
    });
    expect(mocks.share).not.toHaveBeenCalled();
    await queueHostedLinqHomeContactCardAfterDelivery({
      chatId: "chat_test", expectedMemberId: "member_test", prisma: f.prisma,
      messageIds: ["message_test"],
    });
    expect(f.receipt).toHaveBeenCalledExactlyOnceWith({
      where: {
        linqChatLookupKey: { in: [...createHostedLinqChatLookupKeyReadCandidates("chat_test")] },
        messageLookupKey: { in: [...createHostedLinqMessageLookupKeyReadCandidates("message_test")] },
        deliveryStatus: "delivered",
        service: { equals: "imessage", mode: "insensitive" },
      },
      select: { eventId: true },
    });
    expect(mocks.share).toHaveBeenCalledTimes(1);
  });

  it("does not treat provider acceptance alone as handset delivery", async () => {
    const f = fixture();
    f.receipt.mockResolvedValue(null);
    await queueHostedLinqHomeContactCardAfterDelivery({
      chatId: "chat_test", prisma: f.prisma, messageIds: ["message_test"],
    });
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it("does not share an acceptance callback into another member's home chat", async () => {
    const f = fixture();
    await queueHostedLinqHomeContactCardAfterDelivery({
      chatId: "chat_test", expectedMemberId: "different_member", prisma: f.prisma,
      messageIds: ["message_test"],
    });
    expect(f.receipt).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it("contains provider, lookup, and scheduling failures", async () => {
    const f = fixture();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mocks.share.mockRejectedValueOnce(new Error("synthetic private provider detail"));
      await expect(queueHostedLinqHomeContactCardAfterDelivery({
        chatId: "chat_test", prisma: f.prisma, service: "iMessage",
      })).resolves.toBeUndefined();
      f.owners.mockRejectedValueOnce(new Error("synthetic lookup failure"));
      await expect(queueHostedLinqHomeContactCardAfterDelivery({
        chatId: "chat_test", prisma: f.prisma, service: "iMessage",
      })).resolves.toBeUndefined();
      expect(() => queueHostedLinqHomeContactCardAfterDelivery({
        chatId: "chat_test", prisma: f.prisma, service: "iMessage",
        scheduleAfterResponse: () => { throw new Error("scheduler unavailable"); },
      })).not.toThrow();
      expect(JSON.stringify(warning.mock.calls)).not.toContain("synthetic private");
      expect(warning).toHaveBeenCalledTimes(3);
    } finally {
      warning.mockRestore();
    }
  });
});
