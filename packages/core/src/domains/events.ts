import type { EventRecord, ExperimentEventRecord } from "@healthybob/contracts";
import { CONTRACT_SCHEMA_VERSION, EVENT_KINDS, eventRecordSchema } from "@healthybob/contracts";

import { ID_PREFIXES, VAULT_LAYOUT } from "../constants.js";
import { VaultError } from "../errors.js";
import { walkVaultFiles } from "../fs.js";
import { generateRecordId } from "../ids.js";
import { readJsonlRecords, toMonthlyShardRelativePath } from "../jsonl.js";
import type { WriteBatch } from "../operations/write-batch.js";
import { defaultTimeZone, normalizeTimeZone, toLocalDayKey } from "../time.js";
import { loadVault } from "../vault.js";

import {
  compactObject,
  normalizeLocalDate,
  normalizeOptionalText,
  normalizeTimestampInput,
  runLoadedCanonicalWrite,
  uniqueTrimmedStringList,
  validateContract,
} from "./shared.js";

type JsonObject = Record<string, unknown>;

interface LoadedEventLedgerShard {
  relativePath: string;
  records: JsonObject[];
  matchingRecords: EventRecord[];
}

export interface UpsertEventInput {
  vaultRoot: string;
  payload: JsonObject;
  allowSpecializedKindRewrite?: boolean;
}

export interface DeleteEventInput {
  vaultRoot: string;
  eventId: string;
}

export interface UpsertEventResult {
  eventId: string;
  ledgerFile: string;
  created: boolean;
}

export interface DeleteEventResult {
  eventId: string;
  kind: EventRecord["kind"];
  retainedPaths: string[];
  deleted: true;
}

const RESERVED_EVENT_KEYS = new Set([
  "schemaVersion",
  "id",
  "eventId",
  "kind",
  "occurredAt",
  "recordedAt",
  "dayKey",
  "timeZone",
  "source",
  "title",
  "note",
  "tags",
  "relatedIds",
  "rawRefs",
]);

const PUBLIC_EVENT_WRITE_KINDS = new Set<EventRecord["kind"]>([
  "symptom",
  "note",
  "observation",
  "medication_intake",
  "supplement_intake",
  "activity_session",
  "sleep_session",
  "intervention_session",
]);
const SUPPORTED_EVENT_KINDS = new Set<string>(EVENT_KINDS);

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requireText(value: unknown, message: string): string {
  const normalized = normalizeOptionalText(valueAsString(value));
  if (!normalized) {
    throw new VaultError("INVALID_INPUT", message);
  }

  return normalized;
}

function normalizeEventId(payload: JsonObject): string | undefined {
  return normalizeOptionalText(
    typeof payload.id === "string" ? payload.id : valueAsString(payload.eventId),
  ) ?? undefined;
}

function eventSpecificFields(payload: JsonObject): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([key, value]) => !RESERVED_EVENT_KEYS.has(key) && value !== undefined,
    ),
  );
}

function normalizeEventKind(payload: JsonObject): EventRecord["kind"] {
  const kind = valueAsString(payload.kind);
  if (!kind || !SUPPORTED_EVENT_KINDS.has(kind)) {
    throw new VaultError("EVENT_KIND_INVALID", "Event payload requires a supported kind.");
  }

  return kind as EventRecord["kind"];
}

function buildEventRecord(payload: JsonObject, fallbackTimeZone?: string): EventRecord {
  const kind = normalizeEventKind(payload);

  const occurredAt = normalizeTimestampInput(payload.occurredAt);
  if (!occurredAt) {
    throw new VaultError("EVENT_OCCURRED_AT_MISSING", "Event payload requires occurredAt.");
  }

  const timeZone = normalizeTimeZone(valueAsString(payload.timeZone));
  const effectiveTimeZone = timeZone ?? normalizeTimeZone(fallbackTimeZone) ?? defaultTimeZone();
  const dayKey =
    normalizeLocalDate(valueAsString(payload.dayKey)) ??
    toLocalDayKey(occurredAt, effectiveTimeZone, "occurredAt");

  return validateContract(
    eventRecordSchema,
    compactObject({
      schemaVersion: CONTRACT_SCHEMA_VERSION.event,
      id: normalizeEventId(payload) ?? generateRecordId(ID_PREFIXES.event),
      kind,
      occurredAt,
      recordedAt: normalizeTimestampInput(payload.recordedAt) ?? new Date().toISOString(),
      dayKey,
      timeZone,
      source: normalizeOptionalText(valueAsString(payload.source)) ?? "manual",
      title: requireText(payload.title, "Event payload requires a title."),
      note: normalizeOptionalText(valueAsString(payload.note)) ?? undefined,
      tags: uniqueTrimmedStringList(payload.tags) ?? undefined,
      relatedIds: uniqueTrimmedStringList(payload.relatedIds) ?? undefined,
      rawRefs: uniqueTrimmedStringList(payload.rawRefs) ?? undefined,
      ...eventSpecificFields(payload),
    }),
    "EVENT_CONTRACT_INVALID",
    `Event payload for kind "${kind}" is invalid.`,
  );
}

