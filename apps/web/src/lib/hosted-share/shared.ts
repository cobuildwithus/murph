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
import { readHostedSharePackObject } from "./pack-store";

import type { HostedSharePreview, HostedSharePrismaClient } from "./types";

const DEFAULT_HOSTED_SHARE_TTL_HOURS = 24;
const MAX_HOSTED_SHARE_TTL_HOURS = 24;
const HOSTED_SHARE_CODE_BYTES = 24;
const DEFAULT_HOSTED_SHARE_PRIVATE_PREVIEW_TITLE = "Shared Murph pack";

export function createHostedShareMinimalPreview(title: string | null | undefined): HostedSharePreview {
  return {
    counts: {
      foods: 0,
      protocols: 0,
      recipes: 0,
    },
    foodTitles: [],
    protocolTitles: [],
    recipeTitles: [],
    logMealAfterImport: false,
    title: normalizeOptionalString(title) ?? DEFAULT_HOSTED_SHARE_PRIVATE_PREVIEW_TITLE,
  };
}

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

export function serializeHostedSharePreview(preview: HostedSharePreview): Prisma.InputJsonObject {
  return {
    counts: {
      foods: preview.counts.foods,
      protocols: preview.counts.protocols,
      recipes: preview.counts.recipes,
    },
    foodTitles: [...preview.foodTitles],
    logMealAfterImport: preview.logMealAfterImport,
    protocolTitles: [...preview.protocolTitles],
    recipeTitles: [...preview.recipeTitles],
    title: preview.title,
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
    counts: {
      foods: readHostedSharePreviewCount(counts.foods, "foods"),
      protocols: readHostedSharePreviewCount(counts.protocols, "protocols"),
      recipes: readHostedSharePreviewCount(counts.recipes, "recipes"),
    },
    foodTitles: readHostedSharePreviewTitles(value.foodTitles, "foodTitles"),
    logMealAfterImport: value.logMealAfterImport === true,
    protocolTitles: readHostedSharePreviewTitles(value.protocolTitles, "protocolTitles"),
    recipeTitles: readHostedSharePreviewTitles(value.recipeTitles, "recipeTitles"),
    title: readHostedSharePreviewTitle(value.title),
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

export async function readHostedSharePack(record: {
  id: string;
  senderMemberId: string;
}): Promise<{ pack: SharePack }> {
  const pack = await readHostedSharePackObject({
    ownerUserId: record.senderMemberId,
    shareId: record.id,
  });

  if (!pack) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_PACK_NOT_FOUND",
      message: `Hosted share pack ${record.id} was not found.`,
      httpStatus: 404,
    });
  }

  return {
    pack,
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
  shareId: string;
}): Promise<void> {
  if (!input.memberId) {
    return;
  }

  await input.prisma.hostedShareLink.updateMany({
    where: {
      acceptedByMemberId: input.memberId,
      consumedAt: null,
      id: input.shareId,
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
  pack: SharePack;
  shareId: string;
}): HostedExecutionDispatchRequest {
  return buildHostedExecutionVaultShareAcceptedDispatch({
    eventId: input.eventId,
    memberId: input.memberId,
    occurredAt: input.acceptedAt,
    share: {
      pack: input.pack,
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
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`Hosted share preview ${field} count must be a non-negative integer.`);
  }

  return value;
}

function readHostedSharePreviewTitle(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Hosted share preview title must be a non-empty string.");
  }

  return value;
}

function readHostedSharePreviewTitles(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new TypeError(`Hosted share preview ${field} must be a string array.`);
  }

  return [...value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
