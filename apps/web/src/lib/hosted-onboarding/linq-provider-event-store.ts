import type { Prisma, PrismaClient } from "@prisma/client";

import {
  applyHostedLinqDeliveryReceiptTx,
  CLINICAL_LINQ_DELIVERY_TEMPLATE,
  readHostedLinqDeliveryForProviderMessageTx,
  readHostedLinqReceiptOwnerTx,
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
  projectHostedLinqChatHealthTx,
  projectHostedLinqLineProviderStateTx,
} from "./linq-provider-health-store";
import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";
import { toHostedOnboardingLogIdSuffix } from "./logging";
import { sha256Hex } from "../primitives";
import { createHostedLinqChatLookupKeyReadCandidates } from "./contact-privacy";
import { lockHostedLinqProviderReceiptTx } from "./linq-message-receipt-lock";

type HostedLinqProviderEventClient = PrismaClient | Prisma.TransactionClient;

async function projectReceiptReasons(event: ParsedHostedLinqProviderEvent, prisma: HostedLinqProviderEventClient) {
  if ((!event.failureReason && !event.providerReason) ||
      !["message.sent", "message.delivered", "message.failed"].includes(event.eventType)) return { event };
  // Sent receipts do not lock the message. Read pending dispatches first so
  // acceptance cannot move a clinical delivery out of view between the reads.
  const pendingBeforeOwner = event.eventType === "message.sent"
    ? await hasPendingClinicalDispatch(event.linqChatId, prisma) : undefined;
  const owner = await readHostedLinqReceiptOwnerTx(event, prisma);
  const redact = owner
    ? owner.delivery.template === CLINICAL_LINQ_DELIVERY_TEMPLATE
    : pendingBeforeOwner ?? await hasPendingClinicalDispatch(event.linqChatId, prisma);
  return { owner, event: redact ? { ...event, failureReason: null, providerReason: null } : event };
}

async function hasPendingClinicalDispatch(chatId: string | null, prisma: HostedLinqProviderEventClient) {
  const pending = await prisma.hostedLinqDelivery.findFirst({
    where: {
      template: CLINICAL_LINQ_DELIVERY_TEMPLATE, status: "provider_dispatch_started",
      ...(chatId ? { linqChatLookupKey: { in: createHostedLinqChatLookupKeyReadCandidates(chatId) } } : {}),
    },
    select: { id: true },
  });
  return pending !== null;
}

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
  await lockHostedLinqProviderReceiptTx(input);
  const { event, owner } = await projectReceiptReasons(input.event, input.prisma);
  const health = event.providerHealth ?? {
    chat: null,
    line: null,
  };
  const eventLookupKey = createHostedLinqProviderEventLookupKey(event.eventId);
  let lineLookupKey = await ensureHostedLinqLineForProviderEventTx({
    event,
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
      providerReputationStatus: health.line?.reputationStatus ?? null,
      providerServiceStatus: health.line?.serviceStatus ?? null,
      providerStatus: event.providerStatus,
      chatHealthStatus: health.chat?.providerStatus ?? null,
      chatHealthUpdatedAt: health.chat?.providerUpdatedAt ?? null,
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
    const replayDurableReactionProjection = Boolean(existing)
      && !existing?.groupJoinOfferHandledAt
      && (
        event.eventType === "reaction.added"
        || event.eventType === "reaction.removed"
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
    event, owner,
    prisma: input.prisma,
  });
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
  // Delivery projections remain Murph-observed state. Linq's line service and
  // reputation snapshot is projected independently below.
  if (
    event.eventType !== "phone_number.status_updated"
    && !staleDeliveryReceipt
    && !outboundEchoDelivery?.runtimeOwned
  ) {
    await projectHostedLinqLineForProviderEventTx({
      event,
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
