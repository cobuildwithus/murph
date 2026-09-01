import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  signalHostedRuntimeMaintenanceRuntime,
  signalHostedRuntimeRecheckRuntime,
  type HostedRuntimeSignalResult,
} from "../hosted-orchestration/signal-runtime";
import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "../hosted-onboarding/bounded-post-commit";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { activeHostedMemberAccessWhere } from "../hosted-onboarding/member-access";
import {
  readHostedRuntimeStalledRecheckCandidates,
  type HostedRuntimeStalledRecheckCandidate,
  type HostedRuntimeStalledRecheckCandidateScan,
} from "../hosted-runtime-progress/alert-monitor";
import { getPrisma } from "../prisma";
import {
  captureHostedRuntimeRecoveryWitnesses,
  isHostedRuntimeRecoveryMemberId,
  type HostedRuntimeRecoveryVerificationResult,
  type HostedRuntimeRecoveryWitness,
  verifyHostedRuntimeRecoveryWitnesses,
} from "./runtime-recheck-verification";

export type {
  HostedRuntimeRecoveryPendingHead,
  HostedRuntimeRecoveryVerificationResult,
  HostedRuntimeRecoveryVerificationStatus,
  HostedRuntimeRecoveryVerificationUserResult,
  HostedRuntimeRecoveryWitness,
} from "./runtime-recheck-verification";

export const HOSTED_RUNTIME_MAINTENANCE_DEFAULT_READ_LIMIT = 20;
export const HOSTED_RUNTIME_MAINTENANCE_MAX_READ_LIMIT = 100;
export const HOSTED_RUNTIME_MAINTENANCE_DEFAULT_WAKE_LIMIT = 1;
export const HOSTED_RUNTIME_MAINTENANCE_MAX_WAKE_LIMIT = 3;
export const HOSTED_RUNTIME_STALLED_RECHECK_DEFAULT_READ_LIMIT = 100;
export const HOSTED_RUNTIME_STALLED_RECHECK_MAX_READ_LIMIT = 100;
export const HOSTED_RUNTIME_RECHECK_MAX_SIGNAL_LIMIT = 3;

export interface HostedRuntimeMaintenanceWorkspace {
  checkpointedAt: string | null;
  snapshotRefPresent: true;
  updatedAt: string;
  userId: string;
  version: string;
}

export interface HostedRuntimeMaintenanceOverview {
  candidates: HostedRuntimeMaintenanceWorkspace[];
  generatedAt: string;
  limit: number;
  nextCursor: string | null;
  totalCandidateCount: number;
}

export interface HostedRuntimeMaintenanceWakeResult {
  generatedAt: string;
  limit: number;
  nextCursor: string | null;
  results: HostedRuntimeMaintenanceWakeUserResult[];
}

export interface HostedRuntimeStalledRecheckOverview {
  candidates: HostedRuntimeStalledRecheckCandidate[];
  generatedAt: string;
  limit: number;
  scanTruncated: boolean;
  totalCandidateCount: number;
}

export interface HostedRuntimeRecheckResult {
  generatedAt: string;
  requestedCount: number;
  results: HostedRuntimeRecheckUserResult[];
}

export type HostedRuntimeRecheckUserResult =
  | {
      status: "signaled";
      userId: string;
      witness: HostedRuntimeRecoveryWitness;
    }
  | {
      errorMessage: string;
      errorName: string;
      status: "failed";
      userId: string;
    };

export type HostedRuntimeMaintenanceWakeUserResult =
  | {
      checkpointedAt: string | null;
      status: "signaled";
      updatedAt: string;
      userId: string;
      version: string;
      workflowId: string;
    }
  | {
      checkpointedAt: string | null;
      errorMessage: string;
      errorName: string;
      status: "failed";
      updatedAt: string;
      userId: string;
      version: string;
    };

type HostedRuntimeMaintenanceSignal =
  (input: Parameters<typeof signalHostedRuntimeMaintenanceRuntime>[0]) => Promise<HostedRuntimeSignalResult>;

type HostedRuntimeRecheckSignal =
  (input: Parameters<typeof signalHostedRuntimeRecheckRuntime>[0]) => Promise<HostedRuntimeSignalResult>;

type ReadHostedRuntimeStalledRecheckCandidates =
  (input: Parameters<typeof readHostedRuntimeStalledRecheckCandidates>[0]) => Promise<HostedRuntimeStalledRecheckCandidateScan>;

