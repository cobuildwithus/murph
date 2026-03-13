import path from "node:path";
import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import type { InboxCaptureRecord, InboxListFilters, InboxSearchFilters, InboxSearchHit } from "../contracts/search.js";
import type { InboundCapture, PersistedCapture, StoredAttachment, StoredCapture } from "../contracts/capture.js";
import { buildFtsQuery, buildSnippet, normalizeAccountKey, redactSensitivePaths } from "../shared.js";

export interface InboxRuntimeStore {
  readonly databasePath: string;
  close(): void;
  getCursor(source: string, accountId?: string | null): Record<string, unknown> | null;
  setCursor(source: string, accountId: string | null | undefined, cursor: Record<string, unknown> | null): void;
  findByExternalId(
    source: string,
    accountId: string | null | undefined,
    externalId: string,
  ): PersistedCapture | null;
  upsertCaptureIndex(input: {
    captureId: string;
    eventId: string;
    input: InboundCapture;
    stored: StoredCapture;
  }): void;
  enqueueDerivedJobs(input: { captureId: string; stored: StoredCapture }): void;
  listCaptures(filters?: InboxListFilters): InboxCaptureRecord[];
  searchCaptures(filters: InboxSearchFilters): InboxSearchHit[];
  getCapture(captureId: string): InboxCaptureRecord | null;
}

export interface OpenInboxRuntimeInput {
  vaultRoot: string;
}

export async function openInboxRuntime({
  vaultRoot,
}: OpenInboxRuntimeInput): Promise<InboxRuntimeStore> {
  const runtimeDirectory = path.join(path.resolve(vaultRoot), ".runtime");
  await mkdir(runtimeDirectory, { recursive: true });

  const databasePath = path.join(runtimeDirectory, "inboxd.sqlite");
  const database = new DatabaseSync(databasePath);

  database.exec(`
    pragma journal_mode = WAL;
    pragma foreign_keys = ON;

    create table if not exists source_cursor (
      source text not null,
      account_id text not null default '',
      cursor_json text not null,
      updated_at text not null,
      primary key (source, account_id)
    );

    create table if not exists capture (
      capture_id text primary key,
      source text not null,
      account_id text not null default '',
      external_id text not null,
      thread_id text not null,
      thread_title text,
      thread_is_direct integer not null,
      actor_id text,
      actor_name text,
      actor_is_self integer not null,
      occurred_at text not null,
      received_at text,
      text_content text,
      raw_json text not null,
      vault_event_id text not null,
      envelope_path text not null,
      created_at text not null,
      unique (source, account_id, external_id)
    );

    create index if not exists capture_occurred_at_idx on capture (occurred_at desc, capture_id desc);
    create index if not exists capture_source_idx on capture (source, account_id, occurred_at desc);

    create table if not exists capture_attachment (
      id integer primary key autoincrement,
      capture_id text not null references capture(capture_id) on delete cascade,
      ordinal integer not null,
      external_id text,
      kind text not null,
      mime text,
      original_path text,
      stored_path text,
      file_name text,
      sha256 text,
      size_bytes integer,
      extracted_text text,
      transcript_text text,
      created_at text not null
    );

    create unique index if not exists capture_attachment_ordinal_idx on capture_attachment (capture_id, ordinal);

    create table if not exists derived_job (
      id integer primary key autoincrement,
      capture_id text not null references capture(capture_id) on delete cascade,
      kind text not null,
      state text not null,
      attempts integer not null default 0,
      created_at text not null,
      unique (capture_id, kind)
    );

    create virtual table if not exists capture_fts using fts5(
      capture_id unindexed,
      source unindexed,
      thread_id unindexed,
      text_content,
      attachment_text,
      tags
    );
  `);

  return createInboxRuntimeStore(database, databasePath);
}

