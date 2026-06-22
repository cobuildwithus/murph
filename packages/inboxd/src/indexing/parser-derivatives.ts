import path from "node:path";

import {
  normalizeRelativeVaultPath,
  walkVaultFiles,
} from "@murphai/core";

export async function findLatestInboxParserManifestPath(input: {
  attachmentId: string;
  captureId: string;
  vaultRoot: string;
}): Promise<string | null> {
  const attemptsDirectory = normalizeRelativeVaultPath(
    path.posix.join(
      "derived/inbox",
      input.captureId,
      "attachments",
      input.attachmentId,
      "attempts",
    ),
  );
  const manifests = (await walkVaultFiles(input.vaultRoot, attemptsDirectory, {
    extension: ".json",
  })).filter((relativePath) => path.posix.basename(relativePath) === "manifest.json");

  return manifests.sort().at(-1) ?? null;
}
