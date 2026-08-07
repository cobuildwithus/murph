import type { Prisma, PrismaClient } from "@prisma/client";

import {
  applyHostedLinqDeliveryReceiptTx,
  readHostedLinqDeliveryForProviderMessageTx,
} from "./linq-delivery-store";
import {
  ensureHostedLinqLineForProviderEventTx,
  projectHostedLinqLineForProviderEventTx,
  upsertHostedLinqLineForPhoneTx,
} from "./linq-line-store";
import {
  createHostedLinqProviderEventLookupKey,
} from "./linq-observability-identifiers";
import {
  markHostedLinqOnboardingLinkNoticeSent,
  releaseHostedLinqOnboardingLinkNoticeClaim,
} from "./linq-daily-state";
import {
  projectHostedLinqChatHealthTx,
  projectHostedLinqLineProviderStateTx,
} from "./linq-provider-health-store";
import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";
import { toHostedOnboardingLogIdSuffix } from "./logging";
import { sha256Hex } from "../primitives";

type HostedLinqProviderEventClient = PrismaClient | Prisma.TransactionClient;

export async function ingestHostedLinqProviderEventTx(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: HostedLinqProviderEventClient;
  receivedAt?: Date;
}): Promise<{
  alertIds: string[];
  duplicate: boolean;
  groupJoinOfferHandled?: boolean;
  restoreOnboardingLink?: NonNullable<
    Awaited<ReturnType<typeof applyHostedLinqDeliveryReceiptTx>>["restoreOnboardingLink"]
  >;
}> {
  const receivedAt = input.receivedAt ?? new Date();
  const health = input.event.providerHealth ?? {
    chat: null,
    line: null,
  };
  const eventLookupKey = createHostedLinqProviderEventLookupKey(input.event.eventId);
  let lineLookupKey = await ensureHostedLinqLineForProviderEventTx({
    event: input.event,
    prisma: input.prisma,
  });
  const healthLinePhoneNumber = health.line?.phoneNumber
    ?? health.chat?.linePhoneNumber
    ?? null;
  if (!lineLookupKey && healthLinePhoneNumber) {
    const line = await upsertHostedLinqLineForPhoneTx({
      observedAt: receivedAt,
      phoneNumber: healthLinePhoneNumber,
      prisma: input.prisma,
      source: "webhook",
    });
    lineLookupKey = line.phoneNumberLookupKey;
  }
  const created = await input.prisma.hostedLinqProviderEvent.createMany({
    data: {
      apiVersion: input.event.apiVersion,
      deliveryStatus: input.event.deliveryStatus,
      direction: input.event.direction,
      eventId: eventLookupKey,
      eventType: input.event.eventType,
      extractionJson: input.event.extractionJson,
      extractionVersion: 1,
      failureCode: input.event.failureCode,
      failureReason: input.event.failureReason,
      linqChatLookupKey: input.event.linqChatLookupKey,
      messageIdSuffix: input.event.messageIdSuffix,
      messageLookupKey: input.event.messageLookupKey,
      payloadHash: input.event.payloadHash,
      payloadSanitizedJson: input.event.payloadSanitizedJson,
      payloadShapeJson: input.event.payloadShapeJson,
      phoneNumberHint: input.event.phoneNumberHint,
      phoneNumberLookupKey: lineLookupKey,
      phoneNumberRole: input.event.phoneNumberRole,
      providerCreatedAt: input.event.providerCreatedAt,
      providerReason: input.event.providerReason,
      providerReputationStatus: health.line?.reputationStatus ?? null,
      providerServiceStatus: health.line?.serviceStatus ?? null,
      providerStatus: input.event.providerStatus,
      chatHealthStatus: health.chat?.providerStatus ?? null,
      chatHealthUpdatedAt: health.chat?.providerUpdatedAt ?? null,
      receivedAt,
      service: input.event.service,
      traceIdSuffix: input.event.traceIdSuffix,
      webhookVersion: input.event.webhookVersion,
    },
    skipDuplicates: true,
  });

  if (created.count === 0) {
    const existing = await input.prisma.hostedLinqProviderEvent.findUnique({
      where: { eventId: eventLookupKey },
      select: { groupJoinOfferHandledAt: true },
    });
    const replayDurableReactionProjection = Boolean(existing)
      && !existing?.groupJoinOfferHandledAt
      && (
        input.event.eventType === "reaction.added"
        || input.event.eventType === "reaction.removed"
      );
    // Provider-event persistence is not the terminal owner for reaction
    // context. Until a reaction was consumed by the join-offer owner, replay
    // its idempotent mailbox projection on webhook retry; the mailbox event id
    // owns exact dedupe and closes an append-or-signal failure window.
    return {
      alertIds: [],
      duplicate: !replayDurableReactionProjection,
      ...(existing?.groupJoinOfferHandledAt
        ? { groupJoinOfferHandled: true }
        : {}),
    };
  }

  const deliveryReceipt = await applyHostedLinqDeliveryReceiptTx({
    event: input.event,
    prisma: input.prisma,
  });
  if (deliveryReceipt.reopenOnboardingLink) {
    const groupJoinReplyContext =
      deliveryReceipt.reopenOnboardingLink.groupJoinReplyContext;
    if (
      !groupJoinReplyContext
      || deliveryReceipt.reopenOnboardingLink.releaseDailySuppression === true
    ) {
      await releaseHostedLinqOnboardingLinkNoticeClaim({
        memberId: deliveryReceipt.reopenOnboardingLink.memberId,
        occurredAt: deliveryReceipt.reopenOnboardingLink.occurredAt,
        prisma: input.prisma,
      });
    }
  }
  if (deliveryReceipt.restoreOnboardingLink) {
    await markHostedLinqOnboardingLinkNoticeSent({
      memberId: deliveryReceipt.restoreOnboardingLink.memberId,
      occurredAt: deliveryReceipt.restoreOnboardingLink.occurredAt,
      prisma: input.prisma,
    });
  }
  const outboundEchoDelivery = isHostedRuntimeOwnedOutboundEcho(input.event)
    ? await readHostedLinqDeliveryForProviderMessageTx({
        messageLookupKey: input.event.messageLookupKey,
        messageLookupKeyCandidates: input.event.messageLookupKeyReadCandidates,
        prisma: input.prisma,
      })
    : null;
  const staleDeliveryReceipt = deliveryReceipt.deliveryId !== null && !deliveryReceipt.advanced;
  const projectionLineLookupKey = lineLookupKey
    ?? deliveryReceipt.phoneNumberLookupKey
    ?? outboundEchoDelivery?.phoneNumberLookupKey
    ?? null;
  // Delivery projections remain Murph-observed state. Linq's line service and
  // reputation snapshot is projected independently below.
  if (
    input.event.eventType !== "phone_number.status_updated"
    && !staleDeliveryReceipt
    && !outboundEchoDelivery?.runtimeOwned
  ) {
    await projectHostedLinqLineForProviderEventTx({
      event: input.event,
      lineLookupKey: projectionLineLookupKey,
      prisma: input.prisma,
    });
  }

  if (health.line && projectionLineLookupKey) {
    await projectHostedLinqLineProviderStateTx({
      eventId: health.line.eventId,
      observedAt: receivedAt,
      phoneNumberLookupKey: projectionLineLookupKey,
      prisma: input.prisma,
      providerUpdatedAt: health.line.providerUpdatedAt,
      reputationStatus: health.line.reputationStatus,
      serviceStatus: health.line.serviceStatus,
    });
  }
  if (health.chat) {
    await projectHostedLinqChatHealthTx({
      chatId: health.chat.chatId,
      isGroup: health.chat.isGroup,
      observedAt: receivedAt,
      phoneNumberLookupKey: projectionLineLookupKey,
      prisma: input.prisma,
      providerStatus: health.chat.providerStatus,
      providerUpdatedAt: health.chat.providerUpdatedAt,
      service: health.chat.service,
    });
  }

  const alertIds = await claimHostedLinqAlertsForProviderEventTx({
    deliveryId: deliveryReceipt.deliveryId ?? outboundEchoDelivery?.deliveryId ?? null,
    event: input.event,
    eventLookupKey,
    lineLookupKey: projectionLineLookupKey,
    prisma: input.prisma,
  });

  return {
    alertIds,
    duplicate: false,
    ...(deliveryReceipt.restoreOnboardingLink
      ? { restoreOnboardingLink: deliveryReceipt.restoreOnboardingLink }
      : {}),
  };
}

