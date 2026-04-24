import path from "node:path";
import { promises as fs } from "node:fs";

import { normalizeParserArtifactIdentity } from "../contracts/artifact.js";
import type { ParserOutput } from "../contracts/parse.js";
import {
  assertVaultPathOnDisk,
  normalizeRelativePath,
  removeVaultDirectoryIfExists,
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
const PARSER_ARTIFACT_DIRECTORY_MODE = 0o700;
const PARSER_ARTIFACT_FILE_MODE = 0o600;

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
  const absoluteAttemptDirectoryPath = await resetVaultDirectory(input.vaultRoot, attemptDirectoryPath);
  await fs.chmod(absoluteAttemptDirectoryPath, PARSER_ARTIFACT_DIRECTORY_MODE);

  const plainTextPath = normalizePublishedParserPath(path.posix.join(attemptDirectoryPath, "plain.txt"));
  const markdownPath = normalizePublishedParserPath(path.posix.join(attemptDirectoryPath, "normalized.md"));
  const chunksPath = normalizePublishedParserPath(path.posix.join(attemptDirectoryPath, "chunks.jsonl"));
  const manifestPath = normalizePublishedParserPath(path.posix.join(attemptDirectoryPath, "manifest.json"));
  const tablesPath = input.output.tables.length > 0
    ? normalizePublishedParserPath(path.posix.join(attemptDirectoryPath, "tables.json"))
    : null;
  const absolutePlainTextPath = path.join(absoluteAttemptDirectoryPath, "plain.txt");
  const absoluteMarkdownPath = path.join(absoluteAttemptDirectoryPath, "normalized.md");
  const absoluteChunksPath = path.join(absoluteAttemptDirectoryPath, "chunks.jsonl");
  const absoluteManifestPath = path.join(absoluteAttemptDirectoryPath, "manifest.json");
  const absoluteTablesPath = tablesPath === null ? null : path.join(absoluteAttemptDirectoryPath, "tables.json");

  try {
    await writeValidatedArtifactFile(input.vaultRoot, absolutePlainTextPath, `${input.output.text.trim()}\n`);
    await writeValidatedArtifactFile(input.vaultRoot, absoluteMarkdownPath, `${input.output.markdown.trim()}\n`);
    await writeValidatedArtifactFile(
      input.vaultRoot,
      absoluteChunksPath,
      input.output.blocks.map((block) => JSON.stringify(block)).join("\n") + (input.output.blocks.length > 0 ? "\n" : ""),
    );

    if (absoluteTablesPath) {
      await writeValidatedArtifactFile(
        input.vaultRoot,
        absoluteTablesPath,
        `${JSON.stringify(input.output.tables, null, 2)}\n`,
      );
    }

    await writeValidatedArtifactFile(
      input.vaultRoot,
      absoluteManifestPath,
      `${JSON.stringify(
        {
          schema: "murph.parser-manifest.v1",
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

async function writeValidatedArtifactFile(
  vaultRoot: string,
  absolutePath: string,
  content: string,
): Promise<void> {
  await assertVaultPathOnDisk(vaultRoot, absolutePath);
  await fs.writeFile(absolutePath, content, {
    encoding: "utf8",
    mode: PARSER_ARTIFACT_FILE_MODE,
  });
  await fs.chmod(absolutePath, PARSER_ARTIFACT_FILE_MODE);
}
