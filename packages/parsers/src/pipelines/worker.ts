import path from "node:path";

import type {
  AttachmentParseJobClaimFilters,
  AttachmentParseJobRecord,
  InboxRuntimeStore,
} from "@healthybob/inboxd";

import type { ParserArtifactKind } from "../contracts/artifact.js";
import type { ParserRegistry } from "../registry/registry.js";
import { resolveInboxAttachmentArtifact } from "../inboxd/bridge.js";
import { type FfmpegToolOptions } from "../adapters/ffmpeg.js";
import {
  redactSensitiveText,
  removeVaultDirectoryIfExists,
} from "../shared.js";
import { parseAttachment } from "./parse-attachment.js";
import { writeParserArtifacts } from "../publish/writer.js";

export interface RunAttachmentParseJobResult {
  status: "failed" | "succeeded";
  job: AttachmentParseJobRecord;
  providerId?: string;
  manifestPath?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface RunAttachmentParseWorkerInput {
  vaultRoot: string;
  runtime: InboxRuntimeStore;
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

async function runAttachmentParseJobAttempt(
  input: RunAttachmentParseWorkerInput,
): Promise<RunAttachmentParseJobResult | typeof STALE_PARSE_ATTEMPT | null> {
  if (input.signal?.aborted) {
    return null;
  }

  const job = input.runtime.claimNextAttachmentParseJob(input.jobFilters);
  if (!job) {
    return null;
  }

  try {
    const artifact = await resolveInboxAttachmentArtifact({
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
    });
    const published = await writeParserArtifacts({
      attempt: job.attempts,
      vaultRoot: input.vaultRoot,
      output: parsed.output,
    });
    const transcriptOnly = isTranscriptOnlyArtifact(artifact.kind);
    const completedJob = input.runtime.completeAttachmentParseJob({
      attempt: job.attempts,
      jobId: job.jobId,
      providerId: parsed.providerId,
      resultPath: published.manifestPath,
      extractedText: transcriptOnly ? null : parsed.output.text,
      transcriptText: transcriptOnly ? parsed.output.text : null,
    });
    if (!completedJob.applied) {
      await removePublishedArtifacts(input.vaultRoot, published.attemptDirectoryPath);
      return STALE_PARSE_ATTEMPT;
    }

    return {
      status: "succeeded",
      job: completedJob.job,
      providerId: parsed.providerId,
      manifestPath: published.manifestPath,
    };
  } catch (error) {
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
