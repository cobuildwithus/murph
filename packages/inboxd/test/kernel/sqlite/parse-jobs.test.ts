import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { createAttachmentParseJobStore } from "../../../src/kernel/sqlite/parse-jobs.ts";

describe("createAttachmentParseJobStore", () => {
  it.each([
    ["matching", "job-a", 2, "running", "audio", "running", 1],
    ["wrong job", "job-other", 2, "running", "audio", "running", 0],
    ["stale attempt", "job-a", 1, "running", "audio", "running", 0],
    ["non-running job", "job-a", 2, "succeeded", "audio", "succeeded", 0],
    ["non-media job", "job-a", 2, "running", "document", "running", 0],
    ["published attachment", "job-a", 2, "running", "audio", "succeeded", 0],
  ] as const)("resets only the exact claimed attempt: %s", (_scenario, jobId, attempt, state, kind, parserState, expected) => {
    const database = createParseJobTestDatabase();
    try {
      database.prepare(`insert into capture_attachment
        (attachment_id, kind, parser_state, transcript_text, derived_path)
        values ('attachment-a', ?, ?, 'Published transcript.', 'derived/result.json')`).run(kind, parserState);
      database.prepare(`insert into attachment_parse_job
        (job_id, capture_id, attachment_id, pipeline, state, attempts, created_at)
        values ('job-a', 'capture-1', 'attachment-a', 'attachment_text', ?, 2, '2026-04-15')`).run(state);
      database.exec(`insert into capture_attachment (attachment_id, kind, parser_state)
        values ('attachment-b', 'audio', 'running');
        insert into attachment_parse_job
        (job_id, capture_id, attachment_id, pipeline, state, attempts, created_at)
        values ('job-b', 'capture-1', 'attachment-b', 'attachment_text', 'running', 2, '2026-04-15')`);
      const store = createAttachmentParseJobStore({ database, refreshCaptureSearchIndex() {} });
      expect(store.requeueAttachmentParseJobs({ exactAttempt: { jobId, attempt } })).toBe(expected);
      expect(readParseJobState(database, "job-a")).toBe(expected ? "pending" : state);
      expect(readParseJobState(database, "job-b")).toBe("running");
      expect(database.prepare(`select parser_state, transcript_text, derived_path
        from capture_attachment where attachment_id = 'attachment-a'`).get()).toEqual({
        parser_state: expected ? "pending" : parserState,
        transcript_text: expected ? null : "Published transcript.",
        derived_path: expected ? null : "derived/result.json",
      });
      // Omitting exactAttempt preserves deliberate broad reruns, including success.
      expect(store.requeueAttachmentParseJobs({ captureId: "capture-1" })).toBe(
        1 + (kind === "audio" && expected === 0 ? 1 : 0),
      );
    } finally {
      database.close();
    }
  });

  it("orders same-timestamp jobs by attachment id for listing and claiming", () => {
    const database = createParseJobTestDatabase();
    const insertAttachment = database.prepare(
      `
        insert into capture_attachment (
          attachment_id,
          kind,
          parser_state,
          parse_updated_at
        ) values (?, ?, 'pending', ?)
      `,
    );
    insertAttachment.run("attachment-a", "audio", "2026-04-15T12:00:00.000Z");
    insertAttachment.run("attachment-b", "video", "2026-04-15T12:00:00.000Z");
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
        "job-z",
        "capture-1",
        "attachment-a",
        "attachment_text",
        "pending",
        0,
        "2026-04-15T12:00:00.000Z",
      );
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
        "job-a",
        "capture-1",
        "attachment-b",
        "attachment_text",
        "pending",
        0,
        "2026-04-15T12:00:00.000Z",
      );

    const store = createAttachmentParseJobStore({
      database,
      refreshCaptureSearchIndex() {},
    });

    expect(store.listAttachmentParseJobs().map((job) => job.attachmentId)).toEqual([
      "attachment-a",
      "attachment-b",
    ]);
    expect(store.claimNextAttachmentParseJob()?.attachmentId).toBe("attachment-a");
    expect(store.claimNextAttachmentParseJob()?.attachmentId).toBe("attachment-b");

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
