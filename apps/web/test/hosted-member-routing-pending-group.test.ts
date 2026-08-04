import { describe, expect, it, vi } from "vitest";

import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
} from "../src/lib/hosted-onboarding/contact-privacy";
import { lookupHostedMemberRoutingByPendingLinqParticipantContact } from "../src/lib/hosted-onboarding/hosted-member-routing-store";
import { createHostedLinqParticipantContact } from "../src/lib/hosted-onboarding/linq-participant-contact";

describe("pending Linq group contact lookup", () => {
  it("scopes one temporary identity to the exact chat and recipient line", async () => {
    const contact = createHostedLinqParticipantContact({
      kind: "email",
      value: "person@icloud.com",
    });
    if (!contact) {
      throw new Error("Expected email contact");
    }
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      hostedMemberRouting: { findMany },
    };

    await lookupHostedMemberRoutingByPendingLinqParticipantContact({
      contact,
      linqChatId: "chat_group_123",
      prisma: prisma as never,
      recipientPhone: "+15550000000",
    });

    expect(findMany).toHaveBeenCalledWith({
      select: expect.any(Object),
      where: {
        pendingLinqChatLookupKey: {
          in: createHostedLinqChatLookupKeyReadCandidates("chat_group_123"),
        },
        pendingLinqParticipantContactLookupKey: {
          in: expect.arrayContaining([contact.lookupKey]),
        },
        pendingLinqRecipientPhoneLookupKey: {
          in: createHostedPhoneLookupKeyReadCandidates("+15550000000"),
        },
      },
    });
  });

  it("rejects a partially scoped group lookup", async () => {
    const contact = createHostedLinqParticipantContact({
      kind: "email",
      value: "person@icloud.com",
    });
    if (!contact) {
      throw new Error("Expected email contact");
    }

    await expect(
      lookupHostedMemberRoutingByPendingLinqParticipantContact({
        contact,
        linqChatId: "chat_group_123",
        prisma: { hostedMemberRouting: { findMany: vi.fn() } } as never,
      }),
    ).rejects.toThrow(
      "Pending Linq group contact lookup requires both chat and recipient line.",
    );
  });
});
