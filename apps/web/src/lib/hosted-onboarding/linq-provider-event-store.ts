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
  isHostedLinqAffirmativeReaction,
  type ParsedHostedLinqProviderEvent,
} from "./linq-provider-events";
import { toHostedOnboardingLogIdSuffix } from "./logging";
import { sha256Hex } from "../primitives";

type HostedLinqProviderEventClient = PrismaClient | Prisma.TransactionClient;

const HOSTED_LINQ_GROUP_JOIN_APPLICATION_PENDING = "pending";
const HOSTED_LINQ_GROUP_JOIN_APPLICATION_APPLIED_PREFIX = "applied:";

export type HostedLinqGroupJoinApplicationTxResult =
  | {
      eventLookupKey: string;
      kind: typeof HOSTED_LINQ_GROUP_JOIN_APPLICATION_PENDING;
    }
  | {
      eventLookupKey: string;
      kind: "applied";
      membershipId: string;
    }
  | { kind: "unavailable" };

export async function ingestHostedLinqProviderEventTx(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: HostedLinqProviderEventClient;
  receivedAt?: Date;
}): Promise<{
  alertIds: string[];
  duplicate: boolean;
  restoreOnboardingLink?: NonNullable<
    Awaited<ReturnType<typeof applyHostedLinqDeliveryReceiptTx>>["restoreOnboardingLink"]
  >;
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
      // No default/backfill is intentional. Only new reaction rows with the
      // complete immutable context required by the join transaction are
      // pending. Rows written by an older deployment stay null and therefore
      // cannot be mistaken for unconsumed affirmations during rollout.
      groupJoinApplicationState: isHostedLinqAffirmativeReaction({
        customEmoji: input.event.reactionCustomEmoji,
        eventType: input.event.eventType,
        reactionType: input.event.reactionType,
      })
        && input.event.linqChatLookupKey
        && input.event.messageLookupKey
        && input.event.payloadHash
        ? HOSTED_LINQ_GROUP_JOIN_APPLICATION_PENDING
        : null,
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
    ...(deliveryReceipt.restoreOnboardingLink
      ? { restoreOnboardingLink: deliveryReceipt.restoreOnboardingLink }
      : {}),
  };
}

/**
 * Locks and validates the one durable owner for applying a Linq join
 * affirmation. A null application state is intentionally not pending: it
 * identifies provider-event rows written before this owner existed (or by an
 * older deployment during rollout), and therefore fails closed.
 */
export async function lockHostedLinqGroupJoinApplicationTx(input: {
  eventId: string;
  linqChatLookupKeyReadCandidates: readonly string[];
  messageLookupKeyReadCandidates: readonly string[];
  payloadHash: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedLinqGroupJoinApplicationTxResult> {
  const eventLookupKey = createHostedLinqProviderEventLookupKey(input.eventId);
  const linqChatLookupKeyReadCandidates = normalizeHostedLinqLookupKeyCandidates(
    input.linqChatLookupKeyReadCandidates,
  );
  const messageLookupKeyReadCandidates = normalizeHostedLinqLookupKeyCandidates(
    input.messageLookupKeyReadCandidates,
  );
  const payloadHash = input.payloadHash.trim();
  if (
    linqChatLookupKeyReadCandidates.length === 0
    || messageLookupKeyReadCandidates.length === 0
    || payloadHash.length === 0
  ) {
    return { kind: "unavailable" };
  }

  await input.tx.$queryRaw`
    SELECT 1
    FROM "hosted_linq_provider_event"
    WHERE "event_id" = ${eventLookupKey}
    FOR UPDATE
  `;
  const event = await input.tx.hostedLinqProviderEvent.findUnique({
    where: { eventId: eventLookupKey },
    select: {
      eventType: true,
      groupJoinApplicationState: true,
      linqChatLookupKey: true,
      messageLookupKey: true,
      payloadHash: true,
    },
  });
  if (
    !event
    || event.eventType !== "reaction.added"
    || !event.linqChatLookupKey
    || !linqChatLookupKeyReadCandidates.includes(event.linqChatLookupKey)
    || !event.messageLookupKey
    || !messageLookupKeyReadCandidates.includes(event.messageLookupKey)
    || event.payloadHash !== payloadHash
  ) {
    return { kind: "unavailable" };
  }
  if (event.groupJoinApplicationState === HOSTED_LINQ_GROUP_JOIN_APPLICATION_PENDING) {
    return {
      eventLookupKey,
      kind: HOSTED_LINQ_GROUP_JOIN_APPLICATION_PENDING,
    };
  }
  const appliedMembershipId = readHostedLinqGroupJoinAppliedMembershipId(
    event.groupJoinApplicationState,
  );
  if (appliedMembershipId) {
    return {
      eventLookupKey,
      kind: "applied",
      membershipId: appliedMembershipId,
    };
  }
  return { kind: "unavailable" };
}

export async function markHostedLinqGroupJoinApplicationAppliedTx(input: {
  eventLookupKey: string;
  membershipId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const membershipId = input.membershipId.trim();
  if (!membershipId) {
    throw new Error("Hosted Linq group join application requires a membership id.");
  }
  const updated = await input.tx.hostedLinqProviderEvent.updateMany({
    where: {
      eventId: input.eventLookupKey,
      groupJoinApplicationState: HOSTED_LINQ_GROUP_JOIN_APPLICATION_PENDING,
    },
    data: {
      groupJoinApplicationState:
        `${HOSTED_LINQ_GROUP_JOIN_APPLICATION_APPLIED_PREFIX}${membershipId}`,
    },
  });
  if (updated.count !== 1) {
    throw new Error("Hosted Linq group join application state changed unexpectedly.");
  }
}

function readHostedLinqGroupJoinAppliedMembershipId(
  value: string | null,
): string | null {
  if (!value?.startsWith(HOSTED_LINQ_GROUP_JOIN_APPLICATION_APPLIED_PREFIX)) {
    return null;
  }
  const membershipId = value.slice(
    HOSTED_LINQ_GROUP_JOIN_APPLICATION_APPLIED_PREFIX.length,
  );
  return membershipId.length > 0 ? membershipId : null;
}

function normalizeHostedLinqLookupKeyCandidates(
  values: readonly (string | null | undefined)[],
): string[] {
  return [...new Set(values
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0))];
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
