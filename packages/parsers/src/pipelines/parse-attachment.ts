import { promises as fs } from "node:fs";
import path from "node:path";

import {
  normalizeParserArtifactIdentity,
  type ParserArtifactRef,
} from "../contracts/artifact.js";
import { normalizeParserOutput } from "../contracts/parser-output.js";
import type {
  ParseRequest,
  ParserOutput,
} from "../contracts/parse.js";
import type { ParserRegistry } from "../registry/registry.js";
import { prepareAudioInput, type FfmpegToolOptions } from "../adapters/ffmpeg.js";
import {
  ensureDirectory,
  removeDirectoryIfExists,
} from "../shared.js";

export interface ParseAttachmentInput {
  artifact: ParserArtifactRef;
  registry: ParserRegistry;
  scratchRoot: string;
  ffmpeg?: FfmpegToolOptions;
  signal?: AbortSignal;
}

export interface ParseAttachmentResult {
  providerId: string;
  output: ParserOutput;
}

export async function parseAttachment(input: ParseAttachmentInput): Promise<ParseAttachmentResult> {
  throwIfParseAborted(input.signal);
  const artifact = normalizeParserArtifactIdentity(input.artifact);
  const scratchRoot = path.resolve(input.scratchRoot);
  await ensureDirectory(scratchRoot);
  const scratchDirectory = await fs.mkdtemp(path.join(scratchRoot, "attachment-"));

  try {
    const preparedMedia = await prepareAudioInput({
      artifact,
      scratchDirectory,
      ffmpeg: input.ffmpeg,
      signal: input.signal,
    });
    throwIfParseAborted(input.signal);
    const request: ParseRequest = {
      intent: "attachment_text",
      artifact,
      inputPath: preparedMedia.inputPath,
      preparedKind: preparedMedia.preparedKind,
      scratchDirectory,
      signal: input.signal,
    };
    const { selection, result } = await input.registry.run(request);
    const output = normalizeParserOutput({
      artifact,
      providerId: selection.provider.id,
      result,
    });

    return {
      providerId: selection.provider.id,
      output,
    };
  } finally {
    await removeDirectoryIfExists(scratchDirectory);
  }
}

function throwIfParseAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Parser attachment parse aborted.");
  }
}
