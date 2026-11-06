import "server-only";

import { createHash } from "node:crypto";

import {
  HostedGroupSponsorshipAuthorizationStatus,
  HostedUsageCreditPurchaseStatus,
  type Prisma,
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
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";
import {
  isHostedThreadContainerNotificationDestination,
  resolveHostedAssistantNotificationDestination,
} from "../hosted-routing/assistant-notification-destination";
import {
  buildHostedGroupUsageFundingLocatorForRuntimeMember,
  buildHostedGroupUsageFundingUrl,
} from "./group-usage-funding";
import {
  readHostedGroupSponsorshipAuthorizationByPurchase,
} from "./group-sponsorship-authorization";
const PRIVATE_KEY_DOMAIN = "murph.group-sponsorship-private-notice.v1";

export async function materializeHostedGroupSponsorshipRecoveryNotification(
  input: {
    now?: Date;
    prisma: PrismaClient;
    purchaseId: string;
  },
): Promise<boolean> {
  const sponsorship = await readHostedGroupSponsorshipAuthorizationByPurchase({
    prisma: input.prisma,
    purchaseId: input.purchaseId,
  });
  if (!sponsorship || sponsorship.chargeOrdinal <= 0) {
    return false;
  }
  const authorization =
    await input.prisma.hostedGroupSponsorshipAuthorization.findUnique({
      select: { beneficiaryMemberId: true, status: true },
      where: { id: sponsorship.authorizationId },
    });
  if (
    authorization?.status !==
    HostedGroupSponsorshipAuthorizationStatus.recovery_required
  ) {
    return false;
  }
  const managementUrl = buildPrivateManagementUrl(
    authorization.beneficiaryMemberId,
  );
  return materializePrivateSponsorshipNotification({
    beneficiaryMemberId: authorization.beneficiaryMemberId,
    eventIdentity: [
      "recovery",
      sponsorship.authorizationId,
      sponsorship.periodStartedAt.toISOString(),
      input.purchaseId,
    ].join(":"),
    instructions: [
      "Send one concise private billing notice to the sponsor only.",
      "Say that Murph could not complete the latest $5 group usage-credit refill and automatic charges are paused until they review payment.",
      managementUrl ? `Private recovery page: ${managementUrl}` : null,
      "Do not send this to the group, identify the sponsor there, or expose the monthly maximum.",
    ].filter((line): line is string => Boolean(line)).join("\n"),
    now: input.now ?? new Date(),
    payerMemberId: sponsorship.payerMemberId,
    prisma: input.prisma,
    validateBeforeAppendTx: async (tx) => {
      const currentPurchase = await tx.hostedUsageCreditPurchase.findUnique({
        select: {
          groupSponsorshipAuthorizationId: true,
          groupSponsorshipPeriodStartedAt: true,
          payerMemberId: true,
          status: true,
        },
        where: { id: input.purchaseId },
      });
      const currentAuthorization =
        await tx.hostedGroupSponsorshipAuthorization.findUnique({
          select: { payerMemberId: true, status: true },
          where: { id: sponsorship.authorizationId },
        });
      return Boolean(
        currentPurchase &&
        currentPurchase.status === HostedUsageCreditPurchaseStatus.payment_failed &&
        currentPurchase.payerMemberId === sponsorship.payerMemberId &&
        currentPurchase.groupSponsorshipAuthorizationId ===
          sponsorship.authorizationId &&
        currentPurchase.groupSponsorshipPeriodStartedAt?.getTime() ===
          sponsorship.periodStartedAt.getTime() &&
        currentAuthorization?.payerMemberId === sponsorship.payerMemberId &&
        currentAuthorization.status ===
          HostedGroupSponsorshipAuthorizationStatus.recovery_required,
      );
    },
  });
}

async function materializePrivateSponsorshipNotification(input: {
  beneficiaryMemberId?: string;
  eventIdentity: string;
  instructions: string;
  now: Date;
  payerMemberId: string;
  prisma: PrismaClient;
  validateBeforeAppendTx?: (tx: Prisma.TransactionClient) => Promise<boolean>;
}): Promise<boolean> {
  const notificationKey = privateNotificationKey(input.eventIdentity);
  const eventId = `assistant.notification.requested:${notificationKey}`;
  const existing = await readHostedMailboxItemByDedupeKey({
    dedupeKey: eventId,
    prisma: input.prisma,
    userId: input.payerMemberId,
  });
  if (existing) {
    if (existing.kind !== "assistant.notification.requested") {
      throw new Error(
        "Group sponsorship private notification identity belongs to another mailbox kind.",
      );
    }
    await signalHostedMailboxAppendRuntime({
      expectedUserId: input.payerMemberId,
      mailboxItemId: existing.id,
      prisma: input.prisma,
    });
    return true;
  }

  const result = await input.prisma.$transaction(async (tx) => {
    if (input.beneficiaryMemberId) {
      await lockHostedMemberRow(tx, input.beneficiaryMemberId);
    }
    await lockHostedMemberRow(tx, input.payerMemberId);
    const alreadyQueued = await readHostedMailboxItemByDedupeKey({
      dedupeKey: eventId,
      prisma: tx,
      userId: input.payerMemberId,
    });
    if (alreadyQueued) {
      if (alreadyQueued.kind !== "assistant.notification.requested") {
        throw new Error(
          "Group sponsorship private notification identity belongs to another mailbox kind.",
        );
      }
      return { itemId: alreadyQueued.id };
    }
    const destination = await resolveHostedAssistantNotificationDestination({
      memberId: input.payerMemberId,
      prisma: tx,
    });
    if (
      !destination ||
      isHostedThreadContainerNotificationDestination(destination)
    ) {
      return null;
    }
    if (
      input.validateBeforeAppendTx &&
      !(await input.validateBeforeAppendTx(tx))
    ) {
      return null;
    }
    const appended = await appendHostedMailboxEnvelopeTx({
      envelope: buildHostedExecutionAssistantNotificationRequestedWake({
        eventId,
        memberId: input.payerMemberId,
        notification: {
          deliveryDedupeToken: notificationKey,
          deliveryDispatchMode: "queue-only",
          deliveryIdempotencyKey: notificationKey,
          externalThreadRouteAuthority: null,
          instructions: input.instructions,
          responsePolicy: { kind: "require_send" },
          route: destination.route,
        },
        occurredAt: input.now.toISOString(),
      }),
      tx,
    });
    if (appended.dedupeConflict) {
      throw new Error(
        "Group sponsorship private notification identity conflicts with another payload.",
      );
    }
    return { itemId: appended.item.id };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  if (!result) {
    return false;
  }
  await signalHostedMailboxAppendRuntime({
    expectedUserId: input.payerMemberId,
    mailboxItemId: result.itemId,
    prisma: input.prisma,
  });
  return true;
}

function buildPrivateManagementUrl(
  beneficiaryMemberId: string | null,
): string | null {
  if (!beneficiaryMemberId) {
    return null;
  }
  const locator = buildHostedGroupUsageFundingLocatorForRuntimeMember(
    beneficiaryMemberId,
  );
  return locator
    ? buildHostedGroupUsageFundingUrl({ joinCode: locator })
    : null;
}

function privateNotificationKey(eventIdentity: string): string {
  const digest = createHash("sha256")
    .update(PRIVATE_KEY_DOMAIN)
    .update("\0")
    .update(eventIdentity)
    .digest("hex")
    .slice(0, 40);
  return `group-sponsorship-private:v1:${digest}`;
}
