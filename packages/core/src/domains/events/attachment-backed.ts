import type { EventAttachment, EventRecord, RawImportKind } from "@murphai/contracts";
import { eventRecordSchema } from "@murphai/contracts";

import { emitAuditRecord } from "../../audit.ts";
import { ID_PREFIXES } from "../../constants.ts";
import {
  buildAttachmentCompatibilityProjections,
  prepareEventAttachments,
  stagePreparedEventAttachmentsInBatch,
  type EventAttachmentOwnerKind,
  type EventAttachmentSourceInput,
  type StagedEventAttachments,
} from "../../event-attachments.ts";
import { VaultError } from "../../errors.ts";
import {
  buildEventSpineLifecycle,
  eventSpineRevision,
  isDeletedEventSpineRecord,
  selectLatestEventSpineEntry,
} from "../../history/event-spine.ts";
import { generateRecordId } from "../../ids.ts";
import { readJsonlRecords } from "../../jsonl.ts";
import { withCanonicalWriteLock } from "../../operations/canonical-write-lock.ts";
import { runCanonicalWrite, type WriteBatch } from "../../operations/write-batch.ts";
import type { DateInput } from "../../types.ts";
import { loadVault } from "../../vault.ts";
import {
  normalizeOptionalText,
  normalizeTimestampInput,
  uniqueTrimmedStringList,
} from "../shared.ts";
import {
  buildTypedEventRecord,
  normalizeDraftEventId,
  valueAsString,
  type EventDraftByKind,
  type EventLifecycle,
  type EventRecordByKind,
} from "./drafts.ts";
import {
  loadEventLedgerShardsById,
  selectLatestMatchedEvent,
  toEventLedgerFile,
  type LoadedEventLedgerShard,
  type UpsertEventResult,
} from "./ledger.ts";
import {
  CAPTURE_LOOKUP_BACKED_TAG,
  CAPTURE_LOOKUP_SCHEMA,
  captureLookupPathForKey,
  isCaptureLookupBackedEvent,
  readStoredCaptureLookup,
  readStoredCaptureLookupIndex,
  type StoredCaptureLookup,
  type StoredCaptureLookupIndex,
} from "./capture-lookup.ts";

type AttachmentBackedPublicEventKind = "activity_session" | "capture" | "measurement" | "body_measurement";
type CaptureEventDraft = Omit<EventDraftByKind<"note">, "kind">;
type AttachmentBackedEventDraft<K extends AttachmentBackedPublicEventKind> = K extends "capture"
  ? CaptureEventDraft
  : Omit<EventDraftByKind<Extract<K, "activity_session" | "measurement" | "body_measurement">>, "kind">;

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

export interface AddCaptureWithLookupInput extends AddCaptureInput {
  lookupAttachmentRole: string;
  lookupKey: string;
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

export interface AddCaptureWithLookupResult extends AddCaptureResult {
  lookupPath: string;
}

export interface AddMeasurementResult extends UpsertEventResult {
  event: EventRecordByKind<"measurement">;
  manifestPath: string | null;
}

export type FindCaptureByLookupResult =
  | {
      status: "missing";
      lookupPath: string;
    }
  | {
      eventId: string;
      ledgerFile: string;
      lookupPath: string;
      status: "deleted";
    }
  | {
      attachmentRef: string;
      event: EventRecordByKind<"note">;
      eventId: string;
      ledgerFile: string;
      lookupPath: string;
      manifestPath: string | null;
      status: "live";
    };

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

  if (kind === "capture" && isCaptureLookupBackedEvent(latestMatchedEvent.record)) {
    throw new VaultError(
      "CAPTURE_LOOKUP_IMMUTABLE",
      `Event "${eventId}" is a lookup-backed capture and cannot be rewritten.`,
    );
  }
}

export function applyActivitySessionAttachmentProjections(
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

export function applyCaptureAttachmentProjections(
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
  return normalizeCaptureDraftWithRequiredTags(draft, ["capture"]);
}

function normalizeLookupBackedCaptureDraft(
  draft: AttachmentBackedEventDraft<"capture">,
): AttachmentBackedEventDraft<"capture"> {
  return normalizeCaptureDraftWithRequiredTags(draft, ["capture", CAPTURE_LOOKUP_BACKED_TAG]);
}

function normalizeCaptureDraftWithRequiredTags(
  draft: AttachmentBackedEventDraft<"capture">,
  requiredTags: readonly string[],
): AttachmentBackedEventDraft<"capture"> {
  return {
    ...draft,
    tags: uniqueTrimmedStringList([...(draft.tags ?? []), ...requiredTags]) ?? [...requiredTags],
  };
}

function parseStoredCaptureEvent(record: unknown, lookupPath: string): EventRecord | null {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  const parsed = eventRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new VaultError("CAPTURE_LOOKUP_EVENT_INVALID", "Capture lookup event record is invalid.", {
      relativePath: lookupPath,
    });
  }
  return parsed.data;
}

