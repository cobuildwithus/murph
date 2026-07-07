import type {
  HostedMember,
  Prisma,
} from "@prisma/client";
import {
  buildHostedExecutionWhatsAppConversationMessageWake,
} from "@murphai/hosted-execution";
import type {
  HostedExecutionAssistantNotificationRoute,
} from "@murphai/hosted-execution";
import type {
  WhatsAppInboundText,
  WhatsAppWebhookBody,
} from "@murphai/messaging-ingress/whatsapp-webhook";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { createHostedPhoneLookupKeyReadCandidates } from "./contact-privacy";
import {
  isHostedMemberSuspended,
} from "./entitlement";
import {
  isHostedOnboardingError,
  hostedOnboardingError,
} from "./errors";
import {
  appendHostedFamilyChatNotificationTx,
  buildHostedFamilyInviteAcceptedReplyText,
  acceptHostedFamilyInviteFromPhoneTx,
  resolveHostedFamilyInviteTokenForInbound,
} from "./family-plan";
import { readActiveHostedMemberAccess } from "./member-access";
import { normalizePhoneNumber } from "./phone";
import {
  buildHostedWhatsAppWebhookEventId,
  parseHostedWhatsAppInboundTexts,
} from "./whatsapp";
import {
  buildHostedWhatsAppConsentCommandEventId,
  grantHostedWhatsAppMessagingConsentTx,
  readHostedWhatsAppMessagingConsentGrantedTx,
  revokeHostedWhatsAppMessagingConsentTx,
} from "./whatsapp-consent";
import type {
  HostedWebhookPlan,
  HostedWebhookWakeHandoff,
} from "./webhook-service-types";

export type HostedOnboardingWhatsAppWebhookResponse = {
  commandHandledCount: number;
  duplicate?: boolean;
  ignored?: boolean;
  ok: true;
  reason?: string;
  inboundTextCount: number;
  routedTextCount: number;
};

type WhatsAppCommand = "help" | "start" | "stop";

export async function planHostedOnboardingWhatsAppWebhook(input: {
  body: WhatsAppWebhookBody;
  prisma?: Prisma.TransactionClient;
}): Promise<HostedWebhookPlan<HostedOnboardingWhatsAppWebhookResponse>> {
  const inboundTexts = parseHostedWhatsAppInboundTexts(input.body);

  if (inboundTexts.length === 0) {
    return buildIgnoredWhatsAppWebhookPlan("unsupported-update", 0);
  }

  if (!input.prisma) {
    throw new Error("Hosted WhatsApp webhook planning requires Prisma for inbound texts.");
  }

  const wakeHandoffs: HostedWebhookWakeHandoff[] = [];
  let commandHandledCount = 0;
  let duplicateCount = 0;
  let ignoredCount = 0;
  let lastIgnoredReason = "whatsapp-routing-not-configured";
  let routedTextCount = 0;

  for (const inboundText of inboundTexts) {
    const messagePlan = await planHostedOnboardingWhatsAppInboundText({
      inboundText,
      prisma: input.prisma,
    });

    commandHandledCount += messagePlan.commandHandled ? 1 : 0;
    duplicateCount += messagePlan.duplicate ? 1 : 0;
    ignoredCount += messagePlan.ignored ? 1 : 0;
    if (messagePlan.reason) {
      lastIgnoredReason = messagePlan.reason;
    }
    if (messagePlan.wakeHandoff) {
      wakeHandoffs.push(messagePlan.wakeHandoff);
      if (!messagePlan.duplicate) {
        routedTextCount += 1;
      }
    }
  }

  const handledCount = routedTextCount + commandHandledCount + duplicateCount;
  const ignored = handledCount === 0 || ignoredCount === inboundTexts.length;
  const reason = resolveWhatsAppWebhookResponseReason({
    commandHandledCount,
    duplicateCount,
    ignored,
    lastIgnoredReason,
    routedTextCount,
  });

  return {
    desiredSideEffects: [],
    response: {
      ...(duplicateCount > 0 ? { duplicate: true } : {}),
      ignored,
      commandHandledCount,
      inboundTextCount: inboundTexts.length,
      ok: true,
      reason,
      routedTextCount,
    },
    wakeHandoffs,
  };
}

