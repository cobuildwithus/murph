import type { DatabaseSync } from "node:sqlite";
import {
  applySqliteRuntimeMigrations,
  openSqliteRuntimeDatabase,
  resolveRuntimePaths,
  withImmediateTransaction as withTransaction,
} from "@murphai/runtime-state/node";
import type { ParserRuntimeStore } from "@murphai/parsers";

import type {
  AttachmentParseJobClaimFilters,
  AttachmentParseJobFinalizeResult,
  AttachmentParseJobFilters,
  AttachmentParseJobRecord,
  CompleteAttachmentParseJobInput,
  FailAttachmentParseJobInput,
  RequeueAttachmentParseJobsInput,
} from "../contracts/derived.ts";
import type { InboxCaptureRecord, InboxListFilters, InboxSearchFilters, InboxSearchHit } from "../contracts/search.ts";
import type {
  InboundCapture,
  PersistedCapture,
  StoredCapture,
} from "../contracts/capture.ts";
import {
  buildFtsQuery,
  buildSnippet,
  normalizeAccountKey,
  normalizeStoredAttachments,
  sanitizeRawMetadata,
} from "../shared.ts";
import {
  decodeCaptureRow,
  decodeCaptureRows,
  decodeSearchRows,
  hydrateCaptureRows,
} from "./sqlite/rows.ts";
import type { SearchRow } from "./sqlite/rows.ts";
import { createAttachmentParseJobStore } from "./sqlite/parse-jobs.ts";

const INBOX_RUNTIME_SQLITE_SCHEMA_VERSION = 1;
const SQLITE_WAL_COMPANION_SUFFIXES = ["-shm", "-wal"] as const;

export interface InboxCaptureMutationRecord {
  captureId: string;
  cursor: number;
}

export interface InboxRuntimeStore extends ParserRuntimeStore {
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
  }): string;
  enqueueDerivedJobs(input: { captureId: string; stored: StoredCapture }): void;
  listAttachmentParseJobs(filters?: AttachmentParseJobFilters): AttachmentParseJobRecord[];
  claimNextAttachmentParseJob(
    filters?: AttachmentParseJobClaimFilters,
  ): AttachmentParseJobRecord | null;
  requeueAttachmentParseJobs(filters?: RequeueAttachmentParseJobsInput): number;
  completeAttachmentParseJob(
    input: CompleteAttachmentParseJobInput,
  ): AttachmentParseJobFinalizeResult;
  failAttachmentParseJob(
    input: FailAttachmentParseJobInput,
  ): AttachmentParseJobFinalizeResult;
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
  const database = openInboxRuntimeDatabase(vaultRoot);
  return createInboxRuntimeStore(database, resolveRuntimePaths(vaultRoot).inboxDbPath);
}


function openInboxRuntimeDatabase(vaultRoot: string): DatabaseSync {
  const runtimePaths = resolveRuntimePaths(vaultRoot);
  const database = openSqliteRuntimeDatabase(runtimePaths.inboxDbPath);
  applySqliteRuntimeMigrations(database, {
    migrations: [{
      version: INBOX_RUNTIME_SQLITE_SCHEMA_VERSION,
      migrate(candidateDatabase) {
        ensureInboxRuntimeSchema(candidateDatabase);
      },
    }],
    schemaVersion: INBOX_RUNTIME_SQLITE_SCHEMA_VERSION,
    storeName: 'inbox runtime',
  });

  return database;
}

