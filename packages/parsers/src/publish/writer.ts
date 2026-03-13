import path from "node:path";
import { promises as fs } from "node:fs";

import type { ParserOutput } from "../contracts/parse.js";
import { ensureDirectory, normalizeRelativePath, resolveVaultRelativePath } from "../shared.js";

export interface PublishedParserArtifacts {
  manifestPath: string;
  plainTextPath: string;
  markdownPath: string;
  chunksPath: string;
  tablesPath?: string | null;
}

export async function writeParserArtifacts(input: {
  vaultRoot: string;
  output: ParserOutput;
}): Promise<PublishedParserArtifacts> {
  const baseDirectory = normalizeRelativePath(
    path.posix.join(
      "derived",
      "inbox",
      input.output.artifact.captureId,
      "attachments",
      input.output.artifact.attachmentId,
    ),
  );
  const absoluteBaseDirectory = resolveVaultRelativePath(input.vaultRoot, baseDirectory);
  await ensureDirectory(absoluteBaseDirectory);

  const plainTextPath = normalizeRelativePath(path.posix.join(baseDirectory, "plain.txt"));
  const markdownPath = normalizeRelativePath(path.posix.join(baseDirectory, "normalized.md"));
  const chunksPath = normalizeRelativePath(path.posix.join(baseDirectory, "chunks.jsonl"));
  const manifestPath = normalizeRelativePath(path.posix.join(baseDirectory, "manifest.json"));
  const tablesPath = input.output.tables.length > 0
    ? normalizeRelativePath(path.posix.join(baseDirectory, "tables.json"))
    : null;

  await fs.writeFile(resolveVaultRelativePath(input.vaultRoot, plainTextPath), `${input.output.text.trim()}\n`, "utf8");
  await fs.writeFile(resolveVaultRelativePath(input.vaultRoot, markdownPath), `${input.output.markdown.trim()}\n`, "utf8");
  await fs.writeFile(
    resolveVaultRelativePath(input.vaultRoot, chunksPath),
    input.output.blocks.map((block) => JSON.stringify(block)).join("\n") + (input.output.blocks.length > 0 ? "\n" : ""),
    "utf8",
  );

  if (tablesPath) {
    await fs.writeFile(
      resolveVaultRelativePath(input.vaultRoot, tablesPath),
      `${JSON.stringify(input.output.tables, null, 2)}\n`,
      "utf8",
    );
  }

  await fs.writeFile(
    resolveVaultRelativePath(input.vaultRoot, manifestPath),
    `${JSON.stringify(
      {
        schema: "healthybob.parser-manifest.v1",
        providerId: input.output.providerId,
        createdAt: input.output.createdAt,
        artifact: input.output.artifact,
        metadata: input.output.metadata,
        paths: {
          plainTextPath,
          markdownPath,
          chunksPath,
          tablesPath,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    manifestPath,
    plainTextPath,
    markdownPath,
    chunksPath,
    tablesPath,
  };
}
