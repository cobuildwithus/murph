import type {
  HostedMember,
  HostedShareLink,
  PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";

import { acceptHostedShareLink } from "./acceptance-service";
import {
  buildHostedSharePageData as buildHostedSharePageDataBase,
  createHostedShareLink as createHostedShareLinkBase,
} from "./link-service";
import {
  finalizeHostedShareAcceptance,
  findHostedShareLinkByCode,
  readHostedShareDispatchState,
  releaseHostedShareAcceptance,
} from "./shared";
import type {
  AcceptHostedShareResult,
  CreateHostedShareLinkResult,
  HostedSharePageData,
  HostedSharePageStage,
  HostedSharePreview,
} from "./types";

export type {
  AcceptHostedShareResult,
  CreateHostedShareLinkResult,
  HostedSharePageData,
  HostedSharePageStage,
  HostedSharePreview,
} from "./types";
export { acceptHostedShareLink };

export async function createHostedShareLink(
  input: Parameters<typeof createHostedShareLinkBase>[0],
): Promise<CreateHostedShareLinkResult> {
  return createHostedShareLinkBase({
    ...input,
    prisma: input.prisma ?? getPrisma(),
  });
}

export async function buildHostedSharePageData(input: {
  authenticatedMember?: HostedMember | null;
  inviteCode?: string | null;
  prisma?: PrismaClient;
  shareCode: string;
}): Promise<HostedSharePageData> {
  const prisma = input.prisma ?? getPrisma();
  let data = await buildHostedSharePageDataBase({
    ...input,
    prisma,
  });
  const memberId = input.authenticatedMember?.id ?? null;

  if (data.stage !== "processing" || !memberId) {
    return data;
  }

  const shareLink = await findHostedShareLinkByCode(input.shareCode, prisma);

  if (!shouldReconcileHostedSharePageState(shareLink, memberId)) {
    return data;
  }

  const dispatchState = await readHostedShareDispatchState({
    eventId: shareLink.lastEventId,
    memberId,
    prisma,
  });

  if (dispatchState === "completed") {
    await finalizeHostedShareAcceptance({
      eventId: shareLink.lastEventId,
      memberId,
      prisma,
      shareId: shareLink.id,
    });
    data = await buildHostedSharePageDataBase({
      ...input,
      prisma,
    });
  } else if (dispatchState === "poisoned") {
    await releaseHostedShareAcceptance({
      eventId: shareLink.lastEventId,
      memberId,
      prisma,
      shareId: shareLink.id,
    });
    data = await buildHostedSharePageDataBase({
      ...input,
      prisma,
    });
  }

  return data;
}
function shouldReconcileHostedSharePageState(
  shareLink: HostedShareLink | null,
  memberId: string,
): shareLink is HostedShareLink & { lastEventId: string } {
  return Boolean(
    shareLink
    && shareLink.acceptedByMemberId === memberId
    && !shareLink.consumedAt
    && shareLink.lastEventId,
  );
}
