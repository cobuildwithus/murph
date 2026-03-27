import { createHash, randomBytes } from "node:crypto";

import { HostedBillingStatus, Prisma, type PrismaClient } from "@prisma/client";
import { assertContract, sharePackSchema, type SharePack } from "@healthybob/contracts";
import type { HostedExecutionUserStatus } from "@healthybob/runtime-state";

import { getPrisma } from "../prisma";
import { dispatchHostedExecutionStatus } from "../hosted-execution/dispatch";
import {
  getHostedOnboardingSecretCodec,
  requireHostedOnboardingPublicBaseUrl,
} from "../hosted-onboarding/runtime";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  issueHostedInviteForPhone,
} from "../hosted-onboarding/service";

import type { HostedSessionRecord } from "../hosted-onboarding/session";

export type HostedSharePageStage = "invalid" | "expired" | "signin" | "ready" | "consumed";

export interface HostedSharePreview {
  counts: {
    foods: number;
    protocols: number;
    recipes: number;
  };
  foodTitles: string[];
  protocolTitles: string[];
  recipeTitles: string[];
  logMealAfterImport: boolean;
  title: string;
}

export interface HostedSharePageData {
  inviteCode: string | null;
  session: {
    active: boolean;
    authenticated: boolean;
    memberId: string | null;
  };
  share: {
    acceptedByCurrentMember: boolean;
    consumed: boolean;
    expiresAt: string;
    preview: HostedSharePreview;
  } | null;
  stage: HostedSharePageStage;
}

export interface CreateHostedShareLinkResult {
  inviteCode: string | null;
  joinUrl: string | null;
  preview: HostedSharePreview;
  shareCode: string;
  shareUrl: string;
  url: string;
}

export interface AcceptHostedShareResult {
  alreadyImported: boolean;
  imported: boolean;
  preview: HostedSharePreview;
  shareCode: string;
}

const DEFAULT_HOSTED_SHARE_TTL_HOURS = 24 * 7;
const HOSTED_SHARE_CODE_BYTES = 24;

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
  const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
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
  const record = await findHostedShareLinkByCode(input.shareCode, prisma);
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

  const preview = readHostedSharePreview(record.previewJson, readHostedSharePack(record).pack);
  const now = new Date();
  const consumed = Boolean(record.consumedAt);
  const acceptedByCurrentMember = record.consumedByMemberId === input.sessionRecord?.member.id
    || record.acceptedByMemberId === input.sessionRecord?.member.id;
  const stage: HostedSharePageStage = consumed
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

  const claimResult = await prisma.hostedShareLink.updateMany({
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

  record = await requireHostedShareLink(shareCode, prisma);

  if (claimResult.count === 0 && record.acceptedByMemberId && record.acceptedByMemberId !== input.sessionRecord.member.id) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_ALREADY_CLAIMED",
      message: "That share link has already been claimed by another member.",
      httpStatus: 409,
    });
  }
  const { pack } = readHostedSharePack(record);
  const dispatchEventId = record.lastEventId ?? eventId;
  let status: HostedExecutionUserStatus | null = null;

  try {
    status = await dispatchHostedExecutionStatus({
      event: {
        kind: "vault.share.accepted",
        pack,
        shareCode,
        userId: input.sessionRecord.member.id,
      },
      eventId: dispatchEventId,
      occurredAt: acceptedAt.toISOString(),
    });
  } catch (error) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_IMPORT_PENDING",
      message: "The shared bundle may still be importing. Reopen this link in a few seconds.",
      httpStatus: 503,
      retryable: true,
    });
  }

  if (isPendingHostedShareDispatch(status, dispatchEventId)) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_IMPORT_PENDING",
      message: "The shared bundle is still importing. Reopen this link in a few seconds.",
      httpStatus: 503,
      retryable: true,
    });
  }

  if (!isCompletedHostedShareDispatch(status, dispatchEventId)) {
    await releaseHostedShareAcceptance({
      prisma,
      shareCode,
      memberId: input.sessionRecord.member.id,
    });

    throw hostedOnboardingError({
      code: "HOSTED_SHARE_IMPORT_FAILED",
      message: status.lastError ?? "The hosted share could not be imported right now.",
      httpStatus: 502,
    });
  }

  await prisma.hostedShareLink.update({
    where: {
      codeHash: hashHostedShareCode(shareCode),
    },
    data: {
      acceptedAt: now,
      acceptedByMemberId: input.sessionRecord.member.id,
      consumedAt: new Date(),
      consumedByMemberId: input.sessionRecord.member.id,
      lastEventId: dispatchEventId,
    },
  });

  return {
    alreadyImported: false,
    imported: true,
    preview,
    shareCode,
  };
}

