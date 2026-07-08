import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  canAppendCallCircleSetupNotification,
  canUseActiveCallCircleParticipant,
  canUseActiveCallCircleParticipantPair,
  type CallCircleEligibleParticipant,
  listCallCircleEligibleParticipants,
} from "./participant-store";
import {
  createCallCircleMatchProposal,
  expirePastCallCircleMatches,
  listRecentCallCircleMatches,
  markCallCircleMatchAmAsked,
  markCallCircleMatchFinalAsked,
  markCallCircleMatchOutcome,
  readLastCallCirclePartnerMemberIds,
} from "./match-store";
import {
  proposeCallCircleMatches,
} from "./matcher";
import {
  readCallCircleCalendarAvailability,
  type CallCircleConnectedAppsRequester,
} from "./free-busy";
import {
  appendCallCircleConfirmNotificationTx,
  appendCallCircleHandoffNotificationTx,
  appendCallCircleOutcomeNotificationTx,
  appendCallCircleSetupNotificationTx,
  buildCallCircleHandoffNotificationEventId,
  buildCallCircleOutcomeNotificationEventId,
  buildCallCircleSetupNotificationEventId,
  type CallCircleNotificationSignal,
  readCallCircleNotificationSignal,
  readExistingCallCircleNotificationSignalTx,
  readCallCircleNotificationPreflightTx,
  signalCallCircleNotificationRuntimesBestEffort,
} from "./notifications";
import {
  CALL_CIRCLE_FINAL_ASK_LEAD_MS,
  isSameCallCircleLocalDate,
  isWithinCallCircleQuietHours,
  normalizeCallCircleTimeZone,
} from "./time";
import {
  startCallCircleConnectorCall,
  type CallCircleConnectorStarter,
} from "./connector-call";
import { getPrisma } from "../prisma";

export interface RunCallCircleSchedulerResult {
  askedMorning: number;
  askedFinal: number;
  bridgeAttempts: number;
  expired: number;
  handoffs: number;
  proposals: number;
  resultNotifications: number;
  setupAsks: number;
}

const EMPTY_RESULT: RunCallCircleSchedulerResult = {
  askedFinal: 0,
  askedMorning: 0,
  bridgeAttempts: 0,
  expired: 0,
  handoffs: 0,
  proposals: 0,
  resultNotifications: 0,
  setupAsks: 0,
};

const CALL_CIRCLE_STRANDED_BRIDGE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const CALL_CIRCLE_BRIDGE_ANALYSIS_GRACE_MS = 10 * 60 * 1_000;
const CALL_CIRCLE_SCHEDULER_PAGE_SIZE = 100;
const CALL_CIRCLE_HANDOFF_OUTCOMES = [
  "connector_agent_unconfigured",
  "connector_start_failed",
  "text_handoff",
  "verified_phone_missing",
] as const;

type CallCircleNotificationPreflightOk = Extract<
  Awaited<ReturnType<typeof readCallCircleNotificationPreflightTx>>,
  { status: "ok" }
>;