export async function readHostedRuntimeMaintenanceOverview(input: {
  cursor?: string | null;
  limit?: number | string | null;
  prisma?: PrismaClient;
} = {}): Promise<HostedRuntimeMaintenanceOverview> {
  const prisma = input.prisma ?? getPrisma();
  const limit = normalizePositiveInteger(
    input.limit,
    HOSTED_RUNTIME_MAINTENANCE_DEFAULT_READ_LIMIT,
    HOSTED_RUNTIME_MAINTENANCE_MAX_READ_LIMIT,
  );
  const cursor = normalizeOptionalIdentifier(input.cursor);
  const where = buildHostedRuntimeMaintenanceCandidateWhere();
  const [totalCandidateCount, rows] = await Promise.all([
    prisma.hostedWorkspace.count({ where }),
    prisma.hostedWorkspace.findMany({
      orderBy: { userId: "asc" },
      select: {
        checkpointedAt: true,
        snapshotRef: true,
        updatedAt: true,
        userId: true,
        version: true,
      },
      take: limit + 1,
      where,
      ...(cursor
        ? {
            cursor: { userId: cursor },
            skip: 1,
          }
        : {}),
    }),
  ]);

  const pageRows = rows.slice(0, limit);
  const hasMoreRows = rows.length > limit;

  return {
    candidates: pageRows.map(projectHostedRuntimeMaintenanceWorkspace),
    generatedAt: new Date().toISOString(),
    limit,
    nextCursor: hasMoreRows ? pageRows[pageRows.length - 1]?.userId ?? null : null,
    totalCandidateCount,
  };
}

export async function signalHostedRuntimeMaintenanceBatch(input: {
  cursor?: string | null;
  limit?: number | string | null;
  prisma?: PrismaClient;
  signalRuntimeMaintenance?: HostedRuntimeMaintenanceSignal;
  userId?: string | null;
} = {}): Promise<HostedRuntimeMaintenanceWakeResult> {
  const prisma = input.prisma ?? getPrisma();
  const signalRuntimeMaintenance = input.signalRuntimeMaintenance ?? signalHostedRuntimeMaintenanceRuntime;
  const explicitUserId = normalizeOptionalIdentifier(input.userId);
  const limit = explicitUserId
    ? 1
    : normalizePositiveInteger(
        input.limit,
        HOSTED_RUNTIME_MAINTENANCE_DEFAULT_WAKE_LIMIT,
        HOSTED_RUNTIME_MAINTENANCE_MAX_WAKE_LIMIT,
      );
  const overview = explicitUserId
    ? null
    : await readHostedRuntimeMaintenanceOverview({
        cursor: input.cursor,
        limit,
        prisma,
      });
  const candidates = explicitUserId
    ? [await readHostedRuntimeMaintenanceCandidateForUser({
        prisma,
        userId: explicitUserId,
      })]
    : overview?.candidates ?? [];
  const results: HostedRuntimeMaintenanceWakeUserResult[] = [];

  for (const candidate of candidates) {
    try {
      const signal = await signalRuntimeMaintenance({
        prisma,
        userId: candidate.userId,
      });
      results.push({
        checkpointedAt: candidate.checkpointedAt,
        status: "signaled",
        updatedAt: candidate.updatedAt,
        userId: candidate.userId,
        version: candidate.version,
        workflowId: signal.workflowId,
      });
    } catch (error) {
      results.push({
        checkpointedAt: candidate.checkpointedAt,
        errorMessage: describeMaintenanceSignalError(error),
        errorName: error instanceof Error ? error.name : typeof error,
        status: "failed",
        updatedAt: candidate.updatedAt,
        userId: candidate.userId,
        version: candidate.version,
      });
      break;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    limit,
    nextCursor: overview?.nextCursor ?? null,
    results,
  };
}

export async function readHostedRuntimeStalledRecheckOverview(input: {
  limit?: number | string | null;
  now?: Date;
  prisma?: PrismaClient;
  readCandidates?: ReadHostedRuntimeStalledRecheckCandidates;
} = {}): Promise<HostedRuntimeStalledRecheckOverview> {
  const now = input.now ?? new Date();
  const limit = normalizePositiveInteger(
    input.limit,
    HOSTED_RUNTIME_STALLED_RECHECK_DEFAULT_READ_LIMIT,
    HOSTED_RUNTIME_STALLED_RECHECK_MAX_READ_LIMIT,
  );
  const readCandidates = input.readCandidates
    ?? readHostedRuntimeStalledRecheckCandidates;
  const scan = await readCandidates({
    now,
    prisma: input.prisma ?? getPrisma(),
  });

  return {
    candidates: scan.candidates.slice(0, limit),
    generatedAt: now.toISOString(),
    limit,
    scanTruncated: scan.scanTruncated,
    totalCandidateCount: scan.candidates.length,
  };
}

export async function signalHostedRuntimeRecheckBatch(input: {
  abortSignal?: AbortSignal;
  now?: Date;
  prisma?: PrismaClient;
  signalRuntimeRecheck?: HostedRuntimeRecheckSignal;
  userIds: readonly string[];
}): Promise<HostedRuntimeRecheckResult> {
  const prisma = input.prisma ?? getPrisma();
  const userIds = normalizeRuntimeRecheckUserIds(input.userIds);
  const witnesses = await captureHostedRuntimeRecoveryWitnesses({
    now: input.now ?? new Date(),
    prisma,
    userIds,
  });
  const orderedWitnesses = userIds.map((userId) => {
    const witness = witnesses.get(userId);
    if (!witness) {
      throw new Error("Runtime recovery witness capture returned an incomplete batch.");
    }
    return witness;
  });
  const signalRuntimeRecheck = input.signalRuntimeRecheck
    ?? signalHostedRuntimeRecheckRuntime;
  const deadlineMs = createHostedPostCommitDeadline(undefined);
  const results: HostedRuntimeRecheckUserResult[] = [];

  for (const [index, userId] of userIds.entries()) {
    const witness = orderedWitnesses[index]!;
    if (witness.workspaceVersion === null) {
      results.push({
        errorMessage: "No hosted runtime workspace exists for this member id.",
        errorName: "HostedRuntimeWorkspaceNotFound",
        status: "failed",
        userId,
      });
      break;
    }
    try {
      await waitForHostedPostCommitOperation({
        deadlineMs,
        operation: (abortSignal) => signalRuntimeRecheck({
          abortSignal,
          prisma,
          userId,
        }),
        signal: input.abortSignal,
      });
      results.push({
        status: "signaled",
        userId,
        witness,
      });
    } catch (error) {
      results.push({
        errorMessage: describeStalledRecheckSignalError(error),
        errorName: error instanceof Error ? error.name : typeof error,
        status: "failed",
        userId,
      });
      break;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    requestedCount: userIds.length,
    results,
  };
}

export async function verifyHostedRuntimeRecheckBatch(input: {
  baselines: readonly unknown[];
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedRuntimeRecoveryVerificationResult> {
  return await verifyHostedRuntimeRecoveryWitnesses(input);
}

async function readHostedRuntimeMaintenanceCandidateForUser(input: {
  prisma: PrismaClient;
  userId: string;
}): Promise<HostedRuntimeMaintenanceWorkspace> {
  const row = await input.prisma.hostedWorkspace.findFirst({
    select: {
      checkpointedAt: true,
      snapshotRef: true,
      updatedAt: true,
      userId: true,
      version: true,
    },
    where: {
      ...buildHostedRuntimeMaintenanceCandidateWhere(),
      userId: input.userId,
    },
  });

  if (!row) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_MAINTENANCE_WORKSPACE_NOT_FOUND",
      httpStatus: 404,
      message: "No active hosted workspace with a snapshot was found for maintenance.",
    });
  }

  return projectHostedRuntimeMaintenanceWorkspace(row);
}

function buildHostedRuntimeMaintenanceCandidateWhere(): Prisma.HostedWorkspaceWhereInput {
  // Access is enforced in the WHERE so count, cursor, page, and wake signals
  // all describe the same candidate population (a post-slice filter would let
  // one inactive raw row starve a limit-1 batch wake forever).
  return {
    member: activeHostedMemberAccessWhere(),
    snapshotRef: {
      not: Prisma.DbNull,
    },
  };
}

function projectHostedRuntimeMaintenanceWorkspace(row: {
  checkpointedAt: Date | null;
  snapshotRef: Prisma.JsonValue | null;
  updatedAt: Date;
  userId: string;
  version: bigint;
}): HostedRuntimeMaintenanceWorkspace {
  if (row.snapshotRef === null) {
    throw new TypeError("Hosted runtime maintenance candidate requires a snapshot ref.");
  }

  return {
    checkpointedAt: row.checkpointedAt?.toISOString() ?? null,
    snapshotRefPresent: true,
    updatedAt: row.updatedAt.toISOString(),
    userId: row.userId,
    version: row.version.toString(),
  };
}

function normalizePositiveInteger(
  value: number | string | null | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseInt(value, 10)
      : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(parsed), max);
}

