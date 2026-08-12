import type { EventRecord } from "@murphai/contracts";
import {
  collectEventRawReferencePaths,
  EVENT_KINDS,
  eventRecordSchema,
  isStrictIsoDate,
  publicEventImportJsonlRowPayloadSchemasByKind,
} from "@murphai/contracts";

import { emitAuditRecord } from "../../audit.ts";
import { VAULT_LAYOUT } from "../../constants.ts";
import {
  assertNoLegacyRelatedIds,
  normalizeCanonicalEventLinks,
} from "../../event-links.ts";
import { VaultError } from "../../errors.ts";
import { walkVaultFiles } from "../../fs.ts";
import {
  buildEventSpineEnvelope,
  buildEventSpineLifecycle,
  compareEventSpineEntries,
  eventSpineRevision,
  isDeletedEventSpineRecord,
  parseEventSpineAttachments,
  parseEventSpineEvidence,
  selectLatestEventSpineEntry,
} from "../../history/event-spine.ts";
import { readJsonlRecords, toMonthlyShardRelativePath } from "../../jsonl.ts";
import { withCanonicalWriteLock } from "../../operations/canonical-write-lock.ts";
import { loadVault } from "../../vault.ts";
import {
  compactObject,
  normalizeOptionalText,
  normalizeTimestampInput,
  runLoadedCanonicalWrite,
  uniqueTrimmedStringList,
  validateContract,
} from "../shared.ts";
import { isCaptureLookupBackedEvent } from "./capture-lookup.ts";
import {
  buildTypedEventRecord,
  normalizeDraftEventId,
  PUBLIC_EVENT_WRITE_KIND_LIST,
  requireText,
  valueAsString,
  type EventLifecycle,
  type PublicEventDraft,
  type PublicWritableEventKind,
} from "./drafts.ts";

type JsonObject = Record<string, unknown>;

export interface LoadedEventLedgerShard {
  relativePath: string;
  matchingRecords: EventRecord[];
}

