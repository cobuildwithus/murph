import type { DatabaseSync } from "node:sqlite";

import type { AttachmentParseJobRecord } from "../../contracts/derived.ts";
import type { InboxCaptureRecord } from "../../contracts/search.ts";
import type { IndexedAttachment, StoredAttachment } from "../../contracts/capture.ts";

export interface CaptureRow {
  capture_id: string;
  source: string;
  account_id: string | null;
  external_id: string;
  thread_id: string;
  thread_title: string | null;
  thread_is_direct: number;
  actor_id: string | null;
  actor_name: string | null;
  actor_is_self: number;
  occurred_at: string;
  received_at: string | null;
  text_content: string | null;
  raw_json: string;
  vault_event_id: string;
  envelope_path: string;
  created_at: string;
}

export interface AttachmentRow {
  capture_id: string;
  attachment_id: string;
  ordinal: number;
  external_id: string | null;
  kind: StoredAttachment["kind"];
  mime: string | null;
  original_path: string | null;
  stored_path: string | null;
  file_name: string | null;
  size_bytes: number | null;
  sha256: string | null;
  extracted_text: string | null;
  transcript_text: string | null;
  derived_path: string | null;
  parser_provider_id: string | null;
  parser_state: string | null;
}

export interface SearchRow {
  capture_id: string;
  source: string;
  account_id: string | null;
  thread_id: string;
  thread_title: string | null;
  occurred_at: string;
  text_content: string | null;
  envelope_path: string;
  indexed_text: string | null;
  indexed_attachment_text: string | null;
  score: number;
}

export function decodeCaptureRows(rows: ReadonlyArray<Record<string, unknown>>): CaptureRow[] {
  return rows.map(decodeCaptureRow);
}

export function decodeCaptureRow(row: Record<string, unknown>): CaptureRow {
  return {
    capture_id: expectString(row.capture_id, "capture.capture_id"),
    source: expectString(row.source, "capture.source"),
    account_id: expectNullableString(row.account_id, "capture.account_id"),
    external_id: expectString(row.external_id, "capture.external_id"),
    thread_id: expectString(row.thread_id, "capture.thread_id"),
    thread_title: expectNullableString(row.thread_title, "capture.thread_title"),
    thread_is_direct: expectNumber(row.thread_is_direct, "capture.thread_is_direct"),
    actor_id: expectNullableString(row.actor_id, "capture.actor_id"),
    actor_name: expectNullableString(row.actor_name, "capture.actor_name"),
    actor_is_self: expectNumber(row.actor_is_self, "capture.actor_is_self"),
    occurred_at: expectString(row.occurred_at, "capture.occurred_at"),
    received_at: expectNullableString(row.received_at, "capture.received_at"),
    text_content: expectNullableString(row.text_content, "capture.text_content"),
    raw_json: expectString(row.raw_json, "capture.raw_json"),
    vault_event_id: expectString(row.vault_event_id, "capture.vault_event_id"),
    envelope_path: expectString(row.envelope_path, "capture.envelope_path"),
    created_at: expectString(row.created_at, "capture.created_at"),
  };
}

export function decodeAttachmentRows(rows: ReadonlyArray<Record<string, unknown>>): AttachmentRow[] {
  return rows.map(decodeAttachmentRow);
}

export function decodeAttachmentRow(row: Record<string, unknown>): AttachmentRow {
  return {
    capture_id: expectString(row.capture_id, "capture_attachment.capture_id"),
    attachment_id: expectString(row.attachment_id, "capture_attachment.attachment_id"),
    ordinal: expectNumber(row.ordinal, "capture_attachment.ordinal"),
    external_id: expectNullableString(row.external_id, "capture_attachment.external_id"),
    kind: expectString(row.kind, "capture_attachment.kind") as StoredAttachment["kind"],
    mime: expectNullableString(row.mime, "capture_attachment.mime"),
    original_path: expectNullableString(row.original_path, "capture_attachment.original_path"),
    stored_path: expectNullableString(row.stored_path, "capture_attachment.stored_path"),
    file_name: expectNullableString(row.file_name, "capture_attachment.file_name"),
    size_bytes: expectNullableNumber(row.size_bytes, "capture_attachment.size_bytes"),
    sha256: expectNullableString(row.sha256, "capture_attachment.sha256"),
    extracted_text: expectNullableString(row.extracted_text, "capture_attachment.extracted_text"),
    transcript_text: expectNullableString(row.transcript_text, "capture_attachment.transcript_text"),
    derived_path: expectNullableString(row.derived_path, "capture_attachment.derived_path"),
    parser_provider_id: expectNullableString(row.parser_provider_id, "capture_attachment.parser_provider_id"),
    parser_state: expectNullableString(row.parser_state, "capture_attachment.parser_state"),
  };
}

export function decodeAttachmentParseJobRows(
  rows: ReadonlyArray<Record<string, unknown>>,
): AttachmentParseJobRecord[] {
  return rows.map(decodeAttachmentParseJobRow);
}