export async function runCallCircleScheduler(input: {
  calendarRequester?: CallCircleConnectedAppsRequester;
  connectorStarter?: CallCircleConnectorStarter;
  now?: Date;
  prisma?: PrismaClient;
} = {}): Promise<RunCallCircleSchedulerResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const result = { ...EMPTY_RESULT };

  result.handoffs += await appendMissedCallCircleBridgeHandoffs({ now, prisma });
  result.expired += await expirePastCallCircleMatches({ now, prisma });
  result.proposals += await createWeeklyCallCircleProposals({ now, prisma });
  let dueCursor: DueCallCircleMatchCursor | null = null;
  while (true) {
    const dueMatches: SchedulerMatch[] = await prisma.hostedCallCircleMatch.findMany({
      include: {
        memberA: {
          select: { pendingActivationTimeZone: true },
        },
        memberB: {
          select: { pendingActivationTimeZone: true },
        },
        phoneCall: {
          select: {
            analyzedAt: true,
            endedAt: true,
            id: true,
            providerCallId: true,
            status: true,
          },
        },
      },
      orderBy: [
        { windowStartAt: "asc" },
        { id: "asc" },
      ],
      take: CALL_CIRCLE_SCHEDULER_PAGE_SIZE,
      where: dueCallCircleMatchWhere({ cursor: dueCursor, now }),
    });

    for (const match of dueMatches) {
      const memberATimeZone = normalizeCallCircleTimeZone(
        match.memberA.pendingActivationTimeZone,
      );
      const memberBTimeZone = normalizeCallCircleTimeZone(
        match.memberB.pendingActivationTimeZone,
      );
      if (
        (match.status === "proposed" || match.status === "asking")
        && match.amAskedAt === null
        && shouldSendCallCircleMorningConfirmations({
          match,
          memberATimeZone,
          memberBTimeZone,
          now,
        })
      ) {
        const asked = await askCallCircleMorningConfirmations({
          calendarRequester: input.calendarRequester,
          match,
          memberATimeZone,
          memberBTimeZone,
          now,
          prisma,
        });
        if (asked) result.askedMorning += 1;
        continue;
      }

      if (
        match.status === "both_confirmed"
        && match.finalAskedAt === null
        && now.getTime() >= match.windowStartAt.getTime() - CALL_CIRCLE_FINAL_ASK_LEAD_MS
        && now < match.windowStartAt
        && isWithinCallCircleQuietHours({ now, timeZone: memberATimeZone })
        && isWithinCallCircleQuietHours({ now, timeZone: memberBTimeZone })
      ) {
        const asked = await askCallCircleFinalConfirmations({
          match,
          memberATimeZone,
          memberBTimeZone,
          now,
          prisma,
        });
        if (asked) result.askedFinal += 1;
        continue;
      }

      if (
        (
          match.status === "both_confirmed"
          || (match.status === "bridging" && isRecoverableCallCircleBridgePhoneCall(match.phoneCall))
        )
        && match.finalAskedAt !== null
        && now >= match.windowStartAt
        && now < match.windowEndAt
      ) {
        if (!await cancelCallCircleMatchIfParticipantsInactive({
          match,
          now,
          prisma,
        })) {
          continue;
        }
        const starter = input.connectorStarter ?? startCallCircleConnectorCall;
        await starter({ matchId: match.id, now, prisma });
        result.bridgeAttempts += 1;
        continue;
      }

      if (
        match.status === "bridging"
        && isRecoverableCallCircleBridgePhoneCall(match.phoneCall)
        && now >= match.windowEndAt
      ) {
        const handedOff = await appendCallCircleBridgeHandoffs({
          match,
          now,
          prisma,
        });
        if (handedOff) result.handoffs += 1;
        continue;
      }

      if (
        match.status === "bridging"
        && hasTimedOutCallCircleBridgeAnalysis({
          now,
          phoneCall: match.phoneCall,
        })
        && now >= match.windowEndAt
      ) {
        const handedOff = await appendCallCircleBridgeHandoffs({
          match,
          now,
          prisma,
        });
        if (handedOff) result.handoffs += 1;
        continue;
      }

      if (
        match.status === "bridging"
        && match.phoneCall
        && match.phoneCall.analyzedAt !== null
        && ["failed", "needs_user"].includes(match.phoneCall.status)
      ) {
        const handedOff = await appendCallCircleBridgeHandoffs({
          match,
          now,
          prisma,
        });
        if (handedOff) result.handoffs += 1;
      }
    }

    const last = dueMatches.at(-1);
    if (dueMatches.length < CALL_CIRCLE_SCHEDULER_PAGE_SIZE || !last) break;
    dueCursor = {
      id: last.id,
      windowStartAt: last.windowStartAt,
    };
  }

  result.setupAsks += await appendPendingCallCircleSetupNotifications({
    now,
    prisma,
  });
  result.resultNotifications += await appendTerminalCallCircleResultNotifications({
    now,
    prisma,
  });

  return result;
}

interface DueCallCircleMatchCursor {
  id: string;
  windowStartAt: Date;
}

function dueCallCircleMatchWhere(input: {
  cursor: DueCallCircleMatchCursor | null;
  now: Date;
}): Prisma.HostedCallCircleMatchWhereInput {
  const baseWhere: Prisma.HostedCallCircleMatchWhereInput = {
    OR: [
      {
        status: { in: ["proposed", "asking", "both_confirmed", "bridging"] },
        windowEndAt: {
          gt: new Date(input.now.getTime() - 60 * 60 * 1000),
        },
      },
      {
        status: "bridging",
        windowEndAt: {
          gt: new Date(input.now.getTime() - CALL_CIRCLE_STRANDED_BRIDGE_LOOKBACK_MS),
        },
      },
    ],
    windowStartAt: {
      lte: new Date(input.now.getTime() + 24 * 60 * 60 * 1000),
    },
  };
  if (!input.cursor) return baseWhere;
  return {
    AND: [
      baseWhere,
      {
        OR: [
          { windowStartAt: { gt: input.cursor.windowStartAt } },
          {
            id: { gt: input.cursor.id },
            windowStartAt: input.cursor.windowStartAt,
          },
        ],
      },
    ],
  };
}

