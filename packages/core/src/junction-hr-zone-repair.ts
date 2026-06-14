import fs from "node:fs/promises";

import type { ActivitySessionEventRecord } from "@murphai/contracts";
import { eventRecordSchema } from "@murphai/contracts";

import { emitAuditRecord } from "./audit.ts";
import { VAULT_LAYOUT } from "./constants.ts";
import { VaultError } from "./errors.ts";
import { walkVaultFiles } from "./fs.ts";
import {
  buildEventSpineLifecycle,
  eventSpineRevision,
  isDeletedEventSpineRecord,
  selectLatestEventSpineEntry,
  type EventSpineEntry,
} from "./history/event-spine.ts";
import { readJsonlRecords } from "./jsonl.ts";
import { runCanonicalWrite } from "./operations/write-batch.ts";
import { resolveVaultPath } from "./path-safety.ts";

export interface RepairJunctionWorkoutHeartRateZonesInput {
  vaultRoot: string;
  apply?: boolean;
  now?: Date;
}

export interface JunctionWorkoutHeartRateZoneRepairResult {
  mode: "dry-run" | "apply";
  hasWork: boolean;
  mutated: boolean;
  scannedEventCount: number;
  candidateCount: number;
  unverifiedCandidateCount: number;
  repairedCount: number;
  touchedPathCount: number;
  touchedPaths: string[];
  auditPath: string | null;
}

interface JunctionWorkoutHeartRateZoneRepairCandidate {
  relativePath: string;
  original: ActivitySessionEventRecord;
  repaired: ActivitySessionEventRecord;
}

const AUDIT_TARGET_ID_LIMIT = 100;

export async function repairJunctionWorkoutHeartRateZones({
  vaultRoot,
  apply = false,
  now = new Date(),
}: RepairJunctionWorkoutHeartRateZonesInput): Promise<JunctionWorkoutHeartRateZoneRepairResult> {
  const repairedAt = now.toISOString();
  const { candidates, scannedEventCount, unverifiedCandidateCount } = await collectJunctionHrZoneRepairCandidates(
    vaultRoot,
    repairedAt,
  );
  const touchedPaths = [...new Set(candidates.map((candidate) => candidate.relativePath))].sort();

  if (!apply || candidates.length === 0) {
    return {
      auditPath: null,
      candidateCount: candidates.length,
      hasWork: candidates.length > 0,
      mode: apply ? "apply" : "dry-run",
      mutated: false,
      repairedCount: 0,
      scannedEventCount,
      unverifiedCandidateCount,
      touchedPathCount: touchedPaths.length,
      touchedPaths,
    };
  }

  const payloadByShard = new Map<string, string>();
  for (const candidate of candidates) {
    payloadByShard.set(
      candidate.relativePath,
      `${payloadByShard.get(candidate.relativePath) ?? ""}${JSON.stringify(candidate.repaired)}\n`,
    );
  }

  return await runCanonicalWrite({
    occurredAt: repairedAt,
    operationType: "junction_hr_zone_repair",
    summary: `Repair ${candidates.length} Junction workout heart-rate zone record(s)`,
    vaultRoot,
    mutate: async ({ batch }) => {
      for (const relativePath of touchedPaths) {
        const payload = payloadByShard.get(relativePath);

        if (payload) {
          await batch.stageJsonlAppend(relativePath, payload);
        }
      }

      const audit = await emitAuditRecord({
        action: "vault_repair",
        batch,
        commandName: "core.repairJunctionWorkoutHeartRateZones",
        files: touchedPaths,
        occurredAt: repairedAt,
        summary:
          `Repaired ${candidates.length} Junction workout heart-rate zone record(s) ` +
          "from legacy 1..6 numeric buckets to 0..5 numeric buckets.",
        targetIds: candidates
          .map((candidate) => candidate.original.id)
          .slice(0, AUDIT_TARGET_ID_LIMIT),
        vaultRoot,
      });

      return {
        auditPath: audit.relativePath,
        candidateCount: candidates.length,
        hasWork: true,
        mode: "apply",
        mutated: true,
        repairedCount: candidates.length,
        scannedEventCount,
        unverifiedCandidateCount,
        touchedPathCount: touchedPaths.length,
        touchedPaths,
      };
    },
  });
}

async function collectJunctionHrZoneRepairCandidates(
  vaultRoot: string,
  repairedAt: string,
): Promise<{
  candidates: JunctionWorkoutHeartRateZoneRepairCandidate[];
  scannedEventCount: number;
  unverifiedCandidateCount: number;
}> {
  const shardPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });
  const entriesById = new Map<string, Array<EventSpineEntry<ActivitySessionEventRecord>>>();
  let scannedEventCount = 0;
  let unverifiedCandidateCount = 0;

  for (const relativePath of shardPaths) {
    const records = await readJsonlRecords({
      relativePath,
      vaultRoot,
    });

    for (const rawRecord of records) {
      const record = eventRecordSchema.parse(rawRecord);

      if (record.kind !== "activity_session") {
        continue;
      }

      scannedEventCount += 1;

      const entries = entriesById.get(record.id) ?? [];
      entries.push({
        record,
        relativePath,
      });
      entriesById.set(record.id, entries);
    }
  }

  const candidates: JunctionWorkoutHeartRateZoneRepairCandidate[] = [];

  for (const entries of entriesById.values()) {
    const latest = selectLatestEventSpineEntry(entries);

    if (!latest || isDeletedEventSpineRecord(latest.record)) {
      continue;
    }
    if (!isJunctionHrZoneRepairShapeCandidate(latest.record)) {
      continue;
    }
    if (!await hasRawPrimitiveNumericHrZoneEvidence(vaultRoot, latest.record)) {
      unverifiedCandidateCount += 1;
      continue;
    }

    candidates.push({
      original: latest.record,
      relativePath: latest.relativePath,
      repaired: buildRepairedJunctionWorkoutHeartRateZoneRecord(latest.record, repairedAt),
    });
  }

  return {
    candidates: candidates.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath) ||
      left.original.id.localeCompare(right.original.id)
    ),
    scannedEventCount,
    unverifiedCandidateCount,
  };
}