export function buildExperimentEventRecord(input: {
  occurredAt: string;
  title: string;
  note?: string;
  experimentId: string;
  experimentSlug: string;
  phase: ExperimentEventRecord["phase"];
  timeZone?: string;
}): ExperimentEventRecord {
  const timeZone = normalizeTimeZone(input.timeZone);

  return validateContract(
    eventRecordSchema,
    compactObject({
      schemaVersion: CONTRACT_SCHEMA_VERSION.event,
      id: generateRecordId(ID_PREFIXES.event),
      kind: "experiment_event",
      occurredAt: input.occurredAt,
      recordedAt: new Date().toISOString(),
      dayKey: toLocalDayKey(input.occurredAt, timeZone ?? defaultTimeZone(), "occurredAt"),
      timeZone,
      source: "manual",
      title: input.title.trim(),
      note: normalizeOptionalText(input.note) ?? undefined,
      relatedIds: [input.experimentId],
      experimentId: input.experimentId,
      experimentSlug: input.experimentSlug,
      phase: input.phase,
    }),
    "EVENT_CONTRACT_INVALID",
    'Event payload for kind "experiment_event" is invalid.',
  ) as ExperimentEventRecord;
}

function toEventLedgerFile(occurredAt: string): string {
  return toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    occurredAt,
    "occurredAt",
  );
}

function stringifyJsonlRecords(records: readonly JsonObject[]): string {
  return records.length > 0
    ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
    : "";
}

function isMatchingEventId(record: unknown, eventId: string): record is JsonObject & { id: string } {
  return (
    typeof record === "object" &&
    record !== null &&
    typeof (record as { id?: unknown }).id === "string" &&
    (record as { id: string }).id === eventId
  );
}

function validateStoredEventRecord(record: JsonObject): EventRecord {
  return validateContract(
    eventRecordSchema,
    record,
    "EVENT_CONTRACT_INVALID",
    "Stored event record is invalid.",
  );
}

async function loadEventLedgerShardsById(
  vaultRoot: string,
  eventId: string,
): Promise<LoadedEventLedgerShard[]> {
  const relativePaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });
  const matches: LoadedEventLedgerShard[] = [];

  for (const relativePath of relativePaths) {
    const records = await readJsonlRecords({
      vaultRoot,
      relativePath,
    });
    const matchingRecords = records
      .filter((record) => isMatchingEventId(record, eventId))
      .map((record) => validateStoredEventRecord(record as JsonObject));

    if (matchingRecords.length > 0) {
      matches.push({
        relativePath,
        records: records as JsonObject[],
        matchingRecords,
      });
    }
  }

  return matches;
}

async function stageEventLedgerWrites(
  batch: WriteBatch,
  rewritten: ReadonlyMap<string, JsonObject[]>,
): Promise<void> {
  for (const [relativePath, records] of rewritten) {
    if (records.length === 0) {
      await batch.stageDelete(relativePath, {
        allowAppendOnlyJsonl: true,
      });
      continue;
    }

    await batch.stageTextWrite(relativePath, stringifyJsonlRecords(records), {
      allowAppendOnlyJsonl: true,
    });
  }
}

