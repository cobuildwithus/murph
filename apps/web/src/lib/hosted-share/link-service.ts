import { HostedBillingStatus, PrismaClient, type HostedMember } from "@prisma/client";
import { assertContract, sharePackSchema, type SharePack } from "@murphai/contracts";

import { getPrisma } from "../prisma";
import {
  deleteHostedSharePackFromHostedExecution,
  writeHostedSharePackToHostedExecution,
} from "../hosted-execution/control";
import {
  issueHostedInviteForPhone,
} from "../hosted-onboarding/invite-service";

import {
  buildHostedSharePreview,
  buildHostedShareUrl,
  createHostedShareMinimalPreview,
  findHostedShareLinkByCode,
  generateHostedShareCode,
  generateHostedShareId,
  hostedShareExpiresAt,
  normalizeOptionalString,
  readHostedSharePack,
  requireHostedSharePublicBaseUrl,
  hashHostedShareCode,
} from "./shared";
import type {
  CreateHostedShareLinkResult,
  HostedSharePageData,
} from "./types";

const HOSTED_SHARE_PRIVATE_PREVIEW_TITLE = "Shared Murph pack";

export async function createHostedShareLink(input: {
  expiresInHours?: number;
  inviteCode?: string | null;
  pack: SharePack;
  prisma?: PrismaClient;
  recipientPhoneNumber?: string | null;
  senderMemberId?: string | null;
}): Promise<CreateHostedShareLinkResult> {
  const prisma = input.prisma ?? getPrisma();
  const pack = assertContract(sharePackSchema, input.pack, "share pack");
  const preview = buildHostedSharePreview(pack);
  const shareCode = generateHostedShareCode();
  const shareId = generateHostedShareId();
  const publicBaseUrl = requireHostedSharePublicBaseUrl();
  let inviteCode = normalizeOptionalString(input.inviteCode) ?? null;

  if (!inviteCode && normalizeOptionalString(input.recipientPhoneNumber)) {
    const invite = await issueHostedInviteForPhone({
      channel: "share",
      phoneNumber: input.recipientPhoneNumber as string,
      prisma,
    });
    inviteCode = invite.invite.inviteCode;
  }

  await writeHostedSharePackToHostedExecution({
    pack,
    shareId,
  });

  await prisma.hostedShareLink.create({
    data: {
      id: shareId,
      codeHash: hashHostedShareCode(shareCode),
      senderMemberId: normalizeOptionalString(input.senderMemberId) ?? null,
      previewTitle: HOSTED_SHARE_PRIVATE_PREVIEW_TITLE,
      expiresAt: hostedShareExpiresAt(input.expiresInHours),
    },
  }).catch(async (error) => {
    try {
      await deleteHostedSharePackFromHostedExecution(shareId);
    } catch (cleanupError) {
      console.error(
        `Hosted share ${shareId} cleanup failed after Postgres write error.`,
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      );
    }

    throw error;
  });

  const shareUrl = buildHostedShareUrl({
    inviteCode,
    publicBaseUrl,
    shareCode,
  });
  const joinUrl = inviteCode
    ? `${publicBaseUrl}/join/${encodeURIComponent(inviteCode)}?share=${encodeURIComponent(shareCode)}`
    : null;

  return {
    inviteCode,
    joinUrl,
    preview,
    shareCode,
    shareUrl,
    url: joinUrl ?? shareUrl,
  };
}

export async function buildHostedSharePageData(input: {
  authenticatedMember?: HostedMember | null;
  inviteCode?: string | null;
  prisma?: PrismaClient;
  shareCode: string;
}): Promise<HostedSharePageData> {
  const prisma = input.prisma ?? getPrisma();
  const record = await findHostedShareLinkByCode(input.shareCode, prisma);
  const authenticatedMember = input.authenticatedMember ?? null;
  const sessionActive = authenticatedMember?.billingStatus === HostedBillingStatus.active;

  if (!record) {
    return {
      inviteCode: normalizeOptionalString(input.inviteCode) ?? null,
      session: {
        active: Boolean(sessionActive),
        authenticated: Boolean(authenticatedMember),
      },
      share: null,
      stage: "invalid",
    };
  }

  const now = new Date();
  const consumed = Boolean(record.consumedAt);
  const acceptedByCurrentMember = record.consumedByMemberId === authenticatedMember?.id
    || record.acceptedByMemberId === authenticatedMember?.id;
  const stage = consumed
    ? "consumed"
    : acceptedByCurrentMember
      ? "processing"
        : record.expiresAt <= now
          ? "expired"
          : sessionActive
            ? "ready"
            : "signin";
  const preview = stage === "consumed" || stage === "expired"
    ? createHostedShareMinimalPreview(record.previewTitle)
    : buildHostedSharePreview((await readHostedSharePack(record)).pack);

  return {
    inviteCode: normalizeOptionalString(input.inviteCode) ?? null,
    session: {
      active: Boolean(sessionActive),
      authenticated: Boolean(authenticatedMember),
    },
    share: {
      acceptedByCurrentMember,
      consumed,
      expiresAt: record.expiresAt.toISOString(),
      preview,
    },
    stage,
  };
}
