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
  IndexedAttachment,
  InboundCapture,
  PersistedCapture,
  StoredAttachment,
  StoredCapture,
} from "../contracts/capture.ts";
import {
  buildAttachmentId,
  buildFtsQuery,
  buildSnippet,
  generatePrefixedId,
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

const INBOX_RUNTIME_SQLITE_SCHEMA_VERSION = 5;
const SQLITE_WAL_COMPANION_SUFFIXES = ["-shm", "-wal"] as const;
const ATTACHMENT_PARSE_PIPELINE = "attachment_text" as const;
const AUTOMATIC_ATTACHMENT_PARSE_KINDS = new Set<StoredAttachment["kind"]>([
  "audio",
  "video",
]);

export interface InboxCaptureProjectionEntry {
  captureId: string;
  eventId: string;
  input: InboundCapture;
  stored: InboxCaptureProjectionStoredCapture;
}

export type InboxCaptureProjectionAttachment = StoredAttachment & Pick<
  IndexedAttachment,
  "derivedPath" | "extractedText" | "parseState" | "parserProviderId" | "transcriptText"
> & {
  parseUpdatedAt?: string | null;
};

export type InboxCaptureProjectionStoredCapture = Omit<StoredCapture, "attachments"> & {
  attachments: InboxCaptureProjectionAttachment[];
};

interface ProjectionReplacementStore {
  replaceCaptureProjection(
    entries: ReadonlyArray<InboxCaptureProjectionEntry>,
    options?: { enqueueParserJobs?: boolean },
  ): void;
}

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
  getAttachment(attachmentId: string): {
    capture: InboxCaptureRecord;
    attachment: InboxCaptureRecord["attachments"][number];
  } | null;
}

export interface OpenInboxRuntimeInput {
  vaultRoot: string;
}

export async function openInboxRuntime({
  vaultRoot,
}: OpenInboxRuntimeInput): Promise<InboxRuntimeStore> {
  const databasePath = resolveRuntimePaths(vaultRoot).inboxDbPath;
  const database = openInboxRuntimeDatabaseForPath(databasePath);
  return createInboxRuntimeStore(database, databasePath);
}


function openInboxRuntimeDatabase(vaultRoot: string): DatabaseSync {
  return openInboxRuntimeDatabaseForPath(resolveRuntimePaths(vaultRoot).inboxDbPath);
}