function normalizeOptionalIdentifier(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeRuntimeRecheckUserIds(
  values: readonly string[],
): string[] {
  const userIds = [...new Set(values
    .map((value) => value.trim())
    .filter((value) => value.length > 0))];
  if (userIds.length === 0) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_RECHECK_USER_IDS_REQUIRED",
      httpStatus: 400,
      message: "At least one runtime member id is required.",
    });
  }
  if (userIds.length > HOSTED_RUNTIME_RECHECK_MAX_SIGNAL_LIMIT) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_RECHECK_LIMIT_EXCEEDED",
      httpStatus: 400,
      message: `At most ${HOSTED_RUNTIME_RECHECK_MAX_SIGNAL_LIMIT} runtime member ids can be rechecked at once.`,
    });
  }
  if (userIds.some((userId) => !isHostedRuntimeRecoveryMemberId(userId))) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_RECHECK_USER_ID_INVALID",
      httpStatus: 400,
      message: "Every runtime recheck target must be a valid hosted member id.",
    });
  }
  return userIds;
}

function describeMaintenanceSignalError(error: unknown): string {
  return error instanceof Error
    ? "Maintenance signal failed. Check server logs for details."
    : "Maintenance signal failed.";
}

function describeStalledRecheckSignalError(error: unknown): string {
  return error instanceof Error
    ? "Runtime recheck status is unknown. Refresh progress before retrying."
    : "Runtime recheck status is unknown.";
}
