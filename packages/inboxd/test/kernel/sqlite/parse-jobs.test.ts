import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { createAttachmentParseJobStore } from "../../../src/kernel/sqlite/parse-jobs.ts";

describe("createAttachmentParseJobStore", () => {
  it("enqueues image attachments for automatic parsing", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      create table capture_attachment (
        attachment_id text primary key,
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

    database
      .prepare(
        `
          insert into capture_attachment (
            attachment_id,
            parser_state,
            parse_updated_at
          ) values (?, null, null)
        `,
      )
      .run("attachment-image");

    const store = createAttachmentParseJobStore({
      database,
      refreshCaptureSearchIndex() {},
    });
    store.enqueueAttachmentParseJobs({
      captureId: "capture-1",
      attachments: [
        {
          attachmentId: "attachment-image",
          ordinal: 1,
          kind: "image",
          mime: "image/jpeg",
          fileName: "meal.jpg",
          storedPath: "raw/inbox/capture-1/attachments/attachment-image/meal.jpg",
        },
      ],
      createdAt: "2026-04-15T12:00:00.000Z",
    });

    const jobs = store.listAttachmentParseJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      attachmentId: "attachment-image",
      captureId: "capture-1",
      pipeline: "attachment_text",
      state: "pending",
    });
    expect(
      database
        .prepare(
          "select parser_state from capture_attachment where attachment_id = ?",
        )
        .get("attachment-image"),
    ).toEqual({ parser_state: "pending" });
  });
});
