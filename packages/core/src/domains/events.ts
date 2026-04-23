import type { EventAttachment, EventRecord, ExperimentEventRecord, RawImportKind } from "@murphai/contracts";
import {
  EVENT_KINDS,
  eventRecordSchema,
} from "@murphai/contracts";

import { emitAuditRecord } from "../audit.ts";
import { ID_PREFIXES, VAULT_LAYOUT } from "../constants.ts";
import {
  buildAttachmentCompatibilityProjections,
  prepareEventAttachments,
  stagePreparedEventAttachmentsInBatch,
  type EventAttachmentOwnerKind,
  type EventAttachmentSourceInput,
} from "../event-attachments.ts";
import { VaultError } from "../errors.ts";
import { walkVaultFiles } from "../fs.ts";
import { generateRecordId } from "../ids.ts";
import { readJsonlRecords, toMonthlyShardRelativePath } from "../jsonl.ts";
import { runCanonicalWrite } from "../operations/write-batch.ts";
import { loadVault } from "../vault.ts";
import { canonicalizeEventRelations } from "../event-links.ts";
import {
  buildEventSpineEnvelope,
  buildEventSpineLifecycle,
  eventSpineRevision,
  isDeletedEventSpineRecord,
  parseEventSpineAttachments,
  selectLatestEventSpineEntry,
} from "../history/event-spine.ts";

