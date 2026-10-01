import path from "node:path";

import type {
  AttachmentParseJobClaimFilters,
  AttachmentParseJobRecord,
  ParserRuntimeStore,
} from "../contracts/runtime.js";

import type { ParserArtifactKind } from "../contracts/artifact.js";
import type { ParserRegistry } from "../registry/registry.js";
import { type FfmpegToolOptions } from "../adapters/ffmpeg.js";
import {
  redactSensitiveText,
  removeVaultDirectoryIfExists,
} from "../shared.js";
import { parseAttachment, type ParseAttachmentResult } from "./parse-attachment.js";
import { resolveAttachmentArtifact } from "./resolve-attachment-artifact.js";
import { writeParserResult } from "../publish/writer.js";

export interface RunAttachmentParseJobResult {
  status: "failed" | "succeeded";
  job: AttachmentParseJobRecord;
  providerId?: string;
  resultPath?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface RunAttachmentParseWorkerInput {
  vaultRoot: string;
  runtime: ParserRuntimeStore;
  registry: ParserRegistry;
  scratchRoot?: string;
  ffmpeg?: FfmpegToolOptions;
  maxJobs?: number;
  jobFilters?: AttachmentParseJobClaimFilters;
  signal?: AbortSignal;
}

export async function runAttachmentParseJobOnce(input: RunAttachmentParseWorkerInput): Promise<RunAttachmentParseJobResult | null> {
  const result = await runAttachmentParseJobAttempt(input);
  if (result === STALE_PARSE_ATTEMPT) {
    return null;
  }

  return result;
}

export async function runAttachmentParseWorker(input: RunAttachmentParseWorkerInput): Promise<RunAttachmentParseJobResult[]> {
  const results: RunAttachmentParseJobResult[] = [];
  const maxJobs = input.maxJobs ?? Number.POSITIVE_INFINITY;

  while (results.length < maxJobs) {
    if (input.signal?.aborted) {
      break;
    }

    const result = await runAttachmentParseJobAttempt(input);
    if (result === null) {
      break;
    }
    if (result === STALE_PARSE_ATTEMPT) {
      continue;
    }
    results.push(result);
  }

  return results;
}

const STALE_PARSE_ATTEMPT = Symbol("stale-parse-attempt");

/** A claimed attempt. Always complete it before closing its runtime, even on caller cancellation. */
export interface PreparedAttachmentParseJob {
  /** Settles after external preparation, including scratch cleanup; never rejects. */
  readonly ready: Promise<void>;
  /** Publish/finalize through the original attempt fence, once, in caller order. */
  complete(): Promise<RunAttachmentParseJobResult | null>;
}

type AttachmentParsePreparation =
  | { status: "prepared"; parsed: ParseAttachmentResult; transcriptOnly: boolean }
  | { status: "failed"; error: unknown };

/** Claim synchronously; overlap only artifact reading/parsing, not publication or finalization. */
export function prepareAttachmentParseJobOnce(
  input: RunAttachmentParseWorkerInput,
): PreparedAttachmentParseJob | null {
  const attempt = prepareAttachmentParseJobAttempt(input);
  if (!attempt) return null;
  return {
    ready: attempt.ready,
    async complete() {
      const result = await attempt.complete();
      return result === STALE_PARSE_ATTEMPT ? null : result;
    },
  };
}

function prepareAttachmentParseJobAttempt(input: RunAttachmentParseWorkerInput) {
  if (input.signal?.aborted) return null;
  const job = input.runtime.claimNextAttachmentParseJob(input.jobFilters);
  if (!job) return null;

  const preparation: Promise<AttachmentParsePreparation> = (async () => {
    const artifact = await resolveAttachmentArtifact({
      vaultRoot: input.vaultRoot,
      runtime: input.runtime,
      captureId: job.captureId,
      attachmentId: job.attachmentId,
    });
    const parsed = await parseAttachment({
      artifact,
      registry: input.registry,
      scratchRoot: input.scratchRoot ?? path.join(input.vaultRoot, ".runtime", "parsers"),
      ffmpeg: input.ffmpeg,
      signal: input.signal,
    });
    return { status: "prepared" as const, parsed, transcriptOnly: isTranscriptOnlyArtifact(artifact.kind) };
  })().catch((error: unknown) => ({ status: "failed" as const, error }));
  let completion: ReturnType<typeof completeAttachmentParseJobAttempt> | null = null;
  return {
    ready: preparation.then(() => undefined),
    complete() {
      // Memoize before awaiting: retries/cleanup cannot publish or bill a second attempt.
      completion ??= completeAttachmentParseJobAttempt(input, job, preparation);
      return completion;
    },
  };
}

async function runAttachmentParseJobAttempt(
  input: RunAttachmentParseWorkerInput,
): Promise<RunAttachmentParseJobResult | typeof STALE_PARSE_ATTEMPT | null> {
  return await (prepareAttachmentParseJobAttempt(input)?.complete() ?? null);
}

async function completeAttachmentParseJobAttempt(
  input: RunAttachmentParseWorkerInput,
  job: AttachmentParseJobRecord,
  preparation: Promise<AttachmentParsePreparation>,
): Promise<RunAttachmentParseJobResult | typeof STALE_PARSE_ATTEMPT | null> {
  let publishedAttemptDirectoryPath: string | null = null;
  let keepPublishedAttempt = false;

  try {
    const prepared = await preparation;
    if (prepared.status === "failed") throw prepared.error;
    const { parsed, transcriptOnly } = prepared;
    if (input.signal?.aborted) {
      input.runtime.requeueAttachmentParseJobs({
        attachmentId: job.attachmentId,
        captureId: job.captureId,
        state: "running",
      });
      return null;
    }
    const published = await writeParserResult({
      attempt: job.attempts,
      vaultRoot: input.vaultRoot,
      output: parsed.output,
    });
    publishedAttemptDirectoryPath = published.attemptDirectoryPath;
    if (input.signal?.aborted) {
      input.runtime.requeueAttachmentParseJobs({
        attachmentId: job.attachmentId,
        captureId: job.captureId,
        state: "running",
      });
      return null;
    }
    const completedJob = input.runtime.completeAttachmentParseJob({
      attempt: job.attempts,
      jobId: job.jobId,
      providerId: parsed.providerId,
      resultPath: published.resultPath,
      extractedText: transcriptOnly ? null : parsed.output.text,
      transcriptText: transcriptOnly ? parsed.output.text : null,
    });
    if (!completedJob.applied) {
      return STALE_PARSE_ATTEMPT;
    }
    keepPublishedAttempt = true;

    return {
      status: "succeeded",
      job: completedJob.job,
      providerId: parsed.providerId,
      resultPath: published.resultPath,
    };
  } catch (error) {
    if (input.signal?.aborted) {
      input.runtime.requeueAttachmentParseJobs({
        attachmentId: job.attachmentId,
        captureId: job.captureId,
        state: "running",
      });
      return null;
    }

    const errorMessage = redactSensitiveText(error instanceof Error ? error.message : String(error));
    const errorCode = classifyParseError(errorMessage);
    const failedJob = input.runtime.failAttachmentParseJob({
      attempt: job.attempts,
      jobId: job.jobId,
      errorCode,
      errorMessage,
    });
    if (!failedJob.applied) {
      return STALE_PARSE_ATTEMPT;
    }

    return {
      status: "failed",
      job: failedJob.job,
      errorCode,
      errorMessage,
    };
  } finally {
    if (publishedAttemptDirectoryPath && !keepPublishedAttempt) {
      await removePublishedArtifacts(input.vaultRoot, publishedAttemptDirectoryPath);
    }
  }
}

function isTranscriptOnlyArtifact(kind: ParserArtifactKind): boolean {
  return kind === "audio" || kind === "video";
}

function classifyParseError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("ffmpeg")) {
    return "ffmpeg_unavailable";
  }
  if (normalized.includes("no parser provider") || normalized.includes("not found")) {
    return "provider_unavailable";
  }
  if (normalized.includes("unknown inbox attachment") || normalized.includes("unknown inbox capture")) {
    return "missing_attachment";
  }

  return "parser_failed";
}

async function removePublishedArtifacts(
  vaultRoot: string,
  attemptDirectoryPath: string,
): Promise<void> {
  await removeVaultDirectoryIfExists(vaultRoot, attemptDirectoryPath);
}