export function requireHostedShareInternalToken(request: Request): void {
  const token = normalizeOptionalString(process.env.HOSTED_SHARE_INTERNAL_TOKEN);

  if (!token) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_INTERNAL_TOKEN_REQUIRED",
      message: "HOSTED_SHARE_INTERNAL_TOKEN must be configured for internal hosted share creation.",
      httpStatus: 500,
    });
  }

  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_UNAUTHORIZED",
      message: "Unauthorized hosted share request.",
      httpStatus: 401,
    });
  }
}

function buildHostedSharePreview(pack: SharePack): HostedSharePreview {
  return {
    counts: {
      foods: pack.entities.filter((entity) => entity.kind === "food").length,
      protocols: pack.entities.filter((entity) => entity.kind === "protocol").length,
      recipes: pack.entities.filter((entity) => entity.kind === "recipe").length,
    },
    foodTitles: pack.entities.filter((entity) => entity.kind === "food").map((entity) => entity.payload.title),
    protocolTitles: pack.entities.filter((entity) => entity.kind === "protocol").map((entity) => entity.payload.title),
    recipeTitles: pack.entities.filter((entity) => entity.kind === "recipe").map((entity) => entity.payload.title),
    logMealAfterImport: Boolean(pack.afterImport?.logMeal),
    title: pack.title,
  };
}

function findHostedShareLinkByCode(shareCode: string, prisma: PrismaClient) {
  return prisma.hostedShareLink.findUnique({
    where: {
      codeHash: hashHostedShareCode(shareCode),
    },
  });
}

async function requireHostedShareLink(shareCode: string, prisma: PrismaClient) {
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

function readHostedSharePack(record: {
  encryptedPayload: string;
}): { pack: SharePack } {
  const payload = getHostedOnboardingSecretCodec().decrypt(record.encryptedPayload);
  const parsed = JSON.parse(payload) as SharePack;

  return {
    pack: assertContract(sharePackSchema, parsed, "share pack"),
  };
}

function readHostedSharePreview(
  previewJson: unknown,
  fallbackPack: SharePack,
): HostedSharePreview {
  if (previewJson && typeof previewJson === "object" && !Array.isArray(previewJson)) {
    try {
      return JSON.parse(JSON.stringify(previewJson)) as HostedSharePreview;
    } catch {
      return buildHostedSharePreview(fallbackPack);
    }
  }

  return buildHostedSharePreview(fallbackPack);
}

async function releaseHostedShareAcceptance(input: {
  memberId: string;
  prisma: PrismaClient;
  shareCode: string;
}): Promise<void> {
  await input.prisma.hostedShareLink.updateMany({
    where: {
      acceptedByMemberId: input.memberId,
      codeHash: hashHostedShareCode(input.shareCode),
      consumedAt: null,
    },
    data: {
      acceptedAt: null,
      acceptedByMemberId: null,
      lastEventId: null,
    },
  });
}

function isCompletedHostedShareDispatch(
  status: HostedExecutionUserStatus,
  eventId: string,
): boolean {
  if (status.lastError) {
    return false;
  }

  if (status.poisonedEventIds.includes(eventId)) {
    return false;
  }

  return status.lastEventId === eventId
    && !status.inFlight
    && status.pendingEventCount === 0
    && status.retryingEventId !== eventId;
}

function isPendingHostedShareDispatch(
  status: HostedExecutionUserStatus,
  eventId: string,
): boolean {
  return status.lastEventId === eventId
    && (status.inFlight || status.pendingEventCount > 0 || status.retryingEventId === eventId);
}

function generateHostedShareCode(): string {
  return randomBytes(HOSTED_SHARE_CODE_BYTES).toString("base64url");
}

function generateHostedShareId(): string {
  return `hshare_${randomBytes(10).toString("hex")}`;
}

function buildHostedShareUrl(input: {
  inviteCode: string | null;
  publicBaseUrl: string;
  shareCode: string;
}): string {
  const shareUrl = new URL(`/share/${encodeURIComponent(input.shareCode)}`, input.publicBaseUrl);

  if (input.inviteCode) {
    shareUrl.searchParams.set("invite", input.inviteCode);
  }

  return shareUrl.toString();
}

function buildHostedShareAcceptanceEventId(input: {
  acceptedAt: Date;
  memberId: string;
  shareId: string;
}): string {
  return `vault.share.accepted:${input.shareId}:${input.memberId}:${input.acceptedAt.getTime()}`;
}

function hashHostedShareCode(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hostedShareExpiresAt(hours: number | undefined): Date {
  const ttlHours = Number.isFinite(hours) && typeof hours === "number" && hours > 0
    ? Math.min(hours, 24 * 30)
    : DEFAULT_HOSTED_SHARE_TTL_HOURS;

  return new Date(Date.now() + ttlHours * 60 * 60 * 1000);
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
