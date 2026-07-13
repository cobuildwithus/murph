import { createHash } from "node:crypto";
import path from "node:path";

import {
  assertContract,
  INBOX_CAPTURE_TEXT_MAX_BYTES,
  INBOX_CAPTURE_TEXT_MAX_LENGTH,
  inboxCaptureRecordSchema,
  type InboxCaptureRecord as CanonicalInboxCaptureRecord,
} from "@murphai/contracts";
import {
  type CanonicalRawContentInput,
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

export const INBOX_CAPTURE_LEDGER_DIRECTORY = VAULT_LAYOUT.inboxCaptureLedgerDirectory;

export function prepareInboxCaptureRecord(input: {
  auditId?: string;
  eventId: string;
  inbound: InboundCapture;
  preserveFullTextAtProjectionBoundary?: boolean;
  stored: StoredCapture;
}): {
  rawContents: CanonicalRawContentInput[];
  record: CanonicalInboxCaptureRecord;
} {
  const preparedText = prepareInboxCaptureText({
    preserveFullTextAtProjectionBoundary: input.preserveFullTextAtProjectionBoundary,
    sourceDirectory: input.stored.sourceDirectory,
    text: input.inbound.text,
  });
  const record = assertContract<CanonicalInboxCaptureRecord>(inboxCaptureRecordSchema, {
    schemaVersion: "murph.inbox-capture.v2",
    ...buildInboxCaptureRecordFields(input),
    text: preparedText.text,
    ...(preparedText.textContent ? { textContent: preparedText.textContent } : {}),
    rawRefs: buildInboxCaptureRawRefs(input.stored),
  }, "inbox capture record");
  return {
    rawContents: preparedText.rawContent ? [preparedText.rawContent] : [],
    record,
  };
}

export function buildLegacyInboxCaptureRecord(input: {
  auditId?: string;
  envelopePath: string;
  eventId: string;
  inbound: InboundCapture;
  stored: StoredCapture;
}): CanonicalInboxCaptureRecord {
  return assertContract<CanonicalInboxCaptureRecord>(inboxCaptureRecordSchema, {
    schemaVersion: "murph.inbox-capture.v1",
    ...buildInboxCaptureRecordFields(input),
    text: toLegacyInboxCaptureRecordText(input.inbound.text),
    envelopePath: input.envelopePath,
    rawRefs: [input.envelopePath, ...buildInboxCaptureRawRefs(input.stored)],
  }, "legacy inbox capture record");
}

function buildInboxCaptureRecordFields(input: {
  auditId?: string;
  eventId: string;
  inbound: InboundCapture;
  stored: StoredCapture;
}) {
  return {
    captureId: input.stored.captureId,
    identityKey: createInboxCaptureIdentityKey(input.inbound),
    eventId: input.eventId,
    ...(input.auditId ? { auditId: input.auditId } : {}),
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
    raw: input.inbound.raw,
    sourceDirectory: input.stored.sourceDirectory,
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
  };
}

function toLegacyInboxCaptureRecordText(text: string | null | undefined): string | null {
  if (text === null || text === undefined) {
    return null;
  }

  return text.length > INBOX_CAPTURE_TEXT_MAX_LENGTH
    ? text.slice(0, INBOX_CAPTURE_TEXT_MAX_LENGTH)
    : text;
}

function prepareInboxCaptureText(input: {
  preserveFullTextAtProjectionBoundary?: boolean;
  sourceDirectory: string;
  text: string | null | undefined;
}): {
  rawContent: CanonicalRawContentInput | null;
  text: string | null;
  textContent: {
    byteSize: number;
    sha256: string;
    storedPath: string;
  } | null;
} {
  if (input.text === null || input.text === undefined) {
    return { rawContent: null, text: null, textContent: null };
  }

  const textBytes = Buffer.byteLength(input.text, "utf8");
  if (textBytes > INBOX_CAPTURE_TEXT_MAX_BYTES) {
    throw new RangeError(`Inbox capture text exceeded ${INBOX_CAPTURE_TEXT_MAX_BYTES} bytes.`);
  }

  const text = input.text.slice(0, INBOX_CAPTURE_TEXT_MAX_LENGTH);
  if (
    input.text.length < INBOX_CAPTURE_TEXT_MAX_LENGTH
    || (
      input.text.length === INBOX_CAPTURE_TEXT_MAX_LENGTH
      && input.preserveFullTextAtProjectionBoundary !== true
    )
  ) {
    return { rawContent: null, text, textContent: null };
  }

  const content = Buffer.from(input.text, "utf8");
  const storedPath = path.posix.join(input.sourceDirectory, "text.txt");
  const textContent = {
    byteSize: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
    storedPath,
  };
  return {
    rawContent: {
      allowExistingMatch: true,
      content,
      mediaType: "text/plain; charset=utf-8",
      originalFileName: "text.txt",
      targetRelativePath: storedPath,
    },
    text,
    textContent,
  };
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

function buildInboxCaptureRawRefs(stored: StoredCapture): string[] {
  return stored.attachments
    .map((attachment) => attachment.storedPath)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}
