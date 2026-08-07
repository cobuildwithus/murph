import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "../prisma";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import { clinicalRecordsError } from "./errors";
import { resolveClinicalProviderDirectoryEntry } from "./provider-directory-store";

const CLAIM_PREFIX = "cr_";
const CLAIM_BYTES = 24;
const CLAIM_TTL_MS = 15 * 60 * 1_000;

type ClinicalIntentPrismaClient = ReturnType<typeof getPrisma> | Prisma.TransactionClient;

export interface ClinicalRecordConnectIntent {
  claimHash: string;
  completedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  memberId: string;
  providerDirectoryEntryId: string | null;
  startedAt: Date | null;
}

export async function createClinicalRecordConnectIntent(input: {
  memberId: string;
  now?: Date;
  providerDirectoryEntryId?: string | null;
  request: Request;
}): Promise<{ claim: string; connectUrl: string; expiresAt: string }> {
  const now = input.now ?? new Date();
  const providerDirectoryEntryId = normalizeProviderEntryId(input.providerDirectoryEntryId);
  if (input.providerDirectoryEntryId && !providerDirectoryEntryId) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_PROVIDER_NOT_FOUND",
      httpStatus: 404,
      message: "The selected Clinical Records provider is unavailable.",
    });
  }
  const claim = `${CLAIM_PREFIX}${randomBytes(CLAIM_BYTES).toString("base64url")}`;
  const claimHash = hashClaim(claim);
  const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS);
  const prisma = getPrisma();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${input.memberId}),
          hashtext('clinical-record-connect-intent')
        )
      `;
      await tx.clinicalRecordOauthSession.updateMany({
        data: { consumedAt: now },
        where: { consumedAt: null, memberId: input.memberId },
      });
      await tx.clinicalRecordConnectIntent.deleteMany({
        where: {
          OR: [
            { expiresAt: { lte: now } },
            {
              completedAt: null,
              memberId: input.memberId,
            },
          ],
        },
      });
      await tx.clinicalRecordConnectIntent.create({
        data: {
          claimHash,
          memberId: input.memberId,
          providerDirectoryEntryId,
          createdAt: now,
          expiresAt,
        },
      });
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_CONNECT_INTENT_CONFLICT",
      httpStatus: 409,
      message: "Clinical Records connection setup changed. Try again.",
      retryable: true,
    });
  }

  const baseUrl = resolveHostedPublicBaseUrl() ?? new URL(input.request.url).origin;
  const connectUrl = new URL("/records/connect", `${baseUrl}/`);
  connectUrl.hash = new URLSearchParams({ clinicalRecordsIntent: claim }).toString();
  return {
    claim,
    connectUrl: connectUrl.toString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function claimClinicalRecordConnectIntentForStart(input: {
  claim: string;
  memberId: string;
  now?: Date;
  providerDirectoryEntryId: string;
}): Promise<ClinicalRecordConnectIntent> {
  const now = input.now ?? new Date();
  const claimHash = normalizeClaimHash(input.claim);
  const providerDirectoryEntryId = normalizeProviderEntryId(input.providerDirectoryEntryId);
  if (!claimHash || !providerDirectoryEntryId) {
    throw invalidIntentError();
  }

  return getPrisma().$transaction(async (tx) => {
    const record = await tx.clinicalRecordConnectIntent.findUnique({ where: { claimHash } });
    if (!record || record.memberId !== input.memberId) throw invalidIntentError();
    if (record.expiresAt.getTime() <= now.getTime()) {
      await tx.clinicalRecordConnectIntent.deleteMany({ where: { claimHash, expiresAt: { lte: now } } });
      throw clinicalRecordsError({
        code: "CLINICAL_RECORD_CONNECT_INTENT_EXPIRED",
        httpStatus: 410,
        message: "This Clinical Records connection link has expired.",
      });
    }
    if (record.startedAt || record.completedAt) {
      throw clinicalRecordsError({
        code: "CLINICAL_RECORD_CONNECT_INTENT_USED",
        httpStatus: 409,
        message: "This Clinical Records connection link has already been used.",
      });
    }
    if (
      record.providerDirectoryEntryId
      && record.providerDirectoryEntryId !== providerDirectoryEntryId
    ) {
      throw invalidIntentError();
    }
    const claimed = await tx.clinicalRecordConnectIntent.updateMany({
      data: { providerDirectoryEntryId, startedAt: now },
      where: {
        claimHash,
        completedAt: null,
        expiresAt: { gt: now },
        memberId: input.memberId,
        startedAt: null,
      },
    });
    if (claimed.count !== 1) {
      throw clinicalRecordsError({
        code: "CLINICAL_RECORD_CONNECT_INTENT_USED",
        httpStatus: 409,
        message: "This Clinical Records connection link has already been used.",
      });
    }
    return {
      ...record,
      providerDirectoryEntryId,
      startedAt: now,
    };
  });
}

export async function releaseClinicalRecordConnectIntentStart(input: {
  claimHash: string;
  memberId: string;
}): Promise<void> {
  await getPrisma().clinicalRecordConnectIntent.updateMany({
    data: { startedAt: null },
    where: {
      claimHash: input.claimHash,
      completedAt: null,
      memberId: input.memberId,
      startedAt: { not: null },
    },
  });
}

export async function completeClinicalRecordConnectIntent(
  input: { claimHash: string; memberId: string; now: Date },
  prisma: ClinicalIntentPrismaClient = getPrisma(),
): Promise<void> {
  const completed = await prisma.clinicalRecordConnectIntent.updateMany({
    data: { completedAt: input.now },
    where: {
      claimHash: input.claimHash,
      completedAt: null,
      memberId: input.memberId,
      startedAt: { not: null },
    },
  });
  if (completed.count !== 1) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_CONNECT_INTENT_SUPERSEDED",
      httpStatus: 409,
      message: "This Clinical Records connection link is no longer current.",
    });
  }
}

export function normalizeClinicalRecordConnectIntentClaim(claim: string): string | null {
  return normalizeClaimHash(claim);
}

function normalizeProviderEntryId(value: string | null | undefined): string | null {
  if (value === null || value === undefined || !value.trim()) return null;
  const entry = resolveClinicalProviderDirectoryEntry(value);
  return entry?.id ?? null;
}

function normalizeClaimHash(claim: string): string | null {
  if (!/^cr_[A-Za-z0-9_-]{32}$/u.test(claim)) return null;
  return hashClaim(claim);
}

function hashClaim(claim: string): string {
  return createHash("sha256").update(claim).digest("hex");
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "P2002",
  );
}

function invalidIntentError() {
  return clinicalRecordsError({
    code: "CLINICAL_RECORD_CONNECT_INTENT_INVALID",
    httpStatus: 404,
    message: "This Clinical Records connection link is unavailable.",
  });
}