export type MatchedEventRecord = {
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

export interface FindEventsByRawRefsInput {
  vaultRoot: string;
  rawRefs: readonly string[];
  system?: string;
  resourceType?: string;
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

export function buildDeletedEventTombstone(
  record: EventRecord,
  recordedAt: Date,
): EventRecord {
  return validateContract(
    eventRecordSchema,
    compactObject({
      ...record,
      recordedAt: recordedAt.toISOString(),
      lifecycle: buildEventSpineLifecycle(eventSpineRevision(record) + 1, "deleted"),
    }),
    "EVENT_CONTRACT_INVALID",
    "Deleted event tombstone is invalid.",
  );
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
  "rawRefs",
  "evidence",
  "lifecycle",
]);

const PUBLIC_EVENT_WRITE_KINDS = new Set<EventRecord["kind"]>(PUBLIC_EVENT_WRITE_KIND_LIST);

function isPublicEventWriteKind(kind: EventRecord["kind"]): kind is PublicWritableEventKind {
  return PUBLIC_EVENT_WRITE_KINDS.has(kind);
}

function formatZodIssuePath(path: readonly (string | number | symbol)[]): string {
  return path.map((segment) => String(segment)).join(".");
}
const SUPPORTED_EVENT_KINDS = new Set<string>(EVENT_KINDS);

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

function dateOnlyInputDayKey(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return isStrictIsoDate(trimmed) ? trimmed : undefined;
}

function buildEventRecord(
  payload: JsonObject,
  fallbackTimeZone?: string,
  lifecycle?: EventLifecycle,
): EventRecord {
  const kind = normalizeEventKind(payload);
  const eventTimeZone = valueAsString(payload.timeZone);
  const occurredAt = normalizeTimestampInput(payload.occurredAt);
  if (!occurredAt) {
    throw new VaultError("EVENT_OCCURRED_AT_MISSING", "Event payload requires occurredAt.");
  }
  const attachments = parseEventSpineAttachments(payload.attachments);
  assertNoLegacyRelatedIds({
    value: payload.relatedIds,
    errorCode: "EVENT_CONTRACT_INVALID",
    errorMessage: "Event payload relatedIds is no longer supported; use links.",
  });
  const canonicalLinks = normalizeCanonicalEventLinks({
    value: payload.links,
    errorCode: "EVENT_CONTRACT_INVALID",
    errorMessage: "Event payload links must contain objects with type and targetId fields.",
  });

  return validateContract(
    eventRecordSchema,
    compactObject({
      ...buildEventSpineEnvelope({
        id: normalizeEventId(payload),
        occurredAt,
        recordedAt: normalizeTimestampInput(payload.recordedAt),
        dayKey: valueAsString(payload.dayKey) ?? dateOnlyInputDayKey(payload.occurredAt),
        timeZone: eventTimeZone,
        fallbackTimeZone,
        source: valueAsString(payload.source),
        title: requireText(payload.title, "Event payload requires a title."),
        note: normalizeOptionalText(valueAsString(payload.note)) ?? undefined,
        tags: uniqueTrimmedStringList(payload.tags) ?? undefined,
        experimentSlug: valueAsString(payload.experimentSlug),
        links: canonicalLinks,
        rawRefs: uniqueTrimmedStringList(payload.rawRefs) ?? undefined,
        evidence: parseEventSpineEvidence(payload.evidence),
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

// Validates one canonical event payload through the same contract path as the
// single-event upsert, gated to the public-write kinds, without touching the
// ledger. Batch import builds records up front so an invalid payload can
// reject the whole batch before any write. Explicit event ids are rejected:
// externalRef is the only re-import identity for bulk import (reconciled
// vault-wide), so a caller-picked id could only bypass that reconcile and
// mint a colliding revision-1 copy of an existing event.
export function buildPublicEventImportRecord(
  payload: JsonObject,
  fallbackTimeZone?: string,
): EventRecord {
  const kind = normalizeEventKind(payload);

  if (!isPublicEventWriteKind(kind)) {
    throw new VaultError(
      "EVENT_KIND_INVALID",
      `Event kind "${kind}" is not supported by generic event import.`,
    );
  }

  if (normalizeEventId(payload) !== undefined) {
    throw new VaultError(
      "EVENT_ID_NOT_ALLOWED",
      "Bulk event import payloads must not carry an explicit event id; re-import identity comes from externalRef.",
    );
  }

  const payloadSchema = publicEventImportJsonlRowPayloadSchemasByKind[kind];
  const payloadResult = payloadSchema.safeParse(payload);
  if (!payloadResult.success) {
    const errors = payloadResult.error.issues.map((issue) => {
      const path = formatZodIssuePath(issue.path);
      return path ? `${path}: ${issue.message}` : issue.message;
    });
    throw new VaultError(
      "EVENT_IMPORT_PAYLOAD_INVALID",
      `Bulk event import payload failed validation: ${errors.join("; ")}`,
      { errors },
    );
  }

  return buildEventRecord(payload, fallbackTimeZone);
}

export function toEventLedgerFile(occurredAt: string): string {
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

export async function findEventByExternalRef(
  input: FindEventByExternalRefInput,
): Promise<EventRecord | null> {
  const relativePaths = await walkVaultFiles(input.vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });
  const candidateIds = new Set<string>();

  for (const relativePath of relativePaths) {
    const records = await readJsonlRecords({
      vaultRoot: input.vaultRoot,
      relativePath,
    });

    for (const rawRecord of records) {
      const record = validateStoredEventRecord(rawRecord as JsonObject);

      if (externalRefMatches(record, input)) {
        candidateIds.add(record.id);
      }
    }
  }

  if (candidateIds.size === 0) {
    return null;
  }

  const latestByCandidateId = new Map<string, MatchedEventRecord>();
  for (const relativePath of relativePaths) {
    const records = await readJsonlRecords({
      vaultRoot: input.vaultRoot,
      relativePath,
    });

    for (const rawRecord of records) {
      const record = validateStoredEventRecord(rawRecord as JsonObject);
      if (!candidateIds.has(record.id)) {
        continue;
      }

      const entry = { relativePath, record };
      const latest = latestByCandidateId.get(record.id);
      if (!latest || compareEventSpineEntries(latest, entry) < 0) {
        latestByCandidateId.set(record.id, entry);
      }
    }
  }

  const matchingLatestEntries = [...latestByCandidateId.values()].filter((entry) =>
    externalRefMatches(entry.record, input)
  );
  const liveMatchingLatestEntries = matchingLatestEntries.filter((entry) =>
    !isDeletedEventSpineRecord(entry.record)
  );
  const latest = selectLatestEventSpineEntry(
    liveMatchingLatestEntries.length > 0 ? liveMatchingLatestEntries : matchingLatestEntries,
  );
  if (!latest || isDeletedEventSpineRecord(latest.record)) {
    return null;
  }

  return latest.record;
}

function rawRefMatches(record: EventRecord, rawRef: string, input: FindEventsByRawRefsInput): boolean {
  return collectEventRawReferencePaths(record).includes(rawRef)
    && (input.system === undefined || record.externalRef?.system === input.system)
    && (input.resourceType === undefined || record.externalRef?.resourceType === input.resourceType);
}

export async function findEventsByRawRefs(
  input: FindEventsByRawRefsInput,
): Promise<EventRecord[][]> {
  if (input.rawRefs.length > 100) {
    throw new TypeError("Event raw-reference lookup is limited to 100 references.");
  }
  if (input.rawRefs.length === 0) {
    return [];
  }

  const relativePaths = await walkVaultFiles(input.vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });
  const refIndexesByRawRef = new Map<string, number[]>();
  const candidateIdsByRefIndex = input.rawRefs.map(() => new Set<string>());
  input.rawRefs.forEach((rawRef, index) => {
    const indexes = refIndexesByRawRef.get(rawRef) ?? [];
    indexes.push(index);
    refIndexesByRawRef.set(rawRef, indexes);
  });

  for (const relativePath of relativePaths) {
    const records = await readJsonlRecords({ vaultRoot: input.vaultRoot, relativePath });
    for (const rawRecord of records) {
      const record = validateStoredEventRecord(rawRecord as JsonObject);
      for (const rawRef of collectEventRawReferencePaths(record)) {
        for (const refIndex of refIndexesByRawRef.get(rawRef) ?? []) {
          if (rawRefMatches(record, rawRef, input)) {
            candidateIdsByRefIndex[refIndex]?.add(record.id);
          }
        }
      }
    }
  }

  const candidateIds = new Set(candidateIdsByRefIndex.flatMap((ids) => [...ids]));
  if (candidateIds.size === 0) {
    return input.rawRefs.map(() => []);
  }

  const latestByCandidateId = new Map<string, MatchedEventRecord>();
  for (const relativePath of relativePaths) {
    const records = await readJsonlRecords({ vaultRoot: input.vaultRoot, relativePath });
    for (const rawRecord of records) {
      const record = validateStoredEventRecord(rawRecord as JsonObject);
      if (!candidateIds.has(record.id)) {
        continue;
      }
      const entry = { relativePath, record };
      const latest = latestByCandidateId.get(record.id);
      if (!latest || compareEventSpineEntries(latest, entry) < 0) {
        latestByCandidateId.set(record.id, entry);
      }
    }
  }

  return input.rawRefs.map((rawRef, refIndex) =>
    [...(candidateIdsByRefIndex[refIndex] ?? [])]
      .map((candidateId) => latestByCandidateId.get(candidateId)?.record)
      .filter((record): record is EventRecord =>
        record !== undefined
        && !isDeletedEventSpineRecord(record)
        && rawRefMatches(record, rawRef, input))
      .sort((left, right) => left.id.localeCompare(right.id)));
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

export function selectLatestMatchedEvent(
  matchedShards: readonly LoadedEventLedgerShard[],
): MatchedEventRecord | null {
  return selectLatestEventSpineEntry(flattenMatchedEventRecords(matchedShards));
}

export async function loadEventLedgerShardsById(
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
  return collectEventRawReferencePaths(record);
}

function canWriteEventKind(input: {
  kind: EventRecord["kind"],
  latestMatchedEvent: MatchedEventRecord | null,
  allowSpecializedKindRewrite: boolean | undefined,
}): boolean {
  const { kind, latestMatchedEvent, allowSpecializedKindRewrite } = input;
  if (PUBLIC_EVENT_WRITE_KINDS.has(kind)) {
    return true;
  }

  return allowSpecializedKindRewrite === true &&
    latestMatchedEvent !== null &&
    latestMatchedEvent.record.kind === kind &&
    !isDeletedEventSpineRecord(latestMatchedEvent.record);
}

function isDraftUpsertInput(input: UpsertEventInput): input is UpsertEventDraftInput {
  return "draft" in input;
}

export async function upsertEvent(
  input: UpsertEventInput,
): Promise<UpsertEventResult> {
  return withCanonicalWriteLock(input.vaultRoot, () => upsertEventLocked(input));
}

async function upsertEventLocked(
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

  const latestMatchedEvent = selectLatestMatchedEvent(matchedShards);
  if (
    suppliedEventId !== undefined &&
    latestMatchedEvent !== null &&
    !isDeletedEventSpineRecord(latestMatchedEvent.record) &&
    latestMatchedEvent.record.kind !== kind
  ) {
    throw new VaultError(
      "EVENT_KIND_MISMATCH",
      `Event "${suppliedEventId}" is already kind "${latestMatchedEvent.record.kind}" and cannot be rewritten as "${kind}".`,
    );
  }
  if (!canWriteEventKind({
    allowSpecializedKindRewrite: input.allowSpecializedKindRewrite,
    kind,
    latestMatchedEvent,
  })) {
    throw new VaultError(
      "EVENT_KIND_INVALID",
      `Event kind "${kind}" is not supported by generic event upsert.`,
    );
  }
  if (latestMatchedEvent !== null && isCaptureLookupBackedEvent(latestMatchedEvent.record)) {
    throw new VaultError(
      "CAPTURE_LOOKUP_IMMUTABLE",
      `Event "${latestMatchedEvent.record.id}" is a lookup-backed capture and cannot be rewritten.`,
    );
  }

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
  return withCanonicalWriteLock(input.vaultRoot, () => deleteEventLocked(input));
}

async function deleteEventLocked(
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
  const now = new Date();
  const tombstoneRecord = buildDeletedEventTombstone(latestMatchedEvent.record, now);
  const tombstoneLedgerFile = toEventLedgerFile(tombstoneRecord.occurredAt);

  return runLoadedCanonicalWrite<DeleteEventResult>({
    vaultRoot: input.vaultRoot,
    operationType: "event_delete",
    summary: `Delete event ${input.eventId}`,
    occurredAt: now,
    mutate: async ({ batch }) => {
      await batch.stageJsonlAppend(tombstoneLedgerFile, `${JSON.stringify(tombstoneRecord)}\n`);
      await emitAuditRecord({
        vaultRoot: input.vaultRoot,
        batch,
        action: "event_delete",
        commandName: "core.deleteEvent",
        summary: `Deleted ${latestMatchedEvent.record.kind} ${input.eventId}.`,
        occurredAt: now,
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
