import fs from "node:fs/promises";

import type { ActivitySessionEventRecord, EventRecord } from "@murphai/contracts";
import { eventRecordSchema, safeParseContract } from "@murphai/contracts";

import { emitAuditRecord } from "./audit.ts";
import { VAULT_LAYOUT } from "./constants.ts";
import { VaultError } from "./errors.ts";
import { readUtf8File, walkVaultFiles } from "./fs.ts";
import {
  buildEventSpineLifecycle,
  eventSpineRevision,
  isDeletedEventSpineRecord,
  selectLatestEventSpineEntry,
  type EventSpineEntry,
} from "./history/event-spine.ts";
import {
  listIntegrationIngestsForEvent,
  parseIntegrationEvidencePartJson,
} from "./integration-ingests.ts";
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
  // Track every schema-valid event under each id, regardless of kind. If the
  // latest revision is something other than an activity_session, we must not
  // resurrect an older workout row by ignoring it.
  const entriesById = new Map<string, Array<EventSpineEntry<EventRecord>>>();
  // Any event id that also appears on a schema-invalid row is unsafe to
  // repair: the latest revision under that id may be the rejected row, and
  // our "latest" pick would silently shadow it. Stale-state repair could
  // resurrect older workout fields or raw refs.
  const idsWithInvalidRevisions = new Set<string>();
  // Any shard with an unparseable JSONL line is similarly unsafe — a torn
  // later revision (tombstone, kind change, etc.) under any id could shadow
  // an earlier activity_session row we'd otherwise repair. We don't know
  // the torn line's id, so refuse the whole shard's candidates rather than
  // guess.
  const shardsWithUnparseableJson = new Set<string>();
  let scannedEventCount = 0;
  let unverifiedCandidateCount = 0;

  for (const relativePath of shardPaths) {
    // Parse the shard line-by-line and skip both unparsable JSON and
    // schema-invalid rows. Whole-vault validity reporting belongs to
    // `vault repair` / `validate`; one torn legacy row must not abort
    // this command from acting on valid Junction workout candidates in
    // other shards.
    const shardContent = await readUtf8File(vaultRoot, relativePath);

    for (const line of shardContent.split("\n")) {
      if (!line) {
        continue;
      }

      let rawRecord: unknown;
      try {
        rawRecord = JSON.parse(line);
      } catch {
        shardsWithUnparseableJson.add(relativePath);
        continue;
      }

      const parsed = safeParseContract(eventRecordSchema, rawRecord);
      if (!parsed.success) {
        const rejectedId = readPlainStringId(rawRecord);
        if (rejectedId) {
          idsWithInvalidRevisions.add(rejectedId);
        }
        continue;
      }
      const record = parsed.data;

      if (record.kind === "activity_session") {
        scannedEventCount += 1;
      }

      const entries = entriesById.get(record.id) ?? [];
      entries.push({
        record,
        relativePath,
      });
      entriesById.set(record.id, entries);
    }
  }

  const candidates: JunctionWorkoutHeartRateZoneRepairCandidate[] = [];

  for (const [id, entries] of entriesById) {
    if (idsWithInvalidRevisions.has(id)) {
      // We can't tell whether the rejected row is the actual latest
      // revision. Refuse rather than risk appending over stale state.
      continue;
    }

    const latest = selectLatestEventSpineEntry(entries);

    if (!latest || isDeletedEventSpineRecord(latest.record)) {
      continue;
    }
    // The candidate's shard contained an unparseable JSON line. We don't
    // know if a torn later revision under this id is hiding in there, so
    // we can't trust the spine's latest pick.
    if (shardsWithUnparseableJson.has(latest.relativePath)) {
      continue;
    }
    // If a different-kind revision has superseded the workout under this id,
    // selecting the older activity_session row would violate the event-spine
    // kind invariant. Refuse.
    if (latest.record.kind !== "activity_session") {
      continue;
    }
    const latestActivity = latest.record;
    if (!isJunctionHrZoneRepairShapeCandidate(latestActivity)) {
      continue;
    }
    if (!await hasPrimitiveNumericHrZoneEvidence(vaultRoot, latestActivity)) {
      unverifiedCandidateCount += 1;
      continue;
    }

    candidates.push({
      original: latestActivity,
      relativePath: latest.relativePath,
      repaired: buildRepairedJunctionWorkoutHeartRateZoneRecord(latestActivity, repairedAt),
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
  // Scope: dense six-zone legacy rows only. Sparse legacy imports stored
  // fewer than six zones (compacted around null entries) and require raw
  // indexes to repair correctly; the supported recovery path for those is
  // re-importing the affected workout.
  if (
    record.source !== "device"
    || !record.workout?.sourceApp
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

const JUNCTION_WORKOUT_RESOURCE_TYPE_PATTERN = /^junction-.+-workouts$/u;

function isJunctionWorkoutExternalRef(record: ActivitySessionEventRecord): boolean {
  const externalRef = record.externalRef;

  return externalRef?.system === "junction"
    && JUNCTION_WORKOUT_RESOURCE_TYPE_PATTERN.test(externalRef.resourceType);
}

async function hasPrimitiveNumericHrZoneEvidence(
  vaultRoot: string,
  record: ActivitySessionEventRecord,
): Promise<boolean> {
  const sourceWorkoutId = record.workout?.sourceWorkoutId;
  const expectedProviderSlug = slugifyProvider(record.workout?.sourceApp);
  const storedZones = record.workout?.heartRateZones;

  if (
    !sourceWorkoutId
    || !expectedProviderSlug
    || !storedZones
    || storedZones.length !== 6
  ) {
    return false;
  }

  const sameIdRows = await collectSameIdWorkoutRowsFromIntegrationIngests({
    eventId: record.id,
    sourceWorkoutId,
    vaultRoot,
  });
  if (sameIdRows) {
    return rawEvidenceVerifiesStoredRow(sameIdRows, expectedProviderSlug, storedZones);
  }

  return rawEvidenceVerifiesStoredRow(
    await collectSameIdWorkoutRowsFromLegacyRawRefs({
      rawRefs: record.rawRefs,
      sourceWorkoutId,
      vaultRoot,
    }),
    expectedProviderSlug,
    storedZones,
  );
}

async function collectSameIdWorkoutRowsFromIntegrationIngests(input: {
  eventId: string;
  sourceWorkoutId: string;
  vaultRoot: string;
}): Promise<RawSameIdWorkoutRow[] | null> {
  let ingests: Awaited<ReturnType<typeof listIntegrationIngestsForEvent>>;
  try {
    ingests = await listIntegrationIngestsForEvent({
      eventId: input.eventId,
      vaultRoot: input.vaultRoot,
    });
  } catch {
    return [];
  }

  if (ingests.length === 0) {
    return null;
  }

  const sameIdRows: RawSameIdWorkoutRow[] = [];
  for (const ingest of ingests) {
    for (const part of ingest.parts) {
      let payload: unknown | null;
      try {
        payload = await parseIntegrationEvidencePartJson({
          ingestId: ingest.id,
          role: part.role,
          vaultRoot: input.vaultRoot,
        });
      } catch {
        return [];
      }

      if (payload === null) {
        return [];
      }
      sameIdRows.push(...collectRawSameIdWorkoutRows(payload, input.sourceWorkoutId));
    }
  }

  return sameIdRows;
}

async function collectSameIdWorkoutRowsFromLegacyRawRefs(input: {
  rawRefs: readonly string[] | undefined;
  sourceWorkoutId: string;
  vaultRoot: string;
}): Promise<RawSameIdWorkoutRow[]> {
  if (!Array.isArray(input.rawRefs) || input.rawRefs.length === 0) {
    return [];
  }

  // Collect same-id raw rows across every legacy rawRef and decide once.
  // Deciding per-rawRef would let one matching artifact mask contradictory
  // evidence in another rawRef, and would also let the providerless
  // uniqueness rule be satisfied independently in two artifacts that
  // together carry duplicates.
  //
  // Any rawRef that fails to read or parse means we cannot complete the
  // joint check — fail closed and let the candidate be reported as
  // unverified rather than risk repairing on partial evidence.
  const sameIdRows: RawSameIdWorkoutRow[] = [];
  for (const rawRef of input.rawRefs) {
    const rawPayload = await readVaultRawJson(input.vaultRoot, rawRef);
    if (rawPayload === undefined) {
      return [];
    }
    sameIdRows.push(...collectRawSameIdWorkoutRows(rawPayload, input.sourceWorkoutId));
  }

  return sameIdRows;
}

function rawEvidenceVerifiesStoredRow(
  sameIdRows: readonly RawSameIdWorkoutRow[],
  expectedProviderSlug: string,
  storedZones: ReadonlyArray<{ durationMinutes?: number }>,
): boolean {
  if (sameIdRows.length === 0) {
    return false;
  }

  // Cross-provider collision in this artifact: refuse rather than guess
  // which provider's row produced the candidate event.
  if (sameIdRows.some((row) => row.providerSlug !== undefined && row.providerSlug !== expectedProviderSlug)) {
    return false;
  }

  // Same-id row exists with a non-primitive hr_zones shape (object array,
  // wrong length, etc.). We can no longer tell legacy primitive from
  // explicit object zones, so refuse.
  if (sameIdRows.some((row) => row.hasNonPrimitiveZonesField)) {
    return false;
  }

  // Any same-id primitive zone array whose seconds→minutes conversion does
  // not match the stored durations is a contradiction: the artifact holds
  // an alternate snapshot for this workout, so the stored row's lineage is
  // no longer unambiguous. Refuse rather than guess which row produced it.
  const primitiveRows = sameIdRows.filter((row) => row.primitiveZones !== undefined);
  if (primitiveRows.length === 0) {
    return false;
  }
  if (primitiveRows.some((row) => !storedDurationsMatchRawSeconds(storedZones, row.primitiveZones as readonly number[]))) {
    return false;
  }

  // Strong proof: at least one same-id row carries the expected provider
  // inline (and, by the contradiction check above, its durations match).
  if (primitiveRows.some((row) => row.providerSlug === expectedProviderSlug)) {
    return true;
  }

  // Connection-backed fallback. Junction's raw sanitizer strips connectionId
  // and sourceId without re-injecting the resolved sourceProviderSlug, so
  // legacy connection-resolved workouts can land in raw artifacts with no
  // inline provider. Accept only when there is exactly one such row (uniqueness
  // is the only remaining proof) and the contradiction/conflict checks above
  // already established no same-id row disagrees.
  return primitiveRows.length === 1 && primitiveRows[0]?.providerSlug === undefined;
}

function storedDurationsMatchRawSeconds(
  storedZones: ReadonlyArray<{ durationMinutes?: number }>,
  rawSeconds: readonly number[],
): boolean {
  // The importer's numeric-array branch reads each primitive entry through
  // `duration` (seconds) and converts via `seconds / 60`. Require the stored
  // durationMinutes to equal that exact conversion: this binds the raw
  // evidence to *this* row, not just any same-id+same-provider primitive
  // numeric payload in the artifact.
  return rawSeconds.every((seconds, index) => {
    const stored = storedZones[index]?.durationMinutes;
    if (typeof stored !== "number") {
      return false;
    }
    return Math.abs(stored - seconds / 60) < 1e-9;
  });
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

interface RawSameIdWorkoutRow {
  providerSlug: string | undefined;
  primitiveZones: readonly number[] | undefined;
  hasNonPrimitiveZonesField: boolean;
}

function collectRawSameIdWorkoutRows(
  payload: unknown,
  sourceWorkoutId: string,
): RawSameIdWorkoutRow[] {
  // Junction can ship workouts either as a flat array (each entry carries
  // `source.provider`) or as envelope→child shapes where the envelope holds
  // the provider context and a `entries`/`workouts` array holds id+hr_zones.
  // Track the nearest ancestor provider while walking so envelope-derived
  // provenance still classifies the row correctly. Collect every same-id
  // hit instead of returning the first one so the verifier can decide
  // deterministically across duplicate rows.
  type Frame = { value: unknown; inheritedProviderSlug: string | undefined };
  const stack: Frame[] = [{ value: payload, inheritedProviderSlug: undefined }];
  const collected: RawSameIdWorkoutRow[] = [];

  while (stack.length > 0) {
    const frame = stack.pop() as Frame;

    if (Array.isArray(frame.value)) {
      for (const entry of frame.value) {
        stack.push({ value: entry, inheritedProviderSlug: frame.inheritedProviderSlug });
      }
      continue;
    }

    const record = asPlainRecord(frame.value);
    if (!record) {
      continue;
    }

    const effectiveProviderSlug = readRecordProviderSlug(record) ?? frame.inheritedProviderSlug;

    if (rawWorkoutIdMatches(record, sourceWorkoutId)) {
      const zonesField = readRawWorkoutHrZonesField(record);
      const primitiveZones = zonesField === undefined ? undefined : readPrimitiveNumericZoneArray(zonesField);
      collected.push({
        providerSlug: effectiveProviderSlug,
        primitiveZones,
        hasNonPrimitiveZonesField: zonesField !== undefined && primitiveZones === undefined,
      });
    }

    for (const child of Object.values(record)) {
      stack.push({ value: child, inheritedProviderSlug: effectiveProviderSlug });
    }
  }

  return collected;
}

function readRawWorkoutHrZonesField(record: Record<string, unknown>): unknown {
  for (const path of RAW_WORKOUT_HR_ZONE_PATHS) {
    const value = readPath(record, path);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function rawWorkoutIdMatches(record: Record<string, unknown>, sourceWorkoutId: string): boolean {
  return RAW_WORKOUT_ID_PATHS.some((path) => stringId(readPath(record, path)) === sourceWorkoutId);
}

function readRecordProviderSlug(record: Record<string, unknown>): string | undefined {
  for (const path of RAW_WORKOUT_SOURCE_PROVIDER_PATHS) {
    const slug = slugifyProvider(readPath(record, path));
    if (slug) {
      return slug;
    }
  }
  // `provider.name` is free-form display text in Junction's raw shape; mirror
  // the importer's normalizeJunctionSourceProviderSlug + KNOWN_JUNCTION_PROVIDER_NAME_SLUGS
  // gating and only treat it as provider evidence when it slugifies to a
  // known Junction provider.
  const nameSlug = slugifyProvider(readPath(record, "provider.name"));
  return nameSlug !== undefined && KNOWN_JUNCTION_PROVIDER_SLUGS.has(nameSlug) ? nameSlug : undefined;
}

// Mirrored from packages/importers/src/device-providers/junction-origin.ts
// (KNOWN_JUNCTION_PROVIDER_NAME_SLUGS). Kept inline because @murphai/importers
// depends on @murphai/core and cannot be imported here without a cycle; the
// set is stable and small enough to duplicate.
const KNOWN_JUNCTION_PROVIDER_SLUGS: ReadonlySet<string> = new Set([
  "abbott-libreview",
  "accuchek-ble",
  "apple-health-kit",
  "beurer-api",
  "contour-ble",
  "cronometer",
  "dexcom",
  "dexcom-v3",
  "eight-sleep",
  "fitbit",
  "freestyle-libre",
  "freestyle-libre-ble",
  "garmin",
  "google-fit",
  "hammerhead",
  "health-connect",
  "ihealth",
  "kardia",
  "map-my-fitness",
  "omron",
  "onetouch-ble",
  "oura",
  "peloton",
  "polar",
  "renpho",
  "runkeeper",
  "samsung-health",
  "strava",
  "tandem-source",
  "ultrahuman",
  "wahoo",
  "whoop",
  "withings",
  "zwift",
]);

function slugifyProvider(value: unknown): string | undefined {
  const id = stringId(value);
  if (!id) {
    return undefined;
  }

  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  // "junction" is the aggregator slug, not a real source provider — mirror
  // the importer's normalizeJunctionSourceProviderSlug behavior so envelope
  // metadata that wraps providerless workouts under `provider: "junction"`
  // doesn't get treated as a foreign-provider conflict.
  return slug.length > 0 && slug !== "junction" ? slug : undefined;
}

function readPrimitiveNumericZoneArray(value: unknown): readonly number[] | undefined {
  // Mirror the importer's `finiteNumber` scalar semantics: accept both
  // numbers and trimmed numeric strings. Junction historically returned
  // hr_zones values as either, and the old importer normalized both into
  // the same legacy 1..6 stored shape. Only matching the all-number case
  // would silently leave string-shaped legacy rows unrepaired.
  if (!Array.isArray(value) || value.length !== 6) {
    return undefined;
  }
  const numbers: number[] = [];
  for (const entry of value) {
    const numeric = readFiniteNumberLike(entry);
    if (numeric === undefined) {
      return undefined;
    }
    numbers.push(numeric);
  }
  return numbers;
}

function readFiniteNumberLike(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
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

function readPlainStringId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const id = (raw as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
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

// Strong-signal provider paths. These match the importer's
// SOURCE_PROVIDER_SLUG_PATHS — the values are expected to be provider slugs
// directly. `provider.name` is intentionally excluded here and gated
// through KNOWN_JUNCTION_PROVIDER_SLUGS in readRecordProviderSlug, mirroring
// the importer's separate firstKnownProviderNameSlugFromPaths path.
const RAW_WORKOUT_SOURCE_PROVIDER_PATHS = [
  "sourceProviderSlug",
  "source_provider_slug",
  "sourceProvider",
  "source_provider",
  "source.provider",
  "source.providerSlug",
  "source.provider_slug",
  "source.slug",
  "providerSlug",
  "provider_slug",
  "provider.slug",
  "provider.provider",
  "provider.providerSlug",
  "provider.provider_slug",
  "provider",
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