function ensureInboxRuntimeSchema(database: DatabaseSync): void {
  database.exec(`
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
      mutation_cursor integer not null default 0,
      unique (source, account_id, external_id)
    );

    create index if not exists capture_occurred_at_idx on capture (occurred_at desc, capture_id desc);
    create index if not exists capture_source_idx on capture (source, account_id, occurred_at desc);
    create table if not exists capture_mutation_counter (
      singleton integer primary key check (singleton = 1),
      next_cursor integer not null
    );

    create table if not exists capture_attachment (
      id integer primary key autoincrement,
      capture_id text not null references capture(capture_id) on delete cascade,
      attachment_id text not null,
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
      derived_path text,
      parser_provider_id text,
      parser_state text,
      parse_updated_at text,
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

  database.exec(`
    insert into capture_mutation_counter (singleton, next_cursor)
    values (1, 0)
    on conflict (singleton) do nothing;

    create unique index if not exists capture_attachment_attachment_id_idx
    on capture_attachment (attachment_id);

    create index if not exists capture_mutation_cursor_idx
    on capture (mutation_cursor asc, capture_id asc);

    create trigger if not exists capture_mutation_on_insert
    after insert on capture
    begin
      update capture_mutation_counter
         set next_cursor = next_cursor + 1
       where singleton = 1;
      update capture
         set mutation_cursor = (select next_cursor from capture_mutation_counter where singleton = 1)
       where capture_id = new.capture_id;
    end;

    create trigger if not exists capture_mutation_on_update
    after update of
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
    on capture
    begin
      update capture_mutation_counter
         set next_cursor = next_cursor + 1
       where singleton = 1;
      update capture
         set mutation_cursor = (select next_cursor from capture_mutation_counter where singleton = 1)
       where capture_id = new.capture_id;
    end;

    create trigger if not exists capture_attachment_mutation_on_insert
    after insert on capture_attachment
    begin
      update capture_mutation_counter
         set next_cursor = next_cursor + 1
       where singleton = 1;
      update capture
         set mutation_cursor = (select next_cursor from capture_mutation_counter where singleton = 1)
       where capture_id = new.capture_id;
    end;

    create trigger if not exists capture_attachment_mutation_on_update
    after update of
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
      derived_path,
      parser_provider_id,
      parser_state,
      parse_updated_at
    on capture_attachment
    begin
      update capture_mutation_counter
         set next_cursor = next_cursor + 1
       where singleton = 1;
      update capture
         set mutation_cursor = (select next_cursor from capture_mutation_counter where singleton = 1)
       where capture_id = new.capture_id;
    end;

    create trigger if not exists capture_attachment_mutation_on_delete
    after delete on capture_attachment
    begin
      update capture_mutation_counter
         set next_cursor = next_cursor + 1
       where singleton = 1;
      update capture
         set mutation_cursor = (select next_cursor from capture_mutation_counter where singleton = 1)
       where capture_id = old.capture_id;
    end;
  `);
  assertCanonicalAttachmentRows(database);
  database.exec(`
    create table if not exists attachment_parse_job (
      job_id text primary key,
      capture_id text not null references capture(capture_id) on delete cascade,
      attachment_id text not null references capture_attachment(attachment_id) on delete cascade,
      pipeline text not null,
      state text not null,
      attempts integer not null default 0,
      provider_id text,
      result_path text,
      error_code text,
      error_message text,
      created_at text not null,
      started_at text,
      finished_at text,
      unique (attachment_id, pipeline)
    );

    create index if not exists attachment_parse_job_state_idx
    on attachment_parse_job (state, created_at asc, job_id asc);

    create index if not exists attachment_parse_job_capture_idx
    on attachment_parse_job (capture_id, attachment_id);
  `);
}


export async function listInboxCaptureMutations(input: {
  afterCursor?: number | null;
  limit?: number;
  vaultRoot: string;
}): Promise<InboxCaptureMutationRecord[]> {
  const database = openInboxRuntimeDatabase(input.vaultRoot);
  try {
    const rows = database
      .prepare(
        `
          select
            capture_id as captureId,
            mutation_cursor as cursor
          from capture
          where mutation_cursor > ?
          order by mutation_cursor asc, capture_id asc
          limit ?
        `,
      )
      .all(Math.max(0, input.afterCursor ?? 0), normalizeLimit(input.limit, 500)) as Array<{
        captureId: string;
        cursor: number;
      }>;

    return rows.map((row) => ({
      captureId: row.captureId,
      cursor: row.cursor,
    }));
  } finally {
    database.close();
  }
}

export async function readInboxCaptureMutationHead(vaultRoot: string): Promise<number> {
  const database = openInboxRuntimeDatabase(vaultRoot);
  try {
    const row = database
      .prepare("select max(mutation_cursor) as cursor from capture")
      .get() as { cursor: number | null } | undefined;
    return row?.cursor ?? 0;
  } finally {
    database.close();
  }
}

function createInboxRuntimeStore(database: DatabaseSync, databasePath: string): InboxRuntimeStore {
  const selectCursorStatement = database.prepare(
    `
      select cursor_json
      from source_cursor
      where source = ? and account_id = ?
    `,
  );
  const deleteCursorStatement = database.prepare(
    "delete from source_cursor where source = ? and account_id = ?",
  );
  const upsertCursorStatement = database.prepare(
    `
      insert into source_cursor (source, account_id, cursor_json, updated_at)
      values (?, ?, ?, ?)
      on conflict (source, account_id) do update set
        cursor_json = excluded.cursor_json,
        updated_at = excluded.updated_at
    `,
  );
  const findByExternalIdStatement = database.prepare(
    `
      select
        capture_id,
        vault_event_id,
        envelope_path,
        created_at
      from capture
      where source = ? and account_id = ? and external_id = ?
    `,
  );
  const findCaptureIdByExternalIdStatement = database.prepare(
    `
      select capture_id
      from capture
      where source = ? and account_id = ? and external_id = ?
    `,
  );
  const upsertCaptureStatement = database.prepare(
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
  );
  const insertAttachmentStatement = database.prepare(
    `
      insert into capture_attachment (
        capture_id,
        attachment_id,
        ordinal,
        external_id,
        kind,
        mime,
        original_path,
        stored_path,
        file_name,
        sha256,
        size_bytes,
        created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict (attachment_id) do update set
        capture_id = excluded.capture_id,
        ordinal = excluded.ordinal,
        external_id = excluded.external_id,
        kind = excluded.kind,
        mime = excluded.mime,
        original_path = excluded.original_path,
        stored_path = excluded.stored_path,
        file_name = excluded.file_name,
        sha256 = excluded.sha256,
        size_bytes = excluded.size_bytes
    `,
  );
  const listCapturesAscendingStatement = database.prepare(
    `
      select *
      from capture
      where (? is null or source = ?)
        and (? is null or account_id = ?)
        and (
          ? is null
          or ? is null
          or occurred_at > ?
          or (occurred_at = ? and capture_id > ?)
        )
      order by occurred_at asc, capture_id asc
      limit ?
    `,
  );
  const listCapturesDescendingStatement = database.prepare(
    `
      select *
      from capture
      where (? is null or source = ?)
        and (? is null or account_id = ?)
        and (
          ? is null
          or ? is null
          or occurred_at > ?
          or (occurred_at = ? and capture_id > ?)
        )
      order by occurred_at desc, capture_id desc
      limit ?
    `,
  );
  const searchCapturesStatement = database.prepare(
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
  );
  const getCaptureStatement = database.prepare("select * from capture where capture_id = ?");
  const parseJobs = createAttachmentParseJobStore({
    database,
    refreshCaptureSearchIndex(captureId) {
      refreshCaptureSearchIndex(database, captureId);
    },
  });

  return {
    databasePath,
    close() {
      database.close();
    },
    getCursor(source, accountId = null) {
      const row = selectCursorStatement.get(
        source,
        normalizeAccountKey(accountId),
      ) as { cursor_json?: string } | undefined;

      if (!row?.cursor_json) {
        return null;
      }

      return JSON.parse(row.cursor_json) as Record<string, unknown>;
    },
    setCursor(source, accountId = null, cursor) {
      const normalizedAccountId = normalizeAccountKey(accountId);

      if (cursor === null) {
        deleteCursorStatement.run(source, normalizedAccountId);
        return;
      }

      upsertCursorStatement.run(
        source,
        normalizedAccountId,
        JSON.stringify(cursor),
        new Date().toISOString(),
      );
    },
    findByExternalId(source, accountId = null, externalId) {
      const row = findByExternalIdStatement.get(source, normalizeAccountKey(accountId), externalId) as
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
      const normalizedAccountId = normalizeAccountKey(input.accountId);
      const existing = findCaptureIdByExternalIdStatement.get(
        input.source,
        normalizedAccountId,
        input.externalId,
      ) as { capture_id: string } | undefined;
      const effectiveCaptureId = existing?.capture_id ?? captureId;
      const normalizedAttachments = normalizeStoredAttachments(
        effectiveCaptureId,
        stored.attachments,
        `runtime capture ${effectiveCaptureId}`,
      );

      withTransaction(database, () => {
        upsertCaptureStatement.run(
          effectiveCaptureId,
          input.source,
          normalizedAccountId,
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
          JSON.stringify(sanitizeRawMetadata(input.raw)),
          eventId,
          stored.envelopePath,
          stored.storedAt,
        );

        for (const attachment of normalizedAttachments) {
          insertAttachmentStatement.run(
            effectiveCaptureId,
            attachment.attachmentId,
            attachment.ordinal,
            normalizeNullable(attachment.externalId),
            attachment.kind,
            normalizeNullable(attachment.mime),
            null,
            normalizeNullable(attachment.storedPath),
            normalizeNullable(attachment.fileName),
            normalizeNullable(attachment.sha256),
            attachment.byteSize ?? null,
            stored.storedAt,
          );
        }

        if (normalizedAttachments.length === 0) {
          database.prepare("delete from capture_attachment where capture_id = ?").run(effectiveCaptureId);
        } else {
          const seenIds = normalizedAttachments.map((attachment) => attachment.attachmentId);
          database
            .prepare(
              `
                delete from capture_attachment
                where capture_id = ?
                  and attachment_id not in (${seenIds.map(() => "?").join(", ")})
              `,
            )
            .run(effectiveCaptureId, ...seenIds);
        }

        refreshCaptureSearchIndex(database, effectiveCaptureId);
      });

      return effectiveCaptureId;
    },
    enqueueDerivedJobs({ captureId, stored }) {
      const normalizedAttachments = normalizeStoredAttachments(
        captureId,
        stored.attachments,
        `runtime capture ${captureId}`,
      );
      parseJobs.enqueueAttachmentParseJobs({
        captureId,
        attachments: normalizedAttachments,
        createdAt: stored.storedAt,
      });
    },
    listAttachmentParseJobs(filters = {}) {
      return parseJobs.listAttachmentParseJobs(filters);
    },
    claimNextAttachmentParseJob(filters = {}) {
      return parseJobs.claimNextAttachmentParseJob(filters);
    },
    requeueAttachmentParseJobs(filters = {}) {
      return parseJobs.requeueAttachmentParseJobs(filters);
    },
    completeAttachmentParseJob(input) {
      return parseJobs.completeAttachmentParseJob(input);
    },
    failAttachmentParseJob(input) {
      return parseJobs.failAttachmentParseJob(input);
    },
    listCaptures(filters = {}) {
      const normalizedFilters = normalizeCaptureFilters(filters);
      const statement = normalizedFilters.oldestFirst
        ? listCapturesAscendingStatement
        : listCapturesDescendingStatement;
      const rows = statement.all(
        normalizedFilters.source,
        normalizedFilters.source,
        normalizedFilters.accountId,
        normalizedFilters.accountId,
        normalizedFilters.afterOccurredAt,
        normalizedFilters.afterCaptureId,
        normalizedFilters.afterOccurredAt,
        normalizedFilters.afterOccurredAt,
        normalizedFilters.afterCaptureId,
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
      const rows = decodeSearchRows(
        searchCapturesStatement.all(
          query,
          normalizedFilters.source,
          normalizedFilters.source,
          normalizedFilters.accountId,
          normalizedFilters.accountId,
          normalizedFilters.limit,
        ),
      );

      return rows.map(createSearchHitFromRow);
    },
    getCapture(captureId) {
      const row = getCaptureStatement.get(captureId) as Record<string, unknown> | undefined;

      if (!row) {
        return null;
      }

      return hydrateCaptureRows(database, [decodeCaptureRow(row)])[0] ?? null;
    },
  };
}

function assertCanonicalAttachmentRows(database: DatabaseSync): void {
  const row = database
    .prepare(
      `
        select capture_id, attachment_id, ordinal
        from capture_attachment
        where attachment_id is null
          or attachment_id = ''
          or ordinal is null
          or ordinal < 1
        limit 1
      `,
    )
    .get() as { attachment_id?: string | null; capture_id?: string; ordinal?: number | null } | undefined;

  if (!row) {
    return;
  }

  const captureId =
    typeof row.capture_id === "string" && row.capture_id.length > 0 ? row.capture_id : "<unknown>";
  const ordinal =
    typeof row.ordinal === "number" && Number.isSafeInteger(row.ordinal)
      ? String(row.ordinal)
      : "<unknown>";

  if (typeof row.attachment_id !== "string" || row.attachment_id.length === 0) {
    throw new TypeError(
      `Inbox runtime requires canonical attachment metadata; capture_attachment row for capture "${captureId}" ordinal ${ordinal} is missing "attachment_id".`,
    );
  }

  throw new TypeError(
    `Inbox runtime requires canonical attachment metadata; capture_attachment row for capture "${captureId}" has invalid "ordinal" value ${ordinal}.`,
  );
}

function normalizeCaptureFilters(
  filters: InboxListFilters,
  fallbackLimit = 50,
): {
  source: string | null;
  accountId: string | null;
  afterCaptureId: string | null;
  afterOccurredAt: string | null;
  limit: number;
  oldestFirst: boolean;
} {
  return {
    source: normalizeNullable(filters.source),
    accountId: normalizeNullable(filters.accountId),
    afterCaptureId: normalizeNullable(filters.afterCaptureId),
    afterOccurredAt: normalizeNullable(filters.afterOccurredAt),
    limit: normalizeLimit(filters.limit, fallbackLimit),
    oldestFirst: filters.oldestFirst === true,
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
    snippet: buildSnippet(
      capture.text,
      capture.attachments.map((item) => item.fileName).join(" "),
      capture.attachments.map((item) => item.extractedText).join(" "),
      capture.attachments.map((item) => item.transcriptText).join(" "),
    ),
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

function refreshCaptureSearchIndex(database: DatabaseSync, captureId: string): void {
  const captureRow = database
    .prepare(
      `
        select
          capture_id,
          source,
          thread_id,
          text_content
        from capture
        where capture_id = ?
      `,
    )
    .get(captureId) as
    | {
        capture_id: string;
        source: string;
        thread_id: string;
        text_content: string | null;
      }
    | undefined;

  if (!captureRow) {
    return;
  }

  const attachmentRows = database
    .prepare(
      `
        select
          file_name,
          mime,
          extracted_text,
          transcript_text
        from capture_attachment
        where capture_id = ?
        order by ordinal asc
      `,
    )
    .all(captureId) as Array<{
      file_name: string | null;
      mime: string | null;
      extracted_text: string | null;
      transcript_text: string | null;
    }>;

  const attachmentText = attachmentRows
    .map((attachment) =>
      [
        attachment.file_name,
        attachment.mime,
        attachment.extracted_text,
        attachment.transcript_text,
      ]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join(" "),
    )
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
      captureRow.source,
      captureRow.thread_id,
      normalizeNullable(captureRow.text_content),
      normalizeNullable(attachmentText),
      `inbox source-${captureRow.source}`,
    );
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
