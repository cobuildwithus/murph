import "server-only";

import { createHash } from "node:crypto";

import { HostedBillingStatus, Prisma, type PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionManagedAutomationSeedRequestedWake,
  type HostedExecutionAssistantNotificationRoute,
} from "@murphai/hosted-execution";

import {
  signalHostedMailboxAppendRuntime,
  signalHostedRuntimeMaintenanceRuntime,
  type HostedRuntimeSignalResult,
} from "../hosted-orchestration/signal-runtime";
import {
  appendHostedMailboxEnvelopeTx,
  type AppendHostedMailboxItemResult,
} from "../hosted-mailbox/store";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  readHostedMemberSnapshot,
} from "../hosted-onboarding/hosted-member-store";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "../hosted-onboarding/messaging-state";
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

export interface HostedRuntimeManagedAutomationRepairResult {
  generatedAt: string;
  limit: number;
  nextCursor: string | null;
  results: HostedRuntimeManagedAutomationRepairUserResult[];
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

export type HostedRuntimeManagedAutomationRepairUserResult =
  | {
      checkpointedAt: string | null;
      inserted: boolean;
      mailboxItemId: string;
      status: "enqueued";
      updatedAt: string;
      userId: string;
      version: string;
      workflowId: string;
    }
  | {
      checkpointedAt: string | null;
      status: "route_missing";
      updatedAt: string;
      userId: string;
      version: string;
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

type HostedManagedAutomationSeedAppender = (input: {
  prisma: PrismaClient;
  route: HostedExecutionAssistantNotificationRoute;
  userId: string;
}) => Promise<AppendHostedMailboxItemResult>;

type HostedRuntimeMailboxAppendSignal =
  (input: Parameters<typeof signalHostedMailboxAppendRuntime>[0]) => Promise<HostedRuntimeSignalResult>;

type HostedManagedAutomationRepairRouteReader = (input: {
  prisma: PrismaClient;
  userId: string;
}) => Promise<HostedExecutionAssistantNotificationRoute | null>;

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

export async function repairHostedRuntimeManagedAutomationsBatch(input: {
  appendSeedWake?: HostedManagedAutomationSeedAppender;
  cursor?: string | null;
  limit?: number | string | null;
  prisma?: PrismaClient;
  readRepairRoute?: HostedManagedAutomationRepairRouteReader;
  signalMailboxAppendRuntime?: HostedRuntimeMailboxAppendSignal;
  userId?: string | null;
} = {}): Promise<HostedRuntimeManagedAutomationRepairResult> {
  const prisma = input.prisma ?? getPrisma();
  const appendSeedWake = input.appendSeedWake ?? appendHostedManagedAutomationSeedWake;
  const readRepairRoute = input.readRepairRoute ?? readHostedManagedAutomationRepairRoute;
  const signalMailboxAppendRuntime =
    input.signalMailboxAppendRuntime ?? signalHostedMailboxAppendRuntime;
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
  const results: HostedRuntimeManagedAutomationRepairUserResult[] = [];

  for (const candidate of candidates) {
    try {
      const route = await readRepairRoute({
        prisma,
        userId: candidate.userId,
      });
      if (!route) {
        results.push({
          checkpointedAt: candidate.checkpointedAt,
          status: "route_missing",
          updatedAt: candidate.updatedAt,
          userId: candidate.userId,
          version: candidate.version,
        });
        continue;
      }

      const append = await appendSeedWake({
        prisma,
        route,
        userId: candidate.userId,
      });
      const signal = await signalMailboxAppendRuntime({
        expectedUserId: candidate.userId,
        mailboxItemId: append.item.id,
        prisma,
      });
      results.push({
        checkpointedAt: candidate.checkpointedAt,
        inserted: append.inserted,
        mailboxItemId: append.item.id,
        status: "enqueued",
        updatedAt: candidate.updatedAt,
        userId: candidate.userId,
        version: candidate.version,
        workflowId: signal.workflowId,
      });
    } catch (error) {
      results.push({
        checkpointedAt: candidate.checkpointedAt,
        errorMessage: describeManagedAutomationRepairError(error),
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

export async function appendHostedManagedAutomationSeedWake(input: {
  now?: Date;
  prisma: PrismaClient;
  route: HostedExecutionAssistantNotificationRoute;
  userId: string;
}): Promise<AppendHostedMailboxItemResult> {
  const wake = buildHostedManagedAutomationSeedWake({
    now: input.now ?? new Date(),
    route: input.route,
    userId: input.userId,
  });

  return await input.prisma.$transaction((tx) =>
    appendHostedMailboxEnvelopeTx({
      envelope: wake,
      tx,
    }));
}

export async function readHostedManagedAutomationRepairRoute(input: {
  prisma: PrismaClient;
  userId: string;
}): Promise<HostedExecutionAssistantNotificationRoute | null> {
  const member = await readHostedMemberSnapshot({
    memberId: input.userId,
    prisma: input.prisma,
  });
  if (
    !member
    || member.core.billingStatus !== HostedBillingStatus.active
    || member.core.suspendedAt
  ) {
    return null;
  }

  const routing = member.routing;
  const messaging = resolveHostedMemberMessagingState({
    identity: member.identity,
    routing,
  });
  const linqContactLookupKey =
    member.identity?.phoneLookupKey
    ?? routing?.pendingLinqParticipantContact?.lookupKey
    ?? member.emailAuthorization?.verifiedEmail?.lookupKey
    ?? null;

  return resolveHostedMemberAssistantNotificationRoute({
    linqChatId: routing?.linqChatId ?? routing?.pendingLinqChatId ?? null,
    linqContactLookupKey,
    linqRecipientPhone:
      routing?.linqRecipientPhone ?? routing?.pendingLinqRecipientPhone ?? null,
    memberId: input.userId,
    memberPhoneNumber: member.identity?.phoneNumber ?? null,
    messaging,
  });
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
  return {
    member: {
      billingStatus: HostedBillingStatus.active,
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

function buildHostedManagedAutomationSeedWake(input: {
  now: Date;
  route: HostedExecutionAssistantNotificationRoute;
  userId: string;
}) {
  const bucketMs = Math.floor(input.now.getTime() / 60_000) * 60_000;
  const routeFingerprint = createHash("sha256")
    .update(JSON.stringify(input.route))
    .digest("hex")
    .slice(0, 16);

  return buildHostedExecutionManagedAutomationSeedRequestedWake({
    eventId:
      `assistant.managed-automation.seed-requested:${input.userId}:${routeFingerprint}:${bucketMs}`,
    memberId: input.userId,
    occurredAt: new Date(bucketMs).toISOString(),
    route: input.route,
  });
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

function describeManagedAutomationRepairError(error: unknown): string {
  return error instanceof Error
    ? "Managed automation repair failed. Check server logs for details."
    : "Managed automation repair failed.";
}
