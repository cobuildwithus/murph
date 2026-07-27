import "server-only";

import type { PrismaClient } from "@prisma/client";
import type { HostedExecutionWake } from "@murphai/hosted-execution/contracts";
import {
  resolveHostedRuntimeManagedGroupActivityWindow,
} from "@murphai/hosted-execution/managed-group-activity";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";
import {
  type HostedRuntimeManagedGroupActivityDecisionRequest,
  type HostedRuntimeManagedGroupActivityDecisionResponse,
} from "@murphai/hosted-execution/runtime-control";

import { decodeHostedMailboxStoredPayload } from "../hosted-mailbox/store";
import {
  assertHostedThreadRouteEgressAuthority,
} from "../hosted-routing/thread-route-store";
import { getPrisma } from "../prisma";

const MANAGED_GROUP_ACTIVITY_MESSAGE_THRESHOLD = 100;
const MANAGED_GROUP_ACTIVITY_MAX_SCANNED_ROWS = 2_000;

export interface ManagedGroupActivityMailboxRow {
  createdAt: Date;
  dedupeKey: string;
  id: string;
  kind: string;
  lane: string;
  laneSeq: bigint;
  occurredAt: Date;
  payload: { payloadCiphertext: string } | null;
  payloadInlineCiphertext: string | null;
  payloadSchema: string;
  userId: string;
}

export async function readHostedManagedGroupActivityDecision(input: {
  memberId: string;
  prisma?: PrismaClient;
  request: HostedRuntimeManagedGroupActivityDecisionRequest;
}): Promise<HostedRuntimeManagedGroupActivityDecisionResponse> {
  try {
    return await readHostedManagedGroupActivityDecisionStrict(input);
  } catch {
    return { status: "unavailable" };
  }
}

async function readHostedManagedGroupActivityDecisionStrict(input: {
  memberId: string;
  prisma?: PrismaClient;
  request: HostedRuntimeManagedGroupActivityDecisionRequest;
}): Promise<HostedRuntimeManagedGroupActivityDecisionResponse> {
  if (input.request.policy !== "group-sunday-superlatives-v1") {
    return { status: "unavailable" };
  }
  const prisma = input.prisma ?? getPrisma();
  const group = await prisma.hostedGroup.findUnique({
    select: { id: true },
    where: { runtimeMemberId: input.memberId },
  });
  if (!group) {
    return { status: "unavailable" };
  }

  await assertHostedThreadRouteEgressAuthority({
    authority: {
      channel: input.request.route.channel,
      containerMemberId: input.memberId,
      threadId: input.request.route.target,
    },
    prisma,
  });

  const window = resolveHostedRuntimeManagedGroupActivityWindow({
    occurrenceAt: input.request.occurrenceAt,
    timeZone: input.request.timeZone,
  });
  const occurrenceAt = new Date(window.occurrenceAt);
  const rows = await prisma.hostedMailboxItem.findMany({
    orderBy: [
      { createdAt: "asc" },
      { id: "asc" },
    ],
    select: {
      createdAt: true,
      dedupeKey: true,
      id: true,
      kind: true,
      lane: true,
      laneSeq: true,
      occurredAt: true,
      payload: {
        select: {
          payloadCiphertext: true,
        },
      },
      payloadInlineCiphertext: true,
      payloadSchema: true,
      userId: true,
    },
    take: MANAGED_GROUP_ACTIVITY_MAX_SCANNED_ROWS + 1,
    where: {
      createdAt: { lt: occurrenceAt },
      kind: "conversation.message",
      lane: "conversation",
      occurredAt: {
        gte: new Date(window.windowStartAt),
        lt: occurrenceAt,
      },
      userId: input.memberId,
    },
  });

  return await evaluateHostedManagedGroupActivityMailboxRows({
    decodePayload: (row) => decodeManagedGroupActivityMailboxRow({
      prisma,
      row,
    }),
    memberId: input.memberId,
    request: input.request,
    rows,
  });
}