function createInboxRuntimeStore(database: DatabaseSync, databasePath: string): InboxRuntimeStore {
  return {
    databasePath,
    close() {
      database.close();
    },
    getCursor(source, accountId = null) {
      const row = database
        .prepare(
          `
            select cursor_json
            from source_cursor
            where source = ? and account_id = ?
          `,
        )
        .get(source, normalizeAccountKey(accountId)) as { cursor_json?: string } | undefined;

      if (!row?.cursor_json) {
        return null;
      }

      return JSON.parse(row.cursor_json) as Record<string, unknown>;
    },
    setCursor(source, accountId = null, cursor) {
      const normalizedAccountId = normalizeAccountKey(accountId);

      if (cursor === null) {
        database
          .prepare("delete from source_cursor where source = ? and account_id = ?")
          .run(source, normalizedAccountId);
        return;
      }

      database
        .prepare(
          `
            insert into source_cursor (source, account_id, cursor_json, updated_at)
            values (?, ?, ?, ?)
            on conflict (source, account_id) do update set
              cursor_json = excluded.cursor_json,
              updated_at = excluded.updated_at
          `,
        )
        .run(
          source,
          normalizedAccountId,
          JSON.stringify(cursor),
          new Date().toISOString(),
        );
    },
    findByExternalId(source, accountId = null, externalId) {
      const row = database
        .prepare(
          `
            select
              capture_id,
              vault_event_id,
              envelope_path,
              created_at
            from capture
            where source = ? and account_id = ? and external_id = ?
          `,
        )
        .get(source, normalizeAccountKey(accountId), externalId) as
        | {
            capture_id: string;
            vault_event_id: string;
            envelope_path: string;
            created_at: string;
          }
        | undefined;

      if (!row) {
        return null;
      }

      return {
        captureId: row.capture_id,
        eventId: row.vault_event_id,
        envelopePath: row.envelope_path,
        createdAt: row.created_at,
        deduped: true,
      };
    },
    upsertCaptureIndex({ captureId, eventId, input, stored }) {
      withTransaction(database, () => {
        database
          .prepare(
            `
              insert into capture (
                capture_id,
                source,
                account_id,
                external_id,
                thread_id,
                thread_title,
                thread_is_direct,
                actor_id,
                actor_name,
                actor_is_self,
                occurred_at,
                received_at,
                text_content,
                raw_json,
                vault_event_id,
                envelope_path,
                created_at
              ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              on conflict (capture_id) do update set
                source = excluded.source,
                account_id = excluded.account_id,
                external_id = excluded.external_id,
                thread_id = excluded.thread_id,
                thread_title = excluded.thread_title,
                thread_is_direct = excluded.thread_is_direct,
                actor_id = excluded.actor_id,
                actor_name = excluded.actor_name,
                actor_is_self = excluded.actor_is_self,
                occurred_at = excluded.occurred_at,
                received_at = excluded.received_at,
                text_content = excluded.text_content,
                raw_json = excluded.raw_json,
                vault_event_id = excluded.vault_event_id,
                envelope_path = excluded.envelope_path,
                created_at = excluded.created_at
            `,
          )
          .run(
            captureId,
            input.source,
            normalizeAccountKey(input.accountId),
            input.externalId,
            input.thread.id,
            normalizeNullable(input.thread.title),
            input.thread.isDirect ? 1 : 0,
            normalizeNullable(input.actor.id),
            normalizeNullable(input.actor.displayName),
            input.actor.isSelf ? 1 : 0,
            input.occurredAt,
            normalizeNullable(input.receivedAt),
            normalizeNullable(input.text),
            JSON.stringify(redactSensitivePaths(input.raw)),
            eventId,
            stored.envelopePath,
            stored.storedAt,
          );

        database.prepare("delete from capture_attachment where capture_id = ?").run(captureId);

        const insertAttachment = database.prepare(
          `
            insert into capture_attachment (
              capture_id,
              ordinal,
              external_id,
              kind,
              mime,
              original_path,
              stored_path,
              file_name,
              sha256,
              size_bytes,
              extracted_text,
              transcript_text,
              created_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        );

        for (const attachment of stored.attachments) {
          insertAttachment.run(
            captureId,
            attachment.ordinal,
            normalizeNullable(attachment.externalId),
            attachment.kind,
            normalizeNullable(attachment.mime),
            null,
            normalizeNullable(attachment.storedPath),
            normalizeNullable(attachment.fileName),
            normalizeNullable(attachment.sha256),
            attachment.byteSize ?? null,
            null,
            null,
            stored.storedAt,
          );
        }

        const attachmentText = stored.attachments
          .map((attachment) => joinTextValues(attachment.fileName, attachment.mime))
          .join(" ")
          .trim();

        database.prepare("delete from capture_fts where capture_id = ?").run(captureId);
        database
          .prepare(
            `
              insert into capture_fts (
                capture_id,
                source,
                thread_id,
                text_content,
                attachment_text,
                tags
              ) values (?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            captureId,
            input.source,
            input.thread.id,
            normalizeNullable(input.text),
            normalizeNullable(attachmentText),
            `inbox source-${input.source}`,
          );
      });
    },
    enqueueDerivedJobs({ captureId, stored }) {
      if (stored.attachments.length === 0) {
        return;
      }

      database
        .prepare(
          `
            insert into derived_job (capture_id, kind, state, created_at)
            values (?, ?, ?, ?)
            on conflict (capture_id, kind) do nothing
          `,
        )
        .run(captureId, "attachment_text", "pending", stored.storedAt);
    },
    listCaptures(filters = {}) {
      const normalizedFilters = normalizeCaptureFilters(filters);
      const rows = database
        .prepare(
          `
            select *
            from capture
            where (? is null or source = ?)
              and (? is null or account_id = ?)
            order by occurred_at desc, capture_id desc
            limit ?
          `,
        )
        .all(
          normalizedFilters.source,
          normalizedFilters.source,
          normalizedFilters.accountId,
          normalizedFilters.accountId,
          normalizedFilters.limit,
        );

      return hydrateCaptureRows(database, decodeCaptureRows(rows));
    },
    searchCaptures(filters) {
      const query = buildFtsQuery(filters.text);
      if (!query) {
        return this.listCaptures(filters).map(createSearchHitFromCapture);
      }

      const normalizedFilters = normalizeCaptureFilters(filters);
      const rows = database
        .prepare(
          `
            select
              capture.capture_id,
              capture.source,
              capture.account_id,
              capture.thread_id,
              capture.thread_title,
              capture.occurred_at,
              capture.text_content,
              capture.envelope_path,
              capture_fts.text_content as indexed_text,
              capture_fts.attachment_text as indexed_attachment_text,
              -bm25(capture_fts, 6.0, 2.0, 0.25) as score
            from capture_fts
            join capture on capture.capture_id = capture_fts.capture_id
            where capture_fts match ?
              and (? is null or capture.source = ?)
              and (? is null or capture.account_id = ?)
            order by bm25(capture_fts, 6.0, 2.0, 0.25), capture.occurred_at desc
            limit ?
          `,
        )
        .all(
          query,
          normalizedFilters.source,
          normalizedFilters.source,
          normalizedFilters.accountId,
          normalizedFilters.accountId,
          normalizedFilters.limit,
        ) as unknown as SearchRow[];

      return rows.map(createSearchHitFromRow);
    },
    getCapture(captureId) {
      const row = database
        .prepare("select * from capture where capture_id = ?")
        .get(captureId) as Record<string, unknown> | undefined;

      if (!row) {
        return null;
      }

      return hydrateCaptureRows(database, [decodeCaptureRow(row)])[0] ?? null;
    },
  };
}

interface CaptureRow {
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

function decodeCaptureRows(rows: ReadonlyArray<Record<string, unknown>>): CaptureRow[] {
  return rows.map(decodeCaptureRow);
}

function hydrateCaptureRows(database: DatabaseSync, rows: CaptureRow[]): InboxCaptureRecord[] {
  if (rows.length === 0) {
    return [];
  }

  const attachmentsByCapture = hydrateCaptureAttachments(
    loadAttachmentRows(database, rows.map((row) => row.capture_id)),
  );
  return rows.map((row) => hydrateCaptureRow(row, attachmentsByCapture));
}

function withTransaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("begin immediate transaction");

  try {
    const result = operation();
    database.exec("commit");
    return result;
  } catch (error) {
    database.exec("rollback");
    throw error;
  }
}

function normalizeNullable<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
    return fallback;
  }

  return Math.min(limit, 200);
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

