import { HostedBillingStatus, type PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  drainHostedExecutionOutbox,
  findHostedExecutionOutboxByEventId,
  readHostedExecutionOutboxOutcome,
  enqueueHostedExecutionOutbox,
} from "../hosted-execution/outbox";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import type { HostedSessionRecord } from "../hosted-onboarding/session";

import {
  buildHostedShareAcceptanceDispatch,
  buildHostedShareAcceptanceEventId,
  finalizeHostedShareAcceptance,
  readHostedSharePack,
  readHostedSharePreview,
  releaseHostedShareAcceptance,
  requireHostedShareLink,
  hashHostedShareCode,
  normalizeOptionalString,
} from "./shared";
import type { AcceptHostedShareResult } from "./types";

export async function acceptHostedShareLink(input: {
  prisma?: PrismaClient;
  sessionRecord: HostedSessionRecord;
  shareCode: string;
}): Promise<AcceptHostedShareResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = new Date();
  const shareCode = normalizeOptionalString(input.shareCode);

  if (!shareCode) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_CODE_REQUIRED",
      message: "A share code is required.",
      httpStatus: 400,
    });
  }

  if (input.sessionRecord.member.billingStatus !== HostedBillingStatus.active) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_ACTIVE_REQUIRED",
      message: "Finish hosted activation before adding a shared bundle.",
      httpStatus: 403,
    });
  }

  let record = await requireHostedShareLink(shareCode, prisma);
  const preview = readHostedSharePreview(record.previewJson, readHostedSharePack(record).pack);
  const acceptedAt = record.acceptedAt ?? now;
  const eventId = record.lastEventId ?? buildHostedShareAcceptanceEventId({
    acceptedAt,
    memberId: input.sessionRecord.member.id,
    shareId: record.id,
  });

  if (record.expiresAt <= now) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_EXPIRED",
      message: "That share link expired. Ask for a fresh link.",
      httpStatus: 410,
    });
  }

  if (record.consumedAt) {
    if (record.consumedByMemberId === input.sessionRecord.member.id) {
      return {
        alreadyImported: true,
        imported: true,
        preview,
        shareCode,
      };
    }

    throw hostedOnboardingError({
      code: "HOSTED_SHARE_CONSUMED",
      message: "That share link has already been used.",
      httpStatus: 409,
    });
  }

  if (record.acceptedByMemberId && record.acceptedByMemberId !== input.sessionRecord.member.id) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_ALREADY_CLAIMED",
      message: "That share link has already been claimed by another member.",
      httpStatus: 409,
    });
  }

  const claimed = await prisma.$transaction(async (tx) => {
    const claimResult = await tx.hostedShareLink.updateMany({
      where: {
        codeHash: hashHostedShareCode(shareCode),
        consumedAt: null,
        OR: [
          { acceptedAt: null },
          { acceptedByMemberId: input.sessionRecord.member.id },
        ],
      },
      data: {
        acceptedAt,
        acceptedByMemberId: input.sessionRecord.member.id,
        lastEventId: eventId,
      },
    });
    const latest = await requireHostedShareLink(shareCode, tx);
    const dispatchEventId = latest.lastEventId ?? eventId;
    const { pack } = readHostedSharePack(latest);

    if (!latest.consumedAt && latest.acceptedByMemberId === input.sessionRecord.member.id) {
      await enqueueHostedExecutionOutbox({
        dispatch: buildHostedShareAcceptanceDispatch({
          acceptedAt: acceptedAt.toISOString(),
          eventId: dispatchEventId,
          memberId: input.sessionRecord.member.id,
          pack,
          shareCode,
        }),
        sourceId: latest.id,
        sourceType: "hosted_share_link",
        tx,
      });
    }

    return {
      claimCount: claimResult.count,
      record: latest,
    };
  });

  record = claimed.record;

  if (claimed.claimCount === 0 && record.acceptedByMemberId && record.acceptedByMemberId !== input.sessionRecord.member.id) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_ALREADY_CLAIMED",
      message: "That share link has already been claimed by another member.",
      httpStatus: 409,
    });
  }
  const dispatchEventId = record.lastEventId ?? eventId;
  await drainHostedExecutionOutbox({
    eventIds: [dispatchEventId],
    prisma,
  });
  const outboxRecord = await findHostedExecutionOutboxByEventId(dispatchEventId, prisma);
  const outboxOutcome = readHostedExecutionOutboxOutcome(outboxRecord);

  if (outboxOutcome === "pending") {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_IMPORT_PENDING",
      message: "The shared bundle is still importing. Reopen this link in a few seconds.",
      httpStatus: 503,
      retryable: true,
    });
  }

  if (outboxOutcome === "failed") {
    await releaseHostedShareAcceptance({
      prisma,
      shareCode,
      memberId: input.sessionRecord.member.id,
    });

    throw hostedOnboardingError({
      code: "HOSTED_SHARE_IMPORT_FAILED",
      message: outboxRecord?.lastError ?? "The hosted share could not be imported right now.",
      httpStatus: 502,
    });
  }
  await finalizeHostedShareAcceptance({
    eventId: dispatchEventId,
    memberId: input.sessionRecord.member.id,
    prisma,
    shareCode,
  });

  return {
    alreadyImported: false,
    imported: true,
    preview,
    shareCode,
  };
}
