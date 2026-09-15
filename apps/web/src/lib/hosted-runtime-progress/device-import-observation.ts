import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { readHostedRuntimeAiAllowedMemberIds } from "../hosted-onboarding/member-access";
import { getHostedRuntimeLogPool } from "../hosted-runtime-log/database";
import { hostedRuntimeLogSubjectKey, type HostedRuntimeLogSqlDatabase } from "../hosted-runtime-log/store";
import { getPrisma } from "../prisma";
import { DEVICE_IMPORT_LOOKBACK_MS, summarizeDeviceImportHealth, type DeviceImportObservation } from "./device-import-health";

export const DEVICE_IMPORT_MEMBER_LIMIT = 1_000;
export const DEVICE_IMPORT_EVENT_LIMIT = 50_000;
export type DeviceImportPrisma = Pick<PrismaClient,
  "$queryRaw" | "hostedWorkspace" | "hostedMember" | "hostedThreadContainerParticipant" | "hostedLinqAlert">;

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
  const workspaces = await prisma.hostedWorkspace.findMany({
    where: { userId: { in: [...allowed] } },
    select: { userId: true, nextWakeAt: true, nextWakeReason: true },
  });
  const dueSubjects = new Set(workspaces.filter(row => row.nextWakeReason === "device-sync.reconcile"
    && row.nextWakeAt !== null && row.nextWakeAt.getTime() <= input.now.getTime())
    .map(row => hostedRuntimeLogSubjectKey(row.userId)));
  const observations = await readDeviceImportObservations({ subjects, now: input.now, database: input.database });
  return summarizeDeviceImportHealth({ now: input.now, observations, dueSubjects });
}

export async function readDeviceImportObservations(input: {
  subjects: readonly string[]; now: Date; database?: Pick<HostedRuntimeLogSqlDatabase, "query">;
}): Promise<DeviceImportObservation[]> {
  if (input.subjects.length > DEVICE_IMPORT_MEMBER_LIMIT) throw new RangeError("Too many device import subjects.");
  if (input.subjects.length === 0) return [];
  const database = input.database ?? getHostedRuntimeLogPool();
  const result = await database.query<DeviceImportObservation>(`
    SELECT subject_key AS "subjectKey", attempt_id AS "attemptId", at, event_code AS "eventCode",
      CASE WHEN event_code = 'device-sync.pass_finished'
        AND redacted_json->>'deviceSyncConnectionKey' ~ '^[a-f0-9]{64}$'
        THEN redacted_json->>'deviceSyncConnectionKey' ELSE NULL END AS "connectionKey",
      CASE WHEN event_code <> 'device-sync.pass_finished' THEN NULL
        WHEN redacted_json->>'outgoingRetainedJobCount' ~ '^[1-9][0-9]{0,8}$' THEN true
        WHEN redacted_json->>'queueSnapshotAfterPresent' = 'true'
          AND redacted_json->>'pendingJobCountAfter' ~ '^[0-9]{1,9}$'
          THEN (redacted_json->>'pendingJobCountAfter')::int > 0
        ELSE NULL END AS pending,
      COALESCE(event_code = 'device-sync.pass_finished'
        AND redacted_json->>'processedJobs' ~ '^[1-9][0-9]{0,8}$'
        AND (redacted_json->>'deviceSyncImportAppliedCount' ~ '^[1-9][0-9]{0,8}$'
          OR (redacted_json->>'incomingRetainedProgressFingerprint' ~ '^[a-f0-9]{64}$'
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
