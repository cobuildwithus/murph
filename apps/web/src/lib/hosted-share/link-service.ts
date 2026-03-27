import { HostedBillingStatus, Prisma, PrismaClient } from "@prisma/client";
import { assertContract, sharePackSchema, type SharePack } from "@healthybob/contracts";

import { getPrisma } from "../prisma";
import {
  drainHostedExecutionOutboxBestEffort,
  findHostedExecutionOutboxByEventId,
  readHostedExecutionOutboxOutcome,
} from "../hosted-execution/outbox";
import {
  issueHostedInviteForPhone,
} from "../hosted-onboarding/service";
import type { HostedSessionRecord } from "../hosted-onboarding/session";
import {
  getHostedOnboardingSecretCodec,
} from "../hosted-onboarding/runtime";

import {
  buildHostedSharePreview,
  buildHostedShareUrl,
  finalizeHostedShareAcceptance,
  findHostedShareLinkByCode,
  generateHostedShareCode,
  generateHostedShareId,
  hostedShareExpiresAt,
  normalizeOptionalString,
  readHostedSharePack,
  readHostedSharePreview,
  requireHostedShareInternalToken,
  requireHostedShareLink,
  requireHostedSharePublicBaseUrl,
  hashHostedShareCode,
} from "./shared";
import type {
  CreateHostedShareLinkResult,
  HostedSharePageData,
} from "./types";

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
  const publicBaseUrl = requireHostedSharePublicBaseUrl();
  const codec = getHostedOnboardingSecretCodec();
  let inviteCode = normalizeOptionalString(input.inviteCode) ?? null;

  if (!inviteCode && normalizeOptionalString(input.recipientPhoneNumber)) {
    const invite = await issueHostedInviteForPhone({
      channel: "share",
      phoneNumber: input.recipientPhoneNumber as string,
      prisma,
    });
    inviteCode = invite.invite.inviteCode;
  }

  await prisma.hostedShareLink.create({
    data: {
      id: generateHostedShareId(),
      codeHash: hashHostedShareCode(shareCode),
      senderMemberId: normalizeOptionalString(input.senderMemberId) ?? null,
      previewTitle: preview.title,
      previewJson: preview as unknown as Prisma.InputJsonValue,
      encryptedPayload: codec.encrypt(JSON.stringify(pack)),
      encryptionKeyVersion: codec.keyVersion,
      expiresAt: hostedShareExpiresAt(input.expiresInHours),
    },
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
  inviteCode?: string | null;
  prisma?: PrismaClient;
  sessionRecord?: HostedSessionRecord | null;
  shareCode: string;
}): Promise<HostedSharePageData> {
  const prisma = input.prisma ?? getPrisma();
  let record = await findHostedShareLinkByCode(input.shareCode, prisma);
  const sessionActive = input.sessionRecord?.member.billingStatus === HostedBillingStatus.active;

  if (!record) {
    return {
      inviteCode: normalizeOptionalString(input.inviteCode) ?? null,
      session: {
        active: Boolean(sessionActive),
        authenticated: Boolean(input.sessionRecord),
        memberId: input.sessionRecord?.member.id ?? null,
      },
      share: null,
      stage: "invalid",
    };
  }

  if (
    record.acceptedByMemberId === input.sessionRecord?.member.id
    && !record.consumedAt
    && record.lastEventId
  ) {
    await drainHostedExecutionOutboxBestEffort({
      context: `hosted-share page-data share=${input.shareCode}`,
      eventIds: [record.lastEventId],
      prisma,
    });
    const outboxRecord = await findHostedExecutionOutboxByEventId(record.lastEventId, prisma);

    if (readHostedExecutionOutboxOutcome(outboxRecord) === "completed") {
      await finalizeHostedShareAcceptance({
        eventId: record.lastEventId,
        memberId: input.sessionRecord?.member.id ?? null,
        prisma,
        shareCode: input.shareCode,
      });
      record = await requireHostedShareLink(input.shareCode, prisma);
    }
  }

  const preview = readHostedSharePreview(record.previewJson, readHostedSharePack(record).pack);
  const now = new Date();
  const consumed = Boolean(record.consumedAt);
  const acceptedByCurrentMember = record.consumedByMemberId === input.sessionRecord?.member.id
    || record.acceptedByMemberId === input.sessionRecord?.member.id;
  const stage = consumed
    ? "consumed"
    : record.expiresAt <= now
      ? "expired"
      : sessionActive
        ? "ready"
        : "signin";

  return {
    inviteCode: normalizeOptionalString(input.inviteCode) ?? null,
    session: {
      active: Boolean(sessionActive),
      authenticated: Boolean(input.sessionRecord),
      memberId: input.sessionRecord?.member.id ?? null,
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

export { requireHostedShareInternalToken };
