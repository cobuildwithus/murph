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

const HOSTED_LINQ_GROUP_JOIN_APPLICATION_LEGACY_PENDING = "pending";
const HOSTED_LINQ_GROUP_JOIN_APPLICATION_LEGACY_PENDING_V1 = "pending:v1";
const HOSTED_LINQ_GROUP_JOIN_APPLICATION_PENDING = "pending:v2";
const HOSTED_LINQ_GROUP_JOIN_APPLICATION_SUPERSEDED = "superseded:v1";
const HOSTED_LINQ_GROUP_JOIN_APPLICATION_APPLIED_PREFIX = "applied:";
export const HOSTED_LINQ_GROUP_JOIN_APPLICATION_CLAIM_SCHEMA =
  "murph.hosted-linq.group-join-application-claim.v2";

export interface HostedLinqGroupJoinApplicationClaim {
  groupId: string;
  groupRuntimeMemberId: string;
  memberId: string;
  membershipId: string | null;
  membershipSharingDecisionRevision: number | null;
  schema: typeof HOSTED_LINQ_GROUP_JOIN_APPLICATION_CLAIM_SCHEMA;
}

export type HostedLinqGroupJoinApplicationTxResult =
  | {
      eventLookupKey: string;
      kind: "pending";
      claim: HostedLinqGroupJoinApplicationClaim;
    }
  | {
      eventLookupKey: string;
      kind: "applied";
      membershipId: string;
    }
  | {
      eventLookupKey: string;
      kind: "superseded";
    }
  | { kind: "unavailable" };

