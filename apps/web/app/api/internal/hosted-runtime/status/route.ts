import {
  type HostedMailboxLane,
} from "@murphai/hosted-execution/runtime-control";
import {
  parseHostedRunnerStatusResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readHostedMailboxMaxSeqByLane } from "@/src/lib/hosted-mailbox/store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  listHostedRuntimeLogs,
  readHostedWorkspace,
} from "@/src/lib/hosted-workspace/store";

export const GET = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const logLimit = readStatusLogLimit(request);
  const [workspace, maxSeqByLane, recentLogs] = await Promise.all([
    readHostedWorkspace({ userId }),
    readHostedMailboxMaxSeqByLane({ userId }),
    listHostedRuntimeLogs({ limit: logLimit, userId }),
  ]);
  const redactedStatus = readRecord(workspace?.redactedStatusJson);

  return jsonOk(parseHostedRunnerStatusResponse({
    inFlight: false,
    leaseGeneration: "0",
    mailboxLag: maxSeqByLane.map((highWater) => {
      const importedSeq = readImportedSeqForLane(redactedStatus, highWater.lane);
      const maxSeq = BigInt(highWater.maxSeq);

      return {
        importedSeq: importedSeq.toString(),
        lag: (maxSeq > importedSeq ? maxSeq - importedSeq : 0n).toString(),
        lane: highWater.lane,
        maxSeq: highWater.maxSeq,
      };
    }),
    nextAlarmAt: workspace?.nextWakeAt ?? null,
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
      redactedJson: readRecord(entry.redactedJson),
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

function readImportedSeqForLane(
  redactedStatus: Record<string, unknown> | null,
  lane: HostedMailboxLane,
): bigint {
  if (!redactedStatus) {
    return 0n;
  }

  const capitalizedLane = `${lane.slice(0, 1).toUpperCase()}${lane.slice(1)}`;
  const candidates = [
    `${lane}ImportedSeq`,
    `imported${capitalizedLane}Seq`,
    `mailbox${capitalizedLane}ImportedSeq`,
  ];

  for (const key of candidates) {
    const parsed = readNonNegativeBigInt(redactedStatus[key]);

    if (parsed !== null) {
      return parsed;
    }
  }

  return 0n;
}

function readNonNegativeBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint" && value >= 0n) {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^[0-9]+$/u.test(value)) {
    return BigInt(value);
  }

  return null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return Object.fromEntries(Object.entries(value));
}
