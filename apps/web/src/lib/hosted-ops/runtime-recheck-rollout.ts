import "server-only";

import type { PrismaClient } from "@prisma/client";

import {
  signalHostedRuntimeRecheckRuntime,
} from "../hosted-orchestration/signal-runtime";
import {
  readActiveHostedMemberAccess,
} from "../hosted-onboarding/member-access";

export const HOSTED_USAGE_ADVISORY_RECHECK_CAMPAIGN =
  "usage-advisory-2026-07";
const HOSTED_USAGE_ADVISORY_RECHECK_PAGE_SIZE = 100;

export type HostedUsageAdvisoryRecheckMode = "apply" | "dry-run";

export interface HostedUsageAdvisoryRecheckSummary {
  activeWorkspaceCount: number;
  failedSignalCount: number;
  mode: HostedUsageAdvisoryRecheckMode;
  signaledWorkspaceCount: number;
  skippedInactiveWorkspaceCount: number;
  workspaceCount: number;
}

type HostedUsageAdvisoryAccessReader = typeof readActiveHostedMemberAccess;
type HostedUsageAdvisoryRuntimeSignaler = typeof signalHostedRuntimeRecheckRuntime;

export async function recheckHostedUsageAdvisoryWorkflows(input: {
  mode: HostedUsageAdvisoryRecheckMode;
  prisma: PrismaClient;
  readActiveAccess?: HostedUsageAdvisoryAccessReader;
  signalRuntimeRecheck?: HostedUsageAdvisoryRuntimeSignaler;
}): Promise<HostedUsageAdvisoryRecheckSummary> {
  const readActiveAccess = input.readActiveAccess ?? readActiveHostedMemberAccess;
  const signalRuntimeRecheck = input.signalRuntimeRecheck
    ?? signalHostedRuntimeRecheckRuntime;
  const summary: HostedUsageAdvisoryRecheckSummary = {
    activeWorkspaceCount: 0,
    failedSignalCount: 0,
    mode: input.mode,
    signaledWorkspaceCount: 0,
    skippedInactiveWorkspaceCount: 0,
    workspaceCount: 0,
  };
  let cursor: string | null = null;

  for (;;) {
    const rows: Array<{ userId: string }> = await input.prisma.hostedWorkspace.findMany({
      orderBy: { userId: "asc" },
      select: { userId: true },
      take: HOSTED_USAGE_ADVISORY_RECHECK_PAGE_SIZE,
      ...(cursor
        ? {
            cursor: { userId: cursor },
            skip: 1,
          }
        : {}),
    });
    if (rows.length === 0) {
      return summary;
    }

    for (const row of rows) {
      summary.workspaceCount += 1;
      if (!await readActiveAccess({
        memberId: row.userId,
        prisma: input.prisma,
      })) {
        summary.skippedInactiveWorkspaceCount += 1;
        continue;
      }

      summary.activeWorkspaceCount += 1;
      if (input.mode === "dry-run") {
        continue;
      }

      try {
        await signalRuntimeRecheck({
          prisma: input.prisma,
          userId: row.userId,
        });
        summary.signaledWorkspaceCount += 1;
      } catch {
        summary.failedSignalCount += 1;
      }
    }

    cursor = rows[rows.length - 1]?.userId ?? null;
    if (rows.length < HOSTED_USAGE_ADVISORY_RECHECK_PAGE_SIZE || !cursor) {
      return summary;
    }
  }
}