export async function ingestHostedLinqProviderEventTx(input: {
  event: ParsedHostedLinqProviderEvent;
  groupJoinApplicationClaim?: HostedLinqGroupJoinApplicationClaim | null;
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
  const groupJoinApplicationClaim =
    isHostedLinqGroupJoinApplicationCandidate(input.event)
    && input.groupJoinApplicationClaim
      ? input.groupJoinApplicationClaim
      : null;
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
      // No default/backfill is intentional. A reaction becomes pending only
      // when its exact member, membership generation, and selected-share
      // authority were captured in this same receipt transaction. Rows written
      // by an older deployment stay null (or use the legacy bare-pending
      // state) and therefore fail closed during rollout instead of binding on
      // retry. The versioned state also makes older Web instances fail closed
      // on receipts written by this code: they recognize only exact "pending".
      ...(groupJoinApplicationClaim
        ? {
            groupJoinApplicationClaimJson:
              toHostedLinqGroupJoinApplicationClaimJson(groupJoinApplicationClaim),
            groupJoinApplicationState: HOSTED_LINQ_GROUP_JOIN_APPLICATION_PENDING,
          }
        : { groupJoinApplicationState: null }),
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
 * affirmation. A null application state or legacy bare "pending" is
 * intentionally not retryable: it identifies a provider-event row that never
 * bound the event to exact authority, and therefore fails closed.
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
      groupJoinApplicationClaimJson: true,
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
    const claim = readHostedLinqGroupJoinApplicationClaim(
      event.groupJoinApplicationClaimJson,
    );
    if (!claim) {
      await markHostedLinqGroupJoinApplicationSupersededTx({
        eventLookupKey,
        tx: input.tx,
      });
      return {
        eventLookupKey,
        kind: "superseded",
      };
    }
    return {
      claim,
      eventLookupKey,
      kind: "pending",
    };
  }
  if (
    event.groupJoinApplicationState === HOSTED_LINQ_GROUP_JOIN_APPLICATION_LEGACY_PENDING
    || event.groupJoinApplicationState
      === HOSTED_LINQ_GROUP_JOIN_APPLICATION_LEGACY_PENDING_V1
  ) {
    await transitionHostedLinqGroupJoinApplicationStateTx({
      eventLookupKey,
      fromState: event.groupJoinApplicationState,
      toState: HOSTED_LINQ_GROUP_JOIN_APPLICATION_SUPERSEDED,
      tx: input.tx,
    });
    return {
      eventLookupKey,
      kind: "superseded",
    };
  }
  if (event.groupJoinApplicationState === HOSTED_LINQ_GROUP_JOIN_APPLICATION_SUPERSEDED) {
    return {
      eventLookupKey,
      kind: "superseded",
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

export async function markHostedLinqGroupJoinApplicationSupersededTx(input: {
  eventLookupKey: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await transitionHostedLinqGroupJoinApplicationStateTx({
    eventLookupKey: input.eventLookupKey,
    fromState: HOSTED_LINQ_GROUP_JOIN_APPLICATION_PENDING,
    toState: HOSTED_LINQ_GROUP_JOIN_APPLICATION_SUPERSEDED,
    tx: input.tx,
  });
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
  await transitionHostedLinqGroupJoinApplicationStateTx({
    eventLookupKey: input.eventLookupKey,
    fromState: HOSTED_LINQ_GROUP_JOIN_APPLICATION_PENDING,
    toState: `${HOSTED_LINQ_GROUP_JOIN_APPLICATION_APPLIED_PREFIX}${membershipId}`,
    tx: input.tx,
  });
}

async function transitionHostedLinqGroupJoinApplicationStateTx(input: {
  eventLookupKey: string;
  fromState: string;
  toState: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const updated = await input.tx.hostedLinqProviderEvent.updateMany({
    where: {
      eventId: input.eventLookupKey,
      groupJoinApplicationState: input.fromState,
    },
    data: {
      groupJoinApplicationState: input.toState,
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

export function hostedLinqGroupJoinApplicationClaimsEqual(
  left: HostedLinqGroupJoinApplicationClaim,
  right: HostedLinqGroupJoinApplicationClaim,
): boolean {
  return left.schema === right.schema
    && left.groupId === right.groupId
    && left.groupRuntimeMemberId === right.groupRuntimeMemberId
    && left.memberId === right.memberId
    && left.membershipId === right.membershipId
    && left.membershipSharingDecisionRevision
      === right.membershipSharingDecisionRevision;
}

function isHostedLinqGroupJoinApplicationCandidate(
  event: ParsedHostedLinqProviderEvent,
): boolean {
  return isHostedLinqAffirmativeReaction({
    customEmoji: event.reactionCustomEmoji,
    eventType: event.eventType,
    reactionType: event.reactionType,
  })
    && Boolean(event.linqChatLookupKey)
    && Boolean(event.messageLookupKey)
    && Boolean(event.payloadHash);
}

function toHostedLinqGroupJoinApplicationClaimJson(
  claim: HostedLinqGroupJoinApplicationClaim,
): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(claim)) as Prisma.InputJsonValue;
}

function readHostedLinqGroupJoinApplicationClaim(
  value: Prisma.JsonValue | null,
): HostedLinqGroupJoinApplicationClaim | null {
  if (!isRecord(value)) {
    return null;
  }
  const groupId = readNonEmptyString(value.groupId);
  const groupRuntimeMemberId = readNonEmptyString(value.groupRuntimeMemberId);
  const memberId = readNonEmptyString(value.memberId);
  const membershipId = value.membershipId === null
    ? null
    : readNonEmptyString(value.membershipId);
  const membershipSharingDecisionRevision =
    value.membershipSharingDecisionRevision === null
      ? null
      : readNonNegativeInteger(value.membershipSharingDecisionRevision);
  if (
    value.schema !== HOSTED_LINQ_GROUP_JOIN_APPLICATION_CLAIM_SCHEMA
    || !groupId
    || !groupRuntimeMemberId
    || !memberId
    || (value.membershipId !== null && !membershipId)
    || (
      value.membershipSharingDecisionRevision !== null
      && membershipSharingDecisionRevision === null
    )
    || (membershipId === null) !== (membershipSharingDecisionRevision === null)
  ) {
    return null;
  }

  return {
    groupId,
    groupRuntimeMemberId,
    memberId,
    membershipId,
    membershipSharingDecisionRevision,
    schema: HOSTED_LINQ_GROUP_JOIN_APPLICATION_CLAIM_SCHEMA,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.trim() === value
    ? value
    : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
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
