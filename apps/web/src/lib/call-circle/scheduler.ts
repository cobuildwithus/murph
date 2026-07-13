import "server-only";

import {
  Prisma,
  type HostedCallCircleMatchResponse,
  type PrismaClient,
} from "@prisma/client";
import {
  isHostedCallCircleTimeZone,
} from "@murphai/hosted-execution/call-circle";

import {
  advanceCallCircleParticipantMatchingCursors,
  activeCallCircleParticipantWhere,
  canUseActiveCallCircleParticipantPair,
  type CallCircleDueParticipant,
  type CallCircleEligibleParticipant,
  listCallCircleDueParticipants,
  readCallCircleMatchParticipantTimeZones,
} from "./participant-store";
import {
  cancelCallCircleMatchForInactivePair,
  createCallCircleMatchProposal,
  callCircleExpiredResponseWhere,
  dropCallCircleMatchForNotificationBlocked,
  expirePastCallCircleMatches,
  listRecentCallCircleMatches,
  markCallCircleMatchAmAsked,
  markCallCircleMatchFinalAsked,
} from "./match-store";
import { proposeCallCircleMatches } from "./matcher";
import {
  appendCallCircleConfirmNotificationTx,
  appendCallCircleSetupNotificationTx,
  appendCallCircleTerminalNotificationsTx,
  buildCallCircleSetupNotificationEventId,
  readCallCircleNotificationPreflightTx,
  readCallCircleNotificationSignal,
} from "./notifications";
import {
  signalHostedAssistantNotificationsBestEffort,
  type HostedAssistantNotificationSignal,
} from "../hosted-execution/assistant-notifications";
import {
  CALL_CIRCLE_BRIDGE_WINDOW_MS,
  CALL_CIRCLE_FINAL_ASK_LEAD_MS,
  isSameCallCircleLocalDate,
  isWithinCallCircleDaytime,
  readNextCallCircleMatchingAt,
} from "./time";
import {
  startCallCircleConnectorCall,
  type CallCircleConnectorStarter,
} from "./connector-call";
import { getPrisma } from "../prisma";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";

export interface RunCallCircleSchedulerResult {
  askedMorning: number;
  askedFinal: number;
  bridgeAttempts: number;
  expired: number;
  handoffs: number;
  proposals: number;
  setupAsks: number;
}

type CallCircleSchedulerClock = () => Date;
type CallCircleConfirmationStage = "am" | "final";

const EMPTY_RESULT: RunCallCircleSchedulerResult = {
  askedFinal: 0,
  askedMorning: 0,
  bridgeAttempts: 0,
  expired: 0,
  handoffs: 0,
  proposals: 0,
  setupAsks: 0,
};

const CALL_CIRCLE_PHASE_LIMIT = 100;
const CALL_CIRCLE_PROPOSAL_DUE_PARTICIPANT_LIMIT = 32;
const CALL_CIRCLE_SETUP_RETRY_MS = 60 * 60 * 1000;
const CALL_CIRCLE_UPCOMING_CONFIRMATION_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const CALL_CIRCLE_RECOVERABLE_BRIDGE_WHERE = {
  OR: [
    {
      phoneCallId: null,
      status: "both_confirmed",
    },
    {
      phoneCallId: null,
      status: "bridging",
    },
    {
      phoneCall: {
        is: {
          analyzedAt: null,
          endedAt: null,
          providerCallId: null,
          providerStartAttemptedAt: null,
          status: "starting",
        },
      },
      status: "bridging",
    },
    {
      phoneCall: {
        is: {
          analyzedAt: null,
          endedAt: null,
          providerCallId: null,
          status: "failed",
        },
      },
      status: "bridging",
    },
  ],
} satisfies Prisma.HostedCallCircleMatchWhereInput;

type CallCircleNotificationPreflightOk = Extract<
  Awaited<ReturnType<typeof readCallCircleNotificationPreflightTx>>,
  { status: "ok" }
>;