interface AttachmentRow {
  capture_id: string;
  ordinal: number;
  external_id: string | null;
  kind: StoredAttachment["kind"];
  mime: string | null;
  original_path: string | null;
  stored_path: string | null;
  file_name: string | null;
  size_bytes: number | null;
  sha256: string | null;
}

interface SearchRow {
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

function decodeCaptureRow(row: Record<string, unknown>): CaptureRow {
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

function loadAttachmentRows(database: DatabaseSync, captureIds: string[]): AttachmentRow[] {
  return database
    .prepare(
      `
        select *
        from capture_attachment
        where capture_id in (${captureIds.map(() => "?").join(", ")})
        order by capture_id asc, ordinal asc
      `,
    )
    .all(...captureIds) as unknown as AttachmentRow[];
}

function hydrateCaptureAttachments(
  rows: AttachmentRow[],
): Map<string, StoredAttachment[]> {
  const attachmentsByCapture = new Map<string, StoredAttachment[]>();

  for (const row of rows) {
    const attachments = attachmentsByCapture.get(row.capture_id) ?? [];
    attachments.push({
      ordinal: row.ordinal,
      externalId: row.external_id,
      kind: row.kind,
      mime: row.mime,
      originalPath: row.original_path,
      storedPath: row.stored_path,
      fileName: row.file_name,
      byteSize: row.size_bytes,
      sha256: row.sha256,
    });
    attachmentsByCapture.set(row.capture_id, attachments);
  }

  return attachmentsByCapture;
}

function hydrateCaptureRow(
  row: CaptureRow,
  attachmentsByCapture: ReadonlyMap<string, StoredAttachment[]>,
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

function normalizeCaptureFilters(
  filters: InboxListFilters,
  fallbackLimit = 50,
): { source: string | null; accountId: string | null; limit: number } {
  return {
    source: normalizeNullable(filters.source),
    accountId: normalizeNullable(filters.accountId),
    limit: normalizeLimit(filters.limit, fallbackLimit),
  };
}

function createSearchHitFromCapture(capture: InboxCaptureRecord): InboxSearchHit {
  return {
    captureId: capture.captureId,
    source: capture.source,
    accountId: capture.accountId ?? null,
    threadId: capture.thread.id,
    threadTitle: capture.thread.title ?? null,
    occurredAt: capture.occurredAt,
    text: capture.text,
    snippet: buildSnippet(capture.text, joinTextValues(...capture.attachments.map((item) => item.fileName))),
    score: 0,
    envelopePath: capture.envelopePath,
  };
}

function createSearchHitFromRow(row: SearchRow): InboxSearchHit {
  return {
    captureId: row.capture_id,
    source: row.source,
    accountId: row.account_id || null,
    threadId: row.thread_id,
    threadTitle: row.thread_title,
    occurredAt: row.occurred_at,
    text: row.text_content,
    snippet: buildSnippet(row.indexed_text, row.indexed_attachment_text, row.text_content),
    score: Number(row.score.toFixed(6)),
    envelopePath: row.envelope_path,
  };
}

function joinTextValues(...values: Array<string | null | undefined>): string {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");
}
