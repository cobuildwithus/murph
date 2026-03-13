import path from "node:path";

import type { ParserArtifactRef } from "../contracts/artifact.js";
import type { ParseRequest, ParserOutput, ProviderRunResult } from "../contracts/parse.js";
import type { ParserRegistry } from "../registry/registry.js";
import { prepareAudioInput, type FfmpegToolOptions } from "../adapters/ffmpeg.js";
import {
  buildMarkdown,
  ensureDirectory,
  splitTextIntoBlocks,
  toArtifactSummary,
} from "../shared.js";

export interface ParseAttachmentInput {
  artifact: ParserArtifactRef;
  registry: ParserRegistry;
  scratchRoot: string;
  ffmpeg?: FfmpegToolOptions;
}

export interface ParseAttachmentResult {
  providerId: string;
  output: ParserOutput;
}

export async function parseAttachment(input: ParseAttachmentInput): Promise<ParseAttachmentResult> {
  const scratchDirectory = path.resolve(input.scratchRoot, input.artifact.attachmentId);
  await ensureDirectory(scratchDirectory);

  const preparedMedia = await prepareAudioInput({
    artifact: input.artifact,
    scratchDirectory,
    ffmpeg: input.ffmpeg,
  });
  const request: ParseRequest = {
    intent: "attachment_text",
    artifact: input.artifact,
    inputPath: preparedMedia.inputPath,
    preparedKind: preparedMedia.preparedKind,
    scratchDirectory,
  };
  const { selection, result } = await input.registry.run(request);
  const output = normalizeParserOutput({
    artifact: input.artifact,
    providerId: selection.provider.id,
    result,
  });

  return {
    providerId: selection.provider.id,
    output,
  };
}

function normalizeParserOutput(input: {
  artifact: ParserArtifactRef;
  providerId: string;
  result: ProviderRunResult;
}): ParserOutput {
  const text = input.result.text.trim();
  const blocks =
    input.result.blocks && input.result.blocks.length > 0
      ? input.result.blocks
      : splitTextIntoBlocks(text, { defaultKind: "paragraph" });
  const markdown = input.result.markdown?.trim() || buildMarkdown(text, blocks);

  return {
    schema: "healthybob.parser-output.v1",
    providerId: input.providerId,
    artifact: toArtifactSummary(input.artifact),
    text,
    markdown,
    blocks,
    tables: input.result.tables ?? [],
    metadata: input.result.metadata ?? {},
    createdAt: new Date().toISOString(),
  };
}