export function decodeAttachmentParseJobRow(row: Record<string, unknown>): AttachmentParseJobRecord {
  return {
    jobId: expectString(row.job_id, "attachment_parse_job.job_id"),
    captureId: expectString(row.capture_id, "attachment_parse_job.capture_id"),
    attachmentId: expectString(row.attachment_id, "attachment_parse_job.attachment_id"),
    pipeline: expectString(row.pipeline, "attachment_parse_job.pipeline") as AttachmentParseJobRecord["pipeline"],
    state: expectString(row.state, "attachment_parse_job.state") as AttachmentParseJobRecord["state"],
    attempts: expectNumber(row.attempts, "attachment_parse_job.attempts"),
    providerId: expectNullableString(row.provider_id, "attachment_parse_job.provider_id"),
    resultPath: expectNullableString(row.result_path, "attachment_parse_job.result_path"),
    errorCode: expectNullableString(row.error_code, "attachment_parse_job.error_code"),
    errorMessage: expectNullableString(row.error_message, "attachment_parse_job.error_message"),
    createdAt: expectString(row.created_at, "attachment_parse_job.created_at"),
    startedAt: expectNullableString(row.started_at, "attachment_parse_job.started_at"),
    finishedAt: expectNullableString(row.finished_at, "attachment_parse_job.finished_at"),
  };
}

export function decodeSearchRows(rows: ReadonlyArray<Record<string, unknown>>): SearchRow[] {
  return rows.map(decodeSearchRow);
}

export function decodeSearchRow(row: Record<string, unknown>): SearchRow {
  return {
    capture_id: expectString(row.capture_id, "capture_search.capture_id"),
    source: expectString(row.source, "capture_search.source"),
    account_id: expectNullableString(row.account_id, "capture_search.account_id"),
    thread_id: expectString(row.thread_id, "capture_search.thread_id"),
    thread_title: expectNullableString(row.thread_title, "capture_search.thread_title"),
    occurred_at: expectString(row.occurred_at, "capture_search.occurred_at"),
    text_content: expectNullableString(row.text_content, "capture_search.text_content"),
    envelope_path: expectString(row.envelope_path, "capture_search.envelope_path"),
    indexed_text: expectNullableString(row.indexed_text, "capture_search.indexed_text"),
    indexed_attachment_text: expectNullableString(
      row.indexed_attachment_text,
      "capture_search.indexed_attachment_text",
    ),
    score: expectNumber(row.score, "capture_search.score"),
  };
}

export function hydrateCaptureRows(database: DatabaseSync, rows: CaptureRow[]): InboxCaptureRecord[] {
  if (rows.length === 0) {
    return [];
  }

  const attachmentsByCapture = hydrateCaptureAttachments(
    loadAttachmentRows(database, rows.map((row) => row.capture_id)),
  );
  return rows.map((row) => hydrateCaptureRow(row, attachmentsByCapture));
}

export function loadAttachmentRows(database: DatabaseSync, captureIds: string[]): AttachmentRow[] {
  if (captureIds.length === 0) {
    return [];
  }

  const rows = database
    .prepare(
      `
        select *
        from capture_attachment
        where capture_id in (${captureIds.map(() => "?").join(", ")})
        order by capture_id asc, ordinal asc
      `,
    )
    .all(...captureIds);

  return decodeAttachmentRows(rows);
}

export function hydrateCaptureAttachments(rows: AttachmentRow[]): Map<string, IndexedAttachment[]> {
  const attachmentsByCapture = new Map<string, IndexedAttachment[]>();

  for (const row of rows) {
    const attachments = attachmentsByCapture.get(row.capture_id) ?? [];
    attachments.push({
      attachmentId: row.attachment_id,
      ordinal: row.ordinal,
      externalId: row.external_id,
      kind: row.kind,
      mime: row.mime,
      originalPath: row.original_path,
      storedPath: row.stored_path,
      fileName: row.file_name,
      byteSize: row.size_bytes,
      sha256: row.sha256,
      extractedText: row.extracted_text,
      transcriptText: row.transcript_text,
      derivedPath: row.derived_path,
      parserProviderId: row.parser_provider_id,
      parseState: row.parser_state,
    });
    attachmentsByCapture.set(row.capture_id, attachments);
  }

  return attachmentsByCapture;
}

export function hydrateCaptureRow(
  row: CaptureRow,
  attachmentsByCapture: ReadonlyMap<string, IndexedAttachment[]>,
): InboxCaptureRecord {
  return {
    captureId: row.capture_id,
    eventId: row.vault_event_id,
    source: row.source,
    externalId: row.external_id,
    accountId: row.account_id || null,
    thread: {
      id: row.thread_id,
      title: row.thread_title,
      isDirect: row.thread_is_direct === 1,
    },
    actor: {
      id: row.actor_id,
      displayName: row.actor_name,
      isSelf: row.actor_is_self === 1,
    },
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    text: row.text_content,
    attachments: attachmentsByCapture.get(row.capture_id) ?? [],
    raw: JSON.parse(row.raw_json) as Record<string, unknown>,
    envelopePath: row.envelope_path,
    createdAt: row.created_at,
  };
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${label} to be a string.`);
  }

  return value;
}

function expectNullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  return expectString(value, label);
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new TypeError(`Expected ${label} to be a number.`);
  }

  return value;
}

function expectNullableNumber(value: unknown, label: string): number | null {
  if (value === null) {
    return null;
  }

  return expectNumber(value, label);
}
