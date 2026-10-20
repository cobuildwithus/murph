import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { readHostedRuntimeAiAllowedMemberIds } from "../hosted-onboarding/member-access";
import { readHostedRuntimeCheckpointPublicationExpectedBy, readHostedRuntimeTerminalNonReplyCommittedAt,
  readHostedRuntimeTerminalReplyCommittedAt } from "../hosted-runtime-latency/alert-monitor";
import { getHostedRuntimeLogPool } from "../hosted-runtime-log/database";
import { hostedRuntimeLogSubjectKey, type HostedRuntimeLogSqlDatabase } from "../hosted-runtime-log/store";
import { getPrisma } from "../prisma";
import { DEVICE_IMPORT_LOOKBACK_MS, DEVICE_IMPORT_STALL_MS, summarizeDeviceImportHealth,
  type DeviceImportCheckpointPublication, type DeviceImportObservation } from "./device-import-health";

export const DEVICE_IMPORT_MEMBER_LIMIT = 1_000;
export const DEVICE_IMPORT_EVENT_LIMIT = 50_000;
export type DeviceImportPrisma = Pick<PrismaClient,
  "$queryRaw" | "hostedMember" | "hostedThreadContainerParticipant" | "hostedLinqAlert">;

// At most four primary reads and one isolated log read per observation. No
// transactions, ciphertext, provider calls, or raw log payloads are needed.
export async function readDeviceImportHealth(input: {
  now: Date;
  prisma?: DeviceImportPrisma;
  database?: Pick<HostedRuntimeLogSqlDatabase, "query">;
}) {
  const prisma = input.prisma ?? getPrisma();
  const connections = await prisma.$queryRaw<{ userId: string }[]>(Prisma.sql`
    SELECT DISTINCT user_id AS "userId" FROM device_connection
    WHERE status = 'active' ORDER BY user_id LIMIT ${DEVICE_IMPORT_MEMBER_LIMIT + 1}
  `);
  if (connections.length > DEVICE_IMPORT_MEMBER_LIMIT) throw new Error("Device import member scan is truncated.");
  const allowed = await readHostedRuntimeAiAllowedMemberIds({
    memberIds: connections.map(row => row.userId), prisma, now: input.now,
  });
  const subjects = [...allowed].map(hostedRuntimeLogSubjectKey);
  if (subjects.length === 0) return summarizeDeviceImportHealth({
    now: input.now, observations: [], dueSubjects: new Set(),
  });
  const workspaces = await readDeviceImportRuntimeStates({ userIds: [...allowed], now: input.now, prisma });
  const dueSubjects = new Set(workspaces.filter(row => row.nextWakeReason === "device-sync.reconcile"
    && row.nextWakeAt !== null
    && row.nextWakeAt.getTime() <= input.now.getTime() - DEVICE_IMPORT_STALL_MS)
    .map(row => hostedRuntimeLogSubjectKey(row.userId)));
  const observations = await readDeviceImportObservations({ subjects, now: input.now, database: input.database });
  const checkpointPublications = new Map<string, DeviceImportCheckpointPublication>();
  for (const row of workspaces) {
    const expectedBy = readHostedRuntimeCheckpointPublicationExpectedBy(row.checkpointEvidence);
    const completedAt = readHostedRuntimeTerminalReplyCommittedAt(row.checkpointEvidence)
      ?? readHostedRuntimeTerminalNonReplyCommittedAt(row.checkpointEvidence);
    if (row.attemptId && row.foregroundAcceptedAt && expectedBy && completedAt
      && completedAt >= row.foregroundAcceptedAt && completedAt <= input.now
      && expectedBy >= completedAt && input.now <= expectedBy) {
      checkpointPublications.set(hostedRuntimeLogSubjectKey(row.userId), { attemptId: row.attemptId, expectedBy });
    }
  }
  return summarizeDeviceImportHealth({ now: input.now, observations, dueSubjects, checkpointPublications });
}

export async function readDeviceImportRuntimeStates(input: {
  userIds: readonly string[]; now: Date; prisma: Pick<PrismaClient, "$queryRaw">;
}) {
  if (input.userIds.length > DEVICE_IMPORT_MEMBER_LIMIT) throw new RangeError("Too many device import members.");
  if (input.userIds.length === 0) return [];
  return input.prisma.$queryRaw<{
    userId: string; nextWakeAt: Date | null; nextWakeReason: string | null;
    attemptId: string | null; foregroundAcceptedAt: Date | null; checkpointEvidence: unknown;
  }[]>(Prisma.sql`
    SELECT workspace.user_id AS "userId", workspace.next_wake_at AS "nextWakeAt",
      workspace.next_wake_reason AS "nextWakeReason", publication.attempt_id AS "attemptId",
      publication.accepted_at AS "foregroundAcceptedAt", publication.evidence AS "checkpointEvidence"
    FROM hosted_workspace AS workspace
    LEFT JOIN hosted_runtime_owner AS owner ON owner.user_id = workspace.user_id
      AND owner.phase = 'active' AND owner.processing_mode = 'default' AND owner.completed_at IS NULL
    LEFT JOIN LATERAL (
      SELECT foreground.runtime_attempt_id AS attempt_id, foreground.accepted_at,
        jsonb_build_object('assistant', jsonb_build_object(
          'checkpointPublicationExpectedByEpochMs',
            foreground.phase_breakdown_json -> 'assistant' -> 'checkpointPublicationExpectedByEpochMs',
          'terminalReplyCommittedAtEpochMs',
            foreground.phase_breakdown_json -> 'assistant' -> 'terminalReplyCommittedAtEpochMs',
          'terminalNonReplyCommittedAtEpochMs',
            foreground.phase_breakdown_json -> 'assistant' -> 'terminalNonReplyCommittedAtEpochMs'
        )) AS evidence
      FROM (
        SELECT candidate.runtime_attempt_id, candidate.accepted_at, candidate.phase_breakdown_json
        FROM hosted_ingress_latency_trace AS candidate
        WHERE candidate.user_id = workspace.user_id
          AND candidate.accepted_at >= ${new Date(input.now.getTime() - DEVICE_IMPORT_LOOKBACK_MS)}
          AND candidate.accepted_at <= ${input.now}
        ORDER BY candidate.accepted_at DESC, candidate.id DESC LIMIT 1
      ) AS foreground
      WHERE foreground.runtime_attempt_id = owner.attempt_id
        AND owner.generation::text = foreground.phase_breakdown_json -> 'assistant' ->> 'runtimeLeaseGeneration'
    ) AS publication ON TRUE
    WHERE workspace.user_id IN (${Prisma.join(input.userIds)})
    ORDER BY workspace.user_id LIMIT ${DEVICE_IMPORT_MEMBER_LIMIT}
  `);
}

