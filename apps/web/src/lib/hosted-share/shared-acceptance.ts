import type {
  HostedShareLink,
  Prisma,
} from "@prisma/client";

import { hostedOnboardingError } from "../hosted-onboarding/errors";

import { hashHostedShareCode, normalizeOptionalString } from "./shared-identifiers";
import { deleteHostedSharePayload } from "./shared-payload";
import type { HostedSharePrismaClient } from "./types";

export type HostedShareAcceptanceLifecycleState =
  | "completed"
  | "queued"
  | "quarantined";

export function findHostedShareLinkByCode(
  shareCode: string,
  prisma: HostedSharePrismaClient,
) {
  return prisma.hostedShareLink.findUnique({
    where: {
      codeHash: hashHostedShareCode(shareCode),
    },
  });
}

export async function requireHostedShareLink(
  shareCode: string,
  prisma: HostedSharePrismaClient,
) {
  const record = await findHostedShareLinkByCode(shareCode, prisma);

  if (!record) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_NOT_FOUND",
      message: "That share link is not valid.",
      httpStatus: 404,
    });
  }

  return record;
}

export async function releaseHostedShareAcceptance(input: {
  eventId: string;
  memberId: string | null | undefined;
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<boolean> {
  return updateHostedShareAcceptanceClaim({
    data: {
      acceptedAt: null,
      acceptedByMemberId: null,
      consumedByMemberId: null,
      lastEventId: null,
    },
    eventId: input.eventId,
    memberId: input.memberId,
    prisma: input.prisma,
    shareId: input.shareId,
  });
}

export interface HostedShareAcceptanceFinalizationResult {
  finalized: boolean;
  shareFound: boolean;
  sharePackOwnerMemberId: string | null;
}

export async function finalizeHostedShareAcceptance(input: {
  eventId: string;
  memberId: string | null;
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<HostedShareAcceptanceFinalizationResult> {
  const memberId = normalizeOptionalString(input.memberId);

  if (!memberId) {
    return {
      finalized: false,
      shareFound: false,
      sharePackOwnerMemberId: null,
    };
  }

  const finalized = await updateHostedShareAcceptanceClaim({
    data: {
      consumedAt: new Date(),
      consumedByMemberId: memberId,
    },
    eventId: input.eventId,
    memberId,
    prisma: input.prisma,
    shareId: input.shareId,
  });
  const finalizationState = await readHostedShareAcceptanceFinalizationState({
    eventId: input.eventId,
    memberId,
    prisma: input.prisma,
    shareId: input.shareId,
  });

  if (finalizationState.sharePackOwnerMemberId) {
    await deleteHostedSharePayload({
      prisma: input.prisma,
      shareId: input.shareId,
    });
  }

  return {
    finalized,
    ...finalizationState,
  };
}

export async function readHostedShareWakeLifecycleState(input: {
  eventId: string;
  memberId: string;
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<HostedShareAcceptanceLifecycleState | null> {
  const record = await input.prisma.hostedShareLink.findUnique({
    select: {
      acceptedByMemberId: true,
      consumedAt: true,
      consumedByMemberId: true,
      lastEventId: true,
    },
    where: {
      id: input.shareId,
    },
  });

  if (
    !record
    || record.acceptedByMemberId !== input.memberId
    || record.lastEventId !== input.eventId
  ) {
    return null;
  }

  if (record.consumedAt && record.consumedByMemberId === input.memberId) {
    return "completed";
  }

  return "queued";
}

export async function reconcileHostedShareAcceptanceLifecycle(input: {
  eventId: string;
  memberId: string;
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<HostedShareAcceptanceLifecycleState | null> {
  const state = await readHostedShareWakeLifecycleState({
    eventId: input.eventId,
    memberId: input.memberId,
    prisma: input.prisma,
    shareId: input.shareId,
  });

  if (state === "completed") {
    await finalizeHostedShareAcceptance({
      eventId: input.eventId,
      memberId: input.memberId,
      prisma: input.prisma,
      shareId: input.shareId,
    });
  } else if (state === "quarantined") {
    await releaseHostedShareAcceptance({
      eventId: input.eventId,
      memberId: input.memberId,
      prisma: input.prisma,
      shareId: input.shareId,
    });
  }

  return state;
}

async function updateHostedShareAcceptanceClaim(input: {
  data: Prisma.HostedShareLinkUpdateManyMutationInput;
  eventId: string;
  memberId: string | null | undefined;
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<boolean> {
  const memberId = normalizeOptionalString(input.memberId);

  if (!memberId) {
    return false;
  }

  const updated = await input.prisma.hostedShareLink.updateMany({
    where: buildHostedShareAcceptanceClaimWhere({
      eventId: input.eventId,
      memberId,
      shareId: input.shareId,
    }),
    data: input.data,
  });

  return updated.count === 1;
}

async function readHostedShareAcceptanceFinalizationState(input: {
  eventId: string;
  memberId: string | null | undefined;
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<Omit<HostedShareAcceptanceFinalizationResult, "finalized">> {
  const record = await input.prisma.hostedShareLink.findUnique({
    select: {
      consumedAt: true,
      consumedByMemberId: true,
      lastEventId: true,
      senderMemberId: true,
    },
    where: {
      id: input.shareId,
    },
  });

  if (!record) {
    return {
      shareFound: false,
      sharePackOwnerMemberId: null,
    };
  }

  return {
    shareFound: true,
    sharePackOwnerMemberId: isHostedShareConsumedForAcceptanceEvent({
      eventId: input.eventId,
      memberId: input.memberId,
      record,
    })
      ? record.senderMemberId
      : null,
  };
}

function buildHostedShareAcceptanceClaimWhere(input: {
  eventId: string;
  memberId: string;
  shareId: string;
}): Prisma.HostedShareLinkWhereInput {
  return {
    acceptedByMemberId: input.memberId,
    consumedAt: null,
    id: input.shareId,
    lastEventId: input.eventId,
  } satisfies Prisma.HostedShareLinkWhereInput;
}

function isHostedShareConsumedForAcceptanceEvent(input: {
  eventId: string;
  memberId: string | null | undefined;
  record: Pick<HostedShareLink, "consumedAt" | "consumedByMemberId" | "lastEventId">;
}): boolean {
  const memberId = normalizeOptionalString(input.memberId);

  return Boolean(
    memberId
    && input.record.consumedAt
    && input.record.consumedByMemberId === memberId
    && input.record.lastEventId === input.eventId,
  );
}
