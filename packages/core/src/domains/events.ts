import type { EventRecord, ExperimentEventRecord } from "@murphai/contracts";
import { CONTRACT_SCHEMA_VERSION, EVENT_KINDS, eventRecordSchema } from "@murphai/contracts";

import { ID_PREFIXES, VAULT_LAYOUT } from "../constants.ts";
import { VaultError } from "../errors.ts";
import { walkVaultFiles } from "../fs.ts";
import { generateRecordId } from "../ids.ts";
import { readJsonlRecords, toMonthlyShardRelativePath } from "../jsonl.ts";
import { defaultTimeZone, normalizeTimeZone, toLocalDayKey } from "../time.ts";
import { loadVault } from "../vault.ts";

import {
  compactObject,
  normalizeLocalDate,
  normalizeOptionalText,
  normalizeTimestampInput,
  runLoadedCanonicalWrite,
  uniqueTrimmedStringList,
  validateContract,
} from "./shared.ts";
import type { DateInput } from "../types.ts";

type JsonObject = Record<string, unknown>;
type EventRecordByKind<K extends EventRecord["kind"]> = Extract<EventRecord, { kind: K }>;

const PUBLIC_EVENT_WRITE_KIND_LIST = [
  "symptom",
  "note",
  "observation",
  "medication_intake",
  "supplement_intake",
  "activity_session",
  "body_measurement",
  "sleep_session",
  "intervention_session",
] as const;

export type PublicWritableEventKind = (typeof PUBLIC_EVENT_WRITE_KIND_LIST)[number];
export type EventDraftByKind<K extends PublicWritableEventKind> = Omit<
  EventRecordByKind<K>,
  "schemaVersion" | "id" | "kind" | "occurredAt" | "recordedAt" | "dayKey" | "source" | "lifecycle"
> & {
  kind: K;
  id?: string;
  occurredAt: DateInput;
  recordedAt?: DateInput;
  dayKey?: string;
  source?: EventRecordByKind<K>["source"];
};
export type PublicEventDraft = {
  [K in PublicWritableEventKind]: EventDraftByKind<K>;
}[PublicWritableEventKind];

interface LoadedEventLedgerShard {
  relativePath: string;
  matchingRecords: EventRecord[];
}

type EventLifecycle = NonNullable<EventRecord["lifecycle"]>;
type MatchedEventRecord = {
  relativePath: string;
  record: EventRecord;
};

export interface UpsertEventPayloadInput {
  vaultRoot: string;
  payload: JsonObject;
  allowSpecializedKindRewrite?: boolean;
}

export interface UpsertEventDraftInput {
  vaultRoot: string;
  draft: PublicEventDraft;
  allowSpecializedKindRewrite?: boolean;
}

export type UpsertEventInput = UpsertEventPayloadInput | UpsertEventDraftInput;

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
  "lifecycle",
]);

const PUBLIC_EVENT_WRITE_KINDS = new Set<EventRecord["kind"]>(PUBLIC_EVENT_WRITE_KIND_LIST);
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

function normalizeDraftEventId(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeOptionalText(value) ?? undefined : undefined;
}

function buildEventLifecycle(
  revision: number,
  state?: EventLifecycle["state"],
): EventLifecycle {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new VaultError("INVALID_INPUT", "Event lifecycle revision must be a positive integer.");
  }

  return compactObject({
    revision,
    state,
  }) as EventLifecycle;
}

function eventRevision(record: Pick<EventRecord, "lifecycle">): number {
  return record.lifecycle?.revision ?? 1;
}

function isDeletedEventRecord(record: Pick<EventRecord, "lifecycle">): boolean {
  return record.lifecycle?.state === "deleted";
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

function buildEventRecord(
  payload: JsonObject,
  fallbackTimeZone?: string,
  lifecycle?: EventLifecycle,
): EventRecord {
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
      lifecycle,
      ...eventSpecificFields(payload),
    }),
    "EVENT_CONTRACT_INVALID",
    `Event payload for kind "${kind}" is invalid.`,
  );
}

function buildBaseEventContractInput(
  draft: PublicEventDraft,
  fallbackTimeZone?: string,
): Omit<EventRecord, "kind"> {
  const occurredAt = normalizeTimestampInput(draft.occurredAt);
  if (!occurredAt) {
    throw new VaultError("EVENT_OCCURRED_AT_MISSING", "Event draft requires occurredAt.");
  }

  const timeZone = normalizeTimeZone(valueAsString(draft.timeZone));
  const effectiveTimeZone = timeZone ?? normalizeTimeZone(fallbackTimeZone) ?? defaultTimeZone();
  const dayKey =
    normalizeLocalDate(valueAsString(draft.dayKey)) ??
    toLocalDayKey(occurredAt, effectiveTimeZone, "occurredAt");

  return compactObject({
    schemaVersion: CONTRACT_SCHEMA_VERSION.event,
    id: normalizeDraftEventId(draft.id) ?? generateRecordId(ID_PREFIXES.event),
    occurredAt,
    recordedAt: normalizeTimestampInput(draft.recordedAt) ?? new Date().toISOString(),
    dayKey,
    timeZone,
    source: normalizeOptionalText(valueAsString(draft.source)) ?? "manual",
    title: requireText(draft.title, "Event draft requires a title."),
    note: normalizeOptionalText(valueAsString(draft.note)) ?? undefined,
    tags: uniqueTrimmedStringList(draft.tags) ?? undefined,
    relatedIds: uniqueTrimmedStringList(draft.relatedIds) ?? undefined,
    rawRefs: uniqueTrimmedStringList(draft.rawRefs) ?? undefined,
    externalRef: draft.externalRef,
  }) as Omit<EventRecord, "kind">;
}

