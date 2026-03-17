import { DatabaseSync } from "node:sqlite";
import {
  openSqliteRuntimeDatabase,
  resolveRuntimePaths,
  withImmediateTransaction as withTransaction,
} from "@healthybob/runtime-state";

import type {
  AttachmentParseJobClaimFilters,
  AttachmentParseJobFinalizeResult,
  AttachmentParseJobFilters,
  AttachmentParseJobRecord,
  CompleteAttachmentParseJobInput,
  FailAttachmentParseJobInput,
  RequeueAttachmentParseJobsInput,
} from "../contracts/derived.js";
import type { InboxCaptureRecord, InboxListFilters, InboxSearchFilters, InboxSearchHit } from "../contracts/search.js";
import type {
  IndexedAttachment,
  InboundCapture,
  PersistedCapture,
  StoredAttachment,
  StoredCapture,
} from "../contracts/capture.js";
import {
  buildFtsQuery,
  buildLegacyAttachmentId,
  buildSnippet,
  generatePrefixedId,
  normalizeAccountKey,
  normalizeStoredAttachments,
  redactSensitivePaths,
} from "../shared.js";

const ATTACHMENT_PARSE_PIPELINE = "attachment_text" as const;
const PARSEABLE_ATTACHMENT_KINDS = new Set<StoredAttachment["kind"]>([
  "audio",
  "document",
  "image",
  "video",
]);

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
  }): string;
  enqueueDerivedJobs(input: { captureId: string; stored: StoredCapture }): void;
  listAttachmentParseJobs(filters?: AttachmentParseJobFilters): AttachmentParseJobRecord[];
  claimNextAttachmentParseJob(filters?: AttachmentParseJobClaimFilters): AttachmentParseJobRecord | null;
  requeueAttachmentParseJobs(filters?: RequeueAttachmentParseJobsInput): number;
  completeAttachmentParseJob(input: CompleteAttachmentParseJobInput): AttachmentParseJobFinalizeResult;
  failAttachmentParseJob(input: FailAttachmentParseJobInput): AttachmentParseJobFinalizeResult;
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
  const runtimePaths = resolveRuntimePaths(vaultRoot);
  const databasePath = runtimePaths.inboxDbPath;
  const database = openSqliteRuntimeDatabase(databasePath);

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
      unique (source, account_id, external_id)
    );

    create index if not exists capture_occurred_at_idx on capture (occurred_at desc, capture_id desc);
    create index if not exists capture_source_idx on capture (source, account_id, occurred_at desc);

    create table if not exists capture_attachment (
      id integer primary key autoincrement,
      capture_id text not null references capture(capture_id) on delete cascade,
      attachment_id text,
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

  ensureColumn(database, "capture_attachment", "attachment_id", "text");
  ensureColumn(database, "capture_attachment", "derived_path", "text");
  ensureColumn(database, "capture_attachment", "parser_provider_id", "text");
  ensureColumn(database, "capture_attachment", "parser_state", "text");
  ensureColumn(database, "capture_attachment", "parse_updated_at", "text");

  database.exec(`
    update capture_attachment
    set attachment_id = ('att_' || capture_id || '_' || printf('%02d', ordinal))
    where attachment_id is null or attachment_id = '';
  `);
  database.exec(`
    create unique index if not exists capture_attachment_attachment_id_idx
    on capture_attachment (attachment_id);
  `);
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

  return createInboxRuntimeStore(database, databasePath);
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
      const normalizedAttachments = normalizeStoredAttachments(effectiveCaptureId, stored.attachments);

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
          JSON.stringify(redactSensitivePaths(input.raw)),
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
      const normalizedAttachments = normalizeStoredAttachments(captureId, stored.attachments);

      if (normalizedAttachments.length === 0) {
        return;
      }

      withTransaction(database, () => {
        for (const attachment of normalizedAttachments) {
          if (!shouldEnqueueParseJob(attachment)) {
            continue;
          }

          const insertResult = insertAttachmentParseJobStatement.run(
            generatePrefixedId("job"),
            captureId,
            attachment.attachmentId,
            ATTACHMENT_PARSE_PIPELINE,
            "pending",
            0,
            stored.storedAt,
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
              .run(stored.storedAt, attachment.attachmentId);
          }
        }
      });
    },
    listAttachmentParseJobs(filters = {}) {
      const normalizedCaptureId = normalizeNullable(filters.captureId);
      const normalizedAttachmentId = normalizeNullable(filters.attachmentId);
      const normalizedState = normalizeNullable(filters.state);
      const limit = normalizeLimit(filters.limit, 50);

      const rows = database
        .prepare(
          `
            select *
            from attachment_parse_job
            where (? is null or capture_id = ?)
              and (? is null or attachment_id = ?)
              and (? is null or state = ?)
            order by created_at asc, job_id asc
            limit ?
          `,
        )
        .all(
          normalizedCaptureId,
          normalizedCaptureId,
          normalizedAttachmentId,
          normalizedAttachmentId,
          normalizedState,
          normalizedState,
          limit,
        ) as Array<Record<string, unknown>>;

      return decodeAttachmentParseJobRows(rows);
    },
    claimNextAttachmentParseJob(filters = {}) {
      const jobId = withTransaction(database, () => {
        const row = database
          .prepare(
            `
              select job_id, attachment_id
              from attachment_parse_job
              where state = 'pending'
                and (? is null or capture_id = ?)
                and (? is null or attachment_id = ?)
              order by created_at asc, job_id asc
              limit 1
            `,
          )
          .get(
            normalizeNullable(filters.captureId),
            normalizeNullable(filters.captureId),
            normalizeNullable(filters.attachmentId),
            normalizeNullable(filters.attachmentId),
          ) as { attachment_id?: string; job_id?: string } | undefined;

        if (!row?.job_id || !row.attachment_id) {
          return null;
        }

        const startedAt = new Date().toISOString();
        const updateResult = database
          .prepare(
            `
              update attachment_parse_job
              set state = 'running',
                  attempts = attempts + 1,
                  started_at = ?
              where job_id = ? and state = 'pending'
            `,
          )
          .run(startedAt, row.job_id);

        if (updateResult.changes === 0) {
          return null;
        }

        database
          .prepare(
            `
              update capture_attachment
              set parser_state = 'running',
                  parse_updated_at = ?
              where attachment_id = ?
            `,
          )
          .run(startedAt, row.attachment_id);

        return row.job_id;
      });

      if (!jobId) {
        return null;
      }

      return readAttachmentParseJob(database, jobId);
    },
    requeueAttachmentParseJobs(filters = {}) {
      return withTransaction(database, () => {
        const rows = database
          .prepare(
            `
              select attachment_id, capture_id
              from attachment_parse_job
              where (? is null or capture_id = ?)
                and (? is null or attachment_id = ?)
                and (? is null or state = ?)
                and state in ('failed', 'running', 'succeeded')
            `,
          )
          .all(
            normalizeNullable(filters.captureId),
            normalizeNullable(filters.captureId),
            normalizeNullable(filters.attachmentId),
            normalizeNullable(filters.attachmentId),
            normalizeNullable(filters.state),
            normalizeNullable(filters.state),
          ) as Array<{ attachment_id?: string; capture_id?: string }>;

        const attachmentIds = rows
          .map((row) => row.attachment_id)
          .filter((value): value is string => typeof value === "string" && value.length > 0);
        if (attachmentIds.length === 0) {
          return 0;
        }

        const captureIds = Array.from(
          new Set(
            rows
              .map((row) => row.capture_id)
              .filter((value): value is string => typeof value === "string" && value.length > 0),
          ),
        );
        const placeholders = attachmentIds.map(() => "?").join(", ");

        const result = database
          .prepare(
            `
              update attachment_parse_job
              set state = 'pending',
                  provider_id = null,
                  result_path = null,
                  error_code = null,
                  error_message = null,
                  started_at = null,
                  finished_at = null
              where attachment_id in (${placeholders})
            `,
          )
          .run(...attachmentIds);

        const now = new Date().toISOString();
        database
          .prepare(
            `
              update capture_attachment
              set extracted_text = null,
                  transcript_text = null,
                  derived_path = null,
                  parser_provider_id = null,
                  parser_state = 'pending',
                  parse_updated_at = ?
              where attachment_id in (${placeholders})
            `,
          )
          .run(now, ...attachmentIds);

        for (const captureId of captureIds) {
          refreshCaptureSearchIndex(database, captureId);
        }

        return Number(result.changes ?? attachmentIds.length);
      });
    },
    completeAttachmentParseJob(input) {
      return withTransaction(database, () => {
        const job = readAttachmentParseJob(database, input.jobId);
        const finishedAt = input.finishedAt ?? new Date().toISOString();

        const updateResult = database
          .prepare(
            `
              update attachment_parse_job
              set state = 'succeeded',
                  provider_id = ?,
                  result_path = ?,
                  error_code = null,
                  error_message = null,
                  finished_at = ?
              where job_id = ?
                and state = 'running'
                and attempts = ?
            `,
          )
          .run(input.providerId, input.resultPath, finishedAt, input.jobId, input.attempt);

        if (updateResult.changes > 0) {
          database
            .prepare(
              `
                update capture_attachment
                set extracted_text = ?,
                    transcript_text = ?,
                    derived_path = ?,
                    parser_provider_id = ?,
                    parser_state = 'succeeded',
                    parse_updated_at = ?
                where attachment_id = ?
              `,
            )
            .run(
              normalizeNullable(input.extractedText),
              normalizeNullable(input.transcriptText),
              input.resultPath,
              input.providerId,
              finishedAt,
              job.attachmentId,
            );

          refreshCaptureSearchIndex(database, job.captureId);
        }

        return {
          job: readAttachmentParseJob(database, input.jobId),
          applied: updateResult.changes > 0,
        };
      });
    },
    failAttachmentParseJob(input) {
      return withTransaction(database, () => {
        const job = readAttachmentParseJob(database, input.jobId);
        const finishedAt = input.finishedAt ?? new Date().toISOString();

        const updateResult = database
          .prepare(
            `
              update attachment_parse_job
              set state = 'failed',
                  provider_id = ?,
                  error_code = ?,
                  error_message = ?,
                  finished_at = ?
              where job_id = ?
                and state = 'running'
                and attempts = ?
            `,
          )
          .run(
            normalizeNullable(input.providerId),
            normalizeNullable(input.errorCode),
            input.errorMessage,
            finishedAt,
            input.jobId,
            input.attempt,
          );

        if (updateResult.changes > 0) {
          database
            .prepare(
              `
                update capture_attachment
                set parser_provider_id = coalesce(?, parser_provider_id),
                    parser_state = 'failed',
                    parse_updated_at = ?
                where attachment_id = ?
              `,
            )
            .run(normalizeNullable(input.providerId), finishedAt, job.attachmentId);
        }

        return {
          job: readAttachmentParseJob(database, input.jobId),
          applied: updateResult.changes > 0,
        };
      });
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

interface AttachmentRow {
  capture_id: string;
  attachment_id: string | null;
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

interface AttachmentParseJobRow {
  job_id: string;
  capture_id: string;
  attachment_id: string;
  pipeline: string;
  state: string;
  attempts: number;
  provider_id: string | null;
  result_path: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
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

function decodeCaptureRows(rows: ReadonlyArray<Record<string, unknown>>): CaptureRow[] {
  return rows.map(decodeCaptureRow);
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

function decodeAttachmentRows(rows: ReadonlyArray<Record<string, unknown>>): AttachmentRow[] {
  return rows.map(decodeAttachmentRow);
}

function decodeAttachmentRow(row: Record<string, unknown>): AttachmentRow {
  return {
    capture_id: expectString(row.capture_id, "capture_attachment.capture_id"),
    attachment_id: expectNullableString(row.attachment_id, "capture_attachment.attachment_id"),
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

function decodeAttachmentParseJobRows(rows: ReadonlyArray<Record<string, unknown>>): AttachmentParseJobRecord[] {
  return rows.map(decodeAttachmentParseJobRow);
}

function decodeAttachmentParseJobRow(row: Record<string, unknown>): AttachmentParseJobRecord {
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

function decodeSearchRows(rows: ReadonlyArray<Record<string, unknown>>): SearchRow[] {
  return rows.map(decodeSearchRow);
}

function decodeSearchRow(row: Record<string, unknown>): SearchRow {
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

function hydrateCaptureRows(database: DatabaseSync, rows: CaptureRow[]): InboxCaptureRecord[] {
  if (rows.length === 0) {
    return [];
  }

  const attachmentsByCapture = hydrateCaptureAttachments(
    loadAttachmentRows(database, rows.map((row) => row.capture_id)),
  );
  return rows.map((row) => hydrateCaptureRow(row, attachmentsByCapture));
}

function loadAttachmentRows(database: DatabaseSync, captureIds: string[]): AttachmentRow[] {
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

function hydrateCaptureAttachments(rows: AttachmentRow[]): Map<string, IndexedAttachment[]> {
  const attachmentsByCapture = new Map<string, IndexedAttachment[]>();

  for (const row of rows) {
    const attachments = attachmentsByCapture.get(row.capture_id) ?? [];
    attachments.push({
      attachmentId:
        typeof row.attachment_id === "string" && row.attachment_id.length > 0
          ? row.attachment_id
          : buildLegacyAttachmentId(row.capture_id, row.ordinal),
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

function hydrateCaptureRow(
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

function shouldEnqueueParseJob(attachment: StoredAttachment): boolean {
  return (
    PARSEABLE_ATTACHMENT_KINDS.has(attachment.kind) &&
    typeof attachment.storedPath === "string" &&
    attachment.storedPath.length > 0
  );
}

function readAttachmentParseJob(database: DatabaseSync, jobId: string): AttachmentParseJobRecord {
  const row = database
    .prepare("select * from attachment_parse_job where job_id = ?")
    .get(jobId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new TypeError(`Unknown attachment parse job: ${jobId}`);
  }

  return decodeAttachmentParseJobRow(row);
}

function ensureColumn(
  database: DatabaseSync,
  table: string,
  column: string,
  columnDefinition: string,
): void {
  const rows = database.prepare(`pragma table_info(${table})`).all() as Array<{ name?: string }>;
  if (rows.some((row) => row.name === column)) {
    return;
  }

  database.exec(`alter table ${table} add column ${column} ${columnDefinition}`);
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

function expectNullableNumber(value: unknown, label: string): number | null {
  if (value === null) {
    return null;
  }

  return expectNumber(value, label);
}
