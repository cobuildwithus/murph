import {
  parseHostedRuntimeWebStatusResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "@/src/lib/hosted-execution/logging";
import {
  computeHostedMailboxLaneLag,
  readHostedMailboxRedactedStatusRecord,
} from "@/src/lib/hosted-mailbox/lag";
import { readHostedMailboxMaxSeqByLane } from "@/src/lib/hosted-mailbox/store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  isHostedRuntimeLogDatabaseConfigured,
} from "@/src/lib/hosted-runtime-log/database";
import {
  listHostedRuntimeLogs,
} from "@/src/lib/hosted-runtime-log/store";
import {
  readHostedWorkspace,
} from "@/src/lib/hosted-workspace/store";

const HOSTED_RUNTIME_STATUS_CALLBACK_BODY_LIMIT_BYTES = 0;

export const GET = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_RUNTIME_STATUS_CALLBACK_BODY_LIMIT_BYTES,
  });
  const logLimit = readStatusLogLimit(request);
  const [workspace, maxSeqByLane, recentLogs] = await Promise.all([
    readHostedWorkspace({ userId }),
    readHostedMailboxMaxSeqByLane({ userId }),
    logLimit === 0
      ? Promise.resolve([])
      : readRecentHostedRuntimeLogsBestEffort({ limit: logLimit, userId }),
  ]);
  const redactedStatus = readHostedMailboxRedactedStatusRecord(
    workspace?.redactedStatusJson,
  );

  return jsonOk(parseHostedRuntimeWebStatusResponse({
    mailboxLag: maxSeqByLane.map((highWater) => computeHostedMailboxLaneLag({
      highWater,
      redactedStatusJson: redactedStatus,
    })),
    recentLogs: recentLogs?.map((entry) => ({
      at: entry.at,
      attemptId: entry.attemptId,
      checkpointVersion: entry.checkpointVersion,
      component: entry.component,
      errorCode: entry.errorCode,
      eventCode: entry.eventCode,
      leaseGeneration: entry.leaseGeneration,
      level: entry.level,
      mailboxLane: entry.mailboxLane,
      mailboxSeqEnd: entry.mailboxSeqEnd,
      mailboxSeqStart: entry.mailboxSeqStart,
      outboxIntentRef: entry.outboxIntentRef,
      phase: entry.phase,
      redactedJson: readHostedMailboxRedactedStatusRecord(entry.redactedJson),
      workspaceVersion: entry.workspaceVersion,
    })),
    userId,
    workspace: workspace
      ? {
          browserVaultReplicaRef: workspace.browserVaultReplicaRef,
          checkpointedAt: workspace.checkpointedAt,
          createdAt: workspace.createdAt,
          inboxMediaRetentionWakeAt: workspace.inboxMediaRetentionWakeAt,
          nextWakeAt: workspace.nextWakeAt,
          nextWakeReason: workspace.nextWakeReason,
          redactedStatus: redactedStatus,
          snapshotRef: workspace.snapshotRef,
          updatedAt: workspace.updatedAt,
          userId: workspace.userId,
          version: workspace.version,
        }
      : null,
  }));
});

type HostedRuntimeStatusLogRecord =
  Awaited<ReturnType<typeof listHostedRuntimeLogs>>[number];

async function readRecentHostedRuntimeLogsBestEffort(input: {
  limit: number;
  userId: string;
}): Promise<HostedRuntimeStatusLogRecord[] | undefined> {
  try {
    if (!isHostedRuntimeLogDatabaseConfigured()) {
      return [];
    }

    return await listHostedRuntimeLogs(input);
  } catch (error) {
    console.warn("Hosted runtime status isolated-log read failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, {
        code: "HOSTED_RUNTIME_STATUS_LOG_READ_FAILED",
      }),
    });
    return undefined;
  }
}

function readStatusLogLimit(request: Request): number {
  const rawLimit = new URL(request.url).searchParams.get("logLimit");

  if (!rawLimit) {
    return 20;
  }

  if (!/^[0-9]+$/u.test(rawLimit)) {
    return 20;
  }

  const parsed = Number(rawLimit);

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 20;
}