function buildTypedEventRecord(
  draft: PublicEventDraft,
  fallbackTimeZone?: string,
  lifecycle?: EventLifecycle,
): EventRecord {
  const base = buildBaseEventContractInput(draft, fallbackTimeZone);

  const record = (() => {
    switch (draft.kind) {
      case "note":
        return compactObject({
          ...base,
          kind: "note",
        });
      case "symptom":
        return compactObject({
          ...base,
          kind: "symptom",
          symptom: draft.symptom,
          intensity: draft.intensity,
          bodySite: draft.bodySite,
        });
      case "observation":
        return compactObject({
          ...base,
          kind: "observation",
          metric: draft.metric,
          value: draft.value,
          unit: draft.unit,
        });
      case "medication_intake":
        return compactObject({
          ...base,
          kind: "medication_intake",
          medicationName: draft.medicationName,
          dose: draft.dose,
          unit: draft.unit,
        });
      case "supplement_intake":
        return compactObject({
          ...base,
          kind: "supplement_intake",
          supplementName: draft.supplementName,
          dose: draft.dose,
          unit: draft.unit,
        });
      case "activity_session":
        return compactObject({
          ...base,
          kind: "activity_session",
          activityType: draft.activityType,
          durationMinutes: draft.durationMinutes,
          distanceKm: draft.distanceKm,
          strengthExercises: draft.strengthExercises,
          workout: draft.workout,
        });
      case "body_measurement":
        return compactObject({
          ...base,
          kind: "body_measurement",
          measurements: draft.measurements,
          media: draft.media,
        });
      case "sleep_session":
        return compactObject({
          ...base,
          kind: "sleep_session",
          startAt: draft.startAt,
          endAt: draft.endAt,
          durationMinutes: draft.durationMinutes,
        });
      case "intervention_session":
        return compactObject({
          ...base,
          kind: "intervention_session",
          interventionType: draft.interventionType,
          durationMinutes: draft.durationMinutes,
          protocolId: draft.protocolId,
        });
    }
  })();

  return validateContract(
    eventRecordSchema,
    compactObject({
      ...record,
      lifecycle,
    }),
    "EVENT_CONTRACT_INVALID",
    `Event draft for kind "${draft.kind}" is invalid.`,
  );
}

function buildTypedEventDraft<K extends PublicWritableEventKind>(
  kind: K,
  input: Omit<EventDraftByKind<K>, "kind">,
): EventDraftByKind<K> {
  return {
    kind,
    ...input,
  } as EventDraftByKind<K>;
}

export function buildSymptomEventDraft(
  input: Omit<EventDraftByKind<"symptom">, "kind">,
): EventDraftByKind<"symptom"> {
  return buildTypedEventDraft("symptom", input);
}

export function buildNoteEventDraft(
  input: Omit<EventDraftByKind<"note">, "kind">,
): EventDraftByKind<"note"> {
  return buildTypedEventDraft("note", input);
}

export function buildObservationEventDraft(
  input: Omit<EventDraftByKind<"observation">, "kind">,
): EventDraftByKind<"observation"> {
  return buildTypedEventDraft("observation", input);
}

export function buildMedicationIntakeEventDraft(
  input: Omit<EventDraftByKind<"medication_intake">, "kind">,
): EventDraftByKind<"medication_intake"> {
  return buildTypedEventDraft("medication_intake", input);
}

export function buildSupplementIntakeEventDraft(
  input: Omit<EventDraftByKind<"supplement_intake">, "kind">,
): EventDraftByKind<"supplement_intake"> {
  return buildTypedEventDraft("supplement_intake", input);
}

export function buildActivitySessionEventDraft(
  input: Omit<EventDraftByKind<"activity_session">, "kind">,
): EventDraftByKind<"activity_session"> {
  return buildTypedEventDraft("activity_session", input);
}

export function buildBodyMeasurementEventDraft(
  input: Omit<EventDraftByKind<"body_measurement">, "kind">,
): EventDraftByKind<"body_measurement"> {
  return buildTypedEventDraft("body_measurement", input);
}

export function buildSleepSessionEventDraft(
  input: Omit<EventDraftByKind<"sleep_session">, "kind">,
): EventDraftByKind<"sleep_session"> {
  return buildTypedEventDraft("sleep_session", input);
}

export function buildInterventionSessionEventDraft(
  input: Omit<EventDraftByKind<"intervention_session">, "kind">,
): EventDraftByKind<"intervention_session"> {
  return buildTypedEventDraft("intervention_session", input);
}

