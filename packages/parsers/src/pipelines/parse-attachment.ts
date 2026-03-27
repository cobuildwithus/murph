import { promises as fs } from "node:fs";
import path from "node:path";

import {
  normalizeParserArtifactIdentity,
  type ParserArtifactRef,
} from "../contracts/artifact.js";
import type { ParseRequest, ParserOutput, ProviderRunResult } from "../contracts/parse.js";
import type { ParserRegistry } from "../registry/registry.js";
import { prepareAudioInput, type FfmpegToolOptions } from "../adapters/ffmpeg.js";
import {
  buildMarkdown,
  ensureDirectory,
  removeDirectoryIfExists,
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
  const artifact = normalizeParserArtifactIdentity(input.artifact);
  const scratchRoot = path.resolve(input.scratchRoot);
  await ensureDirectory(scratchRoot);
  const scratchDirectory = await fs.mkdtemp(path.join(scratchRoot, "attachment-"));

  try {
    const preparedMedia = await prepareAudioInput({
      artifact,
      scratchDirectory,
      ffmpeg: input.ffmpeg,
    });
    const request: ParseRequest = {
      intent: "attachment_text",
      artifact,
      inputPath: preparedMedia.inputPath,
      preparedKind: preparedMedia.preparedKind,
      scratchDirectory,
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
    schema: "murph.parser-output.v1",
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