function buildIgnoredWhatsAppWebhookPlan(
  reason: string,
  inboundTextCount: number,
): HostedWebhookPlan<HostedOnboardingWhatsAppWebhookResponse> {
  return {
    desiredSideEffects: [],
    response: {
      commandHandledCount: 0,
      ignored: true,
      inboundTextCount,
      ok: true,
      reason,
      routedTextCount: 0,
    },
  };
}

async function planHostedOnboardingWhatsAppInboundText(input: {
  inboundText: WhatsAppInboundText;
  prisma: Prisma.TransactionClient;
}): Promise<{
  commandHandled: boolean;
  duplicate: boolean;
  ignored: boolean;
  reason: string;
  wakeHandoff: HostedWebhookWakeHandoff | null;
}> {
  const phoneNumber = normalizePhoneNumber(input.inboundText.fromWaId);
  if (!phoneNumber) {
    return buildWhatsAppInboundTextNoWakePlan("invalid-whatsapp-sender");
  }

  const familyInviteTokenPresent = await resolveHostedFamilyInviteTokenForInbound({
    prisma: input.prisma,
    text: input.inboundText.text,
  }) !== null;
  let familyAcceptance: Awaited<ReturnType<typeof acceptHostedFamilyInviteFromPhoneTx>> = null;
  try {
    familyAcceptance = await acceptHostedFamilyInviteFromPhoneTx({
      now: input.inboundText.receivedAt,
      onAcceptedMemberValidated: async ({ acceptedMemberId }) => {
        const consentWrite = await grantHostedWhatsAppMessagingConsentTx({
          eventId: buildHostedWhatsAppConsentCommandEventId({
            action: "granted",
            externalMessageId: `${input.inboundText.externalMessageId}:family-invite`,
          }),
          memberId: acceptedMemberId,
          now: input.inboundText.receivedAt,
          prisma: input.prisma,
        });

        if (consentWrite.stale) {
          throw hostedOnboardingError({
            code: "HOSTED_FAMILY_WHATSAPP_CONSENT_STALE",
            httpStatus: 409,
            message: "WhatsApp messaging consent changed while accepting this family invite. Send the invite code again.",
          });
        }
      },
      phoneNumber,
      text: input.inboundText.text,
      tx: input.prisma,
    });
  } catch (error) {
    if (!isExpectedHostedWhatsAppFamilyInviteAcceptanceMiss(error)) {
      throw error;
    }
  }
  if (familyAcceptance) {
    const notification = await appendHostedWhatsAppFamilyChatNotification({
      inboundText: input.inboundText,
      memberId: familyAcceptance.memberId,
      message: buildHostedFamilyInviteAcceptedReplyText({
        memberId: familyAcceptance.memberId,
      }),
      prisma: input.prisma,
      reason: "family-invite-accepted",
    });
    return {
      commandHandled: true,
      duplicate: false,
      ignored: false,
      reason: "family-invite-accepted",
      wakeHandoff: notification.wakeHandoff,
    };
  }

  if (familyInviteTokenPresent) {
    return buildWhatsAppInboundTextNoWakePlan("family-invite-not-accepted");
  }

  const member = await lookupHostedMemberByWhatsAppPhoneNumber({
    phoneNumber,
    prisma: input.prisma,
  });
  if (!member) {
    return buildWhatsAppInboundTextNoWakePlan("unlinked-whatsapp");
  }

  if (isHostedMemberSuspended(member.suspendedAt)) {
    return buildWhatsAppInboundTextNoWakePlan("suspended-member");
  }

  if (!await readActiveHostedMemberAccess({
    memberId: member.id,
    prisma: input.prisma,
  })) {
    return buildWhatsAppInboundTextNoWakePlan("inactive-member");
  }

  const command = parseWhatsAppCommand(input.inboundText.text);
  const eventId = buildHostedWhatsAppWebhookEventId(input.inboundText.externalMessageId);
  if (command === "stop") {
    const consentWrite = await revokeHostedWhatsAppMessagingConsentTx({
      eventId: buildHostedWhatsAppConsentCommandEventId({
        action: "revoked",
        externalMessageId: input.inboundText.externalMessageId,
      }),
      memberId: member.id,
      now: input.inboundText.receivedAt,
      prisma: input.prisma,
    });
    if (consentWrite.duplicate || consentWrite.stale) {
      return consentWrite.duplicate
        ? buildWhatsAppInboundTextDuplicatePlan()
        : buildWhatsAppInboundTextNoWakePlan("stale-whatsapp-command");
    }
    return {
      commandHandled: true,
      duplicate: false,
      ignored: false,
      reason: "whatsapp-stop-revoked",
      wakeHandoff: null,
    };
  }

  if (command === "start") {
    const consentWrite = await grantHostedWhatsAppMessagingConsentTx({
      eventId: buildHostedWhatsAppConsentCommandEventId({
        action: "granted",
        externalMessageId: input.inboundText.externalMessageId,
      }),
      memberId: member.id,
      now: input.inboundText.receivedAt,
      prisma: input.prisma,
    });
    if (consentWrite.duplicate || consentWrite.stale) {
      return consentWrite.duplicate
        ? buildWhatsAppInboundTextDuplicatePlan()
        : buildWhatsAppInboundTextNoWakePlan("stale-whatsapp-command");
    }
    return {
      commandHandled: true,
      duplicate: false,
      ignored: false,
      reason: "whatsapp-start-granted",
      wakeHandoff: null,
    };
  }

  if (command === "help") {
    return {
      commandHandled: true,
      duplicate: false,
      ignored: false,
      reason: "whatsapp-help-handled",
      wakeHandoff: null,
    };
  }

  const consentGranted = await readHostedWhatsAppMessagingConsentGrantedTx({
    memberId: member.id,
    prisma: input.prisma,
  });
  if (!consentGranted) {
    return buildWhatsAppInboundTextNoWakePlan("whatsapp-consent-required");
  }

  const mailboxAppend = await appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionWhatsAppConversationMessageWake({
      eventId,
      occurredAt: input.inboundText.receivedAt.toISOString(),
      userId: member.id,
      whatsappMessage: {
        fromWaId: input.inboundText.fromWaId,
        messageId: input.inboundText.externalMessageId,
        phoneNumberId: input.inboundText.phoneNumberId,
        schema: "murph.hosted-whatsapp-message.v1",
        text: input.inboundText.text,
        threadId: input.inboundText.fromWaId,
      },
    }),
    tx: input.prisma,
  });

  if (mailboxAppend.duplicate) {
    return {
      commandHandled: false,
      duplicate: true,
      ignored: true,
      reason: "duplicate-webhook-event",
      wakeHandoff: {
        eventId,
        mailboxItemId: mailboxAppend.item.id,
        source: "whatsapp",
        userId: member.id,
        wakeMailboxCheckpoint: {
          lane: mailboxAppend.item.lane,
          laneSeq: mailboxAppend.item.laneSeq,
        },
      },
    };
  }

  return {
    commandHandled: false,
    duplicate: false,
    ignored: false,
    reason: "wake-appended-active-member",
    wakeHandoff: {
      eventId,
      mailboxItemId: mailboxAppend.item.id,
      source: "whatsapp",
      userId: member.id,
      wakeMailboxCheckpoint: {
        lane: mailboxAppend.item.lane,
        laneSeq: mailboxAppend.item.laneSeq,
      },
    },
  };
}

