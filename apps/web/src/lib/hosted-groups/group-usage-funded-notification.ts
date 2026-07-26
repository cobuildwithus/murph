import "server-only";

import { createHash } from "node:crypto";

import {
  HostedUsageCreditPurchaseStatus,
  type PrismaClient,
} from "@prisma/client";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "@murphai/hosted-execution";

import {
  appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemByDedupeKey,
} from "../hosted-mailbox/store";
import {
  withHostedMemberStripeMutationLock,
} from "../hosted-onboarding/hosted-member-billing-store";
import {
  projectHostedUsageCreditPurchaseTarget,
} from "../hosted-onboarding/usage-credit-purchase-status-service";
import {
  isHostedThreadContainerNotificationDestination,
  resolveHostedAssistantNotificationDestination,
} from "../hosted-routing/assistant-notification-destination";

const HOSTED_GROUP_USAGE_FUNDED_NOTIFICATION_KEY_DOMAIN =
  "murph.group-usage-funded-notification.v1";
const HOSTED_GROUP_USAGE_FUNDED_NOTIFICATION_TTL_MS = 30 * 60 * 1_000;

export async function appendHostedGroupUsageFundedNotificationIfApplicable(input: {
  now?: Date;
  prisma: PrismaClient;
  purchaseId: string;
}): Promise<boolean> {
  const purchase = await input.prisma.hostedUsageCreditPurchase.findUnique({
    select: {
      beneficiaryMemberId: true,
      checkoutSuccessUrl: true,
      id: true,
      paidAt: true,
      payerMemberId: true,
      remainingCreditUsdMicros: true,
      status: true,
    },
    where: { id: input.purchaseId },
  });
  if (
    !purchase
    || purchase.status !== HostedUsageCreditPurchaseStatus.fulfilled
    || purchase.paidAt === null
    || purchase.remainingCreditUsdMicros <= 0n
    || projectHostedUsageCreditPurchaseTarget(purchase).kind !== "group"
  ) {
    return false;
  }

  const paidAt = purchase.paidAt;
  const expiresAt = new Date(
    paidAt.getTime() + HOSTED_GROUP_USAGE_FUNDED_NOTIFICATION_TTL_MS,
  );
  if (expiresAt.getTime() <= (input.now ?? new Date()).getTime()) {
    return false;
  }

  const notificationKey = buildHostedGroupUsageFundedNotificationKey(
    input.purchaseId,
  );
  const eventId = `assistant.notification.requested:${notificationKey}`;
  const existing = await readHostedMailboxItemByDedupeKey({
    dedupeKey: eventId,
    prisma: input.prisma,
    userId: purchase.beneficiaryMemberId,
  });
  if (existing) {
    if (existing.kind !== "assistant.notification.requested") {
      throw new Error(
        "Group usage-funded notification identity belongs to another mailbox kind.",
      );
    }
    return true;
  }

  const destination = await resolveHostedAssistantNotificationDestination({
    memberId: purchase.beneficiaryMemberId,
    prisma: input.prisma,
  });
  if (
    !destination
    || !isHostedThreadContainerNotificationDestination(destination)
  ) {
    return false;
  }

  return withHostedMemberStripeMutationLock({
    memberId: purchase.beneficiaryMemberId,
    prisma: input.prisma,
    run: async (tx) => {
      const currentPurchase =
        await tx.hostedUsageCreditPurchase.findUnique({
          select: {
            beneficiaryMemberId: true,
            checkoutSuccessUrl: true,
            id: true,
            paidAt: true,
            payerMemberId: true,
            remainingCreditUsdMicros: true,
            status: true,
          },
          where: { id: input.purchaseId },
        });
      if (
        !currentPurchase
        || currentPurchase.beneficiaryMemberId !==
          purchase.beneficiaryMemberId
        || currentPurchase.status !==
          HostedUsageCreditPurchaseStatus.fulfilled
        || currentPurchase.paidAt === null
        || currentPurchase.remainingCreditUsdMicros <= 0n
        || projectHostedUsageCreditPurchaseTarget(currentPurchase).kind !==
          "group"
        || new Date(
          currentPurchase.paidAt.getTime() +
            HOSTED_GROUP_USAGE_FUNDED_NOTIFICATION_TTL_MS,
        ).getTime() <= (input.now ?? new Date()).getTime()
      ) {
        return false;
      }

      const appendResult = await appendHostedMailboxEnvelopeTx({
        envelope: buildHostedExecutionAssistantNotificationRequestedWake({
          eventId,
          memberId: currentPurchase.beneficiaryMemberId,
          notification: {
            deliveryDedupeToken: notificationKey,
            deliveryDispatchMode: "queue-only",
            deliveryIdempotencyKey: notificationKey,
            externalThreadRouteAuthority:
              destination.externalThreadRouteAuthority,
            instructions: buildHostedGroupUsageFundedInstructions(),
            notificationToolProfile: "response-audio",
            responsePolicy: { kind: "require_send" },
            route: destination.route,
          },
          occurredAt: currentPurchase.paidAt.toISOString(),
        }),
        expiresAt: new Date(
          currentPurchase.paidAt.getTime() +
            HOSTED_GROUP_USAGE_FUNDED_NOTIFICATION_TTL_MS,
        ),
        tx,
      });
      if (appendResult.dedupeConflict) {
        throw new Error(
          "Group usage-funded notification identity conflicts with another mailbox payload.",
        );
      }
      return true;
    },
  });
}

function buildHostedGroupUsageFundedInstructions(): string {
  return [
    "Someone added more Murph usage to this group.",
    "Thank the contributor without naming or guessing who they are.",
    "",
    "Create one short, genuinely fun thank-you for this existing group conversation.",
    "Choose exactly one of murph.generate_voice_memo or murph.generate_song.",
    "Choose whichever will land better based on the recent group conversation.",
    "Keep the audio roughly 5 to 15 seconds and the accompanying text to one short line.",
    "Be playful and specific, not corporate or overly earnest.",
    "Do not mention the amount, Stripe, billing, tokens, internal accounting, or private account details.",
    "Do not ask anyone else to buy usage, create urgency, or include a purchase link.",
    "If audio generation is unavailable or fails, still send the brief text thank-you.",
  ].join("\n");
}

function buildHostedGroupUsageFundedNotificationKey(
  purchaseId: string,
): string {
  const digest = createHash("sha256")
    .update(HOSTED_GROUP_USAGE_FUNDED_NOTIFICATION_KEY_DOMAIN)
    .update("\0")
    .update(purchaseId)
    .digest("hex")
    .slice(0, 40);
  return `group-usage-funded:v1:${digest}`;
}
