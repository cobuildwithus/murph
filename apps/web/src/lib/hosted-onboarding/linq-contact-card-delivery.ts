import type { PrismaClient } from "@prisma/client";

import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedLinqMessageLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  isHostedLinqContactCardAutoShareEligible,
  shareMurphHostedLinqNativeContactCardToChat,
} from "./linq-contact-card-share";

/**
 * Direct-chat native identity sharing is independent of signup-link bookkeeping.
 * Webhooks supply confirmed service; acceptance callbacks instead reconcile the
 * exact messages' already-persisted delivery receipts after home-route commit.
 * Provider work runs after the response and never invalidates a delivered reply.
 */
export function queueHostedLinqHomeContactCardAfterDelivery(input: {
  chatId: string | null;
  expectedMemberId?: string;
  prisma: PrismaClient;
  scheduleAfterResponse?: (task: () => Promise<void>) => void;
} & (
  | { service: string | null; messageIds?: never }
  | { messageIds: readonly string[]; service?: never }
)): Promise<void> | void {
  const chatId = input.chatId;
  if (!chatId) return;
  if (input.messageIds === undefined
    && !isHostedLinqContactCardAutoShareEligible({ service: input.service })) return;
  if (input.messageIds && (input.messageIds.length === 0 || input.messageIds.length > 10)) return;

  const task = async (): Promise<void> => {
    try {
      const chatKeys = createHostedLinqChatLookupKeyReadCandidates(chatId);
      const owners = await input.prisma.hostedMemberRouting.findMany({
        where: {
          linqChatLookupKey: { in: [...chatKeys] },
          member: { suspendedAt: null },
        },
        select: { memberId: true },
        take: 2,
      });
      const [owner] = owners;
      if (owners.length !== 1 || !owner) return;
      if (input.expectedMemberId && owner.memberId !== input.expectedMemberId) return;
      if (input.messageIds) {
        const receipt = await input.prisma.hostedLinqProviderEvent.findFirst({
          where: {
            linqChatLookupKey: { in: [...chatKeys] },
            messageLookupKey: {
              in: input.messageIds.flatMap((id) =>
                [...createHostedLinqMessageLookupKeyReadCandidates(id)]),
            },
            deliveryStatus: "delivered",
            service: { equals: "imessage", mode: "insensitive" },
          },
          select: { eventId: true },
        });
        if (!receipt) return;
      }
      const outcome = await shareMurphHostedLinqNativeContactCardToChat({
        chatId,
        memberId: owner.memberId,
        prisma: input.prisma,
      });
      if (outcome.status === "skipped" || outcome.status === "failed") {
        console.warn("Hosted Linq home contact-card share did not send.", {
          status: outcome.status,
          reason: outcome.reason,
        });
      }
    } catch {
      console.warn("Hosted Linq home contact-card share failed.", {
        code: "HOSTED_LINQ_CONTACT_CARD_SHARE_FAILED",
      });
    }
  };
  if (!input.scheduleAfterResponse) return task();
  try {
    input.scheduleAfterResponse(task);
  } catch {
    console.warn("Hosted Linq home contact-card share could not be scheduled.", {
      code: "HOSTED_LINQ_CONTACT_CARD_SHARE_NOT_SCHEDULED",
    });
  }
}