import {
  compactObject,
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
  "measurement",
  "medication_intake",
  "supplement_intake",
  "activity_session",
  "body_measurement",
  "sleep_session",
  "intervention_session",
  "experiment_context",
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

export interface FindEventByExternalRefInput {
  vaultRoot: string;
  system: string;
  resourceType: string;
  resourceId: string;
  version?: string;
  facet?: string;
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

type AttachmentBackedPublicEventKind = "activity_session" | "capture" | "measurement" | "body_measurement";
type CaptureEventDraft = Omit<EventDraftByKind<"note">, "kind">;
type AttachmentBackedEventDraft<K extends AttachmentBackedPublicEventKind> = K extends "capture"
  ? CaptureEventDraft
  : Omit<EventDraftByKind<Extract<K, PublicWritableEventKind>>, "kind">;

interface RawImportOptions {
  importId?: string;
  importKind?: RawImportKind;
  importedAt?: DateInput;
  source?: string | null;
  provenance?: Record<string, unknown>;
}

export interface AddActivitySessionInput {
  vaultRoot: string;
  draft: AttachmentBackedEventDraft<"activity_session">;
  attachments?: readonly EventAttachmentSourceInput[];
  rawImport?: RawImportOptions;
}

export interface AddBodyMeasurementInput {
  vaultRoot: string;
  draft: AttachmentBackedEventDraft<"body_measurement">;
  attachments?: readonly EventAttachmentSourceInput[];
  rawImport?: RawImportOptions;
}

export interface AddCaptureInput {
  vaultRoot: string;
  draft: AttachmentBackedEventDraft<"capture">;
  attachments: readonly EventAttachmentSourceInput[];
  rawImport?: RawImportOptions;
}

export interface AddMeasurementInput {
  vaultRoot: string;
  draft: AttachmentBackedEventDraft<"measurement">;
  attachments?: readonly EventAttachmentSourceInput[];
  rawImport?: RawImportOptions;
}

export interface AddActivitySessionResult extends UpsertEventResult {
  event: EventRecordByKind<"activity_session">;
  manifestPath: string | null;
}

export interface AddBodyMeasurementResult extends UpsertEventResult {
  event: EventRecordByKind<"body_measurement">;
  manifestPath: string | null;
}

export interface AddCaptureResult extends UpsertEventResult {
  event: EventRecordByKind<"note">;
  manifestPath: string | null;
}

export interface AddMeasurementResult extends UpsertEventResult {
  event: EventRecordByKind<"measurement">;
  manifestPath: string | null;
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
  "experimentSlug",
  "links",
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
  const attachments = parseEventSpineAttachments(payload.attachments);
  const canonicalLinks = canonicalizeEventRelations({
    links: payload.links,
    relatedIds: payload.relatedIds,
    normalizeStringList: uniqueTrimmedStringList,
    errorCode: "EVENT_CONTRACT_INVALID",
    errorMessage: "Event payload links must contain objects with type and targetId fields.",
  }).links;

  return validateContract(
    eventRecordSchema,
    compactObject({
      ...buildEventSpineEnvelope({
        id: normalizeEventId(payload),
        occurredAt,
        recordedAt: normalizeTimestampInput(payload.recordedAt),
        dayKey: valueAsString(payload.dayKey),
        timeZone: valueAsString(payload.timeZone),
        fallbackTimeZone,
        source: valueAsString(payload.source),
        title: requireText(payload.title, "Event payload requires a title."),
        note: normalizeOptionalText(valueAsString(payload.note)) ?? undefined,
        tags: uniqueTrimmedStringList(payload.tags) ?? undefined,
        experimentSlug: valueAsString(payload.experimentSlug),
        links: canonicalLinks,
        rawRefs: uniqueTrimmedStringList(payload.rawRefs) ?? undefined,
        attachments,
        lifecycle,
      }),
      kind,
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

  return compactObject({
    ...buildEventSpineEnvelope({
      id: normalizeDraftEventId(draft.id),
      occurredAt,
      recordedAt: normalizeTimestampInput(draft.recordedAt),
      dayKey: valueAsString(draft.dayKey),
      timeZone: valueAsString(draft.timeZone),
      fallbackTimeZone,
      source: valueAsString(draft.source),
      title: requireText(draft.title, "Event draft requires a title."),
      note: normalizeOptionalText(valueAsString(draft.note)) ?? undefined,
      tags: uniqueTrimmedStringList(draft.tags) ?? undefined,
      experimentSlug: valueAsString(
        "experimentSlug" in draft ? draft.experimentSlug : undefined,
      ),
      links: draft.links,
      rawRefs: uniqueTrimmedStringList(draft.rawRefs) ?? undefined,
      attachments: draft.attachments,
      lifecycle: undefined,
    }),
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
          experimentId: draft.experimentId,
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
      case "measurement":
        return compactObject({
          ...base,
          kind: "measurement",
          measurements: draft.measurements,
          media: draft.media,
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
          experimentId: draft.experimentId,
          supplementName: draft.supplementName,
          dose: draft.dose,
          unit: draft.unit,
        });
      case "activity_session":
        return compactObject({
          ...base,
          kind: "activity_session",
          experimentId: draft.experimentId,
          activityType: draft.activityType,
          durationMinutes: draft.durationMinutes,
          distanceKm: draft.distanceKm,
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
          experimentId: draft.experimentId,
          interventionType: draft.interventionType,
          durationMinutes: draft.durationMinutes,
          protocolId: draft.protocolId,
          sessionStatus: draft.sessionStatus,
          temperatureC: draft.temperatureC,
          timing: draft.timing,
          afterExercise: draft.afterExercise,
          symptoms: draft.symptoms,
          confounders: draft.confounders,
        });
      case "experiment_context":
        return compactObject({
          ...base,
          kind: "experiment_context",
          experimentId: draft.experimentId,
          contextType: draft.contextType,
          severity: draft.severity,
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

export function buildMeasurementEventDraft(
  input: Omit<EventDraftByKind<"measurement">, "kind">,
): EventDraftByKind<"measurement"> {
  return buildTypedEventDraft("measurement", input);
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

export function buildExperimentContextEventDraft(
  input: Omit<EventDraftByKind<"experiment_context">, "kind">,
): EventDraftByKind<"experiment_context"> {
  return buildTypedEventDraft("experiment_context", input);
}

export function buildPublicEventRecord<K extends PublicWritableEventKind>(
  draft: EventDraftByKind<K>,
  fallbackTimeZone?: string,
): EventRecordByKind<K> {
  return buildTypedEventRecord(draft as PublicEventDraft, fallbackTimeZone) as EventRecordByKind<K>;
}

function mergeByRelativePath<T extends { relativePath: string }>(
  existing: readonly T[] | undefined,
  next: readonly T[] | undefined,
): T[] | undefined {
  const merged = new Map<string, T>();

  for (const entry of existing ?? []) {
    merged.set(entry.relativePath, entry);
  }

  for (const entry of next ?? []) {
    merged.set(entry.relativePath, entry);
  }

  return merged.size > 0 ? [...merged.values()] : undefined;
}

function mergeStringLists(
  existing: readonly string[] | undefined,
  next: readonly string[] | undefined,
): string[] | undefined {
  const merged = [...(existing ?? []), ...(next ?? [])]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return merged.length > 0 ? [...new Set(merged)] : undefined;
}

function resolveRawImportSource(
  source: string | null | undefined,
  fallbackSource: unknown,
): string | null {
  if (source !== undefined) {
    return normalizeOptionalText(source) ?? null;
  }

  return normalizeOptionalText(valueAsString(fallbackSource)) ?? "manual";
}

function resolveRawImportImportedAt(value: DateInput | undefined): string {
  return normalizeTimestampInput(value) ?? new Date().toISOString();
}

function ensureSpecializedEventKind(
  kind: AttachmentBackedPublicEventKind,
  eventId: string,
  matchedShards: readonly LoadedEventLedgerShard[],
): void {
  const latestMatchedEvent = selectLatestMatchedEvent(matchedShards);

  if (!latestMatchedEvent) {
    return;
  }

  const expectedRecordKind: EventRecord["kind"] = kind === "capture" ? "note" : kind;
  if (latestMatchedEvent.record.kind !== expectedRecordKind) {
    throw new VaultError(
      "EVENT_KIND_INVALID",
      `Event "${eventId}" already exists as kind "${latestMatchedEvent.record.kind}" and cannot be rewritten as "${kind}".`,
    );
  }

  if (kind === "capture" && !latestMatchedEvent.record.tags?.includes("capture")) {
    throw new VaultError(
      "EVENT_KIND_INVALID",
      `Event "${eventId}" already exists as a note and cannot be rewritten as a capture without the capture tag.`,
    );
  }
}

function applyActivitySessionAttachmentProjections(
  draft: AttachmentBackedEventDraft<"activity_session">,
  attachments: readonly EventAttachment[],
): AttachmentBackedEventDraft<"activity_session"> {
  if (attachments.length === 0) {
    return draft;
  }

  const projections = buildAttachmentCompatibilityProjections(attachments);
  const mergedAttachments = mergeByRelativePath(draft.attachments, attachments);
  const mergedWorkoutMedia = mergeByRelativePath(draft.workout.media, projections.media);
  const mergedRawRefs = mergeStringLists(draft.rawRefs, projections.rawRefs);

  return {
    ...draft,
    ...(mergedAttachments ? { attachments: mergedAttachments } : {}),
    ...(mergedRawRefs ? { rawRefs: mergedRawRefs } : {}),
    workout: {
      ...draft.workout,
      ...(mergedWorkoutMedia ? { media: mergedWorkoutMedia } : {}),
    },
  };
}

function applyCaptureAttachmentProjections(
  draft: AttachmentBackedEventDraft<"capture">,
  attachments: readonly EventAttachment[],
): AttachmentBackedEventDraft<"capture"> {
  if (attachments.length === 0) {
    return draft;
  }

  const mergedAttachments = mergeByRelativePath(draft.attachments, attachments);
  const mergedRawRefs = mergeStringLists(
    draft.rawRefs,
    attachments.map((attachment) => attachment.relativePath),
  );

  return {
    ...draft,
    ...(mergedAttachments ? { attachments: mergedAttachments } : {}),
    ...(mergedRawRefs ? { rawRefs: mergedRawRefs } : {}),
  };
}

function normalizeCaptureDraft(
  draft: AttachmentBackedEventDraft<"capture">,
): AttachmentBackedEventDraft<"capture"> {
  return {
    ...draft,
    tags: uniqueTrimmedStringList([...(draft.tags ?? []), "capture"]) ?? ["capture"],
  };
}

function toActivitySessionDraft(
  record: EventRecordByKind<"activity_session">,
): AttachmentBackedEventDraft<"activity_session"> {
  const {
    schemaVersion: _schemaVersion,
    kind: _kind,
    lifecycle: _lifecycle,
    recordedAt: _recordedAt,
    dayKey: _dayKey,
    ...draft
  } = record;

  return draft;
}

function toBodyMeasurementDraft(
  record: EventRecordByKind<"body_measurement">,
): AttachmentBackedEventDraft<"body_measurement"> {
  const {
    schemaVersion: _schemaVersion,
    kind: _kind,
    lifecycle: _lifecycle,
    recordedAt: _recordedAt,
    dayKey: _dayKey,
    ...draft
  } = record;

  return draft;
}

function toCaptureDraft(
  record: EventRecordByKind<"note">,
): AttachmentBackedEventDraft<"capture"> {
  const {
    schemaVersion: _schemaVersion,
    kind: _kind,
    lifecycle: _lifecycle,
    recordedAt: _recordedAt,
    dayKey: _dayKey,
    ...draft
  } = record;

  return draft;
}

function toMeasurementDraft(
  record: EventRecordByKind<"measurement">,
): AttachmentBackedEventDraft<"measurement"> {
  const {
    schemaVersion: _schemaVersion,
    kind: _kind,
    lifecycle: _lifecycle,
    recordedAt: _recordedAt,
    dayKey: _dayKey,
    ...draft
  } = record;

  return draft;
}

function rehydrateDraftFromLatest<TDraft>(
  latestDraft: TDraft | null,
  draft: TDraft,
  mergeDrafts: (latestDraft: TDraft, draft: TDraft) => TDraft,
): TDraft {
  return latestDraft ? mergeDrafts(latestDraft, draft) : draft;
}

function mergeActivitySessionDrafts(
  latestDraft: AttachmentBackedEventDraft<"activity_session">,
  draft: AttachmentBackedEventDraft<"activity_session">,
): AttachmentBackedEventDraft<"activity_session"> {
  return {
    ...latestDraft,
    ...draft,
    attachments: mergeByRelativePath(latestDraft.attachments, draft.attachments),
    rawRefs: mergeStringLists(latestDraft.rawRefs, draft.rawRefs),
    workout: {
      ...latestDraft.workout,
      ...draft.workout,
      media: mergeByRelativePath(latestDraft.workout.media, draft.workout.media),
    },
  };
}

function mergeCaptureDrafts(
  latestDraft: AttachmentBackedEventDraft<"capture">,
  draft: AttachmentBackedEventDraft<"capture">,
): AttachmentBackedEventDraft<"capture"> {
  return {
    ...latestDraft,
    ...draft,
    attachments: mergeByRelativePath(latestDraft.attachments, draft.attachments),
    rawRefs: mergeStringLists(latestDraft.rawRefs, draft.rawRefs),
  };
}

function mergeMeasurementDrafts<K extends "measurement" | "body_measurement">(
  latestDraft: AttachmentBackedEventDraft<K>,
  draft: AttachmentBackedEventDraft<K>,
): AttachmentBackedEventDraft<K> {
  return {
    ...latestDraft,
    ...draft,
    attachments: mergeByRelativePath(latestDraft.attachments, draft.attachments),
    rawRefs: mergeStringLists(latestDraft.rawRefs, draft.rawRefs),
    media: mergeByRelativePath(latestDraft.media, draft.media),
  };
}

function applyMeasurementAttachmentProjections<K extends "measurement" | "body_measurement">(
  draft: AttachmentBackedEventDraft<K>,
  attachments: readonly EventAttachment[],
): AttachmentBackedEventDraft<K> {
  if (attachments.length === 0) {
    return draft;
  }

  const projections = buildAttachmentCompatibilityProjections(attachments);
  const mergedAttachments = mergeByRelativePath(draft.attachments, attachments);
  const mergedMedia = mergeByRelativePath(draft.media, projections.media);
  const mergedRawRefs = mergeStringLists(draft.rawRefs, projections.rawRefs);

  return {
    ...draft,
    ...(mergedAttachments ? { attachments: mergedAttachments } : {}),
    ...(mergedRawRefs ? { rawRefs: mergedRawRefs } : {}),
    ...(mergedMedia ? { media: mergedMedia } : {}),
  } as AttachmentBackedEventDraft<K>;
}

type AttachmentBackedWriteResult<TStoredKind extends EventRecord["kind"]> = UpsertEventResult & {
  event: EventRecordByKind<TStoredKind>;
  manifestPath: string | null;
};

interface WriteAttachmentBackedEventInput<
  K extends AttachmentBackedPublicEventKind,
  TStoredKind extends EventRecord["kind"],
> {
  vaultRoot: string;
  draft: AttachmentBackedEventDraft<K>;
  attachments?: readonly EventAttachmentSourceInput[];
  rawImport?: RawImportOptions;
  specializedKind: K;
  writeLabel: string;
  operationType: string;
  commandName: string;
  ownerKind: EventAttachmentOwnerKind;
  defaultImportKind: RawImportKind;
  rawImportFamily: string;
  toLatestDraft: (record: EventRecordByKind<TStoredKind>) => AttachmentBackedEventDraft<K>;
  mergeDrafts: (
    latestDraft: AttachmentBackedEventDraft<K>,
    draft: AttachmentBackedEventDraft<K>,
  ) => AttachmentBackedEventDraft<K>;
  applyAttachmentProjections: (
    draft: AttachmentBackedEventDraft<K>,
    attachments: readonly EventAttachment[],
  ) => AttachmentBackedEventDraft<K>;
  buildRecord: (
    draft: AttachmentBackedEventDraft<K>,
    fallbackTimeZone: string | undefined,
    lifecycle: EventLifecycle,
  ) => EventRecordByKind<TStoredKind>;
  normalizeDraft?: (
    draft: AttachmentBackedEventDraft<K>,
  ) => AttachmentBackedEventDraft<K>;
  requireAttachments?: {
    code: string;
    message: string;
  };
}

async function writeAttachmentBackedEvent<
  K extends AttachmentBackedPublicEventKind,
  TStoredKind extends EventRecord["kind"],
>(
  input: WriteAttachmentBackedEventInput<K, TStoredKind>,
): Promise<AttachmentBackedWriteResult<TStoredKind>> {
  const vault = await loadVault({ vaultRoot: input.vaultRoot });
  const eventId = normalizeDraftEventId(input.draft.id) ?? generateRecordId(ID_PREFIXES.event);
  const draft: AttachmentBackedEventDraft<K> = {
    ...input.draft,
    id: eventId,
  };
  const matchedShards = await loadEventLedgerShardsById(input.vaultRoot, eventId);
  ensureSpecializedEventKind(input.specializedKind, eventId, matchedShards);
  const latestMatchedEvent = selectLatestMatchedEvent(matchedShards);
  let rehydratedDraft = rehydrateDraftFromLatest(
    latestMatchedEvent
      ? input.toLatestDraft(latestMatchedEvent.record as EventRecordByKind<TStoredKind>)
      : null,
    draft,
    input.mergeDrafts,
  );

  if (input.normalizeDraft) {
    rehydratedDraft = input.normalizeDraft(rehydratedDraft);
  }

  const lifecycle = buildEventSpineLifecycle(
    latestMatchedEvent ? eventSpineRevision(latestMatchedEvent.record) + 1 : 1,
  );
  const preparedAttachments = prepareEventAttachments({
    ownerKind: input.ownerKind,
    ownerId: eventId,
    occurredAt: rehydratedDraft.occurredAt,
    attachments: input.attachments ?? [],
  });

  if (input.requireAttachments && preparedAttachments.length === 0) {
    throw new VaultError(input.requireAttachments.code, input.requireAttachments.message);
  }

  return runCanonicalWrite<AttachmentBackedWriteResult<TStoredKind>>({
    vaultRoot: input.vaultRoot,
    operationType: input.operationType,
    summary: `Write ${input.writeLabel} ${eventId}`,
    occurredAt: rehydratedDraft.occurredAt,
    mutate: async ({ batch }) => {
      const stagedAttachments =
        preparedAttachments.length > 0
          ? await stagePreparedEventAttachmentsInBatch({
              batch,
              owner: {
                kind: input.ownerKind,
                id: eventId,
              },
              attachments: preparedAttachments,
              importId: input.rawImport?.importId ?? eventId,
              importKind: input.rawImport?.importKind ?? input.defaultImportKind,
              importedAt: resolveRawImportImportedAt(input.rawImport?.importedAt),
              source: resolveRawImportSource(input.rawImport?.source, rehydratedDraft.source),
              provenance: input.rawImport?.provenance ?? {
                eventId,
                family: input.rawImportFamily,
                mediaCount: preparedAttachments.length,
              },
            })
          : null;

      if (input.requireAttachments && !stagedAttachments) {
        throw new VaultError(input.requireAttachments.code, input.requireAttachments.message);
      }

      const projectedDraft = stagedAttachments
        ? input.applyAttachmentProjections(rehydratedDraft, stagedAttachments.attachments)
        : rehydratedDraft;
      const eventRecord = input.buildRecord(projectedDraft, vault.metadata.timezone, lifecycle);
      const ledgerFile = toEventLedgerFile(eventRecord.occurredAt);

      await batch.stageJsonlAppend(ledgerFile, `${JSON.stringify(eventRecord)}\n`);
      await emitAuditRecord({
        vaultRoot: input.vaultRoot,
        batch,
        action: "event_upsert",
        commandName: input.commandName,
        summary: `Wrote ${input.writeLabel} ${eventId}.`,
        occurredAt: eventRecord.occurredAt,
        files: [ledgerFile],
        targetIds: [eventId],
      });

      return {
        eventId,
        ledgerFile,
        created: matchedShards.length === 0,
        event: eventRecord,
        manifestPath: stagedAttachments?.manifestPath ?? null,
      };
    },
  });
}

export async function addActivitySession(
  input: AddActivitySessionInput,
): Promise<AddActivitySessionResult> {
  return writeAttachmentBackedEvent({
    vaultRoot: input.vaultRoot,
    draft: input.draft,
    attachments: input.attachments,
    rawImport: input.rawImport,
    specializedKind: "activity_session",
    writeLabel: "activity_session",
    operationType: "activity_session_write",
    commandName: "core.addActivitySession",
    ownerKind: "workout",
    defaultImportKind: "workout_batch",
    rawImportFamily: "workout",
    toLatestDraft: toActivitySessionDraft,
    mergeDrafts: mergeActivitySessionDrafts,
    applyAttachmentProjections: applyActivitySessionAttachmentProjections,
    buildRecord: (draft, fallbackTimeZone, lifecycle) =>
      buildTypedEventRecord(
        {
          kind: "activity_session",
          ...draft,
        },
        fallbackTimeZone,
        lifecycle,
      ) as EventRecordByKind<"activity_session">,
  });
}

export async function addBodyMeasurement(
  input: AddBodyMeasurementInput,
): Promise<AddBodyMeasurementResult> {
  return writeAttachmentBackedEvent({
    vaultRoot: input.vaultRoot,
    draft: input.draft,
    attachments: input.attachments,
    rawImport: input.rawImport,
    specializedKind: "body_measurement",
    writeLabel: "body_measurement",
    operationType: "body_measurement_write",
    commandName: "core.addBodyMeasurement",
    ownerKind: "measurement",
    defaultImportKind: "measurement_batch",
    rawImportFamily: "measurement",
    toLatestDraft: toBodyMeasurementDraft,
    mergeDrafts: mergeMeasurementDrafts,
    applyAttachmentProjections: applyMeasurementAttachmentProjections,
    buildRecord: (draft, fallbackTimeZone, lifecycle) =>
      buildTypedEventRecord(
        {
          kind: "body_measurement",
          ...draft,
        },
        fallbackTimeZone,
        lifecycle,
      ) as EventRecordByKind<"body_measurement">,
  });
}

export async function addCapture(
  input: AddCaptureInput,
): Promise<AddCaptureResult> {
  return writeAttachmentBackedEvent({
    vaultRoot: input.vaultRoot,
    draft: input.draft,
    attachments: input.attachments,
    rawImport: input.rawImport,
    specializedKind: "capture",
    writeLabel: "capture",
    operationType: "capture_write",
    commandName: "core.addCapture",
    ownerKind: "capture",
    defaultImportKind: "capture",
    rawImportFamily: "capture",
    toLatestDraft: toCaptureDraft,
    mergeDrafts: mergeCaptureDrafts,
    applyAttachmentProjections: applyCaptureAttachmentProjections,
    normalizeDraft: normalizeCaptureDraft,
    requireAttachments: {
      code: "CAPTURE_MEDIA_MISSING",
      message: "Capture writes require at least one media attachment.",
    },
    buildRecord: (draft, fallbackTimeZone, lifecycle) =>
      buildTypedEventRecord(
        {
          kind: "note",
          ...draft,
        },
        fallbackTimeZone,
        lifecycle,
      ) as EventRecordByKind<"note">,
  });
}

export async function addMeasurement(
  input: AddMeasurementInput,
): Promise<AddMeasurementResult> {
  return writeAttachmentBackedEvent({
    vaultRoot: input.vaultRoot,
    draft: input.draft,
    attachments: input.attachments,
    rawImport: input.rawImport,
    specializedKind: "measurement",
    writeLabel: "measurement",
    operationType: "measurement_write",
    commandName: "core.addMeasurement",
    ownerKind: "measurement",
    defaultImportKind: "measurement_batch",
    rawImportFamily: "measurement",
    toLatestDraft: toMeasurementDraft,
    mergeDrafts: mergeMeasurementDrafts,
    applyAttachmentProjections: applyMeasurementAttachmentProjections,
    buildRecord: (draft, fallbackTimeZone, lifecycle) =>
      buildTypedEventRecord(
        {
          kind: "measurement",
          ...draft,
        },
        fallbackTimeZone,
        lifecycle,
      ) as EventRecordByKind<"measurement">,
  });
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
  return validateContract(
    eventRecordSchema,
    compactObject({
      ...buildEventSpineEnvelope({
        occurredAt: input.occurredAt,
        timeZone: input.timeZone,
        source: "manual",
        title: input.title.trim(),
        note: normalizeOptionalText(input.note) ?? undefined,
        links: [{ type: "related_to", targetId: input.experimentId }],
      }),
      kind: "experiment_event",
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

function externalRefMatches(record: EventRecord, input: FindEventByExternalRefInput): boolean {
  const externalRef = record.externalRef;
  if (!externalRef) {
    return false;
  }

  return externalRef.system === input.system &&
    externalRef.resourceType === input.resourceType &&
    externalRef.resourceId === input.resourceId &&
    (input.version === undefined || externalRef.version === input.version) &&
    (input.facet === undefined || externalRef.facet === input.facet);
}

export async function findEventByExternalRef(input: FindEventByExternalRefInput): Promise<EventRecord | null> {
  const relativePaths = await walkVaultFiles(input.vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });
  const matches: MatchedEventRecord[] = [];

  for (const relativePath of relativePaths) {
    const records = await readJsonlRecords({
      vaultRoot: input.vaultRoot,
      relativePath,
    });

    for (const rawRecord of records) {
      const record = validateStoredEventRecord(rawRecord as JsonObject);
      if (externalRefMatches(record, input)) {
        matches.push({ relativePath, record });
      }
    }
  }

  const latest = selectLatestEventSpineEntry(matches);
  if (!latest || isDeletedEventSpineRecord(latest.record)) {
    return null;
  }

  return latest.record;
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
  return selectLatestEventSpineEntry(flattenMatchedEventRecords(matchedShards));
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

  for (const attachment of record.attachments ?? []) {
    retained.add(attachment.relativePath);
  }

  uniqueTrimmedStringList(record.rawRefs)?.forEach((relativePath) => retained.add(relativePath));

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
  const lifecycle = buildEventSpineLifecycle(
    latestMatchedEvent ? eventSpineRevision(latestMatchedEvent.record) + 1 : 1,
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
      await emitAuditRecord({
        vaultRoot: input.vaultRoot,
        batch,
        action: "event_upsert",
        commandName: "core.upsertEvent",
        summary: `Upserted ${eventRecord.kind} ${eventRecord.id}.`,
        occurredAt: eventRecord.occurredAt,
        files: [ledgerFile],
        targetIds: [eventRecord.id],
      });

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
  if (!latestMatchedEvent || isDeletedEventSpineRecord(latestMatchedEvent.record)) {
    throw new VaultError("EVENT_MISSING", `Event "${input.eventId}" was not found.`);
  }
  const tombstoneRecord = validateContract(
    eventRecordSchema,
    compactObject({
      ...latestMatchedEvent.record,
      recordedAt: new Date().toISOString(),
      lifecycle: buildEventSpineLifecycle(eventSpineRevision(latestMatchedEvent.record) + 1, "deleted"),
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
      await emitAuditRecord({
        vaultRoot: input.vaultRoot,
        batch,
        action: "event_delete",
        commandName: "core.deleteEvent",
        summary: `Deleted ${latestMatchedEvent.record.kind} ${input.eventId}.`,
        occurredAt: new Date(),
        files: [tombstoneLedgerFile],
        targetIds: [input.eventId],
      });

      return {
        eventId: input.eventId,
        kind: latestMatchedEvent.record.kind,
        retainedPaths: extractRetainedPaths(latestMatchedEvent.record),
        deleted: true,
      };
    },
  });
}
