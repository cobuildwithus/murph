import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  createHostedPhoneLookupKeyReadCandidates,
  readHostedPhoneHint,
} from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  acquireHostedMemberHomeLinqRouteLockTx,
  readHostedMemberRoutingState,
  type HostedMemberRoutingStateSnapshot,
  upsertHostedMemberHomeLinqRecipientPhoneTx,
} from "../hosted-onboarding/hosted-member-routing-store";
import { readHostedLinqHomeLineAuthority } from "../hosted-onboarding/linq-home-routing";
import {
  listHostedLinqAssignableHomeLines,
  type HostedLinqAssignableHomeLine,
} from "../hosted-onboarding/linq-line-store";
import {
  readHostedLinqLinePlanningLoadSnapshot,
} from "../hosted-onboarding/linq-line-planning-load";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { getPrisma } from "../prisma";

type HostedLinqRehomeClient = PrismaClient | Prisma.TransactionClient;

export interface HostedLinqLineRehomeOverview {
  assignableTargetLines: HostedLinqLineRehomeTargetLine[];
  currentRouting: HostedLinqLineRehomeRoutingSummary;
  generatedAt: string;
  member: {
    id: string;
    suspendedAt: string | null;
  };
  planningProjection: {
    complete: boolean;
    unprojectedGroupThreadCount: number;
  };
}

export interface HostedLinqLineRehomeTargetLine {
  activeDirectMemberCount: number;
  maxNewConversationsPerDay: number | null;
  plannedMessages: number;
  phoneNumberHint: string;
  phoneNumberLookupKey: string;
  provisionedGroupThreadCount: number;
}

export interface HostedLinqLineRehomeRoutingSummary {
  authorityKind: "bare" | "home" | "none" | "pending";
  currentLinePhoneHint: string | null;
  homeChatBound: boolean;
  linqHomeLineAssignedAt: string | null;
  linqRecipientPhoneLookupKey: string | null;
}

export interface HostedLinqLineRehomeResult {
  clearedHomeChat: boolean;
  clearedPendingRoute: boolean;
  fromLineHint: string | null;
  toLineHint: string;
}

export async function readHostedLinqLineRehomeOverview(input: {
  memberId: string;
  prisma?: PrismaClient;
}): Promise<HostedLinqLineRehomeOverview> {
  const memberId = normalizeHostedLinqRehomeRequiredString(
    input.memberId,
    "HOSTED_LINQ_REHOME_MEMBER_ID_REQUIRED",
    "Hosted Linq rehome requires a member id.",
  );
  const prisma = input.prisma ?? getPrisma();
  const now = new Date();
  const member = await readHostedLinqRehomeMemberOrThrow({
    memberId,
    prisma,
    rejectSuspended: false,
  });
  const [routingRead, targetLines] = await Promise.all([
    readHostedLinqRehomeRoutingState({
      memberId,
      prisma,
    }),
    listHostedLinqAssignableHomeLines({ prisma }),
  ]);
  const planningLoad = await readHostedLinqLinePlanningLoadSnapshot({
    lines: targetLines,
    now,
    prisma,
  });

  return {
    assignableTargetLines: targetLines.map((line) => {
      const load = planningLoad.byRecipientPhone.get(line.phoneNumber) ?? {
        activeDirectMemberCount: 0,
        plannedMessages: 0,
        provisionedGroupThreadCount: 0,
      };
      return {
        activeDirectMemberCount: load.activeDirectMemberCount,
        maxNewConversationsPerDay: line.maxNewConversationsPerDay,
        plannedMessages: load.plannedMessages,
        phoneNumberHint: line.phoneNumberHint,
        phoneNumberLookupKey: line.phoneNumberLookupKey,
        provisionedGroupThreadCount: load.provisionedGroupThreadCount,
      };
    }),
    currentRouting: summarizeHostedLinqRehomeRouting(routingRead),
    generatedAt: now.toISOString(),
    member: {
      id: member.id,
      suspendedAt: member.suspendedAt?.toISOString() ?? null,
    },
    planningProjection: {
      complete: planningLoad.projectionCoverageComplete,
      unprojectedGroupThreadCount: planningLoad.unprojectedGroupThreadCount,
    },
  };
}

