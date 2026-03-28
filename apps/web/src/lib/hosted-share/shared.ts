import { createHash, randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";
import {
  buildHostedExecutionVaultShareAcceptedDispatch,
  type HostedExecutionDispatchRequest,
  type HostedExecutionSharePackResponse,
} from "@murph/hosted-execution";
import { assertContract, sharePackSchema, type SharePack } from "@murph/contracts";

import {
  getHostedOnboardingSecretCodec,
  requireHostedOnboardingPublicBaseUrl,
} from "../hosted-onboarding/runtime";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

import type { HostedSharePreview, HostedSharePrismaClient } from "./types";

const DEFAULT_HOSTED_SHARE_TTL_HOURS = 24 * 7;
const HOSTED_SHARE_CODE_BYTES = 24;

export function buildHostedSharePreview(pack: SharePack): HostedSharePreview {
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

export function findHostedShareLinkByCode(shareCode: string, prisma: HostedSharePrismaClient) {
  return prisma.hostedShareLink.findUnique({
    where: {
      codeHash: hashHostedShareCode(shareCode),
    },
  });
}

export function findHostedShareLinkById(shareId: string, prisma: HostedSharePrismaClient) {
  return prisma.hostedShareLink.findUnique({
    where: {
      id: shareId,
    },
  });
}

export async function requireHostedShareLink(shareCode: string, prisma: HostedSharePrismaClient) {
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

export function readHostedSharePack(record: {
  encryptedPayload: string;
}): { pack: SharePack } {
  const payload = getHostedOnboardingSecretCodec().decrypt(record.encryptedPayload);
  const parsed = JSON.parse(payload) as SharePack;

  return {
    pack: assertContract(sharePackSchema, parsed, "share pack"),
  };
}

export function readHostedSharePreview(
  previewJson: unknown,
  fallbackPack: SharePack | (() => SharePack),
): HostedSharePreview {
  if (previewJson && typeof previewJson === "object" && !Array.isArray(previewJson)) {
    try {
      return JSON.parse(JSON.stringify(previewJson)) as HostedSharePreview;
    } catch {
      return buildHostedSharePreview(
        typeof fallbackPack === "function" ? fallbackPack() : fallbackPack,
      );
    }
  }

  return buildHostedSharePreview(typeof fallbackPack === "function" ? fallbackPack() : fallbackPack);
}

export async function readHostedSharePackByReference(input: {
  boundMemberId: string;
  prisma: HostedSharePrismaClient;
  shareCode: string;
  shareId: string;
}): Promise<HostedExecutionSharePackResponse> {
  const record = await findHostedShareLinkById(input.shareId, input.prisma);

  if (
    !record
    || record.codeHash !== hashHostedShareCode(input.shareCode)
    || !isHostedShareReadableByMember(record, input.boundMemberId)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_NOT_FOUND",
      message: "That share link is not valid.",
      httpStatus: 404,
    });
  }

  return {
    pack: readHostedSharePack(record).pack,
    shareId: input.shareId,
  };
}

export async function releaseHostedShareAcceptance(input: {
  memberId: string;
  prisma: HostedSharePrismaClient;
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

export async function finalizeHostedShareAcceptance(input: {
  eventId: string;
  memberId: string | null;
  prisma: HostedSharePrismaClient;
  shareCode: string;
}): Promise<void> {
  if (!input.memberId) {
    return;
  }

  await input.prisma.hostedShareLink.updateMany({
    where: {
      acceptedByMemberId: input.memberId,
      codeHash: hashHostedShareCode(input.shareCode),
      consumedAt: null,
      lastEventId: input.eventId,
    },
    data: {
      acceptedAt: new Date(),
      acceptedByMemberId: input.memberId,
      consumedAt: new Date(),
      consumedByMemberId: input.memberId,
      lastEventId: input.eventId,
    },
  });
}

export function generateHostedShareCode(): string {
  return randomBytes(HOSTED_SHARE_CODE_BYTES).toString("base64url");
}

export function generateHostedShareId(): string {
  return `hshare_${randomBytes(10).toString("hex")}`;
}

export function buildHostedShareUrl(input: {
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

export function buildHostedShareAcceptanceEventId(input: {
  acceptedAt: Date;
  memberId: string;
  shareId: string;
}): string {
  return `vault.share.accepted:${input.shareId}:${input.memberId}:${input.acceptedAt.getTime()}`;
}

export function buildHostedShareAcceptanceDispatch(input: {
  acceptedAt: string;
  eventId: string;
  memberId: string;
  shareCode: string;
  shareId: string;
}): HostedExecutionDispatchRequest {
  return buildHostedExecutionVaultShareAcceptedDispatch({
    eventId: input.eventId,
    memberId: input.memberId,
    occurredAt: input.acceptedAt,
    share: {
      shareCode: input.shareCode,
      shareId: input.shareId,
    },
  });
}

export function hashHostedShareCode(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hostedShareExpiresAt(hours: number | undefined): Date {
  const ttlHours = Number.isFinite(hours) && typeof hours === "number" && hours > 0
    ? Math.min(hours, 24 * 30)
    : DEFAULT_HOSTED_SHARE_TTL_HOURS;

  return new Date(Date.now() + ttlHours * 60 * 60 * 1000);
}

export function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
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

export function requireHostedSharePublicBaseUrl(): string {
  return requireHostedOnboardingPublicBaseUrl();
}

function isHostedShareReadableByMember(
  record: {
    acceptedAt: Date | null;
    acceptedByMemberId: string | null;
    consumedAt: Date | null;
    consumedByMemberId: string | null;
  },
  memberId: string,
): boolean {
  if (record.consumedByMemberId === memberId) {
    return true;
  }

  return record.consumedAt === null
    && record.acceptedAt !== null
    && record.acceptedByMemberId === memberId;
}