async function appendHostedWhatsAppFamilyChatNotification(input: {
  inboundText: WhatsAppInboundText;
  memberId: string;
  message: string;
  prisma: Prisma.TransactionClient;
  reason: string;
}): Promise<{ wakeHandoff: HostedWebhookWakeHandoff | null }> {
  const sourceEventId = `${buildHostedWhatsAppWebhookEventId(input.inboundText.externalMessageId)}:${input.reason}`;
  const notification = await appendHostedFamilyChatNotificationTx({
    memberId: input.memberId,
    message: input.message,
    occurredAt: input.inboundText.receivedAt.toISOString(),
    route: buildHostedWhatsAppFamilyChatNotificationRoute(input.inboundText),
    sourceEventId,
    tx: input.prisma,
  });

  return {
    wakeHandoff: notification.mailboxItemId
      ? {
          eventId: sourceEventId,
          mailboxItemId: notification.mailboxItemId,
          source: "whatsapp",
          userId: input.memberId,
        }
      : null,
  };
}

function buildHostedWhatsAppFamilyChatNotificationRoute(
  inboundText: WhatsAppInboundText,
): HostedExecutionAssistantNotificationRoute {
  return {
    actorId: null,
    channel: "whatsapp",
    delivery: {
      kind: "explicit",
      target: inboundText.fromWaId,
    },
    identityId: null,
    threadId: inboundText.fromWaId,
    threadIsDirect: true,
  };
}

