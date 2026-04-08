import type { DatabaseSync } from "node:sqlite";
import { withImmediateTransaction as withTransaction } from "@murphai/runtime-state/node";

import type {
  AttachmentParseJobClaimFilters,
  AttachmentParseJobFinalizeResult,
  AttachmentParseJobFilters,
  AttachmentParseJobRecord,
  CompleteAttachmentParseJobInput,
  FailAttachmentParseJobInput,
  RequeueAttachmentParseJobsInput,
} from "../../contracts/derived.ts";
import type { StoredAttachment } from "../../contracts/capture.ts";
import { generatePrefixedId } from "../../shared.ts";
import { decodeAttachmentParseJobRow, decodeAttachmentParseJobRows } from "./rows.ts";

const ATTACHMENT_PARSE_PIPELINE = "attachment_text" as const;
const PARSEABLE_ATTACHMENT_KINDS = new Set<StoredAttachment["kind"]>([
  "audio",
  "document",
  "video",
]);

export interface AttachmentParseJobStore {
  enqueueAttachmentParseJobs(input: {
    captureId: string;
    attachments: StoredAttachment[];
    createdAt: string;
  }): void;
  listAttachmentParseJobs(filters?: AttachmentParseJobFilters): AttachmentParseJobRecord[];
  claimNextAttachmentParseJob(filters?: AttachmentParseJobClaimFilters): AttachmentParseJobRecord | null;
  requeueAttachmentParseJobs(filters?: RequeueAttachmentParseJobsInput): number;
  completeAttachmentParseJob(input: CompleteAttachmentParseJobInput): AttachmentParseJobFinalizeResult;
  failAttachmentParseJob(input: FailAttachmentParseJobInput): AttachmentParseJobFinalizeResult;
}

export function createAttachmentParseJobStore(input: {
  database: DatabaseSync;
  refreshCaptureSearchIndex(captureId: string): void;
}): AttachmentParseJobStore {
  const { database, refreshCaptureSearchIndex } = input;
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

  return {
    enqueueAttachmentParseJobs({ captureId, attachments, createdAt }) {
      if (attachments.length === 0) {
        return;
      }

      withTransaction(database, () => {
        for (const attachment of attachments) {
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
            createdAt,
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
              .run(createdAt, attachment.attachmentId);
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
        const normalizedCaptureId = normalizeNullable(filters.captureId);
        const normalizedAttachmentId = normalizeNullable(filters.attachmentId);
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
            normalizedCaptureId,
            normalizedCaptureId,
            normalizedAttachmentId,
            normalizedAttachmentId,
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
        const normalizedCaptureId = normalizeNullable(filters.captureId);
        const normalizedAttachmentId = normalizeNullable(filters.attachmentId);
        const normalizedState = normalizeNullable(filters.state);
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
            normalizedCaptureId,
            normalizedCaptureId,
            normalizedAttachmentId,
            normalizedAttachmentId,
            normalizedState,
            normalizedState,
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
          refreshCaptureSearchIndex(captureId);
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

          refreshCaptureSearchIndex(job.captureId);
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
  };
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

function normalizeNullable<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
    return fallback;
  }

  return Math.min(limit, 200);
}
