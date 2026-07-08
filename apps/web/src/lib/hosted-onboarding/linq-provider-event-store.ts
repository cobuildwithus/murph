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
}> {
  const receivedAt = input.receivedAt ?? new Date();
  const eventLookupKey = createHostedLinqProviderEventLookupKey(input.event.eventId);
  const lineLookupKey = await ensureHostedLinqLineForProviderEventTx({
    event: input.event,
    prisma: input.prisma,
  });
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
      providerStatus: input.event.providerStatus,
      receivedAt,
      service: input.event.service,
      traceIdSuffix: input.event.traceIdSuffix,
      webhookVersion: input.event.webhookVersion,
    },
    skipDuplicates: true,
  });

  if (created.count === 0) {
    return {
      alertIds: [],
      duplicate: true,
    };
  }

  const deliveryReceipt = await applyHostedLinqDeliveryReceiptTx({
    event: input.event,
    prisma: input.prisma,
  });
  if (deliveryReceipt.reopenOnboardingLink) {
    await releaseHostedLinqOnboardingLinkNoticeClaim({
      memberId: deliveryReceipt.reopenOnboardingLink.memberId,
      occurredAt: deliveryReceipt.reopenOnboardingLink.occurredAt,
      prisma: input.prisma,
    });
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
  // Delivery/line projections are monotonic derived state. The provider-event
  // ledger remains the duplicate gate for event-scoped alerting below.
  if (!staleDeliveryReceipt && !outboundEchoDelivery?.runtimeOwned) {
    await projectHostedLinqLineForProviderEventTx({
      event: input.event,
      lineLookupKey: projectionLineLookupKey,
      prisma: input.prisma,
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
  };
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
    case "message.received":
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
