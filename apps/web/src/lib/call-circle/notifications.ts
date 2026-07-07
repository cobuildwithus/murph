import "server-only";

import type { Prisma } from "@prisma/client";
import type {
  HostedExecutionAssistantNotificationRoute,
} from "@murphai/hosted-execution";

import {
  appendHostedAssistantNotificationTx,
  resolveHostedAssistantNotificationRouteTx,
} from "../hosted-execution/assistant-notifications";
import {
  hasHostedLinqInboundWithinDays,
} from "../hosted-onboarding/linq-daily-state";
import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import {
  isWithinCallCircleQuietHours,
  normalizeCallCircleTimeZone,
} from "./time";

export type CallCircleNotificationAppendResult =
  | { mailboxItemId: string | null; status: "sent" }
  | {
      reason:
        | "line_unavailable"
        | "missing_route"
        | "missing_recent_inbound"
        | "quiet_hours";
      status: "blocked";
    };

export interface CallCircleNotificationSignal {
  mailboxItemId: string;
  memberId: string;
}

export interface ExistingCallCircleNotificationSignal {
  exists: boolean;
  signal: CallCircleNotificationSignal | null;
}

export function readCallCircleNotificationSignal(input: {
  memberId: string;
  notification: CallCircleNotificationAppendResult;
}): CallCircleNotificationSignal | null {
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

export async function signalCallCircleNotificationRuntimesBestEffort(
  signals: readonly (CallCircleNotificationSignal | null | undefined)[],
): Promise<void> {
  await Promise.all(signals.map(async (signal) => {
    if (!signal) return;
    try {
      await signalHostedMailboxAppendRuntime({
        expectedUserId: signal.memberId,
        mailboxItemId: signal.mailboxItemId,
      });
    } catch {
      // The mailbox item is durable; runtime reconciliation can pick it up later.
    }
  }));
}

export async function appendCallCircleSetupNotificationTx(input: {
  groupId: string;
  memberId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<CallCircleNotificationAppendResult> {
  return appendCallCircleNotificationTx({
    eventId: buildCallCircleSetupNotificationEventId({
      groupId: input.groupId,
      memberId: input.memberId,
    }),
    instructions:
      "Tell the member Call Circle is ready for this group. Ask: Want to take part in short matched calls? Reply yes with days and times that usually work, or no to pause.",
    memberId: input.memberId,
    now: input.now,
    tx: input.tx,
  });
}

export function buildCallCircleSetupNotificationEventId(input: {
  groupId: string;
  memberId: string;
}): string {
  return `assistant.notification.requested:call-circle:setup:${input.groupId}:${input.memberId}`;
}

export async function appendCallCircleConfirmNotificationTx(input: {
  matchId: string;
  memberId: string;
  now: Date;
  otherMemberLabel?: string | null;
  preflight?: { route: HostedExecutionAssistantNotificationRoute; status: "ok" };
  stage: "am" | "final";
  tx: Prisma.TransactionClient;
  windowLabel: string;
  windowStartAt: Date;
}): Promise<CallCircleNotificationAppendResult> {
  const stageLabel = input.stage === "am" ? "today" : "soon";
  const otherMember = normalizeLabel(input.otherMemberLabel) ?? "the matched group member";
  return appendCallCircleNotificationTx({
    eventId: buildCallCircleConfirmNotificationEventId({
      matchId: input.matchId,
      memberId: input.memberId,
      stage: input.stage,
      windowStartAt: input.windowStartAt,
    }),
    instructions:
      `Ask: Does ${input.windowLabel} ${stageLabel} still work for a short Call Circle call with ${otherMember}? Reply yes or no. Record the answer with murph.call_circle_respond.`,
    memberId: input.memberId,
    now: input.now,
    preflight: input.preflight,
    tx: input.tx,
  });
}

export function buildCallCircleConfirmNotificationEventId(input: {
  matchId: string;
  memberId: string;
  stage: "am" | "final";
  windowStartAt: Date;
}): string {
  return [
    "assistant.notification.requested",
    "call-circle",
    input.stage,
    input.matchId,
    input.memberId,
    input.windowStartAt.toISOString(),
  ].join(":");
}

export async function appendCallCircleHandoffNotificationTx(input: {
  matchId: string;
  memberId: string;
  now: Date;
  preflight?: { route: HostedExecutionAssistantNotificationRoute; status: "ok" };
  tx: Prisma.TransactionClient;
}): Promise<CallCircleNotificationAppendResult> {
  return appendCallCircleNotificationTx({
    eventId: buildCallCircleHandoffNotificationEventId({
      matchId: input.matchId,
      memberId: input.memberId,
    }),
    instructions:
      "Tell the member the Call Circle bridge could not start. Ask: Want help sending a quick text to continue instead? Reply yes or no.",
    memberId: input.memberId,
    now: input.now,
    preflight: input.preflight,
    tx: input.tx,
  });
}

export function buildCallCircleHandoffNotificationEventId(input: {
  matchId: string;
  memberId: string;
}): string {
  return `assistant.notification.requested:call-circle:handoff:${input.matchId}:${input.memberId}`;
}

export async function appendCallCircleOutcomeNotificationTx(input: {
  matchId: string;
  memberId: string;
  now: Date;
  preflight?: { route: HostedExecutionAssistantNotificationRoute; status: "ok" };
  tx: Prisma.TransactionClient;
}): Promise<CallCircleNotificationAppendResult> {
  return appendCallCircleNotificationTx({
    eventId: buildCallCircleOutcomeNotificationEventId({
      matchId: input.matchId,
      memberId: input.memberId,
    }),
    instructions:
      "Tell the member the Call Circle call is complete.",
    memberId: input.memberId,
    now: input.now,
    preflight: input.preflight,
    tx: input.tx,
  });
}

export function buildCallCircleOutcomeNotificationEventId(input: {
  matchId: string;
  memberId: string;
}): string {
  return `assistant.notification.requested:call-circle:outcome:${input.matchId}:${input.memberId}`;
}

export async function readCallCircleNotificationPreflightTx(input: {
  memberId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<
  | { route: HostedExecutionAssistantNotificationRoute; status: "ok" }
  | Exclude<CallCircleNotificationAppendResult, { status: "sent" }>
> {
  const route = await resolveHostedAssistantNotificationRouteTx({
    memberId: input.memberId,
    tx: input.tx,
  });
  if (!route) {
    return { reason: "missing_route", status: "blocked" };
  }
  const member = await input.tx.hostedMember.findUnique({
    select: { pendingActivationTimeZone: true },
    where: { id: input.memberId },
  });
  const timeZone = normalizeCallCircleTimeZone(
    member?.pendingActivationTimeZone ?? null,
  );
  if (!isWithinCallCircleQuietHours({ now: input.now, timeZone })) {
    return { reason: "quiet_hours", status: "blocked" };
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
  const assignableLineCount = await input.tx.hostedLinqLine.count({
    where: {
      configuredAt: { not: null },
      egressPolicy: "enabled",
      healthStatus: { in: ["healthy", "unknown"] },
    },
  });
  if (assignableLineCount === 0) {
    return { reason: "line_unavailable", status: "blocked" };
  }
  return { route, status: "ok" };
}

async function appendCallCircleNotificationTx(input: {
  eventId: string;
  instructions: string;
  memberId: string;
  now: Date;
  preflight?: { route: HostedExecutionAssistantNotificationRoute; status: "ok" };
  tx: Prisma.TransactionClient;
}): Promise<CallCircleNotificationAppendResult> {
  const preflight = input.preflight
    ?? await readCallCircleNotificationPreflightTx({
      memberId: input.memberId,
      now: input.now,
      tx: input.tx,
    });
  if (preflight.status !== "ok") {
    return preflight;
  }
  const append = await appendHostedAssistantNotificationTx({
    eventId: input.eventId,
    instructions: input.instructions,
    memberId: input.memberId,
    occurredAt: input.now.toISOString(),
    responsePolicy: { kind: "require_send" },
    route: preflight.route,
    tx: input.tx,
  });
  return { mailboxItemId: append.mailboxItemId, status: "sent" };
}

function normalizeLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
