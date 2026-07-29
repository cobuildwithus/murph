import type { Prisma, PrismaClient } from "@prisma/client";

import {
  applyHostedLinqDeliveryReceiptTx,
  readHostedLinqDeliveryForProviderMessageTx,
} from "./linq-delivery-store";
import {
  ensureHostedLinqLineForProviderEventTx,
  projectHostedLinqLineForProviderEventTx,
} from "./linq-line-store";
import {
  createHostedLinqProviderEventLookupKey,
} from "./linq-observability-identifiers";
import {
  markHostedLinqOnboardingLinkNoticeSent,
  releaseHostedLinqOnboardingLinkNoticeClaim,
} from "./linq-daily-state";
import {
  provisionHostedLinqParticipantAddedOwnerTx,
} from "./linq-participant-added-owner";
import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";
import { toHostedOnboardingLogIdSuffix } from "./logging";
import { sha256Hex } from "../primitives";

type HostedLinqProviderEventClient = PrismaClient | Prisma.TransactionClient;

export async function ingestHostedLinqProviderEventTx(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: Prisma.TransactionClient;
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
  const ownerEvidence = input.event.participantAddedOwnerEvidence ?? null;
  const event = withoutHostedLinqParticipantAddedOwnerEvidence(input.event);
  const eventLookupKey = createHostedLinqProviderEventLookupKey(event.eventId);
  const lineLookupKey = await ensureHostedLinqLineForProviderEventTx({
    event,
    prisma: input.prisma,
  });
  const created = await input.prisma.hostedLinqProviderEvent.createMany({
    data: {
      apiVersion: event.apiVersion,
      deliveryStatus: event.deliveryStatus,
      direction: event.direction,
      eventId: eventLookupKey,
      eventType: event.eventType,
      extractionJson: event.extractionJson,
      extractionVersion: 1,
      failureCode: event.failureCode,
      failureReason: event.failureReason,
      linqChatLookupKey: event.linqChatLookupKey,
      messageIdSuffix: event.messageIdSuffix,
      messageLookupKey: event.messageLookupKey,
      payloadHash: event.payloadHash,
      payloadSanitizedJson: event.payloadSanitizedJson,
      payloadShapeJson: event.payloadShapeJson,
      phoneNumberHint: event.phoneNumberHint,
      phoneNumberLookupKey: lineLookupKey,
      phoneNumberRole: event.phoneNumberRole,
      providerCreatedAt: event.providerCreatedAt,
      providerReason: event.providerReason,
      providerStatus: event.providerStatus,
      receivedAt,
      service: event.service,
      traceIdSuffix: event.traceIdSuffix,
      webhookVersion: event.webhookVersion,
    },
    skipDuplicates: true,
  });

  if (created.count === 0) {
    const existing = await input.prisma.hostedLinqProviderEvent.findUnique({
      where: { eventId: eventLookupKey },
      select: { groupJoinOfferHandledAt: true },
    });
    return {
      alertIds: [],
      duplicate: true,
      ...(existing?.groupJoinOfferHandledAt
        ? { groupJoinOfferHandled: true }
        : {}),
    };
  }

  if (
    event.eventType === "participant.added"
    && event.linqChatId
    && ownerEvidence
  ) {
    await provisionHostedLinqParticipantAddedOwnerTx({
      chatId: event.linqChatId,
      evidence: ownerEvidence,
      eventId: event.eventId,
      occurredAt: event.providerCreatedAt,
      prisma: input.prisma,
    });
  }

  const deliveryReceipt = await applyHostedLinqDeliveryReceiptTx({
    event,
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
  const outboundEchoDelivery = isHostedRuntimeOwnedOutboundEcho(event)
    ? await readHostedLinqDeliveryForProviderMessageTx({
        messageLookupKey: event.messageLookupKey,
        messageLookupKeyCandidates: event.messageLookupKeyReadCandidates,
        prisma: input.prisma,
      })
    : null;
  const staleDeliveryReceipt = deliveryReceipt.deliveryId !== null && !deliveryReceipt.advanced;
  const projectionLineLookupKey = lineLookupKey
    ?? deliveryReceipt.phoneNumberLookupKey
    ?? outboundEchoDelivery?.phoneNumberLookupKey
    ?? null;
  // Delivery/line projections are monotonic derived state. The provider-event
  // ledger remains the duplicate gate for event-scoped alerting below.
  if (!staleDeliveryReceipt && !outboundEchoDelivery?.runtimeOwned) {
    await projectHostedLinqLineForProviderEventTx({
      event,
      lineLookupKey: projectionLineLookupKey,
      prisma: input.prisma,
    });
  }

  const alertIds = await claimHostedLinqAlertsForProviderEventTx({
    deliveryId: deliveryReceipt.deliveryId ?? outboundEchoDelivery?.deliveryId ?? null,
    event,
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

function withoutHostedLinqParticipantAddedOwnerEvidence(
  event: ParsedHostedLinqProviderEvent,
): ParsedHostedLinqProviderEvent {
  const operationalEvent = { ...event };
  delete operationalEvent.participantAddedOwnerEvidence;
  return operationalEvent;
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
  const created = await input.prisma.hostedLinqAlert.createMany({
    data: {
      claimedAt: new Date(),
      deliveryId: input.deliveryId,
      detailsJson: buildHostedLinqAlertDetailsJson(input.event),
      eventId: input.eventLookupKey,
      id,
      kind,
      phoneNumberHint: input.event.phoneNumberHint,
      phoneNumberLookupKey: input.lineLookupKey,
      status: "pending",
      subject: buildHostedLinqAlertSubject(kind, input.event),
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

function buildHostedLinqAlertSubject(
  kind: string,
  event: ParsedHostedLinqProviderEvent,
): string {
  const line = event.phoneNumberHint ? ` ${event.phoneNumberHint}` : "";
  if (kind === "message_failed") {
    return `[Murph] Linq message failed${line}`;
  }

  return `[Murph] Linq line status updated${line}`;
}

function buildHostedLinqAlertDetailsJson(event: ParsedHostedLinqProviderEvent): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify({
    actionTaken: "recorded_only_no_routing_failover",
    deliveryStatus: event.deliveryStatus,
    eventIdSuffix: toHostedOnboardingLogIdSuffix(event.eventId),
    eventType: event.eventType,
    failureCode: event.failureCode,
    failureReason: event.failureReason,
    line: event.phoneNumberHint,
    phoneNumberRole: event.phoneNumberRole,
    providerCreatedAt: event.providerCreatedAt.toISOString(),
    providerReason: event.providerReason,
    providerStatus: event.providerStatus,
    service: event.service,
  })) as Prisma.InputJsonValue;
}

function buildHostedLinqAlertId(kind: string, eventId: string): string {
  return `hla_${kind}_${sha256Hex(`${kind}:${eventId}`).slice(0, 32)}`;
}