export async function readDeviceImportObservations(input: {
  subjects: readonly string[]; now: Date; database?: Pick<HostedRuntimeLogSqlDatabase, "query">;
}): Promise<DeviceImportObservation[]> {
  if (input.subjects.length > DEVICE_IMPORT_MEMBER_LIMIT) throw new RangeError("Too many device import subjects.");
  if (input.subjects.length === 0) return [];
  const database = input.database ?? getHostedRuntimeLogPool();
  // Failed passes have no returned continuation. Their checkpoint preserves
  // the incoming retry obligation, even when the local queue is empty.
  const result = await database.query<DeviceImportObservation>(`
    SELECT subject_key AS "subjectKey", attempt_id AS "attemptId", at, event_code AS "eventCode",
      CASE WHEN event_code = 'device-sync.pass_finished'
        AND redacted_json->>'deviceSyncConnectionKey' ~ '^[a-f0-9]{64}$'
        THEN redacted_json->>'deviceSyncConnectionKey' ELSE NULL END AS "connectionKey",
      CASE WHEN event_code <> 'device-sync.pass_finished' THEN NULL
        WHEN redacted_json->>'outgoingRetainedJobCount' ~ '^[1-9][0-9]{0,8}$' THEN true
        WHEN redacted_json->>'outcome' = 'failed'
          AND redacted_json->>'incomingRetainedJobCount' ~ '^[1-9][0-9]{0,8}$' THEN true
        WHEN redacted_json->>'queueSnapshotAfterPresent' = 'true'
          AND redacted_json->>'pendingJobCountAfter' ~ '^[1-9][0-9]{0,8}$' THEN true
        WHEN redacted_json->>'outcome' IN ('completed', 'yielded')
          AND redacted_json->>'queueSnapshotAfterPresent' = 'true'
          AND redacted_json->>'pendingJobCountAfter' ~ '^[0-9]{1,9}$'
          THEN (redacted_json->>'pendingJobCountAfter')::int > 0
        ELSE NULL END AS pending,
      CASE WHEN event_code <> 'device-sync.pass_finished' THEN NULL
        WHEN redacted_json->>'pendingRunnableJobCountAfter' ~ '^[1-9][0-9]{0,8}$'
          OR redacted_json->>'outgoingRetainedRunnableJobCount' ~ '^[1-9][0-9]{0,8}$' THEN true
        WHEN redacted_json->>'outcome' IN ('completed', 'yielded')
          AND redacted_json->>'queueSnapshotAfterPresent' = 'true'
          AND redacted_json->>'pendingJobCountAfterTruncated' = 'false'
          AND redacted_json->>'pendingRunnableJobCountAfter' = '0'
          AND redacted_json->>'outgoingRetainedRunnableJobCount' = '0' THEN false
        ELSE NULL END AS runnable,
      COALESCE(event_code = 'device-sync.pass_finished'
        AND redacted_json->>'processedJobs' ~ '^[1-9][0-9]{0,8}$'
        AND (redacted_json->>'deviceSyncImportAppliedCount' ~ '^[1-9][0-9]{0,8}$'
          OR (redacted_json->>'outcome' IN ('completed', 'yielded')
            AND redacted_json->>'incomingRetainedProgressFingerprint' ~ '^[a-f0-9]{64}$'
            AND redacted_json->>'outgoingRetainedProgressFingerprint' ~ '^[a-f0-9]{64}$'
            AND redacted_json->>'incomingRetainedProgressFingerprint'
              <> redacted_json->>'outgoingRetainedProgressFingerprint')), false) AS progressed,
      COALESCE(event_code = 'checkpoint.snapshot_finished'
        AND redacted_json->>'webCheckpointAccepted' = 'true', false) AS "checkpointAccepted",
      COALESCE(event_code = 'runner.processing_finished'
        AND redacted_json->>'runtimeProcessingOutcome' = 'runtime_processing_accepted'
        AND redacted_json->>'runtimeProcessingAction' = 'started', false) AS restarted,
      COALESCE(event_code = 'device-sync.pass_finished'
        AND redacted_json->>'yieldReason' = 'outer_signal', false) AS cancelled
    FROM hosted_runtime_log
    WHERE subject_key = ANY($1::text[]) AND at >= $2 AND at <= $3
      AND event_code IN ('device-sync.pass_finished', 'checkpoint.snapshot_finished', 'runner.processing_finished')
    ORDER BY at, id LIMIT $4
  `, [input.subjects, new Date(input.now.getTime() - DEVICE_IMPORT_LOOKBACK_MS), input.now, DEVICE_IMPORT_EVENT_LIMIT + 1]);
  if (result.rows.length > DEVICE_IMPORT_EVENT_LIMIT) throw new Error("Device import event scan is truncated.");
  return result.rows;
}
