import {
  assertContract,
  auditRecordSchema,
  eventRecordSchema,
  inboxCaptureRecordSchema,
  toLocalDayKey,
  type AuditRecord,
  type EventRecord,
  type InboxCaptureRecord as CanonicalInboxCaptureRecord,
} from "@murphai/contracts";
import {
  toMonthlyShardRelativePath,
  VAULT_LAYOUT,
} from "@murphai/core";

import type {
  InboundCapture,
  StoredCapture,
} from "../../contracts/capture.ts";
import {
  createInboxCaptureIdentityKey,
  normalizeStoredAttachments,
  sanitizeSegment,
} from "../../shared.ts";

export const INBOX_CAPTURE_LEDGER_DIRECTORY = "ledger/inbox-captures";

export function buildInboxCaptureRecord(input: {
  auditId: string;
  eventId: string;
  inbound: InboundCapture;
  stored: StoredCapture;
}): CanonicalInboxCaptureRecord {
  return assertContract<CanonicalInboxCaptureRecord>(inboxCaptureRecordSchema, {
    schemaVersion: "murph.inbox-capture.v1",
    captureId: input.stored.captureId,
    identityKey: createInboxCaptureIdentityKey(input.inbound),
    eventId: input.eventId,
    auditId: input.auditId,
    source: input.inbound.source,
    accountId: input.inbound.accountId ?? null,
    externalId: input.inbound.externalId,
    thread: {
      id: input.inbound.thread.id,
      title: input.inbound.thread.title ?? null,
      isDirect: input.inbound.thread.isDirect ?? null,
    },
    actor: {
      id: input.inbound.actor.id ?? null,
      displayName: input.inbound.actor.displayName ?? null,
      isSelf: input.inbound.actor.isSelf,
    },
    occurredAt: input.inbound.occurredAt,
    recordedAt: input.stored.storedAt,
    receivedAt: input.inbound.receivedAt ?? null,
    text: input.inbound.text ?? null,
    raw: input.inbound.raw,
    sourceDirectory: input.stored.sourceDirectory,
    envelopePath: input.stored.envelopePath,
    rawRefs: buildInboxCaptureRawRefs(input.stored),
    attachments: normalizeStoredAttachments(
      input.stored.captureId,
      input.stored.attachments,
      `canonical inbox capture ${input.stored.captureId}`,
    ).map((attachment) => ({
      attachmentId: attachment.attachmentId,
      ordinal: attachment.ordinal,
      externalId: attachment.externalId ?? null,
      kind: attachment.kind,
      mime: attachment.mime ?? null,
      originalPath: null,
      fileName: attachment.fileName ?? null,
      byteSize: attachment.byteSize ?? null,
      storedPath: attachment.storedPath ?? null,
      sha256: attachment.sha256 ?? null,
    })),
  }, "inbox capture record");
}

export function buildInboxCaptureEventRecord(input: {
  eventId: string;
  inbound: InboundCapture;
  stored: StoredCapture;
  timeZone?: string;
}): EventRecord {
  const timeZone = input.timeZone ?? "UTC";

  return assertContract<EventRecord>(eventRecordSchema, {
    schemaVersion: "murph.event.v1",
    id: input.eventId,
    occurredAt: input.inbound.occurredAt,
    recordedAt: input.stored.storedAt,
    dayKey: toLocalDayKey(input.inbound.occurredAt, timeZone),
    timeZone,
    source: "import",
    kind: "note",
    title: `Inbox capture from ${input.inbound.source}`,
    note: buildEventNote(input.inbound),
    tags: ["inbox", `source-${sanitizeSegment(input.inbound.source, "source")}`],
    rawRefs: buildInboxCaptureRawRefs(input.stored),
  }, "inbox capture event");
}

export function buildInboxCaptureAuditRecord(input: {
  auditId: string;
  eventId: string;
  inbound: InboundCapture;
  stored: StoredCapture;
  capturePath?: string;
  eventPath: string;
}): AuditRecord {
  const relativePath = buildInboxCaptureAuditPathForStoredAt(input.stored.storedAt);
  const captureChange = input.capturePath ? [{ path: input.capturePath, op: "append" as const }] : [];

  return assertContract<AuditRecord>(auditRecordSchema, {
    schemaVersion: "murph.audit.v1",
    id: input.auditId,
    action: "intake_import",
    status: "success",
    occurredAt: input.stored.storedAt,
    actor: "importer",
    commandName: `inboxd.processCapture:${sanitizeSegment(input.inbound.source, "source")}`,
    summary: `Imported inbox capture from ${input.inbound.source}.`,
    targetIds: [input.eventId],
    changes: [
      { path: input.stored.envelopePath, op: "create" },
      ...input.stored.attachments
        .map((attachment) => attachment.storedPath)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .map((storedPath) => ({ path: storedPath, op: "copy" as const })),
      ...captureChange,
      { path: input.eventPath, op: "append" },
      { path: relativePath, op: "append" },
    ],
  }, "inbox capture audit");
}

export function buildInboxCaptureLedgerPathForOccurredAt(occurredAt: string): string {
  return toMonthlyShardRelativePath(
    INBOX_CAPTURE_LEDGER_DIRECTORY,
    occurredAt,
    "occurredAt",
  );
}

export function buildInboxCaptureLedgerPath(input: {
  input: InboundCapture;
}): string {
  return buildInboxCaptureLedgerPathForOccurredAt(input.input.occurredAt);
}

export function buildInboxCaptureEventPathForOccurredAt(occurredAt: string): string {
  return toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    occurredAt,
    "occurredAt",
  );
}

export function buildInboxCaptureEventPath(input: {
  input: InboundCapture;
}): string {
  return buildInboxCaptureEventPathForOccurredAt(input.input.occurredAt);
}

export function buildInboxCaptureAuditPathForStoredAt(storedAt: string): string {
  return toMonthlyShardRelativePath(
    VAULT_LAYOUT.auditDirectory,
    storedAt,
    "occurredAt",
  );
}

export function buildInboxCaptureAuditPath(input: {
  stored: StoredCapture;
}): string {
  return buildInboxCaptureAuditPathForStoredAt(input.stored.storedAt);
}

function buildEventNote(capture: InboundCapture): string {
  const text = capture.text?.trim();
  if (text) {
    return text.length > 4000 ? `${text.slice(0, 3997)}...` : text;
  }

  const attachmentCount = capture.attachments.length;
  if (attachmentCount > 0) {
    return `Attachment-only inbox capture from ${capture.source} (${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}).`;
  }

  return `Inbox capture from ${capture.source}.`;
}

function buildInboxCaptureRawRefs(stored: StoredCapture): string[] {
  return [
    stored.envelopePath,
    ...stored.attachments
      .map((attachment) => attachment.storedPath)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  ];
}
