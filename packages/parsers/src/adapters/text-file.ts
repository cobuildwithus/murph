import type { ParseRequest, ProviderRunResult } from "../contracts/parse.js";
import type { ParserProvider } from "../contracts/provider.js";
import {
  assertFileSizeAtMost,
  buildMarkdown,
  DEFAULT_TEXT_FILE_PROVIDER_MAX_INPUT_BYTES,
  isTextLikeArtifact,
  readUtf8IfExists,
  splitTextIntoBlocks,
} from "../shared.js";

export function createTextFileProvider(options: {
  maxInputBytes?: number;
} = {}): ParserProvider {
  return {
    id: "text-file",
    locality: "local",
    openness: "open_source",
    runtime: "node",
    priority: 1_000,
    async discover() {
      return {
        available: true,
        reason: "Node filesystem reader is always available.",
      };
    },
    supports(request: ParseRequest) {
      const kind = request.preparedKind ?? request.artifact.kind;
      return (
        (kind === "document" || kind === "other") &&
        isTextLikeArtifact(request.artifact.fileName, request.artifact.mime)
      );
    },
    async run(request): Promise<ProviderRunResult> {
      const maxInputBytes =
        options.maxInputBytes ?? DEFAULT_TEXT_FILE_PROVIDER_MAX_INPUT_BYTES;
      await assertFileSizeAtMost(request.inputPath, maxInputBytes, "Text attachment");
      const content = await readUtf8IfExists(request.inputPath, {
        maxBytes: maxInputBytes,
      }) ?? "";
      const trimmed = content.trim();
      const isMarkdown = request.artifact.fileName?.toLowerCase().endsWith(".md") ?? false;
      const blocks = splitTextIntoBlocks(trimmed, {
        defaultKind: isMarkdown ? "paragraph" : "line",
      });

      return {
        text: trimmed,
        markdown: isMarkdown ? trimmed : buildMarkdown(trimmed, blocks),
        blocks,
        metadata: {},
      };
    },
  };
}