function isJunctionHrZoneRepairShapeCandidate(record: ActivitySessionEventRecord): boolean {
  if (
    record.source !== "device"
    || record.workout?.sourceApp !== "garmin"
    || !isJunctionWorkoutExternalRef(record)
  ) {
    return false;
  }

  const zones = record.workout?.heartRateZones;

  return Array.isArray(zones)
    && zones.length === 6
    && zones.every((zone, index) =>
      zone.zone === index + 1
      && typeof zone.durationMinutes === "number"
      && zone.label === undefined
      && zone.minHeartRate === undefined
      && zone.maxHeartRate === undefined
    );
}

function isJunctionWorkoutExternalRef(record: ActivitySessionEventRecord): boolean {
  const externalRef = record.externalRef;

  return externalRef?.system === "junction"
    && externalRef.resourceType === "junction-garmin-workouts";
}

async function hasRawPrimitiveNumericHrZoneEvidence(
  vaultRoot: string,
  record: ActivitySessionEventRecord,
): Promise<boolean> {
  const sourceWorkoutId = record.workout?.sourceWorkoutId;
  const rawRefs = record.rawRefs;

  if (!sourceWorkoutId || !Array.isArray(rawRefs) || rawRefs.length === 0) {
    return false;
  }

  for (const rawRef of rawRefs) {
    const rawPayload = await readVaultRawJson(vaultRoot, rawRef);

    if (rawPayload !== undefined && rawPayloadContainsPrimitiveNumericWorkoutZones(rawPayload, sourceWorkoutId)) {
      return true;
    }
  }

  return false;
}

async function readVaultRawJson(vaultRoot: string, rawRef: string): Promise<unknown> {
  try {
    const { absolutePath } = resolveVaultPath(vaultRoot, rawRef);
    const content = await fs.readFile(absolutePath, "utf8");
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

function rawPayloadContainsPrimitiveNumericWorkoutZones(payload: unknown, sourceWorkoutId: string): boolean {
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const value = stack.pop();

    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }

    const record = asPlainRecord(value);

    if (!record) {
      continue;
    }

    if (rawWorkoutIdMatches(record, sourceWorkoutId) && rawWorkoutHasPrimitiveNumericZones(record)) {
      return true;
    }

    stack.push(...Object.values(record));
  }

  return false;
}

function rawWorkoutIdMatches(record: Record<string, unknown>, sourceWorkoutId: string): boolean {
  return RAW_WORKOUT_ID_PATHS.some((path) => stringId(readPath(record, path)) === sourceWorkoutId);
}

function rawWorkoutHasPrimitiveNumericZones(record: Record<string, unknown>): boolean {
  return RAW_WORKOUT_HR_ZONE_PATHS.some((path) => isPrimitiveNumericZoneArray(readPath(record, path)));
}

function isPrimitiveNumericZoneArray(value: unknown): boolean {
  return Array.isArray(value)
    && value.length === 6
    && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function readPath(record: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = record;

  for (const segment of path.split(".")) {
    const cursorRecord = asPlainRecord(cursor);

    if (!cursorRecord || !(segment in cursorRecord)) {
      return undefined;
    }

    cursor = cursorRecord[segment];
  }

  return cursor;
}

function stringId(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const candidate = String(value).trim();
  return candidate.length > 0 ? candidate : undefined;
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : undefined;
}

const RAW_WORKOUT_ID_PATHS = [
  "providerWorkoutId",
  "provider_workout_id",
  "providerId",
  "provider_id",
  "activityId",
  "activity_id",
  "id",
  "workoutId",
  "workout_id",
  "resourceId",
  "resource_id",
  "externalId",
  "external_id",
] as const;

const RAW_WORKOUT_HR_ZONE_PATHS = [
  "heartRateZones",
  "heart_rate_zones",
  "hrZones",
  "hr_zones",
  "heart_rate.zones",
  "zones.heart_rate",
] as const;

function buildRepairedJunctionWorkoutHeartRateZoneRecord(
  record: ActivitySessionEventRecord,
  repairedAt: string,
): ActivitySessionEventRecord {
  const workout = record.workout;
  const heartRateZones = workout?.heartRateZones;

  if (!workout || !heartRateZones) {
    throw new VaultError(
      "EVENT_CONTRACT_INVALID",
      "Junction heart-rate zone repair candidate is missing workout zones.",
    );
  }

  const repaired = eventRecordSchema.parse({
    ...record,
    lifecycle: buildEventSpineLifecycle(eventSpineRevision(record) + 1),
    recordedAt: repairedAt,
    workout: {
      ...workout,
      heartRateZones: heartRateZones.map((zone, index) => ({
        ...zone,
        zone: index,
      })),
    },
  });

  if (repaired.kind !== "activity_session") {
    throw new VaultError(
      "EVENT_CONTRACT_INVALID",
      "Junction heart-rate zone repair produced a non-activity event.",
    );
  }

  return repaired;
}