async function lookupHostedMemberByWhatsAppPhoneNumber(input: {
  phoneNumber: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMember | null> {
  const phoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(input.phoneNumber);
  if (phoneLookupKeys.length === 0) {
    return null;
  }

  const identityRecords = await input.prisma.hostedMemberIdentity.findMany({
    where: {
      phoneLookupKey: {
        in: phoneLookupKeys,
      },
      phoneNumberVerifiedAt: {
        not: null,
      },
    },
    include: {
      member: true,
    },
  });
  const membersById = new Map<string, HostedMember>();

  for (const identityRecord of identityRecords) {
    membersById.set(identityRecord.member.id, identityRecord.member);
  }

  return membersById.size === 1 ? [...membersById.values()][0] ?? null : null;
}

function buildWhatsAppInboundTextNoWakePlan(reason: string): {
  commandHandled: false;
  duplicate: false;
  ignored: true;
  reason: string;
  wakeHandoff: null;
} {
  return {
    commandHandled: false,
    duplicate: false,
    ignored: true,
    reason,
    wakeHandoff: null,
  };
}

function buildWhatsAppInboundTextDuplicatePlan(): {
  commandHandled: false;
  duplicate: true;
  ignored: true;
  reason: string;
  wakeHandoff: null;
} {
  return {
    commandHandled: false,
    duplicate: true,
    ignored: true,
    reason: "duplicate-webhook-event",
    wakeHandoff: null,
  };
}

function parseWhatsAppCommand(text: string): WhatsAppCommand | null {
  const normalized = text.trim().toLowerCase();

  if (normalized === "stop" || normalized === "unsubscribe" || normalized === "cancel") {
    return "stop";
  }

  if (normalized === "start" || normalized === "subscribe") {
    return "start";
  }

  return normalized === "help" ? "help" : null;
}

function resolveWhatsAppWebhookResponseReason(input: {
  commandHandledCount: number;
  duplicateCount: number;
  ignored: boolean;
  lastIgnoredReason: string;
  routedTextCount: number;
}): string {
  if (input.routedTextCount > 0) {
    return "wake-appended-active-member";
  }

  if (input.commandHandledCount > 0) {
    return "whatsapp-command-handled";
  }

  if (input.duplicateCount > 0) {
    return "duplicate-webhook-event";
  }

  return input.lastIgnoredReason;
}

const HOSTED_WHATSAPP_FAMILY_INVITE_ACCEPTANCE_MISS_CODES = new Set([
  "HOSTED_FAMILY_DIRECT_PAID_TRANSFER_REQUIRED",
  "HOSTED_FAMILY_INVITE_NOT_ACTIVE",
  "HOSTED_FAMILY_INVITE_NOT_FOUND",
  "HOSTED_FAMILY_INVITE_PHONE_MISMATCH",
  "HOSTED_FAMILY_INVITE_PHONE_REQUIRED",
  "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
  "HOSTED_FAMILY_OWNER_ALREADY_IN_GROUP",
  "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
]);

function isExpectedHostedWhatsAppFamilyInviteAcceptanceMiss(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && !error.retryable
    && HOSTED_WHATSAPP_FAMILY_INVITE_ACCEPTANCE_MISS_CODES.has(error.code);
}
