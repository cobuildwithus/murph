import { describe, expect, it } from "vitest";

import {
  readHostedStaleRunnerCleanupCandidateIds,
  runHostedStaleRunnerCleanup,
  type HostedStaleRunnerCleanupDeleteFn,
  type HostedStaleRunnerCleanupPrisma,
} from "@/src/lib/hosted-execution/stale-runner-cleanup";
import type { HostedRunnerUserDataDeletionBestEffortResult } from "@/src/lib/hosted-execution/user-data-delete";
import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

describe("readHostedStaleRunnerCleanupCandidateIds", () => {
  it("parses comma and newline separated candidates and dedupes them", () => {
    expect(readHostedStaleRunnerCleanupCandidateIds("member-stale-1, member-stale-2\nmember-stale-1")).toEqual([
      "member-stale-1",
      "member-stale-2",
    ]);
  });

  it("returns an empty candidate list for blank configuration", () => {
    expect(readHostedStaleRunnerCleanupCandidateIds("  \n ")).toEqual([]);
  });

  it("rejects malformed candidates without echoing their value", () => {
    let error: unknown;

    try {
      readHostedStaleRunnerCleanupCandidateIds("member/invalid");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HostedOnboardingError);
    expect((error as HostedOnboardingError).code).toBe(
      "HOSTED_STALE_RUNNER_CLEANUP_INVALID_CANDIDATE",
    );
    expect((error as HostedOnboardingError).message).not.toContain("member/invalid");
  });
});

describe("runHostedStaleRunnerCleanup", () => {
  it("skips configured candidates that still exist as hosted members", async () => {
    const deletedUserIds: string[] = [];
    const result = await runHostedStaleRunnerCleanup({
      configuredUserIds: "member-active member-stale",
      deleteRunnerUserData: makeDeleteRunnerUserData(deletedUserIds),
      prisma: makePrismaWithActiveMembers(["member-active"]),
    });

    expect(deletedUserIds).toEqual(["member-stale"]);
    expect(result).toMatchObject({
      activeMemberSkipCount: 1,
      candidateCount: 2,
      configured: true,
      deletedCount: 1,
      failedCount: 0,
    });
    expect(result.results.map((entry) => entry.action)).toEqual([
      "skipped_active_member",
      "deleted",
    ]);
  });

  it("does not query or delete anything when no candidates are configured", async () => {
    let queried = false;
    const prisma: HostedStaleRunnerCleanupPrisma = {
      hostedMember: {
        async findMany() {
          queried = true;
          return [];
        },
      },
    };
    const deletedUserIds: string[] = [];

    const result = await runHostedStaleRunnerCleanup({
      configuredUserIds: "",
      deleteRunnerUserData: makeDeleteRunnerUserData(deletedUserIds),
      prisma,
    });

    expect(queried).toBe(false);
    expect(deletedUserIds).toEqual([]);
    expect(result).toEqual({
      activeMemberSkipCount: 0,
      candidateCount: 0,
      configured: false,
      deletedCount: 0,
      failedCount: 0,
      results: [],
    });
  });

  it("reports failed best-effort deletions without exposing candidate ids", async () => {
    const result = await runHostedStaleRunnerCleanup({
      configuredUserIds: "member-stale",
      deleteRunnerUserData: async () => ({
        ...makeDeletionResult(),
        deleted: false,
        errorCode: "FetchError",
      }),
      prisma: makePrismaWithActiveMembers([]),
    });

    expect(result.failedCount).toBe(1);
    expect(result.results).toEqual([
      {
        action: "delete_failed",
        alarmCleared: true,
        candidateIndex: 0,
        errorCode: "FetchError",
        r2DeletedObjectCount: 0,
        runnerStateDeleted: true,
      },
    ]);
  });
});

function makePrismaWithActiveMembers(activeMemberIds: string[]): HostedStaleRunnerCleanupPrisma {
  const activeMemberIdSet = new Set(activeMemberIds);

  return {
    hostedMember: {
      async findMany(input) {
        return input.where.id.in
          .filter((id) => activeMemberIdSet.has(id))
          .map((id) => ({ id }));
      },
    },
  };
}

function makeDeleteRunnerUserData(deletedUserIds: string[]): HostedStaleRunnerCleanupDeleteFn {
  return async (input) => {
    deletedUserIds.push(input.userId);
    return makeDeletionResult();
  };
}

function makeDeletionResult(): HostedRunnerUserDataDeletionBestEffortResult {
  return {
    alarmCleared: true,
    configured: true,
    deleted: true,
    errorCode: null,
    r2DeletedObjectCount: 0,
    r2SkippedUserScopedPrefixes: false,
    r2Supported: true,
    r2UserScopedSkipReason: null,
    runnerStateDeleted: true,
  };
}
