import type { EventAttachment, EventLifecycle, EventRecord } from "@murphai/contracts";
import {
  CONTRACT_SCHEMA_VERSION,
  clinicalEvidenceRefSchema,
  collapseEventRevisions,
  compareEventRevisionPriority,
  eventAttachmentSchema,
  eventRevisionFromLifecycle,
  isDeletedEventLifecycle,
  parseEventLifecycle,
} from "@murphai/contracts";

import { ID_PREFIXES } from "../constants.ts";
import { buildAttachmentCompatibilityProjections } from "../event-attachments.ts";
import { normalizeCanonicalEventLinks } from "../event-links.ts";
import { VaultError } from "../errors.ts";
import { generateRecordId } from "../ids.ts";
import { defaultTimeZone, normalizeTimeZone, toLocalDayKey } from "../time.ts";
import {
  compactObject,
  normalizeLocalDate,
  normalizeOptionalText,
} from "../domains/shared.ts";

type RevisionComparableRecord = Pick<EventRecord, "id" | "occurredAt" | "recordedAt" | "lifecycle">;

export interface EventSpineEntry<TRecord extends RevisionComparableRecord> {
  relativePath: string;
  record: TRecord;
}

export interface BuildEventSpineEnvelopeInput {
  schemaVersion?: EventRecord["schemaVersion"];
  id?: string;
  occurredAt: string;
  recordedAt?: string;
  dayKey?: string;
  timeZone?: string;
  fallbackTimeZone?: string;
  source?: unknown;
  title: string;
  note?: string;
  tags?: string[];
  experimentSlug?: string;
  links?: unknown;
  relationErrorCode?: string;
  relationErrorMessage?: string;
  strictDayKey?: boolean;
  invalidDayKeyCode?: string;
  invalidDayKeyMessage?: string;
  rawRefs?: string[];
  evidence?: EventRecord["evidence"];
  attachments?: EventAttachment[];
  lifecycle?: EventLifecycle;
}

export function parseEventSpineAttachments(value: unknown): EventAttachment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const attachments = value.map((attachment, index) => {
    const parsed = eventAttachmentSchema.safeParse(attachment);
    if (!parsed.success) {
      throw new VaultError(
        "EVENT_CONTRACT_INVALID",
        `Event attachment at index ${index} is invalid.`,
      );
    }

    return parsed.data;
  });

  return attachments.length > 0 ? attachments : undefined;
}

export function parseEventSpineEvidence(value: unknown): EventRecord["evidence"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const evidence = value.map((entry, index) => {
    const parsed = clinicalEvidenceRefSchema.safeParse(entry);
    if (!parsed.success) {
      throw new VaultError(
        "EVENT_CONTRACT_INVALID",
        `Event evidence at index ${index} is invalid.`,
      );
    }

    return parsed.data;
  });

  return evidence.length > 0 ? evidence : undefined;
}

export function buildEventSpineLifecycle(
  revision: number,
  state?: EventLifecycle["state"],
): EventLifecycle {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new VaultError("INVALID_INPUT", "Event lifecycle revision must be a positive integer.");
  }

  return state ? { revision, state } : { revision };
}

export function eventSpineRevision(record: Pick<EventRecord, "lifecycle">): number {
  return eventRevisionFromLifecycle(record.lifecycle);
}

export function isDeletedEventSpineRecord(record: Pick<EventRecord, "lifecycle">): boolean {
  return isDeletedEventLifecycle(record.lifecycle);
}

export function parseStoredEventSpineLifecycle(
  value: unknown,
  invalidCode: string,
  invalidMessage: string,
): EventLifecycle | undefined {
  const parsed = parseEventLifecycle(value);

  if (parsed.state === "missing") {
    return undefined;
  }

  if (parsed.state === "invalid") {
    throw new VaultError(invalidCode, invalidMessage);
  }

  return parsed.lifecycle;
}

export function compareEventSpineEntries<TRecord extends RevisionComparableRecord>(
  left: EventSpineEntry<TRecord>,
  right: EventSpineEntry<TRecord>,
): number {
  return compareEventRevisionPriority(
    {
      lifecycle: left.record.lifecycle,
      recordedAt: left.record.recordedAt,
      occurredAt: left.record.occurredAt,
      relativePath: left.relativePath,
    },
    {
      lifecycle: right.record.lifecycle,
      recordedAt: right.record.recordedAt,
      occurredAt: right.record.occurredAt,
      relativePath: right.relativePath,
    },
  );
}

export function selectLatestEventSpineEntry<TRecord extends RevisionComparableRecord>(
  entries: readonly EventSpineEntry<TRecord>[],
): EventSpineEntry<TRecord> | null {
  if (entries.length === 0) {
    return null;
  }

  return entries.reduce((latest, candidate) =>
    compareEventSpineEntries(latest, candidate) >= 0 ? latest : candidate,
  );
}

export function collapseEventSpineEntries<TRecord extends RevisionComparableRecord>(
  entries: readonly EventSpineEntry<TRecord>[],
): EventSpineEntry<TRecord>[] {
  return collapseEventRevisions(entries, (entry) => ({
    eventId: entry.record.id,
    lifecycle: entry.record.lifecycle,
    recordedAt: entry.record.recordedAt,
    occurredAt: entry.record.occurredAt,
    relativePath: entry.relativePath,
  }));
}

export function buildEventSpineEnvelope(
  input: BuildEventSpineEnvelopeInput,
): Omit<EventRecord, "kind"> {
  const attachments = input.attachments;
  const attachmentProjections = attachments
    ? buildAttachmentCompatibilityProjections(attachments)
    : null;
  const timeZone = normalizeTimeZone(input.timeZone);
  const effectiveTimeZone = timeZone ?? normalizeTimeZone(input.fallbackTimeZone) ?? defaultTimeZone();
  const normalizedDayKey = normalizeLocalDate(input.dayKey);
  if (input.strictDayKey && !normalizedDayKey) {
    throw new VaultError(
      input.invalidDayKeyCode ?? "EVENT_CONTRACT_INVALID",
      input.invalidDayKeyMessage ?? "Event dayKey must be a valid local date.",
    );
  }
  const dayKey = normalizedDayKey ?? toLocalDayKey(input.occurredAt, effectiveTimeZone, "occurredAt");
  const canonicalLinks = normalizeCanonicalEventLinks({
    value: input.links,
    errorCode: input.relationErrorCode ?? "EVENT_CONTRACT_INVALID",
    errorMessage:
      input.relationErrorMessage ??
      "Event payload links must contain objects with type and targetId fields.",
  });

  return compactObject({
    schemaVersion: input.schemaVersion ?? CONTRACT_SCHEMA_VERSION.event,
    id: input.id ?? generateRecordId(ID_PREFIXES.event),
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    dayKey,
    timeZone,
    source: normalizeOptionalText(input.source) ?? "manual",
    title: input.title,
    note: input.note,
    tags: input.tags,
    experimentSlug: input.experimentSlug,
    links: canonicalLinks,
    rawRefs: input.rawRefs ?? attachmentProjections?.rawRefs ?? undefined,
    evidence: input.evidence,
    attachments,
    lifecycle: input.lifecycle,
  }) as Omit<EventRecord, "kind">;
}
