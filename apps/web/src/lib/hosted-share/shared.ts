import { createHash, randomBytes } from "node:crypto";

import type { HostedShareLink, Prisma } from "@prisma/client";
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
  memberId: string | null | undefined;
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<boolean> {
  return updateHostedShareAcceptanceClaim({
    data: {
      acceptedAt: null,
      acceptedByMemberId: null,
      consumedByMemberId: null,
      lastEventId: null,
    },
    eventId: input.eventId,
    memberId: input.memberId,
    prisma: input.prisma,
    shareId: input.shareId,
  });
}

export interface HostedShareAcceptanceFinalizationResult {
  finalized: boolean;
  shareFound: boolean;
  sharePackOwnerMemberId: string | null;
}

export async function finalizeHostedShareAcceptance(input: {
  eventId: string;
  memberId: string | null;
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<HostedShareAcceptanceFinalizationResult> {
  const memberId = normalizeOptionalString(input.memberId);

  if (!memberId) {
    return {
      finalized: false,
      shareFound: false,
      sharePackOwnerMemberId: null,
    };
  }

  const finalized = await updateHostedShareAcceptanceClaim({
    data: {
      consumedAt: new Date(),
      consumedByMemberId: memberId,
    },
    eventId: input.eventId,
    memberId,
    prisma: input.prisma,
    shareId: input.shareId,
  });
  const finalizationState = await readHostedShareAcceptanceFinalizationState({
    eventId: input.eventId,
    memberId,
    prisma: input.prisma,
    shareId: input.shareId,
  });

  return {
    finalized,
    ...finalizationState,
  };
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

async function updateHostedShareAcceptanceClaim(input: {
  data: Prisma.HostedShareLinkUpdateManyMutationInput;
  eventId: string;
  memberId: string | null | undefined;
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<boolean> {
  const memberId = normalizeOptionalString(input.memberId);

  if (!memberId) {
    return false;
  }

  const updated = await input.prisma.hostedShareLink.updateMany({
    where: buildHostedShareAcceptanceClaimWhere({
      eventId: input.eventId,
      memberId,
      shareId: input.shareId,
    }),
    data: input.data,
  });

  return updated.count === 1;
}

async function readHostedShareAcceptanceFinalizationState(input: {
  eventId: string;
  memberId: string | null | undefined;
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<Omit<HostedShareAcceptanceFinalizationResult, "finalized">> {
  const record = await input.prisma.hostedShareLink.findUnique({
    select: {
      consumedAt: true,
      consumedByMemberId: true,
      lastEventId: true,
      senderMemberId: true,
    },
    where: {
      id: input.shareId,
    },
  });

  if (!record) {
    return {
      shareFound: false,
      sharePackOwnerMemberId: null,
    };
  }

  return {
    shareFound: true,
    sharePackOwnerMemberId: isHostedShareConsumedForAcceptanceEvent({
      eventId: input.eventId,
      memberId: input.memberId,
      record,
    })
      ? record.senderMemberId
      : null,
  };
}

function buildHostedShareAcceptanceClaimWhere(input: {
  eventId: string;
  memberId: string;
  shareId: string;
}): Prisma.HostedShareLinkWhereInput {
  return {
    acceptedByMemberId: input.memberId,
    consumedAt: null,
    id: input.shareId,
    lastEventId: input.eventId,
  } satisfies Prisma.HostedShareLinkWhereInput;
}

function isHostedShareConsumedForAcceptanceEvent(input: {
  eventId: string;
  memberId: string | null | undefined;
  record: Pick<HostedShareLink, "consumedAt" | "consumedByMemberId" | "lastEventId">;
}): boolean {
  const memberId = normalizeOptionalString(input.memberId);

  return Boolean(
    memberId
    && input.record.consumedAt
    && input.record.consumedByMemberId === memberId
    && input.record.lastEventId === input.eventId,
  );
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
