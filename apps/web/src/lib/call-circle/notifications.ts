import "server-only";

import { Prisma } from "@prisma/client";
import type {
  HostedExecutionAssistantNotificationRoute,
} from "@murphai/hosted-execution";
import {
  isHostedCallCircleTimeZone,
} from "@murphai/hosted-execution/call-circle";

import {
  appendHostedAssistantNotificationTx,
  resolveHostedAssistantNotificationTargetTx,
  type HostedAssistantNotificationSignal,
} from "../hosted-execution/assistant-notifications";
import {
  hasHostedLinqInboundWithinDays,
} from "../hosted-onboarding/linq-daily-state";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import {
  activeCallCircleParticipantWhere,
  canUseActiveCallCircleParticipant,
  readCallCircleMatchParticipantTimeZones,
} from "./participant-store";
import {
  isWithinCallCircleDaytime,
} from "./time";

const CALL_CIRCLE_NOTIFICATION_EVENT_ID_PREFIX =
  "assistant.notification.requested:call-circle";
const CALL_CIRCLE_SUPERSEDED_NOTIFICATION_KIND =
  "assistant.notification.superseded";

type CallCircleNotificationAppendResult =
  | { mailboxItemId: string | null; status: "sent" }
  | {
      reason:
        | "line_unavailable"
        | "missing_route"
        | "missing_recent_inbound"
        | "missing_time_zone"
        | "quiet_hours";
      status: "blocked";
    };

type CallCircleTerminalNotificationKind =
  | "canceled"
  | "expired"
  | "handoff"
  | "outcome";

interface ExistingCallCircleNotificationSignal {
  exists: boolean;
  signal: HostedAssistantNotificationSignal | null;
}

export type CallCircleConfirmNotificationAnchor = {
  key: string;
  matchId: string;
  stage: "am" | "final";
  windowStartAt: Date;
};

export type CallCircleSetupNotificationAnchor = {
  enrollmentGeneration: number;
  groupId: string;
  participantId: string;
};

export function readCallCircleNotificationSignal(input: {
  memberId: string;
  notification: CallCircleNotificationAppendResult;
}): HostedAssistantNotificationSignal | null {
  if (input.notification.status !== "sent" || !input.notification.mailboxItemId) {
    return null;
  }
  return {
    mailboxItemId: input.notification.mailboxItemId,
    memberId: input.memberId,
  };
}

