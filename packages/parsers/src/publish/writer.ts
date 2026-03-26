import path from "node:path";
import { promises as fs } from "node:fs";

import { normalizeParserArtifactIdentity } from "../contracts/artifact.js";
import type { ParserOutput } from "../contracts/parse.js";
import {
  normalizeRelativePath,
  removeVaultDirectoryIfExists,
  resolveVaultRelativePath,
  resetVaultDirectory,
} from "../shared.js";

export interface PublishedParserArtifacts {
  attemptDirectoryPath: string;
  manifestPath: string;
  plainTextPath: string;
  markdownPath: string;
  chunksPath: string;
  tablesPath?: string | null;
}

const DERIVED_INBOX_ROOT = normalizeRelativePath("derived/inbox");

export async function writeParserArtifacts(input: {
  attempt: number;
  vaultRoot: string;
  output: ParserOutput;
}): Promise<PublishedParserArtifacts> {
  const artifact = normalizeParserArtifactIdentity(input.output.artifact);
  const baseDirectory = normalizePublishedParserPath(
    path.posix.join(
      DERIVED_INBOX_ROOT,
      artifact.captureId,
      "attachments",
      artifact.attachmentId,
    ),
  );
  const attemptDirectoryPath = normalizePublishedParserPath(
    path.posix.join(
      baseDirectory,
      "attempts",
      String(input.attempt).padStart(4, "0"),
    ),
  );
  await resetVaultDirectory(input.vaultRoot, attemptDirectoryPath);

  const plainTextPath = normalizePublishedParserPath(path.posix.join(attemptDirectoryPath, "plain.txt"));
  const markdownPath = normalizePublishedParserPath(path.posix.join(attemptDirectoryPath, "normalized.md"));
  const chunksPath = normalizePublishedParserPath(path.posix.join(attemptDirectoryPath, "chunks.jsonl"));
  const manifestPath = normalizePublishedParserPath(path.posix.join(attemptDirectoryPath, "manifest.json"));
  const tablesPath = input.output.tables.length > 0
    ? normalizePublishedParserPath(path.posix.join(attemptDirectoryPath, "tables.json"))
    : null;

  try {
    await fs.writeFile(
      await resolveVaultRelativePath(input.vaultRoot, plainTextPath),
      `${input.output.text.trim()}\n`,
      "utf8",
    );
    await fs.writeFile(
      await resolveVaultRelativePath(input.vaultRoot, markdownPath),
      `${input.output.markdown.trim()}\n`,
      "utf8",
    );
    await fs.writeFile(
      await resolveVaultRelativePath(input.vaultRoot, chunksPath),
      input.output.blocks.map((block) => JSON.stringify(block)).join("\n") + (input.output.blocks.length > 0 ? "\n" : ""),
      "utf8",
    );

    if (tablesPath) {
      await fs.writeFile(
        await resolveVaultRelativePath(input.vaultRoot, tablesPath),
        `${JSON.stringify(input.output.tables, null, 2)}\n`,
        "utf8",
      );
    }

    await fs.writeFile(
      await resolveVaultRelativePath(input.vaultRoot, manifestPath),
      `${JSON.stringify(
        {
          schema: "healthybob.parser-manifest.v1",
          providerId: input.output.providerId,
          createdAt: input.output.createdAt,
          artifact,
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
  } catch (error) {
    await removeVaultDirectoryIfExists(input.vaultRoot, attemptDirectoryPath);
    throw error;
  }

  return {
    attemptDirectoryPath,
    manifestPath,
    plainTextPath,
    markdownPath,
    chunksPath,
    tablesPath,
  };
}

function normalizePublishedParserPath(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);

  if (
    normalized !== DERIVED_INBOX_ROOT &&
    !normalized.startsWith(`${DERIVED_INBOX_ROOT}/`)
  ) {
    throw new TypeError("Published parser artifacts must stay within derived/inbox.");
  }

  return normalized;
}
