import { promises as fs } from "node:fs";

import type { ParseRequest, ProviderRunResult } from "../contracts/parse.js";
import type { ParserProvider } from "../contracts/provider.js";
import { buildMarkdown, isTextLikeArtifact, splitTextIntoBlocks } from "../shared.js";

export function createTextFileProvider(): ParserProvider {
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
      const content = await fs.readFile(request.inputPath, "utf8");
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
