import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { initializeVault } from "@murphai/core";
import { test } from "vitest";

import type {
  AttachmentParseJobFinalizeResult,
  AttachmentParseJobRecord,
  CompleteAttachmentParseJobInput,
  FailAttachmentParseJobInput,
  ParserRuntimeCaptureRecord,
  ParserRuntimeStore,
  RequeueAttachmentParseJobsInput,
} from "../src/contracts/runtime.js";
import { resolveAttachmentArtifact } from "../src/pipelines/resolve-attachment-artifact.js";
import { runAttachmentParseJobOnce } from "../src/pipelines/worker.js";
import { createParserRegistry } from "../src/registry/registry.js";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function writeFile(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(directory, fileName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

function createCaptureRuntime(options: {
  capture: ParserRuntimeCaptureRecord | null;
  job?: AttachmentParseJobRecord | null;
}): ParserRuntimeStore & {
  failedInput: FailAttachmentParseJobInput | null;
  completedInput: CompleteAttachmentParseJobInput | null;
} {
  let job = options.job ?? null;
  let failedInput: FailAttachmentParseJobInput | null = null;
  let completedInput: CompleteAttachmentParseJobInput | null = null;

  return {
    claimNextAttachmentParseJob(): AttachmentParseJobRecord | null {
      if (!job || job.state !== "pending") {
        return null;
      }

      job = {
        ...job,
        state: "running",
        attempts: job.attempts + 1,
      };
      return job;
    },
    completeAttachmentParseJob(
      input: CompleteAttachmentParseJobInput,
    ): AttachmentParseJobFinalizeResult {
      completedInput = input;
      assert.fail("worker should not complete parse jobs in raw attachment root guard tests");
    },
    failAttachmentParseJob(input: FailAttachmentParseJobInput): AttachmentParseJobFinalizeResult {
      failedInput = input;
      const failedJob: AttachmentParseJobRecord = {
        ...(job ?? assert.fail("worker should only fail an active job")),
        state: "failed",
        attempts: input.attempt,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage,
        providerId: input.providerId ?? null,
        finishedAt: input.finishedAt ?? null,
      };
      job = failedJob;
      return {
        applied: true,
        job: failedJob,
      };
    },
    getCapture(captureId: string): ParserRuntimeCaptureRecord | null {
      if (captureId !== options.capture?.captureId) {
        return null;
      }

      return options.capture;
    },
    requeueAttachmentParseJobs(_filters?: RequeueAttachmentParseJobsInput): number {
      return 0;
    },
    get failedInput(): FailAttachmentParseJobInput | null {
      return failedInput;
    },
    get completedInput(): CompleteAttachmentParseJobInput | null {
      return completedInput;
    },
  };
}

function buildCapture(storedPath: string): ParserRuntimeCaptureRecord {
  return {
    captureId: "cap_example",
    attachments: [{
      attachmentId: "att_example",
      byteSize: 8,
      fileName: "attachment.txt",
      kind: "document",
      mime: "text/plain",
      sha256: "sha-example",
      storedPath,
    }],
  };
}

test("resolveAttachmentArtifact normalizes accepted raw inbox stored paths", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsers-raw-root-accept");
  const normalizedStoredPath = "raw/inbox/example/attachment.txt";
  await initializeVault({
    createdAt: "2026-04-23T00:00:00.000Z",
    vaultRoot,
  });
  await writeFile(vaultRoot, normalizedStoredPath, "artifact");

  const artifact = await resolveAttachmentArtifact({
    attachmentId: "att_example",
    captureId: "cap_example",
    runtime: createCaptureRuntime({
      capture: buildCapture("raw/inbox/example/nested/../attachment.txt"),
    }),
    vaultRoot,
  });

  assert.equal(artifact.storedPath, normalizedStoredPath);
  assert.equal(artifact.absolutePath, path.join(vaultRoot, normalizedStoredPath));
});

test("resolveAttachmentArtifact rejects non-raw in-vault stored paths", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsers-raw-root-reject");
  await initializeVault({
    createdAt: "2026-04-23T00:00:00.000Z",
    vaultRoot,
  });

  for (const storedPath of [
    "derived/inbox/example/attachment.txt",
    "derived/knowledge/example.md",
    "raw/inbox/example/../../derived/inbox/escape.txt",
  ]) {
    const normalizedStoredPath = storedPath.startsWith("raw/inbox/")
      ? path.posix.normalize(storedPath)
      : storedPath;
    await writeFile(vaultRoot, normalizedStoredPath, "artifact");

    await assert.rejects(
      resolveAttachmentArtifact({
        attachmentId: "att_example",
        captureId: "cap_example",
        runtime: createCaptureRuntime({
          capture: buildCapture(storedPath),
        }),
        vaultRoot,
      }),
      /Unknown inbox attachment: att_example \(stored path must stay within raw\/inbox\)\./u,
    );
  }
});

test("attachment parse worker fails closed on non-raw stored paths with missing attachment classification", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsers-raw-root-worker");
  await initializeVault({
    createdAt: "2026-04-23T00:00:00.000Z",
    vaultRoot,
  });
  await writeFile(vaultRoot, "derived/inbox/example/attachment.txt", "artifact");

  const runtime = createCaptureRuntime({
    capture: buildCapture("derived/inbox/example/attachment.txt"),
    job: {
      jobId: "job_example",
      captureId: "cap_example",
      attachmentId: "att_example",
      pipeline: "attachment_text",
      state: "pending",
      attempts: 0,
      createdAt: "2026-04-23T00:00:00.000Z",
    },
  });
  let providerRuns = 0;

  const result = await runAttachmentParseJobOnce({
    vaultRoot,
    runtime,
    registry: createParserRegistry([
      {
        id: "unexpected-provider-run",
        locality: "local",
        openness: "open_source",
        runtime: "node",
        priority: 100,
        async discover() {
          return {
            available: true,
            reason: "available for raw attachment root guard test",
          };
        },
        supports() {
          return true;
        },
        async run() {
          providerRuns += 1;
          return {
            text: "should not run",
          };
        },
      },
    ]),
  });

  assert.ok(result);
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "missing_attachment");
  assert.match(result.errorMessage ?? "", /stored path must stay within raw\/inbox/u);
  assert.equal(providerRuns, 0);
  assert.equal(runtime.failedInput?.errorCode, "missing_attachment");
  assert.equal(runtime.completedInput, null);
});