function openInboxRuntimeDatabaseForPath(databasePath: string): DatabaseSync {
  const database = openSqliteRuntimeDatabase(databasePath);
  applySqliteRuntimeMigrations(database, {
    migrations: [
      {
        version: 1,
        migrate(candidateDatabase) {
          ensureInboxRuntimeSchema(candidateDatabase);
        },
      },
      {
        version: 3,
        migrate(candidateDatabase) {
          ensureCaptureMutationOnUpdateTrigger(candidateDatabase);
        },
      },
      {
        version: 4,
        migrate() {},
      },
      {
        version: 5,
        migrate(candidateDatabase) {
          ensureCaptureAttachmentContentStatusColumn(candidateDatabase);
          ensureCaptureAttachmentMutationOnUpdateTrigger(candidateDatabase);
        },
      },
    ],
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
    create index if not exists capture_created_at_idx on capture (created_at desc, capture_id desc);
    create index if not exists capture_source_created_idx on capture (source, account_id, created_at desc, capture_id desc);
    create table if not exists capture_mutation_counter (
      singleton integer primary key check (singleton = 1),
      next_cursor integer not null
    );

    create table if not exists capture_mutation_tombstone (
      capture_id text primary key,
      mutation_cursor integer not null
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
      content_status text,
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

    create index if not exists capture_mutation_tombstone_cursor_idx
    on capture_mutation_tombstone (mutation_cursor asc, capture_id asc);

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
      content_status,
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
  ensureCaptureMutationOnUpdateTrigger(database);
  ensureCaptureAttachmentMutationOnUpdateTrigger(database);
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

function ensureCaptureAttachmentContentStatusColumn(database: DatabaseSync): void {
  const columns = database.prepare("pragma table_info(capture_attachment)").all() as Array<{
    name?: string | null;
  }>;
  if (columns.some((column) => column.name === "content_status")) {
    return;
  }

  database.exec("alter table capture_attachment add column content_status text");
}

function ensureCaptureAttachmentMutationOnUpdateTrigger(database: DatabaseSync): void {
  database.exec(`
    drop trigger if exists capture_attachment_mutation_on_update;

    create trigger capture_attachment_mutation_on_update
    after update of
      ordinal,
      external_id,
      kind,
      mime,
      original_path,
      stored_path,
      file_name,
      sha256,
      content_status,
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
  `);
}

function ensureCaptureMutationOnUpdateTrigger(database: DatabaseSync): void {
  database.exec(`
    drop trigger if exists capture_mutation_on_update;

    create trigger capture_mutation_on_update
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
          select captureId, cursor
          from (
            select
              capture_id as captureId,
              mutation_cursor as cursor
            from capture
            where mutation_cursor > ?
            union all
            select
              capture_id as captureId,
              mutation_cursor as cursor
            from capture_mutation_tombstone
            where mutation_cursor > ?
          )
          order by cursor asc, captureId asc
          limit ?
        `,
      )
      .all(
        Math.max(0, input.afterCursor ?? 0),
        Math.max(0, input.afterCursor ?? 0),
        normalizeLimit(input.limit, 500),
      ) as Array<{
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
      .prepare(
        `
          select max(cursor) as cursor
          from (
            select mutation_cursor as cursor from capture
            union all
            select mutation_cursor as cursor from capture_mutation_tombstone
          )
        `,
      )
      .get() as { cursor: number | null } | undefined;
    return row?.cursor ?? 0;
  } finally {
    database.close();
  }
}

function createInboxRuntimeStore(
  database: DatabaseSync,
  databasePath: string,
): InboxRuntimeStore & ProjectionReplacementStore {
  const listCaptureIdsStatement = database.prepare(
    "select capture_id from capture",
  );
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
  const deleteCaptureStatement = database.prepare("delete from capture where capture_id = ?");
  const deleteAllCapturesStatement = database.prepare("delete from capture");
  const deleteCaptureSearchIndexStatement = database.prepare("delete from capture_fts where capture_id = ?");
  const deleteAllCaptureSearchIndexStatement = database.prepare("delete from capture_fts");
  const incrementMutationCounterStatement = database.prepare(
    `
      update capture_mutation_counter
         set next_cursor = next_cursor + 1
       where singleton = 1
    `,
  );
  const readMutationCounterStatement = database.prepare(
    `
      select next_cursor
      from capture_mutation_counter
      where singleton = 1
    `,
  );
  const setMutationCounterStatement = database.prepare(
    `
      update capture_mutation_counter
         set next_cursor = ?
       where singleton = 1
    `,
  );
  const upsertCaptureMutationTombstoneStatement = database.prepare(
    `
      insert into capture_mutation_tombstone (
        capture_id,
        mutation_cursor
      ) values (?, ?)
      on conflict (capture_id) do update set
        mutation_cursor = excluded.mutation_cursor
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
      where
        capture.source is not excluded.source
        or capture.account_id is not excluded.account_id
        or capture.external_id is not excluded.external_id
        or capture.thread_id is not excluded.thread_id
        or capture.thread_title is not excluded.thread_title
        or capture.thread_is_direct is not excluded.thread_is_direct
        or capture.actor_id is not excluded.actor_id
        or capture.actor_name is not excluded.actor_name
        or capture.actor_is_self is not excluded.actor_is_self
        or capture.occurred_at is not excluded.occurred_at
        or capture.received_at is not excluded.received_at
        or capture.text_content is not excluded.text_content
        or capture.raw_json is not excluded.raw_json
        or capture.vault_event_id is not excluded.vault_event_id
        or capture.envelope_path is not excluded.envelope_path
        or capture.created_at is not excluded.created_at
    `,
  );
  const insertAttachmentParseJobStatement = database.prepare(
    `
      insert into attachment_parse_job (
        job_id,
        capture_id,
        attachment_id,
        pipeline,
        state,
        attempts,
        created_at
      ) values (?, ?, ?, ?, ?, ?, ?)
      on conflict (attachment_id, pipeline) do nothing
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
        content_status,
        size_bytes,
        created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        content_status = excluded.content_status,
        size_bytes = excluded.size_bytes
      where
        capture_attachment.capture_id is not excluded.capture_id
        or capture_attachment.ordinal is not excluded.ordinal
        or capture_attachment.external_id is not excluded.external_id
        or capture_attachment.kind is not excluded.kind
        or capture_attachment.mime is not excluded.mime
        or capture_attachment.original_path is not excluded.original_path
        or capture_attachment.stored_path is not excluded.stored_path
        or capture_attachment.file_name is not excluded.file_name
        or capture_attachment.sha256 is not excluded.sha256
        or capture_attachment.content_status is not excluded.content_status
        or capture_attachment.size_bytes is not excluded.size_bytes
    `,
  );
  const updateAttachmentParseProjectionStatement = database.prepare(
    `
      update capture_attachment
      set extracted_text = ?,
          transcript_text = ?,
          derived_path = ?,
          parser_provider_id = ?,
          parser_state = ?,
          parse_updated_at = ?
      where attachment_id = ?
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
  const listCapturesAscendingByCreatedStatement = database.prepare(
    `
      select *
      from capture
      where (? is null or source = ?)
        and (? is null or account_id = ?)
        and (
          ? is null
          or ? is null
          or created_at > ?
          or (created_at = ? and capture_id > ?)
        )
      order by created_at asc, capture_id asc
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
          or occurred_at < ?
          or (occurred_at = ? and capture_id < ?)
        )
      order by occurred_at desc, capture_id desc
      limit ?
    `,
  );
  const listCapturesDescendingByCreatedStatement = database.prepare(
    `
      select *
      from capture
      where (? is null or source = ?)
        and (? is null or account_id = ?)
        and (
          ? is null
          or ? is null
          or created_at < ?
          or (created_at = ? and capture_id < ?)
        )
      order by created_at desc, capture_id desc
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
  const getCaptureStatement = database.prepare(
    "select * from capture where capture_id = ?",
  );
  const findCaptureIdByAttachmentIdStatement = database.prepare(
    "select capture_id from capture_attachment where attachment_id = ?",
  );
  const parseJobs = createAttachmentParseJobStore({
    database,
    refreshCaptureSearchIndex(captureId) {
      refreshCaptureSearchIndex(database, captureId);
    },
  });

  function readCurrentMutationCursor(): number {
    const row = readMutationCounterStatement.get() as { next_cursor?: number } | undefined;
    return typeof row?.next_cursor === "number" ? row.next_cursor : 0;
  }

  function allocateMutationCursor(): number {
    incrementMutationCounterStatement.run();
    return readCurrentMutationCursor();
  }

  function recordCaptureTombstone(captureId: string): void {
    upsertCaptureMutationTombstoneStatement.run(captureId, allocateMutationCursor());
  }

  function deleteCaptureProjectionRow(captureId: string, options?: { recordTombstone?: boolean }): void {
    deleteCaptureSearchIndexStatement.run(captureId);
    deleteCaptureStatement.run(captureId);
    if (options?.recordTombstone === true) {
      recordCaptureTombstone(captureId);
    }
  }

  function enqueueAttachmentParseJobsForProjection(input: {
    captureId: string;
    attachments: StoredAttachment[];
    createdAt: string;
  }): void {
    for (const attachment of input.attachments) {
      if (!shouldEnqueueParseJobForProjection(attachment)) {
        continue;
      }

      const insertResult = insertAttachmentParseJobStatement.run(
        generatePrefixedId("job"),
        input.captureId,
        attachment.attachmentId,
        ATTACHMENT_PARSE_PIPELINE,
        "pending",
        0,
        input.createdAt,
      );

      if (insertResult.changes > 0) {
        database
          .prepare(
            `
              update capture_attachment
              set parser_state = 'pending',
                  parse_updated_at = ?
              where attachment_id = ?
            `,
          )
          .run(input.createdAt, attachment.attachmentId);
      }
    }
  }

  function upsertCaptureProjection(
    input: InboxCaptureProjectionEntry,
    options?: { recordCollisionTombstone?: boolean },
  ): string {
    const normalizedAccountId = normalizeAccountKey(input.input.accountId);
    const normalizedAttachments = normalizeRuntimeAttachments(
      input.captureId,
      input.stored.attachments,
      `runtime capture ${input.captureId}`,
    );
    const existing = findCaptureIdByExternalIdStatement.get(
      input.input.source,
      normalizedAccountId,
      input.input.externalId,
    ) as { capture_id: string } | undefined;

    if (existing?.capture_id && existing.capture_id !== input.captureId) {
      deleteCaptureProjectionRow(existing.capture_id, {
        recordTombstone: options?.recordCollisionTombstone === true,
      });
    }

    upsertCaptureStatement.run(
      input.captureId,
      input.input.source,
      normalizedAccountId,
      input.input.externalId,
      input.input.thread.id,
      normalizeNullable(input.input.thread.title),
      input.input.thread.isDirect ? 1 : 0,
      normalizeNullable(input.input.actor.id),
      normalizeNullable(input.input.actor.displayName),
      input.input.actor.isSelf ? 1 : 0,
      input.input.occurredAt,
      normalizeNullable(input.input.receivedAt),
      normalizeNullable(input.input.text),
      JSON.stringify(sanitizeRawMetadata(input.input.raw)),
      input.eventId,
      input.stored.envelopePath,
      input.stored.storedAt,
    );

    for (const attachment of normalizedAttachments) {
      insertAttachmentStatement.run(
        input.captureId,
        attachment.attachmentId,
        attachment.ordinal,
        normalizeNullable(attachment.externalId),
        attachment.kind,
        normalizeNullable(attachment.mime),
        null,
        normalizeNullable(attachment.storedPath),
        normalizeNullable(attachment.fileName),
        normalizeNullable(attachment.sha256),
        normalizeAttachmentContentStatus(attachment.contentStatus),
        attachment.byteSize ?? null,
        input.stored.storedAt,
      );
      if (hasAttachmentParseProjection(attachment)) {
        updateAttachmentParseProjectionStatement.run(
          normalizeNullable(attachment.extractedText),
          normalizeNullable(attachment.transcriptText),
          normalizeNullable(attachment.derivedPath),
          normalizeNullable(attachment.parserProviderId),
          normalizeNullable(attachment.parseState),
          normalizeNullable(attachment.parseUpdatedAt),
          attachment.attachmentId,
        );
      }
    }

    if (normalizedAttachments.length === 0) {
      database.prepare("delete from capture_attachment where capture_id = ?").run(input.captureId);
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
        .run(input.captureId, ...seenIds);
    }

    refreshCaptureSearchIndex(database, input.captureId);
    return input.captureId;
  }

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
      withTransaction(database, () => {
        upsertCaptureProjection(
          {
            captureId,
            eventId,
            input,
            stored,
          },
          {
            recordCollisionTombstone: true,
          },
        );
      });

      return captureId;
    },
    enqueueDerivedJobs({ captureId, stored }) {
      const normalizedAttachments = normalizeRuntimeAttachments(
        captureId,
        stored.attachments,
        `runtime capture ${captureId}`,
      );
      withTransaction(database, () => {
        enqueueAttachmentParseJobsForProjection({
          captureId,
          attachments: normalizedAttachments,
          createdAt: stored.storedAt,
        });
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
      const statement = normalizedFilters.afterCreatedAt
        ? (
            normalizedFilters.oldestFirst
              ? listCapturesAscendingByCreatedStatement
              : listCapturesDescendingByCreatedStatement
          )
        : (
            normalizedFilters.oldestFirst
              ? listCapturesAscendingStatement
              : listCapturesDescendingStatement
          );
      const afterTime =
        normalizedFilters.afterCreatedAt ?? normalizedFilters.afterOccurredAt;
      const rows = statement.all(
        normalizedFilters.source,
        normalizedFilters.source,
        normalizedFilters.accountId,
        normalizedFilters.accountId,
        afterTime,
        normalizedFilters.afterCaptureId,
        afterTime,
        afterTime,
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
    getAttachment(attachmentId) {
      const row = findCaptureIdByAttachmentIdStatement.get(attachmentId) as
        | { capture_id: string }
        | undefined;
      if (!row) {
        return null;
      }

      const capture = this.getCapture(row.capture_id);
      const attachment =
        capture?.attachments.find((candidate) => candidate.attachmentId === attachmentId) ?? null;
      return capture && attachment
        ? {
            capture,
            attachment,
          }
        : null;
    },
    replaceCaptureProjection(entries, options = {}) {
      const normalizedEntries = entries.map((entry) => ({
        ...entry,
        stored: {
          ...entry.stored,
          attachments: normalizeRuntimeAttachments(
            entry.captureId,
            entry.stored.attachments,
            `runtime capture ${entry.captureId}`,
          ),
        },
      }));

      withTransaction(database, () => {
        const previousNextCursor = readCurrentMutationCursor();
        const previousCaptureIds = new Set(
          (
            listCaptureIdsStatement.all() as Array<{
              capture_id?: string;
            }>
          )
            .map((row) => row.capture_id)
            .filter((value): value is string => typeof value === "string" && value.length > 0),
        );
        const replayedCaptureIds = new Set<string>();

        deleteAllCaptureSearchIndexStatement.run();
        deleteAllCapturesStatement.run();
        setMutationCounterStatement.run(previousNextCursor);

        for (const entry of normalizedEntries) {
          replayedCaptureIds.add(entry.captureId);
          upsertCaptureProjection(entry);
          if (options.enqueueParserJobs === true) {
            enqueueAttachmentParseJobsForProjection({
              captureId: entry.captureId,
              attachments: entry.stored.attachments,
              createdAt: entry.stored.storedAt,
            });
          }
        }

        for (const captureId of previousCaptureIds) {
          if (replayedCaptureIds.has(captureId)) {
            continue;
          }

          recordCaptureTombstone(captureId);
        }
      });
    },
  };
}

export function replaceInboxCaptureProjection(input: {
  databasePath: string;
  enqueueParserJobs?: boolean;
  entries: ReadonlyArray<InboxCaptureProjectionEntry>;
}): void {
  const database = openInboxRuntimeDatabaseForPath(input.databasePath);
  const runtime = createInboxRuntimeStore(database, input.databasePath);

  try {
    runtime.replaceCaptureProjection(input.entries, {
      enqueueParserJobs: input.enqueueParserJobs === true,
    });
  } finally {
    runtime.close();
  }
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

function normalizeRuntimeAttachments(
  captureId: string,
  attachments: ReadonlyArray<InboxCaptureProjectionAttachment>,
  context: string,
): InboxCaptureProjectionAttachment[] {
  return normalizeStoredAttachments(captureId, attachments, context).map((attachment) => {
    const expectedAttachmentId = buildAttachmentId(captureId, attachment.ordinal);
    if (attachment.attachmentId !== expectedAttachmentId) {
      throw new TypeError(
        `Inbox runtime requires attachment ids derived from capture "${captureId}"; expected "${expectedAttachmentId}" for ordinal ${attachment.ordinal}.`,
      );
    }

    return attachment;
  });
}

function hasAttachmentParseProjection(
  attachment: InboxCaptureProjectionAttachment,
): boolean {
  return Boolean(
    attachment.parseState ||
      attachment.parserProviderId ||
      attachment.derivedPath ||
      attachment.extractedText ||
      attachment.transcriptText ||
      attachment.parseUpdatedAt,
  );
}

function normalizeAttachmentContentStatus(
  value: StoredAttachment["contentStatus"],
): NonNullable<StoredAttachment["contentStatus"]> {
  return value === "retention_expired" ? "retention_expired" : "available";
}

function normalizeCaptureFilters(
  filters: InboxListFilters,
  fallbackLimit = 50,
): {
  source: string | null;
  accountId: string | null;
  afterCaptureId: string | null;
  afterCreatedAt: string | null;
  afterOccurredAt: string | null;
  limit: number;
  oldestFirst: boolean;
} {
  return {
    source: normalizeNullable(filters.source),
    accountId: normalizeNullable(filters.accountId),
    afterCaptureId: normalizeNullable(filters.afterCaptureId),
    afterCreatedAt: normalizeNullable(filters.afterCreatedAt),
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

function shouldEnqueueParseJobForProjection(attachment: StoredAttachment): boolean {
  return (
    AUTOMATIC_ATTACHMENT_PARSE_KINDS.has(attachment.kind) &&
    typeof attachment.storedPath === "string" &&
    attachment.storedPath.length > 0
  );
}
