import path from "node:path";

import {
  normalizeRelativeVaultPath,
  walkVaultFiles,
} from "@murphai/core";

export async function listInboxParserArtifactPathsNewestFirst(input: {
  attachmentId: string;
  captureId: string;
  vaultRoot: string;
}): Promise<string[]> {
  const attemptsDirectory = normalizeRelativeVaultPath(
    path.posix.join(
      "derived/inbox",
      input.captureId,
      "attachments",
      input.attachmentId,
      "attempts",
    ),
  );
  const artifacts = (await walkVaultFiles(input.vaultRoot, attemptsDirectory, {
    extension: ".json",
  })).filter((relativePath) => {
    const fileName = path.posix.basename(relativePath);
    return fileName === "result.json" || fileName === "manifest.json";
  });

  return artifacts.sort().reverse();
}