export async function runCallCircleScheduler(input: {
  clock?: CallCircleSchedulerClock;
  connectorStarter?: CallCircleConnectorStarter;
  now?: Date;
  prisma?: PrismaClient;
} = {}): Promise<RunCallCircleSchedulerResult> {
  const prisma = input.prisma ?? getPrisma();
  const sourceClock = resolveCallCircleSchedulerClock(input);
  const runNowMs = sourceClock().getTime();
  const clock = () => new Date(runNowMs);
  const result = { ...EMPTY_RESULT };

  result.handoffs += await handoffElapsedCallCircleBridges({
    clock,
    connectorStarter: input.connectorStarter,
    prisma,
  });
  result.askedFinal += await advanceCallCircleConfirmationStage({
    clock,
    prisma,
    stage: "final",
  });
  result.expired += await expireDueCallCircleMatches({ clock, prisma });
  result.proposals += await createDueCallCircleProposals({ clock, prisma });
  result.askedMorning += await advanceCallCircleConfirmationStage({
    clock,
    prisma,
    stage: "am",
  });
  result.bridgeAttempts += await startDueCallCircleBridges({
    clock,
    connectorStarter: input.connectorStarter,
    prisma,
  });
  result.setupAsks += await appendPendingCallCircleSetupNotifications({
    clock,
    prisma,
  });

  return result;
}

function resolveCallCircleSchedulerClock(input: {
  clock?: CallCircleSchedulerClock;
  now?: Date;
}): CallCircleSchedulerClock {
  if (input.clock) return input.clock;
  if (input.now) {
    const nowMs = input.now.getTime();
    return () => new Date(nowMs);
  }
  return () => new Date();
}

async function expireDueCallCircleMatches(input: {
  clock: CallCircleSchedulerClock;
  prisma: PrismaClient;
}): Promise<number> {
  const queryNow = input.clock();
  const matches = await input.prisma.hostedCallCircleMatch.findMany({
    orderBy: [
      { windowEndAt: "asc" },
      { id: "asc" },
    ],
    select: {
      groupId: true,
      id: true,
      memberAId: true,
      memberBId: true,
      sideAResponse: true,
      sideBResponse: true,
    },
    take: CALL_CIRCLE_PHASE_LIMIT,
    where: {
      ...callCircleExpiredResponseWhere(queryNow),
    },
  });
  let expired = 0;
  for (const match of matches) {
    const transaction = await input.prisma.$transaction(async (tx) => {
      const count = await expirePastCallCircleMatches({
        matchIds: [match.id],
        now: input.clock(),
        prisma: tx,
      });
      if (count === 0) return { count, signals: [] };
      const currentResponses = await tx.hostedCallCircleMatch.findUniqueOrThrow({
        select: {
          sideAResponse: true,
          sideBResponse: true,
        },
        where: { id: match.id },
      });
      const memberIds = [
        ...(isAffirmativeCallCircleResponse(currentResponses.sideAResponse)
          ? [match.memberAId]
          : []),
        ...(isAffirmativeCallCircleResponse(currentResponses.sideBResponse)
          ? [match.memberBId]
          : []),
      ];
      const signals = memberIds.length === 0
        ? []
        : await appendCallCircleTerminalNotificationsTx({
            groupId: match.groupId,
            kind: "expired",
            matchId: match.id,
            memberAId: match.memberAId,
            memberBId: match.memberBId,
            memberIds,
            now: input.clock(),
            tx,
          });
      return { count, signals };
    });
    expired += transaction.count;
    await signalHostedAssistantNotificationsBestEffort(transaction.signals);
  }
  return expired;
}

