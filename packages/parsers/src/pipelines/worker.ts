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
import { redactSensitiveText } from "../shared.js";
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
}

export async function runAttachmentParseJobOnce(input: RunAttachmentParseWorkerInput): Promise<RunAttachmentParseJobResult | null> {
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
      vaultRoot: input.vaultRoot,
      output: parsed.output,
    });
    const transcriptOnly = isTranscriptOnlyArtifact(artifact.kind);
    const completedJob = input.runtime.completeAttachmentParseJob({
      jobId: job.jobId,
      providerId: parsed.providerId,
      resultPath: published.manifestPath,
      extractedText: transcriptOnly ? null : parsed.output.text,
      transcriptText: transcriptOnly ? parsed.output.text : null,
    });

    return {
      status: "succeeded",
      job: completedJob,
      providerId: parsed.providerId,
      manifestPath: published.manifestPath,
    };
  } catch (error) {
    const errorMessage = redactSensitiveText(error instanceof Error ? error.message : String(error));
    const errorCode = classifyParseError(errorMessage);
    const failedJob = input.runtime.failAttachmentParseJob({
      jobId: job.jobId,
      errorCode,
      errorMessage,
    });

    return {
      status: "failed",
      job: failedJob,
      errorCode,
      errorMessage,
    };
  }
}

export async function runAttachmentParseWorker(input: RunAttachmentParseWorkerInput): Promise<RunAttachmentParseJobResult[]> {
  const results: RunAttachmentParseJobResult[] = [];
  const maxJobs = input.maxJobs ?? Number.POSITIVE_INFINITY;

  while (results.length < maxJobs) {
    const result = await runAttachmentParseJobOnce(input);
    if (!result) {
      break;
    }
    results.push(result);
  }

  return results;
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
