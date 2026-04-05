import { HostedBillingStatus, Prisma, type HostedMember, type PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { enqueueHostedExecutionOutbox } from "../hosted-execution/outbox";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

import {
  buildHostedShareAcceptanceDispatch,
  buildHostedShareAcceptanceEventId,
  createHostedShareMinimalPreview,
  requireHostedShareLink,
  hashHostedShareCode,
  normalizeOptionalString,
  readHostedSharePack,
} from "./shared";
import type { AcceptHostedShareResult } from "./types";

export async function acceptHostedShareLink(input: {
  member?: HostedMember;
  prisma?: PrismaClient;
  shareCode: string;
}): Promise<AcceptHostedShareResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = new Date();
  const shareCode = normalizeOptionalString(input.shareCode);
  const member = input.member;

  if (!shareCode) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_CODE_REQUIRED",
      message: "A share code is required.",
      httpStatus: 400,
    });
  }

  if (!member) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Sign in again before adding a shared bundle.",
      httpStatus: 401,
    });
  }

  if (member.billingStatus !== HostedBillingStatus.active) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_ACTIVE_REQUIRED",
      message: "Finish hosted activation before adding a shared bundle.",
      httpStatus: 403,
    });
  }

  const memberId = member.id;
  const codeHash = hashHostedShareCode(shareCode);
  const claim = await prisma.$transaction(async (tx) => {
    await lockHostedShareLinkRow(tx, codeHash);

    const latest = await requireHostedShareLink(shareCode, tx);

    if (latest.expiresAt <= now) {
      throw hostedOnboardingError({
        code: "HOSTED_SHARE_EXPIRED",
        message: "That share link expired. Ask for a fresh link.",
        httpStatus: 410,
      });
    }

    if (latest.consumedAt) {
      if (latest.consumedByMemberId === memberId) {
        return {
          outcome: "alreadyImported" as const,
          preview: createHostedShareMinimalPreview(latest.previewTitle),
          record: latest,
        };
      }

      throw hostedOnboardingError({
        code: "HOSTED_SHARE_CONSUMED",
        message: "That share link has already been used.",
        httpStatus: 409,
      });
    }

    if (latest.acceptedByMemberId && latest.acceptedByMemberId !== memberId) {
      throw hostedOnboardingError({
        code: "HOSTED_SHARE_ALREADY_CLAIMED",
        message: "That share link has already been claimed by another member.",
        httpStatus: 409,
      });
    }

    const sharePack = await readHostedSharePack(latest);
    const acceptedAt = latest.acceptedAt ?? now;
    const eventId = latest.lastEventId ?? buildHostedShareAcceptanceEventId({
      acceptedAt,
      memberId,
      shareId: latest.id,
    });
    const record = latest.acceptedAt?.getTime() === acceptedAt.getTime()
      && latest.acceptedByMemberId === memberId
      && latest.lastEventId === eventId
      ? latest
      : await tx.hostedShareLink.update({
          where: {
            id: latest.id,
          },
          data: {
            acceptedAt,
            acceptedByMemberId: memberId,
            lastEventId: eventId,
          },
        });

    await enqueueHostedExecutionOutbox({
      dispatch: buildHostedShareAcceptanceDispatch({
        acceptedAt: acceptedAt.toISOString(),
        eventId,
        memberId,
        pack: sharePack.pack,
        shareId: record.id,
      }),
      sourceId: record.id,
      sourceType: "hosted_share_link",
      tx,
    });

    return {
      outcome: "pending" as const,
      preview: createHostedShareMinimalPreview(record.previewTitle),
      record,
    };
  });

  if (claim.outcome === "alreadyImported") {
    return {
      alreadyImported: true,
      imported: true,
      pending: false,
      preview: claim.preview,
      shareCode,
    };
  }

  const imported = Boolean(
    claim.record.consumedAt && claim.record.consumedByMemberId === memberId,
  );

  return {
    alreadyImported: false,
    imported,
    pending: !imported,
    preview: claim.preview,
    shareCode,
  };
}

async function lockHostedShareLinkRow(
  tx: Prisma.TransactionClient,
  codeHash: string,
): Promise<void> {
  await tx.$queryRaw`select 1 from "hosted_share_link" where "code_hash" = ${codeHash} for update`;
}