export async function markHostedLinqGroupJoinOfferHandledTx(input: {
  eventId: string;
  handledAt?: Date;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const updated = await input.prisma.hostedLinqProviderEvent.updateMany({
    data: {
      groupJoinOfferHandledAt: input.handledAt ?? new Date(),
    },
    where: {
      eventId: createHostedLinqProviderEventLookupKey(input.eventId),
      groupJoinOfferHandledAt: null,
    },
  });
  if (updated.count > 1) {
    throw new Error("A Linq provider event marker updated more than one row.");
  }
  if (updated.count === 0) {
    const existing = await input.prisma.hostedLinqProviderEvent.findUnique({
      where: {
        eventId: createHostedLinqProviderEventLookupKey(input.eventId),
      },
      select: { groupJoinOfferHandledAt: true },
    });
    if (!existing?.groupJoinOfferHandledAt) {
      throw new Error(
        "A terminal group-join reaction requires its Linq provider event.",
      );
    }
  }
}

function isHostedRuntimeOwnedOutboundEcho(
  event: ParsedHostedLinqProviderEvent,
): boolean {
  return event.eventType === "message.received"
    && event.direction === "outbound"
    && event.messageLookupKey !== null;
}

async function claimHostedLinqAlertsForProviderEventTx(input: {
  deliveryId: string | null;
  event: ParsedHostedLinqProviderEvent;
  eventLookupKey: string;
  lineLookupKey: string | null;
  prisma: HostedLinqProviderEventClient;
}): Promise<string[]> {
  const kind = resolveHostedLinqAlertKind(input.event);
  if (!kind) {
    return [];
  }

  const id = buildHostedLinqAlertId(kind, input.eventLookupKey);
  // A `message.failed` payload carries no line phone number, so the parsed
  // event's own hint is null even though the delivery receipt resolved the
  // line. Reading the hint off the resolved line keeps the alert (and its
  // email) able to answer which line failed.
  const phoneNumberHint = input.event.phoneNumberHint
    ?? await readHostedLinqAlertLineHintTx({
      lineLookupKey: input.lineLookupKey,
      prisma: input.prisma,
    });
  const created = await input.prisma.hostedLinqAlert.createMany({
    data: {
      claimedAt: new Date(),
      deliveryId: input.deliveryId,
      detailsJson: buildHostedLinqAlertDetailsJson(input.event, phoneNumberHint),
      eventId: input.eventLookupKey,
      id,
      kind,
      phoneNumberHint,
      phoneNumberLookupKey: input.lineLookupKey,
      status: "pending",
      subject: buildHostedLinqAlertSubject(kind, phoneNumberHint),
    },
    skipDuplicates: true,
  });

  return created.count === 1 ? [id] : [];
}

function resolveHostedLinqAlertKind(event: ParsedHostedLinqProviderEvent): string | null {
  switch (event.eventType) {
    case "message.failed":
      return "message_failed";
    case "phone_number.status_updated":
      return "phone_number_status_updated";
    case "message.delivered":
    case "chat.group_icon_updated":
    case "chat.group_icon_update_failed":
    case "message.edited":
    case "message.sent":
    case "message.received":
    case "participant.added":
    case "participant.removed":
    case "reaction.added":
    case "reaction.removed":
      return null;
  }
}

async function readHostedLinqAlertLineHintTx(input: {
  lineLookupKey: string | null;
  prisma: HostedLinqProviderEventClient;
}): Promise<string | null> {
  if (!input.lineLookupKey) {
    return null;
  }

  const line = await input.prisma.hostedLinqLine.findUnique({
    where: { phoneNumberLookupKey: input.lineLookupKey },
    select: { phoneNumberHint: true },
  });

  return line?.phoneNumberHint ?? null;
}

function buildHostedLinqAlertSubject(
  kind: string,
  phoneNumberHint: string | null,
): string {
  const line = phoneNumberHint ? ` ${phoneNumberHint}` : "";
  if (kind === "message_failed") {
    return `[Murph] Linq message failed${line}`;
  }

  return `[Murph] Linq line status updated${line}`;
}

function buildHostedLinqAlertDetailsJson(
  event: ParsedHostedLinqProviderEvent,
  phoneNumberHint: string | null,
): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify({
    actionTaken: "health_projection_updated_egress_policy_evaluated_at_send",
    deliveryStatus: event.deliveryStatus,
    eventIdSuffix: toHostedOnboardingLogIdSuffix(event.eventId),
    eventType: event.eventType,
    failureCode: event.failureCode,
    failureReason: event.failureReason,
    line: phoneNumberHint,
    phoneNumberRole: event.phoneNumberRole,
    providerCreatedAt: event.providerCreatedAt.toISOString(),
    providerReason: event.providerReason,
    providerReputationStatus: event.providerHealth?.line?.reputationStatus ?? null,
    providerServiceStatus: event.providerHealth?.line?.serviceStatus ?? null,
    providerStatus: event.providerStatus,
    service: event.service,
  })) as Prisma.InputJsonValue;
}

function buildHostedLinqAlertId(kind: string, eventId: string): string {
  return `hla_${kind}_${sha256Hex(`${kind}:${eventId}`).slice(0, 32)}`;
}
