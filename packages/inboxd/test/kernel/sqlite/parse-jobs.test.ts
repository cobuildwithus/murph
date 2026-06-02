import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { createAttachmentParseJobStore } from "../../../src/kernel/sqlite/parse-jobs.ts";

describe("createAttachmentParseJobStore", () => {
  it("enqueues only media attachments for parser jobs", () => {
    const database = createParseJobTestDatabase();

    const insertAttachment = database.prepare(
      `
        insert into capture_attachment (
          attachment_id,
          kind,
          parser_state,
          parse_updated_at
        ) values (?, ?, null, null)
      `,
    );
    insertAttachment.run("attachment-audio", "audio");
    insertAttachment.run("attachment-video", "video");
    insertAttachment.run("attachment-document", "document");
    insertAttachment.run("attachment-image", "image");

    const store = createAttachmentParseJobStore({
      database,
      refreshCaptureSearchIndex() {},
    });
    store.enqueueAttachmentParseJobs({
      captureId: "capture-1",
      attachments: [
        {
          attachmentId: "attachment-audio",
          ordinal: 1,
          kind: "audio",
          mime: "audio/mpeg",
          fileName: "voice.mp3",
          storedPath: "raw/inbox/capture-1/attachments/attachment-audio/voice.mp3",
        },
        {
          attachmentId: "attachment-video",
          ordinal: 2,
          kind: "video",
          mime: "video/mp4",
          fileName: "clip.mp4",
          storedPath: "raw/inbox/capture-1/attachments/attachment-video/clip.mp4",
        },
        {
          attachmentId: "attachment-document",
          ordinal: 3,
          kind: "document",
          mime: "application/pdf",
          fileName: "lab.pdf",
          storedPath: "raw/inbox/capture-1/attachments/attachment-document/lab.pdf",
        },
        {
          attachmentId: "attachment-image",
          ordinal: 4,
          kind: "image",
          mime: "image/jpeg",
          fileName: "photo.jpg",
          storedPath: "raw/inbox/capture-1/attachments/attachment-image/photo.jpg",
        },
      ],
      createdAt: "2026-04-15T12:00:00.000Z",
    });

    const jobs = store.listAttachmentParseJobs();

    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.attachmentId)).toEqual([
      "attachment-audio",
      "attachment-video",
    ]);
    for (const job of jobs) {
      expect(job).toMatchObject({
        captureId: "capture-1",
        pipeline: "attachment_text",
        state: "pending",
      });
    }
    expect(
      database
        .prepare(
          "select parser_state from capture_attachment where attachment_id = ?",
        )
        .get("attachment-audio"),
    ).toEqual({ parser_state: "pending" });
    expect(
      database
        .prepare(
          "select parser_state from capture_attachment where attachment_id = ?",
        )
        .get("attachment-video"),
    ).toEqual({ parser_state: "pending" });
    expect(
      database
        .prepare(
          `
            select attachment_id, parser_state
            from capture_attachment
            where attachment_id in ('attachment-document', 'attachment-image')
            order by attachment_id asc
          `,
        )
        .all(),
    ).toEqual([
      { attachment_id: "attachment-document", parser_state: null },
      { attachment_id: "attachment-image", parser_state: null },
    ]);
    database.close();
  });

  it("does not process seeded legacy document parse jobs", () => {
    const database = createParseJobTestDatabase();
    database
      .prepare(
        `
          insert into capture_attachment (
            attachment_id,
            kind,
            parser_state,
            parse_updated_at
          ) values (?, ?, null, null)
        `,
      )
      .run("attachment-document", "document");
    database
      .prepare(
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
        `,
      )
      .run(
        "job-document",
        "capture-1",
        "attachment-document",
        "attachment_text",
        "pending",
        0,
        "2026-04-15T12:00:00.000Z",
      );

    const store = createAttachmentParseJobStore({
      database,
      refreshCaptureSearchIndex() {
        throw new Error("document parse jobs should not refresh search");
      },
    });

    expect(store.claimNextAttachmentParseJob()).toBeNull();

    database
      .prepare("update attachment_parse_job set state = 'running', attempts = 1 where job_id = ?")
      .run("job-document");

    const completed = store.completeAttachmentParseJob({
      attempt: 1,
      jobId: "job-document",
      providerId: "legacy-parser",
      resultPath: "derived/inbox/capture-1/attachment-1/manifest.json",
      transcriptText: "legacy transcript should not apply",
    });
    expect(completed.applied).toBe(false);
    expect(completed.job.state).toBe("running");
    expect(
      database
        .prepare(
          `
            select derived_path, transcript_text, parser_state
            from capture_attachment
            where attachment_id = ?
          `,
        )
        .get("attachment-document"),
    ).toEqual({
      derived_path: null,
      parser_state: null,
      transcript_text: null,
    });

    const requeued = store.requeueAttachmentParseJobs({
      attachmentId: "attachment-document",
    });
    expect(requeued).toBe(0);
    expect(readParseJobState(database, "job-document")).toBe("running");

    const failed = store.failAttachmentParseJob({
      attempt: 1,
      errorMessage: "legacy parser failure should not apply",
      jobId: "job-document",
      providerId: "legacy-parser",
    });
    expect(failed.applied).toBe(false);
    expect(failed.job.state).toBe("running");
    expect(
      database
        .prepare("select parser_state from capture_attachment where attachment_id = ?")
        .get("attachment-document"),
    ).toEqual({ parser_state: null });
    database.close();
  });
});

function createParseJobTestDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    create table capture_attachment (
      attachment_id text primary key,
      kind text,
      extracted_text text,
      transcript_text text,
      derived_path text,
      parser_provider_id text,
      parser_state text,
      parse_updated_at text
    );

    create table attachment_parse_job (
      job_id text primary key,
      capture_id text not null,
      attachment_id text not null,
      pipeline text not null,
      state text not null,
      attempts integer not null,
      provider_id text,
      result_path text,
      error_code text,
      error_message text,
      created_at text not null,
      started_at text,
      finished_at text,
      unique (attachment_id, pipeline)
    );
  `);
  return database;
}

function readParseJobState(database: DatabaseSync, jobId: string): string | null {
  const row = database
    .prepare("select state from attachment_parse_job where job_id = ?")
    .get(jobId) as { state?: string } | undefined;
  return row?.state ?? null;
}