export function buildPublicEventRecord<K extends PublicWritableEventKind>(
  draft: EventDraftByKind<K>,
  fallbackTimeZone?: string,
): EventRecordByKind<K> {
  return buildTypedEventRecord(draft as PublicEventDraft, fallbackTimeZone) as EventRecordByKind<K>;
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

function compareMatchedEventRecords(left: MatchedEventRecord, right: MatchedEventRecord): number {
  const revisionComparison = eventRevision(left.record) - eventRevision(right.record);
  if (revisionComparison !== 0) {
    return revisionComparison;
  }

  const recordedAtComparison = left.record.recordedAt.localeCompare(right.record.recordedAt);
  if (recordedAtComparison !== 0) {
    return recordedAtComparison;
  }

  const occurredAtComparison = left.record.occurredAt.localeCompare(right.record.occurredAt);
  if (occurredAtComparison !== 0) {
    return occurredAtComparison;
  }

  return left.relativePath.localeCompare(right.relativePath);
}

function flattenMatchedEventRecords(
  matchedShards: readonly LoadedEventLedgerShard[],
): MatchedEventRecord[] {
  return matchedShards.flatMap((shard) =>
    shard.matchingRecords.map((record) => ({
      relativePath: shard.relativePath,
      record,
    })),
  );
}

function selectLatestMatchedEvent(
  matchedShards: readonly LoadedEventLedgerShard[],
): MatchedEventRecord | null {
  const flattened = flattenMatchedEventRecords(matchedShards);
  if (flattened.length === 0) {
    return null;
  }

  return flattened.reduce((latest, candidate) =>
    compareMatchedEventRecords(latest, candidate) >= 0 ? latest : candidate,
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
        matchingRecords,
      });
    }
  }

  return matches;
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

  const mediaSources = [
    (record as { media?: Array<{ relativePath?: unknown }> }).media,
    (record as { workout?: { media?: Array<{ relativePath?: unknown }> } }).workout?.media,
  ];
  for (const mediaList of mediaSources) {
    if (!Array.isArray(mediaList)) {
      continue;
    }
    for (const entry of mediaList) {
      const relativePath = valueAsString(entry?.relativePath);
      if (relativePath) {
        retained.add(relativePath);
      }
    }
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

function isDraftUpsertInput(input: UpsertEventInput): input is UpsertEventDraftInput {
  return "draft" in input;
}

export async function upsertEvent(
  input: UpsertEventInput,
): Promise<UpsertEventResult> {
  const vault = await loadVault({ vaultRoot: input.vaultRoot });
  const suppliedEventId = isDraftUpsertInput(input)
    ? normalizeDraftEventId(input.draft.id)
    : normalizeEventId(input.payload);
  const kind = isDraftUpsertInput(input)
    ? input.draft.kind
    : normalizeEventKind(input.payload);
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

  const latestMatchedEvent = selectLatestMatchedEvent(matchedShards);
  const lifecycle = buildEventLifecycle(
    latestMatchedEvent ? eventRevision(latestMatchedEvent.record) + 1 : 1,
  );
  const eventRecord = isDraftUpsertInput(input)
    ? buildTypedEventRecord(input.draft, vault.metadata.timezone, lifecycle)
    : buildEventRecord(input.payload, vault.metadata.timezone, lifecycle);

  const ledgerFile = toEventLedgerFile(eventRecord.occurredAt);

  return runLoadedCanonicalWrite<UpsertEventResult>({
    vaultRoot: input.vaultRoot,
    operationType: "event_upsert",
    summary: `Upsert event ${eventRecord.id}`,
    occurredAt: eventRecord.occurredAt,
    mutate: async ({ batch }) => {
      await batch.stageJsonlAppend(ledgerFile, `${JSON.stringify(eventRecord)}\n`);

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

  const latestMatchedEvent = selectLatestMatchedEvent(matchedShards);
  if (!latestMatchedEvent || isDeletedEventRecord(latestMatchedEvent.record)) {
    throw new VaultError("EVENT_MISSING", `Event "${input.eventId}" was not found.`);
  }
  const tombstoneRecord = validateContract(
    eventRecordSchema,
    compactObject({
      ...latestMatchedEvent.record,
      recordedAt: new Date().toISOString(),
      lifecycle: buildEventLifecycle(eventRevision(latestMatchedEvent.record) + 1, "deleted"),
    }),
    "EVENT_CONTRACT_INVALID",
    "Deleted event tombstone is invalid.",
  );
  const tombstoneLedgerFile = toEventLedgerFile(tombstoneRecord.occurredAt);

  return runLoadedCanonicalWrite<DeleteEventResult>({
    vaultRoot: input.vaultRoot,
    operationType: "event_delete",
    summary: `Delete event ${input.eventId}`,
    occurredAt: new Date(),
    mutate: async ({ batch }) => {
      await batch.stageJsonlAppend(tombstoneLedgerFile, `${JSON.stringify(tombstoneRecord)}\n`);

      return {
        eventId: input.eventId,
        kind: latestMatchedEvent.record.kind,
        retainedPaths: extractRetainedPaths(latestMatchedEvent.record),
        deleted: true,
      };
    },
  });
}
