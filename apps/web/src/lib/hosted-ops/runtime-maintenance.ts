import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  signalHostedRuntimeMaintenanceRuntime,
  type HostedRuntimeSignalResult,
} from "../hosted-orchestration/signal-runtime";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  hasActiveHostedMemberAccess,
  hostedMemberAccessSelect,
} from "../hosted-onboarding/member-access";
import { getPrisma } from "../prisma";

export const HOSTED_RUNTIME_MAINTENANCE_DEFAULT_READ_LIMIT = 20;
export const HOSTED_RUNTIME_MAINTENANCE_MAX_READ_LIMIT = 100;
export const HOSTED_RUNTIME_MAINTENANCE_DEFAULT_WAKE_LIMIT = 1;
export const HOSTED_RUNTIME_MAINTENANCE_MAX_WAKE_LIMIT = 3;

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
        member: {
          select: hostedMemberAccessSelect,
        },
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
    // Access is decided by the shared resolver so sponsored members and
    // thread containers stay maintainable; the page cursor advances over the
    // raw rows, filtered rows are simply not maintenance candidates.
    candidates: pageRows
      .filter((row) => hasActiveHostedMemberAccess(row.member))
      .map(projectHostedRuntimeMaintenanceWorkspace),
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

async function readHostedRuntimeMaintenanceCandidateForUser(input: {
  prisma: PrismaClient;
  userId: string;
}): Promise<HostedRuntimeMaintenanceWorkspace> {
  const row = await input.prisma.hostedWorkspace.findFirst({
    select: {
      checkpointedAt: true,
      member: {
        select: hostedMemberAccessSelect,
      },
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

  if (!row || !hasActiveHostedMemberAccess(row.member)) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_MAINTENANCE_WORKSPACE_NOT_FOUND",
      httpStatus: 404,
      message: "No active hosted workspace with a snapshot was found for maintenance.",
    });
  }

  return projectHostedRuntimeMaintenanceWorkspace(row);
}

function buildHostedRuntimeMaintenanceCandidateWhere(): Prisma.HostedWorkspaceWhereInput {
  return {
    member: {
      suspendedAt: null,
    },
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

function describeMaintenanceSignalError(error: unknown): string {
  return error instanceof Error
    ? "Maintenance signal failed. Check server logs for details."
    : "Maintenance signal failed.";
}