function extractRetainedPaths(record: EventRecord): string[] {
  const retained = new Set<string>();

  uniqueTrimmedStringList(record.rawRefs)?.forEach((relativePath) => retained.add(relativePath));
  uniqueTrimmedStringList((record as { photoPaths?: unknown }).photoPaths)?.forEach((relativePath) =>
    retained.add(relativePath),
  );
  uniqueTrimmedStringList((record as { audioPaths?: unknown }).audioPaths)?.forEach((relativePath) =>
    retained.add(relativePath),
  );

  const documentPath = valueAsString((record as { documentPath?: unknown }).documentPath);
  if (documentPath) {
    retained.add(documentPath);
  }

  return [...retained].sort((left, right) => left.localeCompare(right));
}

function canWriteEventKind(
  kind: EventRecord["kind"],
  matchedShards: readonly LoadedEventLedgerShard[],
  allowSpecializedKindRewrite: boolean | undefined,
): boolean {
  if (PUBLIC_EVENT_WRITE_KINDS.has(kind)) {
    return true;
  }

  return allowSpecializedKindRewrite === true && matchedShards.length > 0;
}

export async function upsertEvent(
  input: UpsertEventInput,
): Promise<UpsertEventResult> {
  const vault = await loadVault({ vaultRoot: input.vaultRoot });
  const suppliedEventId = normalizeEventId(input.payload);
  const kind = normalizeEventKind(input.payload);
  const matchedShards =
    suppliedEventId === undefined
      ? []
      : await loadEventLedgerShardsById(input.vaultRoot, suppliedEventId);

  if (
    !canWriteEventKind(
      kind,
      matchedShards,
      input.allowSpecializedKindRewrite,
    )
  ) {
    throw new VaultError(
      "EVENT_KIND_INVALID",
      `Event kind "${kind}" is not supported by generic event upsert.`,
    );
  }

  const eventRecord = buildEventRecord(input.payload, vault.metadata.timezone);

  const ledgerFile = toEventLedgerFile(eventRecord.occurredAt);
  const rewritten = new Map<string, JsonObject[]>();

  for (const shard of matchedShards) {
    rewritten.set(
      shard.relativePath,
      shard.records.filter((record) => !isMatchingEventId(record, eventRecord.id)),
    );
  }

  if (rewritten.has(ledgerFile)) {
    rewritten.set(ledgerFile, [...(rewritten.get(ledgerFile) ?? []), eventRecord]);
  }

  return runLoadedCanonicalWrite<UpsertEventResult>({
    vaultRoot: input.vaultRoot,
    operationType: "event_upsert",
    summary: `Upsert event ${eventRecord.id}`,
    occurredAt: eventRecord.occurredAt,
    mutate: async ({ batch }) => {
      await stageEventLedgerWrites(batch, rewritten);

      if (!rewritten.has(ledgerFile)) {
        await batch.stageJsonlAppend(ledgerFile, `${JSON.stringify(eventRecord)}\n`);
      }

      return {
        eventId: eventRecord.id,
        ledgerFile,
        created: matchedShards.length === 0,
      };
    },
  });
}

export async function deleteEvent(
  input: DeleteEventInput,
): Promise<DeleteEventResult> {
  const matchedShards = await loadEventLedgerShardsById(input.vaultRoot, input.eventId);

  if (matchedShards.length === 0) {
    throw new VaultError("EVENT_MISSING", `Event "${input.eventId}" was not found.`);
  }

  const firstRecord = matchedShards[0]?.matchingRecords[0];
  if (!firstRecord) {
    throw new VaultError("EVENT_MISSING", `Event "${input.eventId}" was not found.`);
  }

  const rewritten = new Map<string, JsonObject[]>();
  const retainedPaths = new Set<string>();

  for (const shard of matchedShards) {
    shard.matchingRecords
      .flatMap((record) => extractRetainedPaths(record))
      .forEach((relativePath) => retainedPaths.add(relativePath));

    rewritten.set(
      shard.relativePath,
      shard.records.filter((record) => !isMatchingEventId(record, input.eventId)),
    );
  }

  return runLoadedCanonicalWrite<DeleteEventResult>({
    vaultRoot: input.vaultRoot,
    operationType: "event_delete",
    summary: `Delete event ${input.eventId}`,
    occurredAt: new Date(),
    mutate: async ({ batch }) => {
      await stageEventLedgerWrites(batch, rewritten);

      return {
        eventId: input.eventId,
        kind: firstRecord.kind,
        retainedPaths: [...retainedPaths].sort((left, right) => left.localeCompare(right)),
        deleted: true,
      };
    },
  });
}