async function createDueCallCircleProposals(input: {
  clock: CallCircleSchedulerClock;
  prisma: PrismaClient;
}): Promise<number> {
  const queryNow = input.clock();
  const dueParticipants: CallCircleProposalDueParticipant[] =
    await input.prisma.hostedCallCircleParticipant.findMany({
      orderBy: [
        { nextMatchingAt: "asc" },
        { id: "asc" },
      ],
      select: {
        groupId: true,
        memberId: true,
        preferencesJson: true,
      },
      take: CALL_CIRCLE_PROPOSAL_DUE_PARTICIPANT_LIMIT,
      where: {
        nextMatchingAt: { lte: queryNow },
        preferencesJson: { not: Prisma.DbNull },
        status: "enrolled",
      },
    });
  const groupIds = [...new Set(dueParticipants.map((participant) => participant.groupId))];
  let created = 0;

  for (const groupId of groupIds) {
    const proposalNow = input.clock();
    const dueGroupParticipants = await listCallCircleDueParticipants({
      groupId,
      now: proposalNow,
      prisma: input.prisma,
    });
    const participants = dueGroupParticipants.filter(
      isCallCircleEligibleParticipant,
    );
    const recentMatches = await listRecentCallCircleMatches({
      memberIds: participants.map((participant) => participant.memberId),
      now: proposalNow,
      prisma: input.prisma,
    });
    const reachableParticipants = await listCallCircleReachableParticipants({
      clock: input.clock,
      participants,
      prisma: input.prisma,
    });
    const proposals = proposeCallCircleMatches({
      now: proposalNow,
      participants: reachableParticipants,
      recentMatches,
    });
    for (const proposal of proposals) {
      const match = await createCallCircleMatchProposal({
        proposal: {
          groupId,
          memberAId: proposal.memberAId,
          memberBId: proposal.memberBId,
          now: proposalNow,
          windowEndAt: proposal.windowEndAt,
          windowStartAt: proposal.windowStartAt,
        },
        prisma: input.prisma,
      });
      if (match) created += 1;
    }

    await advanceCallCircleParticipantMatchingCursors({
      now: proposalNow,
      participants: mergeCallCircleProposalCursorParticipants({
        activeParticipants: dueGroupParticipants,
        seedParticipants: dueParticipants.filter(
          (participant) => participant.groupId === groupId,
        ),
      }),
      prisma: input.prisma,
    });
  }

  return created;
}

interface CallCircleProposalDueParticipant {
  groupId: string;
  memberId: string;
  preferencesJson: Prisma.JsonValue;
}

function mergeCallCircleProposalCursorParticipants(input: {
  activeParticipants: readonly CallCircleDueParticipant[];
  seedParticipants: readonly CallCircleProposalDueParticipant[];
}): CallCircleDueParticipant[] {
  const participants = new Map(
    input.activeParticipants.map((participant) => [
      participant.memberId,
      participant,
    ]),
  );
  for (const participant of input.seedParticipants) {
    if (participants.has(participant.memberId)) continue;
    participants.set(participant.memberId, {
      groupId: participant.groupId,
      memberId: participant.memberId,
      preferences: null,
      storedPreferencesJson: participant.preferencesJson,
    });
  }
  return [...participants.values()];
}

function isCallCircleEligibleParticipant(
  participant: CallCircleDueParticipant,
): participant is CallCircleEligibleParticipant {
  return participant.preferences !== null;
}

async function listCallCircleReachableParticipants(input: {
  clock: CallCircleSchedulerClock;
  participants: CallCircleEligibleParticipant[];
  prisma: PrismaClient;
}): Promise<CallCircleEligibleParticipant[]> {
  if (input.participants.length === 0) return [];
  const now = input.clock();
  return input.prisma.$transaction(async (tx) => {
    const preflights = await Promise.all(input.participants.map((participant) =>
      readCallCircleNotificationPreflightTx({
        memberId: participant.memberId,
        now,
        requireDaytime: false,
        timeZone: participant.preferences.timeZone,
        tx,
      })
    ));
    return input.participants.filter((_, index) =>
      preflights[index]?.status === "ok"
    );
  });
}

async function advanceCallCircleConfirmationStage(input: {
  clock: CallCircleSchedulerClock;
  prisma: PrismaClient;
  stage: CallCircleConfirmationStage;
}): Promise<number> {
  const queryNow = input.clock();
  const matches: SchedulerMatch[] = await input.prisma.hostedCallCircleMatch.findMany({
    orderBy: [
      { updatedAt: "asc" },
      { windowStartAt: "asc" },
      { id: "asc" },
    ],
    take: CALL_CIRCLE_PHASE_LIMIT,
    where: confirmationStageWhere({
      now: queryNow,
      stage: input.stage,
    }),
  });
  let asked = 0;
  const deferredMatchIds: string[] = [];

  for (const match of matches) {
    if (await askCallCircleConfirmations({
      clock: input.clock,
      match,
      prisma: input.prisma,
      stage: input.stage,
    })) {
      asked += 1;
    } else {
      deferredMatchIds.push(match.id);
    }
  }

  if (deferredMatchIds.length > 0) {
    await input.prisma.hostedCallCircleMatch.updateMany({
      data: { updatedAt: input.clock() },
      where: {
        id: { in: deferredMatchIds },
        ...confirmationStageWhere({ now: queryNow, stage: input.stage }),
      },
    });
  }

  return asked;
}