function assertLiveCaptureLookupEvent(input: {
  attachmentRef: string;
  event: EventRecord;
  lookupPath: string;
}): EventRecordByKind<"note"> {
  if (input.event.kind !== "note" || !input.event.tags?.includes("capture")) {
    throw new VaultError("CAPTURE_LOOKUP_EVENT_INVALID", "Capture lookup target is not a capture event.", {
      relativePath: input.lookupPath,
    });
  }

  const hasAttachment = input.event.attachments?.some((attachment) =>
    attachment.relativePath === input.attachmentRef
  ) ?? false;
  if (!hasAttachment) {
    throw new VaultError("CAPTURE_LOOKUP_EVENT_STALE", "Capture lookup attachment is no longer present.", {
      relativePath: input.lookupPath,
    });
  }

  return input.event as EventRecordByKind<"note">;
}

export async function findCaptureByLookup(input: {
  lookupKey: string;
  vaultRoot: string;
}): Promise<FindCaptureByLookupResult> {
  const { lookupPath } = captureLookupPathForKey(input.lookupKey);
  const stored = await readStoredCaptureLookup(input);
  if (!stored) {
    return {
      lookupPath,
      status: "missing",
    };
  }

  if (stored.lookup.retiredAt) {
    return {
      eventId: stored.lookup.eventId,
      ledgerFile: stored.lookup.ledgerFile,
      lookupPath: stored.lookupPath,
      status: "deleted",
    };
  }

  const records = await readJsonlRecords({
    vaultRoot: input.vaultRoot,
    relativePath: stored.lookup.ledgerFile,
  });
  const matches = records
    .map((record) => parseStoredCaptureEvent(record, stored.lookupPath))
    .filter((record): record is EventRecord => record?.id === stored.lookup.eventId)
    .map((record) => ({
      relativePath: stored.lookup.ledgerFile,
      record,
    }));
  const latest = selectLatestEventSpineEntry(matches);
  if (!latest) {
    throw new VaultError("CAPTURE_LOOKUP_EVENT_MISSING", "Capture lookup target event is missing.", {
      relativePath: stored.lookupPath,
    });
  }

  if (isDeletedEventSpineRecord(latest.record)) {
    return {
      eventId: stored.lookup.eventId,
      ledgerFile: stored.lookup.ledgerFile,
      lookupPath: stored.lookupPath,
      status: "deleted",
    };
  }

  const event = assertLiveCaptureLookupEvent({
    attachmentRef: stored.lookup.attachmentRef,
    event: latest.record,
    lookupPath: stored.lookupPath,
  });

  return {
    attachmentRef: stored.lookup.attachmentRef,
    event,
    eventId: stored.lookup.eventId,
    ledgerFile: stored.lookup.ledgerFile,
    lookupPath: stored.lookupPath,
    manifestPath: stored.lookup.manifestPath,
    status: "live",
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

export function mergeActivitySessionDrafts(
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

export function mergeCaptureDrafts(
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

export function mergeMeasurementDrafts<K extends "measurement" | "body_measurement">(
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

export function applyMeasurementAttachmentProjections<K extends "measurement" | "body_measurement">(
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

interface AttachmentBackedAdditionalStageResult {
  auditFiles?: readonly string[];
}

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
  stageAdditionalResult?: (input: {
    batch: WriteBatch;
    eventRecord: EventRecordByKind<TStoredKind>;
    ledgerFile: string;
    manifestPath: string | null;
    stagedAttachments: StagedEventAttachments | null;
  }) => Promise<AttachmentBackedAdditionalStageResult>;
}

export async function writeAttachmentBackedEvent<
  K extends AttachmentBackedPublicEventKind,
  TStoredKind extends EventRecord["kind"],
>(
  input: WriteAttachmentBackedEventInput<K, TStoredKind>,
): Promise<AttachmentBackedWriteResult<TStoredKind>> {
  const vault = await loadVault({ vaultRoot: input.vaultRoot });
  const suppliedEventId = normalizeDraftEventId(input.draft.id);
  const eventId = suppliedEventId ?? generateRecordId(ID_PREFIXES.event);
  const draft: AttachmentBackedEventDraft<K> = {
    ...input.draft,
    id: eventId,
  };
  const matchedShards = suppliedEventId
    ? await loadEventLedgerShardsById(input.vaultRoot, eventId)
    : [];
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

      const additional = input.stageAdditionalResult
        ? await input.stageAdditionalResult({
            batch,
            eventRecord,
            ledgerFile,
            manifestPath: stagedAttachments?.manifestPath ?? null,
            stagedAttachments,
          })
        : null;

      await emitAuditRecord({
        vaultRoot: input.vaultRoot,
        batch,
        action: "event_upsert",
        commandName: input.commandName,
        summary: `Wrote ${input.writeLabel} ${eventId}.`,
        occurredAt: eventRecord.occurredAt,
        files: [ledgerFile, ...(additional?.auditFiles ?? [])],
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

export async function addCaptureWithLookup(
  input: AddCaptureWithLookupInput,
): Promise<AddCaptureWithLookupResult> {
  return withCanonicalWriteLock(input.vaultRoot, async () => {
    if (normalizeDraftEventId(input.draft.id)) {
      throw new VaultError("INVALID_INPUT", "Capture lookup writes generate their own event id.");
    }

    const existing = await findCaptureByLookup({
      lookupKey: input.lookupKey,
      vaultRoot: input.vaultRoot,
    });
    if (existing.status === "live") {
      throw new VaultError("CAPTURE_LOOKUP_EXISTS", "Capture lookup already points at a live capture.", {
        eventId: existing.eventId,
        relativePath: existing.lookupPath,
      });
    }
    if (existing.status === "deleted") {
      throw new VaultError("CAPTURE_LOOKUP_DELETED", "Capture lookup points at a deleted capture.", {
        eventId: existing.eventId,
        relativePath: existing.lookupPath,
      });
    }

    const { lookupKeyHash, lookupPath } = captureLookupPathForKey(input.lookupKey);
    const result = await writeAttachmentBackedEvent<"capture", "note">({
      vaultRoot: input.vaultRoot,
      draft: input.draft,
      attachments: input.attachments,
      rawImport: input.rawImport,
      specializedKind: "capture",
      writeLabel: "capture",
      operationType: "capture_write",
      commandName: "core.addCaptureWithLookup",
      ownerKind: "capture",
      defaultImportKind: "capture",
      rawImportFamily: "capture",
      toLatestDraft: toCaptureDraft,
      mergeDrafts: mergeCaptureDrafts,
      applyAttachmentProjections: applyCaptureAttachmentProjections,
      normalizeDraft: normalizeLookupBackedCaptureDraft,
      requireAttachments: {
        code: "CAPTURE_MEDIA_MISSING",
        message: "Capture writes require at least one media attachment.",
      },
      stageAdditionalResult: async ({ batch, eventRecord, ledgerFile, manifestPath }) => {
        const attachmentRef = eventRecord.attachments?.find((attachment) =>
          attachment.role === input.lookupAttachmentRole
        )?.relativePath ?? null;
        if (!attachmentRef) {
          throw new VaultError(
            "CAPTURE_LOOKUP_ATTACHMENT_MISSING",
            "Capture lookup attachment role was not written.",
          );
        }

        const index = await readStoredCaptureLookupIndex({
          vaultRoot: input.vaultRoot,
        });
        if (Object.prototype.hasOwnProperty.call(index.entries, lookupKeyHash)) {
          throw new VaultError("CAPTURE_LOOKUP_EXISTS", "Capture lookup already exists.", {
            relativePath: lookupPath,
          });
        }

        const lookup: StoredCaptureLookup = {
          attachmentRef,
          eventId: eventRecord.id,
          ledgerFile,
          manifestPath,
        };
        const nextIndex: StoredCaptureLookupIndex = {
          entries: {
            ...index.entries,
            [lookupKeyHash]: lookup,
          },
          schema: CAPTURE_LOOKUP_SCHEMA,
        };
        await batch.stageTextWrite(lookupPath, `${JSON.stringify(nextIndex, null, 2)}\n`);

        return {
          auditFiles: [lookupPath],
        };
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

    return {
      ...result,
      lookupPath,
    };
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
