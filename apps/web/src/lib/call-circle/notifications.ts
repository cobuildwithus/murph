import "server-only";

import { Prisma } from "@prisma/client";
import type {
  HostedExecutionAssistantNotificationRoute,
} from "@murphai/hosted-execution";
import { isHostedCallCircleTimeZone } from "@murphai/hosted-execution/call-circle";

import {
  appendHostedAssistantNotificationTx,
  resolveHostedAssistantNotificationTargetTx,
  type HostedAssistantNotificationSignal,
} from "../hosted-execution/assistant-notifications";
import {
  hasHostedLinqInboundWithinDays,
} from "../hosted-onboarding/linq-daily-state";
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

type CallCircleTerminalNotificationKind = "handoff" | "outcome";

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
  groupId: string;
  memberId: string;
  now: Date;
  offerId?: string;
  tx: Prisma.TransactionClient;
}): Promise<CallCircleNotificationAppendResult | null> {
  const participantCount = await input.tx.hostedCallCircleParticipant.count({
    where: {
      ...activeCallCircleParticipantWhere({
        groupId: input.groupId,
        memberId: input.memberId,
      }),
      preferencesJson: { equals: Prisma.DbNull },
    },
  });
  if (participantCount !== 1) return null;
  const preflight = await readCallCircleNotificationPreflightTx({
    memberId: input.memberId,
    now: input.now,
    requireDaytime: false,
    tx: input.tx,
  });
  if (preflight.status !== "ok") return preflight;
  return appendCallCircleNotificationTx({
    eventId: buildCallCircleSetupNotificationEventId({
      groupId: input.groupId,
      memberId: input.memberId,
      offerId: input.offerId,
    }),
    instructions:
      "Tell the member Call Circle is ready for this group. Ask: Want to take part in short matched calls? Reply yes with days and times that usually work, or no to pause.",
    memberId: input.memberId,
    now: input.now,
    preflight,
    tx: input.tx,
  });
}

function buildCallCircleSetupNotificationEventId(input: {
  groupId: string;
  memberId: string;
  offerId?: string;
}): string {
  const prefix = buildCallCircleSetupNotificationEventIdPrefix(input);
  return input.offerId
    ? `${prefix}:offer:${input.offerId}`
    : prefix;
}

export function buildCallCircleSetupNotificationEventIdPrefix(input: {
  groupId: string;
  memberId: string;
}): string {
  return `${CALL_CIRCLE_NOTIFICATION_EVENT_ID_PREFIX}:setup:${input.groupId}:${input.memberId}`;
}

export function readCallCircleSetupNotificationGroupId(input: {
  eventId: string;
  memberId: string;
}): string | null {
  const prefix = `${CALL_CIRCLE_NOTIFICATION_EVENT_ID_PREFIX}:setup:`;
  if (!input.eventId.startsWith(prefix)) return null;
  const segments = input.eventId.slice(prefix.length).split(":");
  const [groupId, memberId, suffixKind, suffixId] = segments;
  if (!groupId || memberId !== input.memberId) return null;
  if (segments.length === 2) return groupId;
  return segments.length === 4 && suffixKind === "offer" && suffixId
    ? groupId
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
    timeZone: input.timeZone,
    tx: input.tx,
  });
  if (preflight.status !== "ok") return null;
  return appendCallCircleNotificationTx({
    eventId: buildCallCircleTerminalNotificationEventId(input),
    instructions: input.kind === "outcome"
      ? "Tell the member the Call Circle call is complete."
      : "Tell the member the Call Circle bridge could not start. Ask: Want help sending a quick text to continue instead? Reply yes or no.",
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
  const notifications = await Promise.all([
    appendCallCircleTerminalNotificationIfReachableTx({
      groupId: input.groupId,
      kind: input.kind,
      matchId: input.matchId,
      memberId: input.memberAId,
      now: input.now,
      timeZone: timeZones.memberATimeZone,
      tx: input.tx,
    }),
    appendCallCircleTerminalNotificationIfReachableTx({
      groupId: input.groupId,
      kind: input.kind,
      matchId: input.matchId,
      memberId: input.memberBId,
      now: input.now,
      timeZone: timeZones.memberBTimeZone,
      tx: input.tx,
    }),
  ]);
  return notifications.flatMap((notification, index) => {
    if (!notification) return [];
    const signal = readCallCircleNotificationSignal({
      memberId: index === 0 ? input.memberAId : input.memberBId,
      notification,
    });
    return signal ? [signal] : [];
  });
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