export async function evaluateHostedManagedGroupActivityMailboxRows(input: {
  decodePayload?: (
    row: ManagedGroupActivityMailboxRow,
  ) => Promise<unknown | null>;
  memberId: string;
  request: HostedRuntimeManagedGroupActivityDecisionRequest;
  rows: readonly ManagedGroupActivityMailboxRow[];
}): Promise<HostedRuntimeManagedGroupActivityDecisionResponse> {
  const window = resolveHostedRuntimeManagedGroupActivityWindow({
    occurrenceAt: input.request.occurrenceAt,
    timeZone: input.request.timeZone,
  });
  const occurrenceAtMs = Date.parse(window.occurrenceAt);
  const windowStartAtMs = Date.parse(window.windowStartAt);
  let eligibleMessages = 0;

  for (const [index, row] of input.rows.entries()) {
    if (index >= MANAGED_GROUP_ACTIVITY_MAX_SCANNED_ROWS) {
      return { status: "unavailable" };
    }
    if (
      row.userId !== input.memberId
      || row.kind !== "conversation.message"
      || row.lane !== "conversation"
      || row.createdAt.getTime() >= occurrenceAtMs
      || row.occurredAt.getTime() < windowStartAtMs
      || row.occurredAt.getTime() >= occurrenceAtMs
    ) {
      continue;
    }

    let wake: HostedExecutionWake;
    try {
      const payload = input.decodePayload
        ? await input.decodePayload(row)
        : await decodeManagedGroupActivityMailboxRow({ row });
      if (payload === null) {
        return { status: "unavailable" };
      }
      wake = parseHostedExecutionWake(payload);
    } catch {
      return { status: "unavailable" };
    }

    if (!managedGroupActivityWakeMatchesRoute({
      memberId: input.memberId,
      occurredAt: row.occurredAt,
      route: input.request.route,
      wake,
    })) {
      continue;
    }

    eligibleMessages += 1;
    if (eligibleMessages >= MANAGED_GROUP_ACTIVITY_MESSAGE_THRESHOLD) {
      return { status: "eligible" };
    }
  }

  return { status: "ineligible" };
}

async function decodeManagedGroupActivityMailboxRow(input: {
  prisma?: PrismaClient;
  row: ManagedGroupActivityMailboxRow;
}): Promise<unknown | null> {
  return await decodeHostedMailboxStoredPayload({
    dedupeKey: input.row.dedupeKey,
    kind: input.row.kind,
    lane: input.row.lane,
    laneSeq: input.row.laneSeq,
    mailboxItemId: input.row.id,
    occurredAt: input.row.occurredAt.toISOString(),
    payloadCiphertext: input.row.payload?.payloadCiphertext ?? null,
    payloadInlineCiphertext: input.row.payloadInlineCiphertext,
    payloadSchema: input.row.payloadSchema,
    prisma: input.prisma,
    userId: input.row.userId,
  });
}

function managedGroupActivityWakeMatchesRoute(input: {
  memberId: string;
  occurredAt: Date;
  route: HostedRuntimeManagedGroupActivityDecisionRequest["route"];
  wake: HostedExecutionWake;
}): boolean {
  if (
    input.wake.kind !== "conversation.message"
    || input.wake.userId !== input.memberId
    || input.wake.occurredAt !== input.occurredAt.toISOString()
    || input.wake.message.channel !== input.route.channel
  ) {
    return false;
  }
  const authority = input.wake.message.routeAuthority;
  if (
    !authority
    || authority.channel !== input.route.channel
    || authority.containerMemberId !== input.memberId
    || authority.threadId !== input.route.target
  ) {
    return false;
  }

  if (input.wake.message.channel === "linq") {
    const message = input.wake.message.linqMessage;
    return (
      message.chatId === input.route.target
      && message.threadIsDirect === false
      && message.isFromMe === false
      && message.affirmativeReaction !== true
      && input.wake.message.groupParticipantAdded !== true
      && message.from.trim().length > 0
      && message.parts.length > 0
    );
  }

  const message = input.wake.message.telegramMessage;
  return (
    message.threadId === input.route.target
    && message.threadIsDirect === false
    && typeof message.from === "string"
    && message.from.trim().length > 0
    && (
      (typeof message.text === "string" && message.text.trim().length > 0)
      || (message.attachments?.length ?? 0) > 0
    )
  );
}