export async function rehomeHostedMemberLinqHomeLine(input: {
  memberId: string;
  prisma?: PrismaClient;
  targetLineLookupKey: string;
}): Promise<HostedLinqLineRehomeResult> {
  const memberId = normalizeHostedLinqRehomeRequiredString(
    input.memberId,
    "HOSTED_LINQ_REHOME_MEMBER_ID_REQUIRED",
    "Hosted Linq rehome requires a member id.",
  );
  const targetLineLookupKey = normalizeHostedLinqRehomeRequiredString(
    input.targetLineLookupKey,
    "HOSTED_LINQ_REHOME_TARGET_LOOKUP_KEY_REQUIRED",
    "Hosted Linq rehome requires a target line lookup key.",
  );
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction(async (tx) => {
    await readHostedLinqRehomeMemberOrThrow({
      memberId,
      prisma: tx,
      rejectSuspended: true,
    });
    await assertHostedLinqRehomeMemberHasPhoneIdentity({
      memberId,
      prisma: tx,
    });
    await acquireHostedMemberHomeLinqRouteLockTx({
      memberId,
      prisma: tx,
    });

    const target = (await listHostedLinqAssignableHomeLines({ prisma: tx }))
      .find((line) => line.phoneNumberLookupKey === targetLineLookupKey);
    if (!target) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_REHOME_TARGET_NOT_ASSIGNABLE",
        httpStatus: 400,
        message: "Hosted Linq rehome target line is not assignable.",
        retryable: false,
      });
    }

    const routing = await readHostedMemberRoutingState({
      memberId,
      prisma: tx,
    });
    if (hostedLinqRoutingAlreadyTargetsLine({ routing, target })) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_REHOME_ALREADY_ON_TARGET",
        httpStatus: 409,
        message: "Hosted member is already homed on the requested Linq line.",
        retryable: false,
      });
    }

    const now = new Date();
    await upsertHostedMemberHomeLinqRecipientPhoneTx({
      clearPending: true,
      homeLineAssignedAt: now,
      memberId,
      prisma: tx,
      recipientPhone: target.phoneNumber,
    });

    return {
      clearedHomeChat: Boolean(routing?.linqChatId),
      clearedPendingRoute: routing?.hasPendingLinqRouteState === true,
      fromLineHint: readHostedLinqRehomeAuthorityPhoneHint(routing),
      toLineHint: target.phoneNumberHint,
    };
  });
}

async function readHostedLinqRehomeMemberOrThrow(input: {
  memberId: string;
  prisma: HostedLinqRehomeClient;
  rejectSuspended: boolean;
}): Promise<{ id: string; suspendedAt: Date | null }> {
  const member = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: {
      id: true,
      suspendedAt: true,
    },
  });

  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_REHOME_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "Hosted Linq rehome member was not found.",
      retryable: false,
    });
  }

  if (input.rejectSuspended && member.suspendedAt) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_REHOME_MEMBER_SUSPENDED",
      httpStatus: 409,
      message: "Hosted Linq rehome cannot run for a suspended member.",
      retryable: false,
    });
  }

  return member;
}

async function assertHostedLinqRehomeMemberHasPhoneIdentity(input: {
  memberId: string;
  prisma: HostedLinqRehomeClient;
}): Promise<void> {
  const identity = await input.prisma.hostedMemberIdentity.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: {
      phoneLookupKey: true,
    },
  });

  if (identity?.phoneLookupKey) {
    return;
  }

  // Linq rediscovers fresh chats by member phone identity; activation already
  // requires one, so rehome cannot clear old chat bindings for phone-less members.
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_REHOME_MEMBER_PHONE_REQUIRED",
    httpStatus: 409,
    message: "Hosted Linq rehome requires a verified member phone identity.",
    retryable: false,
  });
}

async function readHostedLinqRehomeRoutingState(input: {
  memberId: string;
  prisma: HostedLinqRehomeClient;
}): Promise<{
  routing: HostedMemberRoutingStateSnapshot | null;
}> {
  return {
    routing: await readHostedMemberRoutingState({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
  };
}

function summarizeHostedLinqRehomeRouting(input: {
  routing: HostedMemberRoutingStateSnapshot | null;
}): HostedLinqLineRehomeRoutingSummary {
  const authority = readHostedLinqHomeLineAuthority(input.routing);

  return {
    authorityKind: authority.kind,
    currentLinePhoneHint: authority.kind === "none"
      ? null
      : readHostedPhoneHint(authority.recipientPhone),
    homeChatBound: Boolean(input.routing?.linqChatId),
    linqHomeLineAssignedAt:
      input.routing?.linqHomeLineAssignedAt?.toISOString() ?? null,
    linqRecipientPhoneLookupKey:
      input.routing?.linqRecipientPhoneLookupKey ?? null,
  };
}

function hostedLinqRoutingAlreadyTargetsLine(input: {
  routing: HostedMemberRoutingStateSnapshot | null;
  target: HostedLinqAssignableHomeLine;
}): boolean {
  if (normalizePhoneNumber(input.routing?.linqRecipientPhone) === input.target.phoneNumber) {
    return true;
  }

  const currentLookupKey = input.routing?.linqRecipientPhoneLookupKey;
  if (!currentLookupKey) {
    return false;
  }

  return createHostedPhoneLookupKeyReadCandidates(input.target.phoneNumber)
    .includes(currentLookupKey);
}

function readHostedLinqRehomeAuthorityPhoneHint(
  routing: HostedMemberRoutingStateSnapshot | null,
): string | null {
  const authority = readHostedLinqHomeLineAuthority(routing);
  return authority.kind === "none" ? null : readHostedPhoneHint(authority.recipientPhone);
}

function normalizeHostedLinqRehomeRequiredString(
  value: string,
  code: string,
  message: string,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw hostedOnboardingError({
      code,
      httpStatus: 400,
      message,
      retryable: false,
    });
  }

  return normalized;
}