function confirmationStageWhere(input: {
  now: Date;
  stage: CallCircleConfirmationStage;
}): Prisma.HostedCallCircleMatchWhereInput {
  if (input.stage === "am") {
    return {
      amAskedAt: null,
      finalAskedAt: null,
      status: { in: ["proposed", "asking"] },
      windowEndAt: { gt: input.now },
      windowStartAt: {
        gt: new Date(input.now.getTime() + CALL_CIRCLE_FINAL_ASK_LEAD_MS),
        lte: new Date(
          input.now.getTime() + CALL_CIRCLE_UPCOMING_CONFIRMATION_LOOKAHEAD_MS,
        ),
      },
    };
  }
  return {
    amAskedAt: { not: null },
    finalAskedAt: null,
    status: "both_confirmed",
    windowEndAt: { gt: input.now },
    windowStartAt: {
      gt: input.now,
      lte: new Date(input.now.getTime() + CALL_CIRCLE_FINAL_ASK_LEAD_MS),
    },
  };
}

function shouldAdvanceCallCircleConfirmationStage(input: {
  match: Pick<SchedulerMatch, "windowStartAt">;
  memberATimeZone: string;
  memberBTimeZone: string;
  now: Date;
  stage: CallCircleConfirmationStage;
}): boolean {
  if (input.stage === "am") {
    return shouldSendCallCircleMorningConfirmations(input);
  }
  return input.now.getTime()
    >= input.match.windowStartAt.getTime() - CALL_CIRCLE_FINAL_ASK_LEAD_MS
    && input.now < input.match.windowStartAt
    && isWithinCallCircleDaytime({
      now: input.now,
      timeZone: input.memberATimeZone,
    })
    && isWithinCallCircleDaytime({
      now: input.now,
      timeZone: input.memberBTimeZone,
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
    && isWithinCallCircleDaytime({
      now: input.now,
      timeZone: input.memberATimeZone,
    })
    && isWithinCallCircleDaytime({
      now: input.now,
      timeZone: input.memberBTimeZone,
    });
}

async function askCallCircleConfirmations(input: {
  clock: CallCircleSchedulerClock;
  match: SchedulerMatch;
  prisma: PrismaClient;
  stage: CallCircleConfirmationStage;
}): Promise<boolean> {
  const transaction = await input.prisma.$transaction(async (tx): Promise<{
    asked: boolean;
    signals: HostedAssistantNotificationSignal[];
  }> => {
    const timeZones = await readCallCircleMatchParticipantTimeZones({
      groupId: input.match.groupId,
      memberAId: input.match.memberAId,
      memberBId: input.match.memberBId,
      prisma: tx,
    });
    if (!hasValidCallCircleParticipantTimeZones(timeZones)) {
      return { asked: false, signals: [] };
    }
    const now = input.clock();
    if (!await cancelCallCircleMatchIfParticipantsInactive({
      match: input.match,
      now,
      prisma: tx,
    })) {
      return { asked: false, signals: [] };
    }
    if (!shouldAdvanceCallCircleConfirmationStage({
      match: input.match,
      memberATimeZone: timeZones.memberATimeZone,
      memberBTimeZone: timeZones.memberBTimeZone,
      now,
      stage: input.stage,
    })) {
      return { asked: false, signals: [] };
    }
    const pendingRecipients = listCallCircleConfirmationRecipients({
      match: input.match,
      memberATimeZone: timeZones.memberATimeZone,
      memberBTimeZone: timeZones.memberBTimeZone,
      stage: input.stage,
    });
    if (pendingRecipients.length === 0) {
      return { asked: false, signals: [] };
    }
    const preflights = await Promise.all(pendingRecipients.map((recipient) =>
      readCallCircleNotificationPreflightTx({
        memberId: recipient.memberId,
        now,
        timeZone: recipient.timeZone,
        tx,
      })
    ));
    if (preflights.some((preflight) => preflight.status !== "ok")) {
      const dropped = await dropCallCircleMatchForNotificationBlocked({
        groupId: input.match.groupId,
        matchId: input.match.id,
        prisma: tx,
        sideAResponse: input.match.sideAResponse,
        sideBResponse: input.match.sideBResponse,
        stage: input.stage,
        windowEndAt: input.match.windowEndAt,
        windowStartAt: input.match.windowStartAt,
      });
      const signals = dropped && input.stage === "final"
        ? await appendCallCircleTerminalNotificationsTx({
            groupId: input.match.groupId,
            kind: "canceled",
            matchId: input.match.id,
            memberAId: input.match.memberAId,
            memberBId: input.match.memberBId,
            now,
            tx,
          })
        : [];
      return { asked: false, signals };
    }

    const pendingNotifications: PendingConfirmationNotification[] = [];
    for (let index = 0; index < pendingRecipients.length; index += 1) {
      const recipient = pendingRecipients[index];
      const preflight = preflights[index];
      if (!recipient || !preflight || preflight.status !== "ok") {
        return { asked: false, signals: [] };
      }
      pendingNotifications.push({
        memberId: recipient.memberId,
        preflight,
        timeZone: recipient.timeZone,
      });
    }

    const marked = await markCallCircleConfirmationStage({
      match: input.match,
      now,
      prisma: tx,
      stage: input.stage,
    });
    if (!marked) return { asked: false, signals: [] };

    const notifications = await Promise.all(pendingNotifications.map((notification) =>
      appendCallCircleConfirmNotificationTx({
        matchId: input.match.id,
        memberId: notification.memberId,
        now,
        preflight: notification.preflight,
        stage: input.stage,
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
  await signalHostedAssistantNotificationsBestEffort(transaction.signals);
  return transaction.asked;
}

function listCallCircleConfirmationRecipients(input: {
  match: SchedulerMatch;
  memberATimeZone: string;
  memberBTimeZone: string;
  stage: CallCircleConfirmationStage;
}): PendingConfirmationRecipient[] {
  if (input.stage === "final") {
    return [
      {
        memberId: input.match.memberAId,
        timeZone: input.memberATimeZone,
      },
      {
        memberId: input.match.memberBId,
        timeZone: input.memberBTimeZone,
      },
    ];
  }

  const recipients: PendingConfirmationRecipient[] = [];
  if (input.match.sideAResponse === "pending") {
    recipients.push({
      memberId: input.match.memberAId,
      timeZone: input.memberATimeZone,
    });
  }
  if (input.match.sideBResponse === "pending") {
    recipients.push({
      memberId: input.match.memberBId,
      timeZone: input.memberBTimeZone,
    });
  }
  return recipients;
}

async function markCallCircleConfirmationStage(input: {
  match: SchedulerMatch;
  now: Date;
  prisma: Prisma.TransactionClient;
  stage: CallCircleConfirmationStage;
}): Promise<boolean> {
  const shared = {
    groupId: input.match.groupId,
    matchId: input.match.id,
    memberAId: input.match.memberAId,
    memberBId: input.match.memberBId,
    now: input.now,
    prisma: input.prisma,
    sideAResponse: input.match.sideAResponse,
    sideBResponse: input.match.sideBResponse,
    windowEndAt: input.match.windowEndAt,
    windowStartAt: input.match.windowStartAt,
  };
  return input.stage === "am"
    ? markCallCircleMatchAmAsked(shared)
    : markCallCircleMatchFinalAsked(shared);
}

async function startDueCallCircleBridges(input: {
  clock: CallCircleSchedulerClock;
  connectorStarter?: CallCircleConnectorStarter;
  prisma: PrismaClient;
}): Promise<number> {
  const queryNow = input.clock();
  const matches: SchedulerMatch[] = await input.prisma.hostedCallCircleMatch.findMany({
    orderBy: [
      { windowStartAt: "asc" },
      { id: "asc" },
    ],
    take: CALL_CIRCLE_PHASE_LIMIT,
    where: {
      ...CALL_CIRCLE_RECOVERABLE_BRIDGE_WHERE,
      finalAskedAt: { not: null },
      windowEndAt: { gt: queryNow },
      windowStartAt: {
        gt: new Date(queryNow.getTime() - CALL_CIRCLE_BRIDGE_WINDOW_MS),
        lte: queryNow,
      },
    },
  });
  const starter = input.connectorStarter ?? startCallCircleConnectorCall;
  let attempts = 0;

  for (const match of matches) {
    const connectorResult = await startCallCircleConnectorMatch({
      matchId: match.id,
      now: input.clock(),
      prisma: input.prisma,
      starter,
    });
    if (!connectorResult) continue;
    attempts += 1;
  }

  return attempts;
}

async function handoffElapsedCallCircleBridges(input: {
  clock: CallCircleSchedulerClock;
  connectorStarter?: CallCircleConnectorStarter;
  prisma: PrismaClient;
}): Promise<number> {
  const queryNow = input.clock();
  const matches: SchedulerMatch[] = await input.prisma.hostedCallCircleMatch.findMany({
    orderBy: [
      { windowStartAt: "asc" },
      { id: "asc" },
    ],
    take: CALL_CIRCLE_PHASE_LIMIT,
    where: {
      AND: [
        CALL_CIRCLE_RECOVERABLE_BRIDGE_WHERE,
        {
          OR: [
            { windowEndAt: { lte: queryNow } },
            {
              windowStartAt: {
                lte: new Date(queryNow.getTime() - CALL_CIRCLE_BRIDGE_WINDOW_MS),
              },
            },
          ],
        },
      ],
      finalAskedAt: { not: null },
    },
  });
  const starter = input.connectorStarter ?? startCallCircleConnectorCall;
  let handedOff = 0;

  for (const match of matches) {
    const connectorResult = await startCallCircleConnectorMatch({
      matchId: match.id,
      now: input.clock(),
      prisma: input.prisma,
      starter,
    });
    if (connectorResult?.status === "handoff") {
      handedOff += 1;
    }
  }

  return handedOff;
}

async function startCallCircleConnectorMatch(input: {
  matchId: string;
  now: Date;
  prisma: PrismaClient;
  starter: CallCircleConnectorStarter;
}): Promise<Awaited<ReturnType<CallCircleConnectorStarter>> | null> {
  try {
    return await input.starter({
      matchId: input.matchId,
      now: input.now,
      prisma: input.prisma,
    });
  } catch {
    console.error(
      "Call Circle connector start failed; continuing scheduler batch.",
    );
    return null;
  }
}

async function appendPendingCallCircleSetupNotifications(input: {
  clock: CallCircleSchedulerClock;
  prisma: PrismaClient;
}): Promise<number> {
  const queryNow = input.clock();
  const participants: PendingCallCircleSetupParticipant[] =
    await input.prisma.hostedCallCircleParticipant.findMany({
      orderBy: [
        { nextMatchingAt: "asc" },
        { id: "asc" },
      ],
      select: {
        enrollmentGeneration: true,
        groupId: true,
        id: true,
        member: {
          select: { pendingActivationTimeZone: true },
        },
        memberId: true,
      },
      take: CALL_CIRCLE_PHASE_LIMIT,
      where: {
        nextMatchingAt: { lte: queryNow },
        preferencesJson: { equals: Prisma.DbNull },
        status: "enrolled",
      },
    });
  let asked = 0;

  for (const participant of participants) {
    const setupResult = await appendCallCircleSetupNotificationIfMissing({
      enrollmentGeneration: participant.enrollmentGeneration,
      groupId: participant.groupId,
      memberId: participant.memberId,
      now: input.clock(),
      participantId: participant.id,
      prisma: input.prisma,
      timeZone: participant.member.pendingActivationTimeZone,
    });
    if (setupResult.status === "appended") asked += 1;
    await input.prisma.hostedCallCircleParticipant.updateMany({
      data: {
        nextMatchingAt: setupResult.status === "blocked"
          ? new Date(input.clock().getTime() + CALL_CIRCLE_SETUP_RETRY_MS)
          : readNextCallCircleMatchingAt(input.clock()),
      },
      where: {
        enrollmentGeneration: setupResult.enrollmentGeneration,
        groupId: participant.groupId,
        id: participant.id,
        memberId: participant.memberId,
        nextMatchingAt: { lte: queryNow },
        preferencesJson: { equals: Prisma.DbNull },
        status: "enrolled",
      },
    });
  }
  return asked;
}

interface PendingCallCircleSetupParticipant {
  enrollmentGeneration: number;
  groupId: string;
  id: string;
  member: { pendingActivationTimeZone: string | null };
  memberId: string;
}

async function appendCallCircleSetupNotificationIfMissing(input: {
  enrollmentGeneration: number;
  groupId: string;
  memberId: string;
  now: Date;
  participantId: string;
  prisma: PrismaClient;
  timeZone: string | null;
}): Promise<{
  enrollmentGeneration: number;
  status: "appended" | "blocked" | "existing";
}> {
  const transaction = await input.prisma.$transaction(async (tx): Promise<{
    enrollmentGeneration: number;
    signals: HostedAssistantNotificationSignal[];
    status: "appended" | "blocked" | "existing";
  }> => {
    await lockHostedMemberRow(tx, input.memberId);
    let enrollmentGeneration = input.enrollmentGeneration;
    const eventId = buildCallCircleSetupNotificationEventId({
      enrollmentGeneration,
      groupId: input.groupId,
      memberId: input.memberId,
      participantId: input.participantId,
    });
    const existing = await tx.hostedMailboxItem.findUnique({
      select: { kind: true },
      where: {
        userId_dedupeKey: {
          dedupeKey: eventId,
          userId: input.memberId,
        },
      },
    });
    if (existing && existing.kind !== "assistant.notification.superseded") {
      return { enrollmentGeneration, signals: [], status: "existing" };
    }
    if (existing) {
      const replacementGeneration = enrollmentGeneration + 1;
      const advanced = await tx.hostedCallCircleParticipant.updateMany({
        data: { enrollmentGeneration: replacementGeneration },
        where: {
          ...activeCallCircleParticipantWhere({
            groupId: input.groupId,
            memberId: input.memberId,
          }),
          enrollmentGeneration,
          id: input.participantId,
          preferencesJson: { equals: Prisma.DbNull },
        },
      });
      if (advanced.count === 0) {
        return { enrollmentGeneration, signals: [], status: "blocked" };
      }
      enrollmentGeneration = replacementGeneration;
    }

    const notification = await appendCallCircleSetupNotificationTx({
      enrollmentGeneration,
      groupId: input.groupId,
      memberId: input.memberId,
      now: input.now,
      participantId: input.participantId,
      requireDaytime: true,
      timeZone: input.timeZone,
      tx,
    });
    const signal = notification ? readCallCircleNotificationSignal({
      memberId: input.memberId,
      notification,
    }) : null;
    return {
      enrollmentGeneration,
      signals: signal ? [signal] : [],
      status: notification?.status === "sent" ? "appended" : "blocked",
    };
  });
  if (transaction.signals.length > 0) {
    await signalHostedAssistantNotificationsBestEffort(transaction.signals);
  }
  return {
    enrollmentGeneration: transaction.enrollmentGeneration,
    status: transaction.status,
  };
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
  await cancelCallCircleMatchForInactivePair({
    groupId: input.match.groupId,
    matchId: input.match.id,
    memberAId: input.match.memberAId,
    memberBId: input.match.memberBId,
    now: input.now,
    prisma: input.prisma,
  });
  return false;
}

interface SchedulerMatch {
  amAskedAt: Date | null;
  finalAskedAt: Date | null;
  groupId: string;
  id: string;
  memberAId: string;
  memberBId: string;
  sideAResponse: HostedCallCircleMatchResponse;
  sideBResponse: HostedCallCircleMatchResponse;
  status: string;
  windowEndAt: Date;
  windowStartAt: Date;
}

interface PendingConfirmationRecipient {
  memberId: string;
  timeZone: string;
}

interface PendingConfirmationNotification extends PendingConfirmationRecipient {
  preflight: CallCircleNotificationPreflightOk;
}

function hasValidCallCircleParticipantTimeZones(
  timeZones: {
    memberATimeZone: string;
    memberBTimeZone: string;
  } | null,
): timeZones is {
  memberATimeZone: string;
  memberBTimeZone: string;
} {
  return timeZones !== null
    && isHostedCallCircleTimeZone(timeZones.memberATimeZone)
    && isHostedCallCircleTimeZone(timeZones.memberBTimeZone);
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

function isAffirmativeCallCircleResponse(
  response: HostedCallCircleMatchResponse,
): boolean {
  return response === "confirmed" || response === "countered";
}
