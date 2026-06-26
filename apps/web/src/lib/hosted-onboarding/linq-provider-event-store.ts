import type { Prisma, PrismaClient } from "@prisma/client";

import { applyHostedLinqDeliveryReceiptTx } from "./linq-delivery-store";
import {
  applyHostedLinqConversationDeliveryReceiptTx,
} from "./linq-conversation-state";
import {
  ensureHostedLinqLineForProviderEventTx,
  projectHostedLinqLineForProviderEventTx,
} from "./linq-line-store";
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
  const lineLookupKey = await ensureHostedLinqLineForProviderEventTx({
    event: input.event,
    prisma: input.prisma,
  });
  const created = await input.prisma.hostedLinqProviderEvent.createMany({
    data: {
      apiVersion: input.event.apiVersion,
      deliveryStatus: input.event.deliveryStatus,
      direction: input.event.direction,
      eventId: input.event.eventId,
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
      phoneNumberLookupKey: input.event.phoneNumberLookupKey,
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
  const staleDeliveryReceipt = deliveryReceipt.deliveryId !== null && !deliveryReceipt.advanced;
  if (!staleDeliveryReceipt) {
    await applyHostedLinqConversationDeliveryReceiptTx({
      event: input.event,
      prisma: input.prisma,
    });
  }
  const lineProjectionAdvanced = staleDeliveryReceipt
    ? false
    : await projectHostedLinqLineForProviderEventTx({
      event: input.event,
      lineLookupKey,
      prisma: input.prisma,
    });
  if (staleDeliveryReceipt || isStaleStatusProjection(input.event, lineProjectionAdvanced)) {
    return {
      alertIds: [],
      duplicate: false,
    };
  }

  const alertIds = await claimHostedLinqAlertsForProviderEventTx({
    deliveryId: deliveryReceipt.deliveryId,
    event: input.event,
    prisma: input.prisma,
  });

  return {
    alertIds,
    duplicate: false,
  };
}

function isStaleStatusProjection(
  event: ParsedHostedLinqProviderEvent,
  lineProjectionAdvanced: boolean,
): boolean {
  return event.eventType === "phone_number.status_updated" && !lineProjectionAdvanced;
}

async function claimHostedLinqAlertsForProviderEventTx(input: {
  deliveryId: string | null;
  event: ParsedHostedLinqProviderEvent;
  prisma: HostedLinqProviderEventClient;
}): Promise<string[]> {
  const kind = resolveHostedLinqAlertKind(input.event);
  if (!kind) {
    return [];
  }

  const id = buildHostedLinqAlertId(kind, input.event.eventId);
  const created = await input.prisma.hostedLinqAlert.createMany({
    data: {
      claimedAt: new Date(),
      deliveryId: input.deliveryId,
      detailsJson: buildHostedLinqAlertDetailsJson(input.event),
      eventId: input.event.eventId,
      id,
      kind,
      phoneNumberHint: input.event.phoneNumberHint,
      phoneNumberLookupKey: input.event.phoneNumberLookupKey,
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