export async function readExistingCallCircleNotificationSignalTx(input: {
  eventId: string;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<ExistingCallCircleNotificationSignal> {
  const existing = await input.tx.hostedMailboxItem.findUnique({
    select: {
      consumedAt: true,
      id: true,
    },
    where: {
      userId_dedupeKey: {
        dedupeKey: input.eventId,
        userId: input.memberId,
      },
    },
  });
  if (!existing) {
    return { exists: false, signal: null };
  }
  if (existing.consumedAt) {
    return { exists: true, signal: null };
  }
  return {
    exists: true,
    signal: {
      mailboxItemId: existing.id,
      memberId: input.memberId,
    },
  };
}

export async function appendCallCircleSetupNotificationTx(input: {
  enrollmentGeneration: number;
  groupId: string;
  memberId: string;
  now: Date;
  participantId: string;
  requireDaytime?: boolean;
  timeZone?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<CallCircleNotificationAppendResult | null> {
  await lockHostedMemberRow(input.tx, input.memberId);
  const participantCount = await input.tx.hostedCallCircleParticipant.count({
    where: {
      ...activeCallCircleParticipantWhere({
        groupId: input.groupId,
        memberId: input.memberId,
      }),
      enrollmentGeneration: input.enrollmentGeneration,
      id: input.participantId,
      preferencesJson: { equals: Prisma.DbNull },
    },
  });
  if (participantCount !== 1) return null;
  const preflight = await readCallCircleNotificationPreflightTx({
    memberId: input.memberId,
    now: input.now,
    requireDaytime: input.requireDaytime ?? false,
    timeZone: input.timeZone,
    tx: input.tx,
  });
  if (preflight.status !== "ok") return preflight;
  return appendCallCircleNotificationTx({
    eventId: buildCallCircleSetupNotificationEventId({
      enrollmentGeneration: input.enrollmentGeneration,
      groupId: input.groupId,
      memberId: input.memberId,
      participantId: input.participantId,
    }),
    instructions:
      "Tell the member Call Circle is ready for this group. Ask: Want to take part in short matched calls? Reply yes with days and times that usually work, or no to pause.",
    memberId: input.memberId,
    now: input.now,
    preflight,
    tx: input.tx,
  });
}

export function buildCallCircleSetupNotificationEventId(input: {
  enrollmentGeneration: number;
  groupId: string;
  memberId: string;
  participantId: string;
}): string {
  const prefix = buildCallCircleSetupNotificationEventIdPrefix(input);
  return [
    prefix,
    "participant",
    input.participantId,
    "enrollment",
    input.enrollmentGeneration,
  ].join(":");
}

export function buildCallCircleSetupNotificationEventIdPrefix(input: {
  groupId: string;
  memberId: string;
}): string {
  return `${CALL_CIRCLE_NOTIFICATION_EVENT_ID_PREFIX}:setup:${input.groupId}:${input.memberId}`;
}

export function readCallCircleSetupNotificationAnchor(input: {
  eventId: string;
  memberId: string;
}): CallCircleSetupNotificationAnchor | null {
  const prefix = `${CALL_CIRCLE_NOTIFICATION_EVENT_ID_PREFIX}:setup:`;
  if (!input.eventId.startsWith(prefix)) return null;
  const segments = input.eventId.slice(prefix.length).split(":");
  const [
    groupId,
    memberId,
    participantKind,
    participantId,
    suffixKind,
    suffixId,
  ] = segments;
  if (!groupId || memberId !== input.memberId) return null;
  if (
    segments.length !== 6
    || participantKind !== "participant"
    || !participantId
    || suffixKind !== "enrollment"
    || !/^[1-9]\d*$/.test(suffixId ?? "")
  ) {
    return null;
  }
  const enrollmentGeneration = Number(suffixId);
  return Number.isSafeInteger(enrollmentGeneration)
    ? { enrollmentGeneration, groupId, participantId }
    : null;
}

export async function appendCallCircleConfirmNotificationTx(input: {
  matchId: string;
  memberId: string;
  now: Date;
  preflight: { route: HostedExecutionAssistantNotificationRoute; status: "ok" };
  stage: "am" | "final";
  tx: Prisma.TransactionClient;
  windowLabel: string;
  windowStartAt: Date;
}): Promise<CallCircleNotificationAppendResult> {
  const stageLabel = input.stage === "am" ? "today" : "soon";
  return appendCallCircleNotificationTx({
    eventId: buildCallCircleConfirmNotificationEventId({
      matchId: input.matchId,
      memberId: input.memberId,
      stage: input.stage,
      windowStartAt: input.windowStartAt,
    }),
    instructions:
      `Ask: Does ${input.windowLabel} ${stageLabel} still work for a short Call Circle call with the matched group member? Reply yes or no. Record the answer with murph.call_circle_respond.`,
    memberId: input.memberId,
    now: input.now,
    preflight: input.preflight,
    tx: input.tx,
  });
}

function buildCallCircleConfirmNotificationEventId(input: {
  matchId: string;
  memberId: string;
  stage: "am" | "final";
  windowStartAt: Date;
}): string {
  return [
    CALL_CIRCLE_NOTIFICATION_EVENT_ID_PREFIX,
    input.stage,
    input.matchId,
    input.memberId,
    input.windowStartAt.toISOString(),
  ].join(":");
}

export function readCallCircleConfirmNotificationAnchor(input: {
  eventId: string;
  memberId: string;
}): CallCircleConfirmNotificationAnchor | null {
  for (const stage of ["am", "final"] as const) {
    const prefix = `${CALL_CIRCLE_NOTIFICATION_EVENT_ID_PREFIX}:${stage}:`;
    if (!input.eventId.startsWith(prefix)) continue;
    const remainder = input.eventId.slice(prefix.length);
    const memberMarker = `:${input.memberId}:`;
    const memberIndex = remainder.indexOf(memberMarker);
    if (memberIndex <= 0) return null;
    const matchId = remainder.slice(0, memberIndex).trim();
    const windowStartAt = remainder.slice(memberIndex + memberMarker.length).trim();
    const parsedWindowStartAt = new Date(windowStartAt);
    if (!matchId || Number.isNaN(parsedWindowStartAt.getTime())) return null;
    return {
      key: `${stage}:${matchId}:${windowStartAt}`,
      matchId,
      stage,
      windowStartAt: parsedWindowStartAt,
    };
  }
  return null;
}

export async function supersedeCallCircleNotificationsTx(input: {
  groupId?: string;
  matches?: readonly {
    id: string;
    memberAId: string;
    memberBId: string;
  }[];
  now: Date;
  setupMemberIds?: readonly string[];
  tx: Prisma.TransactionClient;
}): Promise<number> {
  const groupId = input.groupId;
  const setupFilters = [...new Set(input.setupMemberIds ?? [])].sort().map((memberId) => ({
        dedupeKey: {
          startsWith: groupId
            ? buildCallCircleSetupNotificationEventIdPrefix({ groupId, memberId })
            : `${CALL_CIRCLE_NOTIFICATION_EVENT_ID_PREFIX}:setup:`,
        },
        userId: memberId,
      }));
  const confirmFilters = (input.matches ?? []).flatMap((match) =>
    [...new Set([match.memberAId, match.memberBId])].sort().flatMap((memberId) =>
      (["am", "final"] as const).map((stage) => ({
        dedupeKey: {
          startsWith: `${CALL_CIRCLE_NOTIFICATION_EVENT_ID_PREFIX}:${stage}:${match.id}:${memberId}:`,
        },
        userId: memberId,
      })),
    ),
  );
  const filters = [...setupFilters, ...confirmFilters];
  if (filters.length === 0) return 0;

  const result = await input.tx.hostedMailboxItem.updateMany({
    data: {
      consumedAt: input.now,
      kind: CALL_CIRCLE_SUPERSEDED_NOTIFICATION_KIND,
    },
    where: {
      consumedAt: null,
      kind: "assistant.notification.requested",
      OR: filters,
    },
  });
  return result.count;
}

export function buildCallCircleTerminalNotificationEventId(input: {
  kind: CallCircleTerminalNotificationKind;
  matchId: string;
  memberId: string;
}): string {
  return `${CALL_CIRCLE_NOTIFICATION_EVENT_ID_PREFIX}:${input.kind}:${input.matchId}:${input.memberId}`;
}

export async function appendCallCircleTerminalNotificationIfReachableTx(input: {
  groupId: string;
  kind: CallCircleTerminalNotificationKind;
  matchId: string;
  memberId: string;
  now: Date;
  timeZone: string;
  tx: Prisma.TransactionClient;
}): Promise<CallCircleNotificationAppendResult | null> {
  if (!await canUseActiveCallCircleParticipant({
    groupId: input.groupId,
    memberId: input.memberId,
    prisma: input.tx,
  })) {
    return null;
  }
  const preflight = await readCallCircleNotificationPreflightTx({
    memberId: input.memberId,
    now: input.now,
    requireDaytime: input.kind !== "handoff",
    timeZone: input.timeZone,
    tx: input.tx,
  });
  if (preflight.status !== "ok") return null;
  return appendCallCircleNotificationTx({
    eventId: buildCallCircleTerminalNotificationEventId(input),
    instructions: readCallCircleTerminalNotificationInstructions(input.kind),
    memberId: input.memberId,
    now: input.now,
    preflight,
    tx: input.tx,
  });
}

export async function appendCallCircleTerminalNotificationsTx(input: {
  groupId: string;
  kind: CallCircleTerminalNotificationKind;
  matchId: string;
  memberAId: string;
  memberBId: string;
  memberIds?: readonly string[];
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedAssistantNotificationSignal[]> {
  const timeZones = await readCallCircleMatchParticipantTimeZones({
    groupId: input.groupId,
    memberAId: input.memberAId,
    memberBId: input.memberBId,
    prisma: input.tx,
  });
  if (!timeZones) return [];
  const requestedMemberIds = new Set(
    input.memberIds ?? [input.memberAId, input.memberBId],
  );
  const recipients = [
    { memberId: input.memberAId, timeZone: timeZones.memberATimeZone },
    { memberId: input.memberBId, timeZone: timeZones.memberBTimeZone },
  ].filter((recipient) => requestedMemberIds.has(recipient.memberId));
  const notifications = await Promise.all(recipients.map((recipient) =>
    appendCallCircleTerminalNotificationIfReachableTx({
      groupId: input.groupId,
      kind: input.kind,
      matchId: input.matchId,
      memberId: recipient.memberId,
      now: input.now,
      timeZone: recipient.timeZone,
      tx: input.tx,
    })
  ));
  return notifications.flatMap((notification, index) => {
    const recipient = recipients[index];
    if (!notification || !recipient) return [];
    const signal = readCallCircleNotificationSignal({
      memberId: recipient.memberId,
      notification,
    });
    return signal ? [signal] : [];
  });
}

function readCallCircleTerminalNotificationInstructions(
  kind: CallCircleTerminalNotificationKind,
): string {
  switch (kind) {
    case "canceled":
      return "Tell the member this Call Circle match could not go ahead, so no call will start.";
    case "expired":
      return "Tell the member this Call Circle match expired before both people could confirm, so no call will start.";
    case "handoff":
      return "Tell the member the Call Circle bridge could not start. Ask: Want help sending a quick text to continue instead? Reply yes or no.";
    case "outcome":
      return "Tell the member the Call Circle call is complete.";
  }
}

export async function readCallCircleNotificationPreflightTx(input: {
  memberId: string;
  now: Date;
  requireDaytime?: boolean;
  timeZone?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<
  | { route: HostedExecutionAssistantNotificationRoute; status: "ok" }
  | Exclude<CallCircleNotificationAppendResult, { status: "sent" }>
> {
  const target = await resolveHostedAssistantNotificationTargetTx({
    memberId: input.memberId,
    tx: input.tx,
  });
  const route = target.route;
  if (!route) {
    return { reason: "missing_route", status: "blocked" };
  }
  if (route.channel === "linq" && route.delivery.kind === "participant") {
    return { reason: "missing_route", status: "blocked" };
  }
  if (input.requireDaytime !== false) {
    if (!input.timeZone || !isHostedCallCircleTimeZone(input.timeZone)) {
      return { reason: "missing_time_zone", status: "blocked" };
    }
    if (!isWithinCallCircleDaytime({
      now: input.now,
      timeZone: input.timeZone,
    })) {
      return { reason: "quiet_hours", status: "blocked" };
    }
  }
  if (route.channel !== "linq") {
    return { route, status: "ok" };
  }
  const hasRecentInbound = await hasHostedLinqInboundWithinDays({
    memberId: input.memberId,
    now: input.now,
    prisma: input.tx,
  });
  if (!hasRecentInbound) {
    return {
      reason: "missing_recent_inbound",
      status: "blocked",
    };
  }
  if (!target.linqSourceLineLookupKey) {
    return { reason: "line_unavailable", status: "blocked" };
  }
  const line = await input.tx.hostedLinqLine.findUnique({
    select: { phoneNumberLookupKey: true },
    where: {
      phoneNumberLookupKey: target.linqSourceLineLookupKey,
      configuredAt: { not: null },
      egressPolicy: "enabled",
      healthStatus: { in: ["healthy", "unknown"] },
    },
  });
  if (!line) {
    return { reason: "line_unavailable", status: "blocked" };
  }
  return { route, status: "ok" };
}

async function appendCallCircleNotificationTx(input: {
  eventId: string;
  instructions: string;
  memberId: string;
  now: Date;
  preflight: { route: HostedExecutionAssistantNotificationRoute; status: "ok" };
  tx: Prisma.TransactionClient;
}): Promise<CallCircleNotificationAppendResult> {
  const append = await appendHostedAssistantNotificationTx({
    eventId: input.eventId,
    instructions: input.instructions,
    memberId: input.memberId,
    occurredAt: input.now.toISOString(),
    responsePolicy: { kind: "require_send" },
    route: input.preflight.route,
    tx: input.tx,
  });
  return { mailboxItemId: append.mailboxItemId, status: "sent" };
}
