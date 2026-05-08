import {
  parseHostedRuntimeWebStatusResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  computeHostedMailboxLaneLag,
  mergeLatestHostedMailboxImportRedactedStatus,
  readHostedMailboxRedactedStatusRecord,
} from "@/src/lib/hosted-mailbox/lag";
import { readHostedMailboxMaxSeqByLane } from "@/src/lib/hosted-mailbox/store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  listHostedRuntimeLogs,
  readLatestHostedMailboxImportRuntimeLog,
  readHostedWorkspace,
} from "@/src/lib/hosted-workspace/store";

export const GET = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const logLimit = readStatusLogLimit(request);
  const [workspace, maxSeqByLane, recentLogs, latestMailboxImportLog] = await Promise.all([
    readHostedWorkspace({ userId }),
    readHostedMailboxMaxSeqByLane({ userId }),
    listHostedRuntimeLogs({ limit: logLimit, userId }),
    readLatestHostedMailboxImportRuntimeLog({ userId }),
  ]);
  const workspaceRedactedStatus =
    readHostedMailboxRedactedStatusRecord(workspace?.redactedStatusJson);
  const redactedStatus = mergeLatestHostedMailboxImportRedactedStatus(
    workspaceRedactedStatus,
    readHostedMailboxRedactedStatusRecord(latestMailboxImportLog?.redactedJson),
  );

  return jsonOk(parseHostedRuntimeWebStatusResponse({
    mailboxLag: maxSeqByLane.map((highWater) => computeHostedMailboxLaneLag({
      highWater,
      redactedStatusJson: redactedStatus,
    })),
    recentLogs: recentLogs.map((entry) => ({
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

function readStatusLogLimit(request: Request): number {
  const rawLimit = new URL(request.url).searchParams.get("logLimit");

  if (!rawLimit) {
    return 20;
  }

  const parsed = Number.parseInt(rawLimit, 10);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 20;
}
