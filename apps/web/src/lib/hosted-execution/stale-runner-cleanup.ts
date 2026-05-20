import {
  deleteHostedRunnerUserDataBestEffort,
  type HostedRunnerUserDataDeletionBestEffortResult,
} from "./user-data-delete";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

export const HOSTED_STALE_RUNNER_USER_IDS_ENV = "HOSTED_STALE_RUNNER_USER_IDS";

const HOSTED_STALE_RUNNER_CLEANUP_MAX_CANDIDATES = 25;
const HOSTED_STALE_RUNNER_ID_MAX_LENGTH = 160;
const HOSTED_STALE_RUNNER_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const HOSTED_STALE_RUNNER_CLEANUP_TIMEOUT_MS = 30_000;

export interface HostedStaleRunnerCleanupPrisma {
  hostedMember: {
    findMany(input: {
      where: {
        id: {
          in: string[];
        };
      };
      select: {
        id: true;
      };
    }): Promise<Array<{ id: string }>>;
  };
}

export type HostedStaleRunnerCleanupDeleteFn = (input: {
  context?: string;
  timeoutMs?: number;
  userId: string;
}) => Promise<HostedRunnerUserDataDeletionBestEffortResult>;

export type HostedStaleRunnerCleanupCandidateAction =
  | "deleted"
  | "delete_failed"
  | "skipped_active_member";

export interface HostedStaleRunnerCleanupCandidateResult {
  readonly action: HostedStaleRunnerCleanupCandidateAction;
  readonly alarmCleared: boolean | null;
  readonly candidateIndex: number;
  readonly errorCode: string | null;
  readonly r2DeletedObjectCount: number | null;
  readonly runnerStateDeleted: boolean | null;
}

export interface HostedStaleRunnerCleanupResult {
  readonly activeMemberSkipCount: number;
  readonly candidateCount: number;
  readonly configured: boolean;
  readonly deletedCount: number;
  readonly failedCount: number;
  readonly results: HostedStaleRunnerCleanupCandidateResult[];
}

export async function runHostedStaleRunnerCleanup(input: {
  configuredUserIds?: string | null;
  deleteRunnerUserData?: HostedStaleRunnerCleanupDeleteFn;
  prisma: HostedStaleRunnerCleanupPrisma;
  timeoutMs?: number;
}): Promise<HostedStaleRunnerCleanupResult> {
  const candidates = readHostedStaleRunnerCleanupCandidateIds(
    input.configuredUserIds ?? process.env[HOSTED_STALE_RUNNER_USER_IDS_ENV],
  );

  if (candidates.length === 0) {
    return {
      activeMemberSkipCount: 0,
      candidateCount: 0,
      configured: false,
      deletedCount: 0,
      failedCount: 0,
      results: [],
    };
  }

  const activeMembers = await input.prisma.hostedMember.findMany({
    where: {
      id: {
        in: candidates,
      },
    },
    select: {
      id: true,
    },
  });
  const activeMemberIds = new Set(activeMembers.map((member) => member.id));
  const deleteRunnerUserData = input.deleteRunnerUserData ?? deleteHostedRunnerUserDataBestEffort;
  const results: HostedStaleRunnerCleanupCandidateResult[] = [];

  for (const [candidateIndex, userId] of candidates.entries()) {
    if (activeMemberIds.has(userId)) {
      results.push({
        action: "skipped_active_member",
        alarmCleared: null,
        candidateIndex,
        errorCode: null,
        r2DeletedObjectCount: null,
        runnerStateDeleted: null,
      });
      continue;
    }

    const deletion = await deleteRunnerUserData({
      context: "hosted-stale-runner-cleanup-cron",
      timeoutMs: input.timeoutMs ?? HOSTED_STALE_RUNNER_CLEANUP_TIMEOUT_MS,
      userId,
    });

    results.push({
      action: deletion.deleted ? "deleted" : "delete_failed",
      alarmCleared: deletion.alarmCleared,
      candidateIndex,
      errorCode: deletion.errorCode,
      r2DeletedObjectCount: deletion.r2DeletedObjectCount,
      runnerStateDeleted: deletion.runnerStateDeleted,
    });
  }

  return summarizeHostedStaleRunnerCleanupResults(candidates.length, results);
}

export function readHostedStaleRunnerCleanupCandidateIds(value: string | null | undefined): string[] {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    return [];
  }

  const candidates = normalized
    .split(/[\s,]+/u)
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0);
  const dedupedCandidates = [...new Set(candidates)];

  if (dedupedCandidates.length > HOSTED_STALE_RUNNER_CLEANUP_MAX_CANDIDATES) {
    throw hostedOnboardingError({
      code: "HOSTED_STALE_RUNNER_CLEANUP_TOO_MANY_CANDIDATES",
      message: "Too many stale runner cleanup candidates are configured.",
      httpStatus: 500,
    });
  }

  for (const candidate of dedupedCandidates) {
    if (
      candidate.length > HOSTED_STALE_RUNNER_ID_MAX_LENGTH
      || !HOSTED_STALE_RUNNER_ID_PATTERN.test(candidate)
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_STALE_RUNNER_CLEANUP_INVALID_CANDIDATE",
        message: "A stale runner cleanup candidate is malformed.",
        httpStatus: 500,
      });
    }
  }

  return dedupedCandidates;
}

function summarizeHostedStaleRunnerCleanupResults(
  candidateCount: number,
  results: HostedStaleRunnerCleanupCandidateResult[],
): HostedStaleRunnerCleanupResult {
  return {
    activeMemberSkipCount: results.filter((result) => result.action === "skipped_active_member")
      .length,
    candidateCount,
    configured: true,
    deletedCount: results.filter((result) => result.action === "deleted").length,
    failedCount: results.filter((result) => result.action === "delete_failed").length,
    results,
  };
}