async function appendPendingCallCircleSetupNotifications(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  let asked = 0;
  let cursor: PendingCallCircleSetupCursor | null = null;
  while (true) {
    const participants: PendingCallCircleSetupParticipant[] =
      await input.prisma.hostedCallCircleParticipant.findMany({
        orderBy: [
          { updatedAt: "asc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
        select: {
          createdAt: true,
          groupId: true,
          id: true,
          memberId: true,
          updatedAt: true,
        },
        take: CALL_CIRCLE_SCHEDULER_PAGE_SIZE,
        where: {
          ...pendingSetupCursorWhere(cursor),
          preferencesJson: { equals: Prisma.DbNull },
          status: "enrolled",
        },
      });

    for (const participant of participants) {
      if (await appendCallCircleSetupNotificationIfMissing({
        groupId: participant.groupId,
        memberId: participant.memberId,
        now: input.now,
        prisma: input.prisma,
      })) {
        asked += 1;
      }
    }
    const last = participants.at(-1);
    if (participants.length < CALL_CIRCLE_SCHEDULER_PAGE_SIZE || !last) break;
    cursor = {
      createdAt: last.createdAt,
      id: last.id,
      updatedAt: last.updatedAt,
    };
  }
  return asked;
}

interface PendingCallCircleSetupParticipant {
  createdAt: Date;
  groupId: string;
  id: string;
  memberId: string;
  updatedAt: Date;
}

interface PendingCallCircleSetupCursor {
  createdAt: Date;
  id: string;
  updatedAt: Date;
}

function pendingSetupCursorWhere(
  cursor: PendingCallCircleSetupCursor | null,
): Prisma.HostedCallCircleParticipantWhereInput {
  if (!cursor) return {};
  return {
    OR: [
      { updatedAt: { gt: cursor.updatedAt } },
      {
        createdAt: { gt: cursor.createdAt },
        updatedAt: cursor.updatedAt,
      },
      {
        createdAt: cursor.createdAt,
        id: { gt: cursor.id },
        updatedAt: cursor.updatedAt,
      },
    ],
  };
}

async function appendCallCircleSetupNotificationIfMissing(input: {
  groupId: string;
  memberId: string;
  now: Date;
  prisma: PrismaClient;
}): Promise<boolean> {
  const eventId = buildCallCircleSetupNotificationEventId({
    groupId: input.groupId,
    memberId: input.memberId,
  });
  const transaction = await input.prisma.$transaction(async (tx): Promise<{
    asked: boolean;
    signals: CallCircleNotificationSignal[];
  }> => {
    const existing = await tx.hostedMailboxItem.findUnique({
      select: { id: true },
      where: {
        userId_dedupeKey: {
          dedupeKey: eventId,
          userId: input.memberId,
        },
      },
    });
    if (existing) return { asked: false, signals: [] };

    if (!await canAppendCallCircleSetupNotification({
      groupId: input.groupId,
      memberId: input.memberId,
      prisma: tx,
    })) {
      return { asked: false, signals: [] };
    }

    const notification = await appendCallCircleSetupNotificationTx({
      groupId: input.groupId,
      memberId: input.memberId,
      now: input.now,
      tx,
    });
    const signal = readCallCircleNotificationSignal({
      memberId: input.memberId,
      notification,
    });
    return {
      asked: signal !== null,
      signals: signal ? [signal] : [],
    };
  });
  if (transaction.signals.length > 0) {
    await signalCallCircleNotificationRuntimesBestEffort(transaction.signals);
  }
  return transaction.asked;
}

async function appendMissedCallCircleBridgeHandoffs(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const matches = await input.prisma.hostedCallCircleMatch.findMany({
    include: {
      memberA: {
        select: { pendingActivationTimeZone: true },
      },
      memberB: {
        select: { pendingActivationTimeZone: true },
      },
      phoneCall: {
        select: {
          analyzedAt: true,
          endedAt: true,
          id: true,
          providerCallId: true,
          status: true,
        },
      },
    },
    orderBy: { windowEndAt: "asc" },
    take: 100,
    where: {
      finalAskedAt: { not: null },
      phoneCallId: null,
      status: "both_confirmed",
      windowEndAt: {
        gt: new Date(input.now.getTime() - CALL_CIRCLE_STRANDED_BRIDGE_LOOKBACK_MS),
        lte: input.now,
      },
    },
  });

  let handedOff = 0;
  for (const match of matches) {
    if (await appendCallCircleBridgeHandoffs({
      match,
      now: input.now,
      prisma: input.prisma,
    })) {
      handedOff += 1;
    }
  }
  return handedOff;
}

async function appendTerminalCallCircleResultNotifications(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  let notified = 0;
  let cursor: TerminalCallCircleNotificationCursor | null = null;
  while (true) {
    const matches: TerminalNotificationMatch[] =
      await input.prisma.hostedCallCircleMatch.findMany({
        include: {
          memberA: {
            select: { pendingActivationTimeZone: true },
          },
          memberB: {
            select: { pendingActivationTimeZone: true },
          },
        },
        orderBy: [
          { endedAt: "desc" },
          { windowEndAt: "desc" },
          { id: "asc" },
        ],
        take: CALL_CIRCLE_SCHEDULER_PAGE_SIZE,
        where: terminalCallCircleNotificationWhere({
          cursor,
          now: input.now,
        }),
      });

    for (const match of matches) {
      if (await appendTerminalCallCircleResultNotificationIfMissing({
        match,
        now: input.now,
        prisma: input.prisma,
      })) {
        notified += 1;
      }
    }

    const last = matches.at(-1);
    if (matches.length < CALL_CIRCLE_SCHEDULER_PAGE_SIZE || !last?.endedAt) break;
    cursor = {
      endedAt: last.endedAt,
      id: last.id,
      windowEndAt: last.windowEndAt,
    };
  }
  return notified;
}

interface TerminalCallCircleNotificationCursor {
  endedAt: Date;
  id: string;
  windowEndAt: Date;
}

function terminalCallCircleNotificationWhere(input: {
  cursor: TerminalCallCircleNotificationCursor | null;
  now: Date;
}): Prisma.HostedCallCircleMatchWhereInput {
  const baseWhere: Prisma.HostedCallCircleMatchWhereInput = {
    endedAt: {
      gt: new Date(input.now.getTime() - CALL_CIRCLE_STRANDED_BRIDGE_LOOKBACK_MS),
    },
    outcome: { in: ["completed", ...CALL_CIRCLE_HANDOFF_OUTCOMES] },
    status: { in: ["completed", "dropped"] },
  };
  if (!input.cursor) return baseWhere;
  return {
    AND: [
      baseWhere,
      {
        OR: [
          { endedAt: { lt: input.cursor.endedAt } },
          {
            endedAt: input.cursor.endedAt,
            windowEndAt: { lt: input.cursor.windowEndAt },
          },
          {
            endedAt: input.cursor.endedAt,
            id: { gt: input.cursor.id },
            windowEndAt: input.cursor.windowEndAt,
          },
        ],
      },
    ],
  };
}

async function appendTerminalCallCircleResultNotificationIfMissing(input: {
  match: TerminalNotificationMatch;
  now: Date;
  prisma: PrismaClient;
}): Promise<boolean> {
  const kind = readTerminalCallCircleNotificationKind(input.match);
  if (!kind) return false;
  const memberNotifications = [
    {
      dedupeKey: buildTerminalCallCircleNotificationEventId({
        kind,
        matchId: input.match.id,
        memberId: input.match.memberAId,
      }),
      memberId: input.match.memberAId,
    },
    {
      dedupeKey: buildTerminalCallCircleNotificationEventId({
        kind,
        matchId: input.match.id,
        memberId: input.match.memberBId,
      }),
      memberId: input.match.memberBId,
    },
  ];

  const transaction = await input.prisma.$transaction(async (tx): Promise<{
    notified: boolean;
    signals: CallCircleNotificationSignal[];
  }> => {
    const existing = await Promise.all(memberNotifications.map((notification) =>
      readExistingCallCircleNotificationSignalTx({
        eventId: notification.dedupeKey,
        memberId: notification.memberId,
        tx,
      })
    ));
    const existingSignals = existing.flatMap((result) =>
      result.signal ? [result.signal] : []);
    const missing = memberNotifications.filter((_, index) => !existing[index]?.exists);
    if (missing.length === 0) {
      return {
        notified: existingSignals.length > 0,
        signals: existingSignals,
      };
    }

    const notifications = await Promise.all(memberNotifications.map((notification, index) => {
      if (existing[index]?.exists) return Promise.resolve(null);
      return appendTerminalCallCircleNotificationIfReachableTx({
        kind,
        matchId: input.match.id,
        memberId: notification.memberId,
        now: input.now,
        tx,
      });
    }));

    const signals = notifications.flatMap((notification, index) => {
      if (!notification) return [];
      const signal = readCallCircleNotificationSignal({
        memberId: memberNotifications[index]?.memberId ?? "",
        notification,
      });
      return signal ? [signal] : [];
    });
    signals.unshift(...existingSignals);
    return {
      notified: signals.length > 0,
      signals,
    };
  });
  if (transaction.signals.length > 0) {
    await signalCallCircleNotificationRuntimesBestEffort(transaction.signals);
  }
  return transaction.notified;
}

function readTerminalCallCircleNotificationKind(
  match: Pick<TerminalNotificationMatch, "outcome" | "status">,
): "handoff" | "outcome" | null {
  if (match.status === "completed" && match.outcome === "completed") {
    return "outcome";
  }
  if (
    match.status === "dropped"
    && CALL_CIRCLE_HANDOFF_OUTCOMES.includes(
      match.outcome as (typeof CALL_CIRCLE_HANDOFF_OUTCOMES)[number],
    )
  ) {
    return "handoff";
  }
  return null;
}

function buildTerminalCallCircleNotificationEventId(input: {
  kind: "handoff" | "outcome";
  matchId: string;
  memberId: string;
}): string {
  return input.kind === "outcome"
    ? buildCallCircleOutcomeNotificationEventId(input)
    : buildCallCircleHandoffNotificationEventId(input);
}

async function appendTerminalCallCircleNotificationIfReachableTx(input: {
  kind: "handoff" | "outcome";
  matchId: string;
  memberId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<Awaited<ReturnType<typeof appendCallCircleHandoffNotificationTx>> | null> {
  const preflight = await readCallCircleNotificationPreflightTx({
    memberId: input.memberId,
    now: input.now,
    tx: input.tx,
  });
  if (preflight.status !== "ok") return null;
  return input.kind === "outcome"
    ? appendCallCircleOutcomeNotificationTx({
        matchId: input.matchId,
        memberId: input.memberId,
        now: input.now,
        preflight,
        tx: input.tx,
      })
    : appendCallCircleHandoffNotificationTx({
        matchId: input.matchId,
        memberId: input.memberId,
        now: input.now,
        preflight,
        tx: input.tx,
      });
}

function shouldSendCallCircleMorningConfirmations(input: {
  match: Pick<SchedulerMatch, "windowStartAt">;
  memberATimeZone: string;
  memberBTimeZone: string;
  now: Date;
}): boolean {
  return input.now.getTime()
    < input.match.windowStartAt.getTime() - CALL_CIRCLE_FINAL_ASK_LEAD_MS
    && isSameCallCircleLocalDate({
      first: input.now,
      second: input.match.windowStartAt,
      timeZone: input.memberATimeZone,
    })
    && isSameCallCircleLocalDate({
      first: input.now,
      second: input.match.windowStartAt,
      timeZone: input.memberBTimeZone,
    })
    && isWithinCallCircleQuietHours({
      now: input.now,
      timeZone: input.memberATimeZone,
    })
    && isWithinCallCircleQuietHours({
      now: input.now,
      timeZone: input.memberBTimeZone,
    });
}

async function createWeeklyCallCircleProposals(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  let created = 0;
  let groupCursor: string | null = null;
  while (true) {
    const groups: CallCircleProposalGroup[] =
      await input.prisma.hostedCallCircleParticipant.findMany({
        distinct: ["groupId"],
        orderBy: { groupId: "asc" },
        select: { groupId: true },
        take: CALL_CIRCLE_SCHEDULER_PAGE_SIZE,
        where: {
          ...(groupCursor ? { groupId: { gt: groupCursor } } : {}),
          preferencesJson: { not: Prisma.DbNull },
          status: "enrolled",
        },
      });

    for (const group of groups) {
      const [participants, recentMatches] = await Promise.all([
        listCallCircleEligibleParticipants({
          groupId: group.groupId,
          prisma: input.prisma,
        }),
        listRecentCallCircleMatches({
          groupId: group.groupId,
          now: input.now,
          prisma: input.prisma,
        }),
      ]);
      const activeParticipants = await listCallCircleActiveParticipants({
        participants,
        prisma: input.prisma,
      });
      const reachableParticipants = await listCallCircleReachableParticipants({
        now: input.now,
        participants: activeParticipants,
        prisma: input.prisma,
      });
      const lastPartners = await readLastCallCirclePartnerMemberIds({
        groupId: group.groupId,
        memberIds: reachableParticipants.map((participant) => participant.memberId),
        prisma: input.prisma,
      });
      const proposals = proposeCallCircleMatches({
        now: input.now,
        participants: reachableParticipants.map((participant) => ({
          ...participant,
          lastPartnerMemberId: lastPartners.get(participant.memberId) ?? null,
        })),
        recentMatches,
      });
      for (const proposal of proposals) {
        const match = await createCallCircleMatchProposal({
          proposal: {
            groupId: group.groupId,
            memberAId: proposal.memberAId,
            memberBId: proposal.memberBId,
            now: input.now,
            windowEndAt: proposal.windowEndAt,
            windowStartAt: proposal.windowStartAt,
          },
          prisma: input.prisma,
        });
        if (match) created += 1;
      }
    }

    const last = groups.at(-1);
    if (groups.length < CALL_CIRCLE_SCHEDULER_PAGE_SIZE || !last) break;
    groupCursor = last.groupId;
  }
  return created;
}

interface CallCircleProposalGroup {
  groupId: string;
}

async function listCallCircleActiveParticipants(input: {
  participants: CallCircleEligibleParticipant[];
  prisma: PrismaClient;
}): Promise<CallCircleEligibleParticipant[]> {
  const active = await Promise.all(input.participants.map(async (participant) =>
    await canUseActiveCallCircleParticipant({
      groupId: participant.groupId,
      memberId: participant.memberId,
      prisma: input.prisma,
    })
      ? participant
      : null
  ));
  return active.filter((participant): participant is CallCircleEligibleParticipant =>
    participant !== null);
}

async function listCallCircleReachableParticipants(input: {
  now: Date;
  participants: CallCircleEligibleParticipant[];
  prisma: PrismaClient;
}): Promise<CallCircleEligibleParticipant[]> {
  if (input.participants.length === 0) return [];
  return input.prisma.$transaction(async (tx) => {
    const preflights = await Promise.all(input.participants.map((participant) =>
      readCallCircleNotificationPreflightTx({
        memberId: participant.memberId,
        now: input.now,
        tx,
      })
    ));
    return input.participants.filter((_, index) =>
      preflights[index]?.status === "ok"
    );
  });
}

async function askCallCircleMorningConfirmations(input: {
  calendarRequester?: CallCircleConnectedAppsRequester;
  match: SchedulerMatch;
  memberATimeZone: string;
  memberBTimeZone: string;
  now: Date;
  prisma: PrismaClient;
}): Promise<boolean> {
  const calendarRecipients = await preflightCallCircleMorningCalendarRecipients(input);
  if (!calendarRecipients) return false;

  const calendarAvailability = await Promise.all(calendarRecipients.map((recipient) =>
    readCallCircleCalendarAvailability({
      endAt: input.match.windowEndAt,
      memberId: recipient.memberId,
      requester: input.calendarRequester,
      startAt: input.match.windowStartAt,
      timeZone: recipient.timeZone,
    })
  ));
  if (calendarAvailability.some((availability) => availability === "busy")) {
    await input.prisma.$transaction(async (tx) => {
      if (!await cancelCallCircleMatchIfParticipantsInactive({
        match: input.match,
        now: input.now,
        prisma: tx,
      })) {
        return;
      }
      await markCallCircleMatchOutcome({
        matchId: input.match.id,
        now: input.now,
        outcome: "calendar_busy",
        prisma: tx,
        status: "dropped",
      });
    });
    return false;
  }

  const transaction = await input.prisma.$transaction(async (tx): Promise<{
    asked: boolean;
    signals: CallCircleNotificationSignal[];
  }> => {
    const pendingNotifications = await preflightCallCircleMorningNotificationsTx({
      match: input.match,
      memberATimeZone: input.memberATimeZone,
      memberBTimeZone: input.memberBTimeZone,
      now: input.now,
      tx,
    });
    if (!pendingNotifications) return { asked: false, signals: [] };
    const marked = await markCallCircleMatchAmAsked({
      matchId: input.match.id,
      now: input.now,
      prisma: tx,
    });
    if (!marked) return { asked: false, signals: [] };
    const notifications = await Promise.all(pendingNotifications.map((notification) =>
      appendCallCircleConfirmNotificationTx({
        matchId: input.match.id,
        memberId: notification.memberId,
        now: input.now,
        otherMemberLabel: null,
        preflight: notification.preflight,
        stage: "am",
        tx,
        windowLabel: formatCallCircleWindowLabel({
          startAt: input.match.windowStartAt,
          timeZone: notification.timeZone,
        }),
        windowStartAt: input.match.windowStartAt,
      })
    ));
    return {
      asked: true,
      signals: notifications.flatMap((notification, index) => {
        const memberId = pendingNotifications[index]?.memberId;
        if (!memberId) return [];
        const signal = readCallCircleNotificationSignal({ memberId, notification });
        return signal ? [signal] : [];
      }),
    };
  });
  await signalCallCircleNotificationRuntimesBestEffort(transaction.signals);
  return transaction.asked;
}

async function preflightCallCircleMorningCalendarRecipients(input: {
  match: SchedulerMatch;
  memberATimeZone: string;
  memberBTimeZone: string;
  now: Date;
  prisma: PrismaClient;
}): Promise<PendingMorningConfirmationRecipient[] | null> {
  return input.prisma.$transaction(async (tx) => {
    const pendingNotifications = await preflightCallCircleMorningNotificationsTx({
      match: input.match,
      memberATimeZone: input.memberATimeZone,
      memberBTimeZone: input.memberBTimeZone,
      now: input.now,
      tx,
    });
    return pendingNotifications?.map((notification) => ({
      memberId: notification.memberId,
      timeZone: notification.timeZone,
    })) ?? null;
  });
}

async function preflightCallCircleMorningNotificationsTx(input: {
  match: SchedulerMatch;
  memberATimeZone: string;
  memberBTimeZone: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<PendingMorningConfirmationNotification[] | null> {
  if (!await cancelCallCircleMatchIfParticipantsInactive({
    match: input.match,
    now: input.now,
    prisma: input.tx,
  })) {
    return null;
  }
  const pendingRecipients: PendingMorningConfirmationRecipient[] = [];
  if (input.match.sideAResponse === "pending") {
    pendingRecipients.push({
      memberId: input.match.memberAId,
      timeZone: input.memberATimeZone,
    });
  }
  if (input.match.sideBResponse === "pending") {
    pendingRecipients.push({
      memberId: input.match.memberBId,
      timeZone: input.memberBTimeZone,
    });
  }
  if (pendingRecipients.length === 0) return null;
  const preflights = await Promise.all(pendingRecipients.map((recipient) =>
    readCallCircleNotificationPreflightTx({
      memberId: recipient.memberId,
      now: input.now,
      tx: input.tx,
    })
  ));
  if (preflights.some((preflight) => preflight.status !== "ok")) {
    await markCallCircleMatchOutcome({
      matchId: input.match.id,
      now: input.now,
      outcome: "notification_blocked",
      prisma: input.tx,
      status: "dropped",
    });
    return null;
  }
  const pendingNotifications: PendingMorningConfirmationNotification[] = [];
  for (let index = 0; index < pendingRecipients.length; index += 1) {
    const recipient = pendingRecipients[index];
    const preflight = preflights[index];
    if (!recipient || !preflight || preflight.status !== "ok") return null;
    pendingNotifications.push({
      memberId: recipient.memberId,
      preflight,
      timeZone: recipient.timeZone,
    });
  }
  return pendingNotifications;
}

async function askCallCircleFinalConfirmations(input: {
  match: SchedulerMatch;
  memberATimeZone: string;
  memberBTimeZone: string;
  now: Date;
  prisma: PrismaClient;
}): Promise<boolean> {
  const transaction = await input.prisma.$transaction(async (tx): Promise<{
    asked: boolean;
    signals: CallCircleNotificationSignal[];
  }> => {
    if (!await cancelCallCircleMatchIfParticipantsInactive({
      match: input.match,
      now: input.now,
      prisma: tx,
    })) {
      return { asked: false, signals: [] };
    }
    const [memberAPreflight, memberBPreflight] = await Promise.all([
      readCallCircleNotificationPreflightTx({
        memberId: input.match.memberAId,
        now: input.now,
        tx,
      }),
      readCallCircleNotificationPreflightTx({
        memberId: input.match.memberBId,
        now: input.now,
        tx,
      }),
    ]);
    if (memberAPreflight.status !== "ok" || memberBPreflight.status !== "ok") {
      await markCallCircleMatchOutcome({
        matchId: input.match.id,
        now: input.now,
        outcome: "notification_blocked",
        prisma: tx,
        status: "dropped",
      });
      return { asked: false, signals: [] };
    }
    const marked = await markCallCircleMatchFinalAsked({
      matchId: input.match.id,
      now: input.now,
      prisma: tx,
    });
    if (!marked) return { asked: false, signals: [] };
    const [memberANotification, memberBNotification] = await Promise.all([
      appendCallCircleConfirmNotificationTx({
        matchId: input.match.id,
        memberId: input.match.memberAId,
        now: input.now,
        otherMemberLabel: null,
        preflight: memberAPreflight,
        stage: "final",
        tx,
        windowLabel: formatCallCircleWindowLabel({
          startAt: input.match.windowStartAt,
          timeZone: input.memberATimeZone,
        }),
        windowStartAt: input.match.windowStartAt,
      }),
      appendCallCircleConfirmNotificationTx({
        matchId: input.match.id,
        memberId: input.match.memberBId,
        now: input.now,
        otherMemberLabel: null,
        preflight: memberBPreflight,
        stage: "final",
        tx,
        windowLabel: formatCallCircleWindowLabel({
          startAt: input.match.windowStartAt,
          timeZone: input.memberBTimeZone,
        }),
        windowStartAt: input.match.windowStartAt,
      }),
    ]);
    return {
      asked: true,
      signals: [
        readCallCircleNotificationSignal({
          memberId: input.match.memberAId,
          notification: memberANotification,
        }),
        readCallCircleNotificationSignal({
          memberId: input.match.memberBId,
          notification: memberBNotification,
        }),
      ].filter((signal): signal is CallCircleNotificationSignal => signal !== null),
    };
  });
  await signalCallCircleNotificationRuntimesBestEffort(transaction.signals);
  return transaction.asked;
}

async function appendCallCircleBridgeHandoffs(input: {
  match: SchedulerMatch;
  now: Date;
  prisma: PrismaClient;
}): Promise<boolean> {
  const transaction = await input.prisma.$transaction(async (tx): Promise<{
    handedOff: boolean;
    signals: CallCircleNotificationSignal[];
  }> => {
    if (!await cancelCallCircleMatchIfParticipantsInactive({
      match: input.match,
      now: input.now,
      prisma: tx,
    })) {
      return { handedOff: false, signals: [] };
    }
    const marked = await markCallCircleMatchOutcome({
      matchId: input.match.id,
      now: input.now,
      outcome: "text_handoff",
      phoneCallId: input.match.phoneCall?.id ?? null,
      prisma: tx,
      status: "dropped",
    });
    if (!marked) return { handedOff: false, signals: [] };
    const notifications = await Promise.all([
      appendTerminalCallCircleNotificationIfReachableTx({
        kind: "handoff",
        matchId: input.match.id,
        memberId: input.match.memberAId,
        now: input.now,
        tx,
      }),
      appendTerminalCallCircleNotificationIfReachableTx({
        kind: "handoff",
        matchId: input.match.id,
        memberId: input.match.memberBId,
        now: input.now,
        tx,
      }),
    ]);
    return {
      handedOff: true,
      signals: notifications.flatMap((notification, index) => {
        const memberId = index === 0
          ? input.match.memberAId
          : input.match.memberBId;
        const signal = notification
          ? readCallCircleNotificationSignal({ memberId, notification })
          : null;
        return signal ? [signal] : [];
      }),
    };
  });
  await signalCallCircleNotificationRuntimesBestEffort(transaction.signals);
  return transaction.handedOff;
}

async function cancelCallCircleMatchIfParticipantsInactive(input: {
  match: Pick<SchedulerMatch, "groupId" | "id" | "memberAId" | "memberBId">;
  now: Date;
  prisma: Prisma.TransactionClient | PrismaClient;
}): Promise<boolean> {
  if (await canUseActiveCallCircleParticipantPair({
    groupId: input.match.groupId,
    memberAId: input.match.memberAId,
    memberBId: input.match.memberBId,
    prisma: input.prisma,
  })) {
    return true;
  }
  await markCallCircleMatchOutcome({
    matchId: input.match.id,
    now: input.now,
    outcome: "participant_unavailable",
    prisma: input.prisma,
    status: "canceled",
  });
  return false;
}

function isRecoverableCallCircleBridgePhoneCall(
  phoneCall: SchedulerMatch["phoneCall"],
): boolean {
  return !phoneCall
    || (
      phoneCall.analyzedAt === null
      && phoneCall.providerCallId === null
      && phoneCall.status === "starting"
    );
}

function hasTimedOutCallCircleBridgeAnalysis(input: {
  now: Date;
  phoneCall: SchedulerMatch["phoneCall"];
}): boolean {
  return Boolean(
    input.phoneCall
    && input.phoneCall.endedAt
    && input.phoneCall.analyzedAt === null
    && input.now.getTime() - input.phoneCall.endedAt.getTime()
      >= CALL_CIRCLE_BRIDGE_ANALYSIS_GRACE_MS,
  );
}

interface SchedulerMatch {
  amAskedAt: Date | null;
  finalAskedAt: Date | null;
  groupId: string;
  id: string;
  memberA: { pendingActivationTimeZone: string | null };
  memberAId: string;
  memberB: { pendingActivationTimeZone: string | null };
  memberBId: string;
  phoneCall: {
    analyzedAt: Date | null;
    endedAt: Date | null;
    id: string;
    providerCallId: string | null;
    status: string;
  } | null;
  sideAResponse: string;
  sideBResponse: string;
  status: string;
  windowEndAt: Date;
  windowStartAt: Date;
}

interface TerminalNotificationMatch {
  endedAt: Date | null;
  id: string;
  memberAId: string;
  memberBId: string;
  outcome: string | null;
  status: string;
  windowEndAt: Date;
}

interface PendingMorningConfirmationRecipient {
  memberId: string;
  timeZone: string;
}

interface PendingMorningConfirmationNotification
  extends PendingMorningConfirmationRecipient {
  preflight: CallCircleNotificationPreflightOk;
}

function formatCallCircleWindowLabel(input: {
  startAt: Date;
  timeZone: string;
}): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: input.timeZone,
    weekday: "short",
  }).format(input.startAt);
}
