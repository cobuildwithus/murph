import { createHash, randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";
import {
  buildHostedExecutionVaultShareAcceptedDispatch,
  type HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";
import type { SharePack } from "@murphai/contracts";

import {
  requireHostedOnboardingPublicBaseUrl,
} from "../hosted-onboarding/runtime";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

import type { HostedShareKind, HostedSharePreview, HostedSharePrismaClient } from "./types";

const DEFAULT_HOSTED_SHARE_TTL_HOURS = 24;
const MAX_HOSTED_SHARE_TTL_HOURS = 24;
const HOSTED_SHARE_CODE_BYTES = 24;
export function createHostedShareMinimalPreview(): HostedSharePreview {
  return {
    kinds: [],
    counts: {
      foods: 0,
      protocols: 0,
      recipes: 0,
      total: 0,
    },
    logMealAfterImport: false,
  };
}

export function buildHostedSharePreview(pack: SharePack): HostedSharePreview {
  const kinds = new Set<HostedShareKind>();
  let foods = 0;
  let protocols = 0;
  let recipes = 0;

  for (const entity of pack.entities) {
    if (entity.kind === "food") {
      foods += 1;
      kinds.add("food");
      continue;
    }

    if (entity.kind === "protocol") {
      protocols += 1;
      kinds.add("protocol");
      continue;
    }

    recipes += 1;
    kinds.add("recipe");
  }

  return {
    kinds: [...kinds].sort(),
    counts: {
      foods,
      protocols,
      recipes,
      total: pack.entities.length,
    },
    logMealAfterImport: Boolean(pack.afterImport?.logMeal),
  };
}

export function serializeHostedSharePreview(preview: HostedSharePreview): Prisma.InputJsonObject {
  return {
    kinds: [...preview.kinds],
    counts: {
      foods: preview.counts.foods,
      protocols: preview.counts.protocols,
      recipes: preview.counts.recipes,
      total: preview.counts.total,
    },
    logMealAfterImport: preview.logMealAfterImport,
  } satisfies Prisma.InputJsonObject;
}

export function readHostedSharePreview(value: Prisma.JsonValue): HostedSharePreview {
  if (!isRecord(value)) {
    throw new TypeError("Hosted share preview metadata must be a JSON object.");
  }

  const counts = value.counts;
  if (!isRecord(counts)) {
    throw new TypeError("Hosted share preview counts must be a JSON object.");
  }

  return {
    kinds: readHostedSharePreviewKinds(value.kinds),
    counts: {
      foods: readHostedSharePreviewCount(counts.foods, "foods"),
      protocols: readHostedSharePreviewCount(counts.protocols, "protocols"),
      recipes: readHostedSharePreviewCount(counts.recipes, "recipes"),
      total: readHostedSharePreviewCount(counts.total, "total"),
    },
    logMealAfterImport: value.logMealAfterImport === true,
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

export async function releaseHostedShareAcceptance(input: {
  eventId: string;
  memberId: string;
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<boolean> {
  const released = await input.prisma.hostedShareLink.updateMany({
    where: {
      acceptedByMemberId: input.memberId,
      consumedAt: null,
      id: input.shareId,
      lastEventId: input.eventId,
    },
    data: {
      acceptedAt: null,
      acceptedByMemberId: null,
      lastEventId: null,
    },
  });

  return released.count === 1;
}

export async function finalizeHostedShareAcceptance(input: {
  eventId: string;
  memberId: string | null;
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<boolean> {
  if (!input.memberId) {
    return false;
  }

  const finalized = await input.prisma.hostedShareLink.updateMany({
    where: {
      acceptedByMemberId: input.memberId,
      consumedAt: null,
      id: input.shareId,
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

  return finalized.count === 1;
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
  ownerUserId: string;
  shareId: string;
}): HostedExecutionDispatchRequest {
  return buildHostedExecutionVaultShareAcceptedDispatch({
    eventId: input.eventId,
    memberId: input.memberId,
    occurredAt: input.acceptedAt,
    share: {
      ownerUserId: input.ownerUserId,
      shareId: input.shareId,
    },
  });
}

export function hashHostedShareCode(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hostedShareExpiresAt(hours: number | undefined): Date {
  const ttlHours = Number.isFinite(hours) && typeof hours === "number" && hours > 0
    ? Math.min(hours, MAX_HOSTED_SHARE_TTL_HOURS)
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

export function requireHostedSharePublicBaseUrl(): string {
  return requireHostedOnboardingPublicBaseUrl();
}

function readHostedSharePreviewCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`Hosted share preview ${field} count must be a non-negative integer.`);
  }

  return value;
}

function readHostedSharePreviewKinds(value: unknown): HostedShareKind[] {
  if (
    !Array.isArray(value)
    || value.some((entry) => entry !== "food" && entry !== "protocol" && entry !== "recipe")
  ) {
    throw new TypeError("Hosted share preview kinds must be a HostedShareKind array.");
  }

  return [...new Set(value)].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
