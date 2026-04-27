import {
  Prisma,
  type HostedShareLink,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { nudgeHostedRunnerBestEffort } from "../hosted-runner/control";
import { hasHostedMemberActiveAccess } from "../hosted-onboarding/entitlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { type HostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";

import {
  buildHostedShareAcceptanceEventId,
  buildHostedShareAcceptanceWake,
  deleteHostedSharePayload,
  hashHostedShareCode,
  normalizeOptionalString,
  reconcileHostedShareAcceptanceLifecycle,
  requireHostedShareLink,
} from "./shared";
import type { AcceptHostedShareResult } from "./types";

export async function acceptHostedShareLink(input: {
  member?: HostedMemberCoreState;
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

  if (member.suspendedAt) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
      httpStatus: 403,
    });
  }

  if (!hasHostedMemberActiveAccess({
    billingStatus: member.billingStatus,
    suspendedAt: member.suspendedAt,
  })) {
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

    let latest = await requireHostedShareLink(shareCode, tx);

    if (latest.expiresAt <= now) {
      await deleteHostedSharePayload({
        prisma: tx,
        shareId: latest.id,
      });
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
          record: latest,
        };
      }

      throw hostedOnboardingError({
        code: "HOSTED_SHARE_CONSUMED",
        message: "That share link has already been used.",
        httpStatus: 409,
      });
    }

    const reconciliation = await reconcileHostedShareClaim({
      latest,
      memberId,
      tx,
    });
    latest = reconciliation.record;

    if (reconciliation.outcome === "alreadyImported") {
      return {
        outcome: "alreadyImported" as const,
        record: latest,
      };
    }

    if (latest.acceptedByMemberId && latest.acceptedByMemberId !== memberId) {
      throw hostedOnboardingError({
        code: "HOSTED_SHARE_ALREADY_CLAIMED",
        message: "That share link has already been claimed by another member.",
        httpStatus: 409,
      });
    }

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

    await appendHostedMailboxEnvelopeTx({
      envelope: buildHostedShareAcceptanceWake({
        acceptedAt: acceptedAt.toISOString(),
        eventId,
        memberId,
        ownerUserId: latest.senderMemberId,
        shareId: record.id,
      }),
      tx,
    });

    return {
      eventId,
      outcome: "pending" as const,
      record,
    };
  });

  if (claim.outcome === "alreadyImported") {
    return {
      alreadyImported: true,
      imported: true,
      pending: false,
      shareCode,
    };
  }

  void nudgeHostedRunnerBestEffort({
    context: "hosted-share.acceptance",
    userId: memberId,
  });

  const imported = Boolean(
    claim.record.consumedAt && claim.record.consumedByMemberId === memberId,
  );

  return {
    alreadyImported: false,
    imported,
    pending: !imported,
    shareCode,
  };
}

async function lockHostedShareLinkRow(
  tx: Prisma.TransactionClient,
  codeHash: string,
): Promise<void> {
  await tx.$queryRaw`select 1 from "hosted_share_link" where "code_hash" = ${codeHash} for update`;
}

async function reconcileHostedShareClaim(input: {
  latest: HostedShareLink;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<
  | {
      outcome: "alreadyImported";
      record: HostedShareLink;
    }
  | {
      outcome: "continue";
      record: HostedShareLink;
    }
> {
  const { latest, memberId, tx } = input;

  if (latest.acceptedByMemberId !== memberId || latest.consumedAt || !latest.lastEventId) {
    return {
      outcome: "continue",
      record: latest,
    };
  }

  const lifecycleState = await reconcileHostedShareAcceptanceLifecycle({
    eventId: latest.lastEventId,
    memberId,
    prisma: tx,
    shareId: latest.id,
  });

  if (lifecycleState === "completed") {
    return {
      outcome: "alreadyImported",
      record: await requireHostedShareLinkById(tx, latest.id),
    };
  }

    if (lifecycleState === "quarantined" || lifecycleState === null) {
      return {
        outcome: "continue",
        record: await requireHostedShareLinkById(tx, latest.id),
      };
  }

  return {
    outcome: "continue",
    record: latest,
  };
}
async function requireHostedShareLinkById(
  prisma: Prisma.TransactionClient,
  shareId: string,
): Promise<HostedShareLink> {
  const record = await prisma.hostedShareLink.findUnique({
    where: {
      id: shareId,
    },
  });

  if (!record) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_NOT_FOUND",
      message: "That share link is not valid.",
      httpStatus: 404,
    });
  }

  return record;
}
