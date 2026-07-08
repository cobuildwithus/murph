import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  createEmptyProfileDocument,
  parseProfileDocument,
  profileDocumentRelativePath,
  renderProfileDocument,
  type ProfileDocumentSnapshot,
} from "@murphai/contracts";

export type { ProfileDocumentSnapshot } from "@murphai/contracts";

export async function readProfileDocumentRuntime(
  vaultRoot: string,
): Promise<ProfileDocumentSnapshot> {
  const sourcePath = path.join(vaultRoot, profileDocumentRelativePath);

  try {
    const markdown = await readFile(sourcePath, "utf8");
    return {
      ...parseProfileDocument({ text: markdown }),
      exists: true,
      markdown,
      sourcePath: profileDocumentRelativePath,
    };
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    const document = createEmptyProfileDocument();
    return {
      ...document,
      exists: false,
      markdown: renderProfileDocument(document),
      sourcePath: profileDocumentRelativePath,
    };
  }
}

export async function readProfileDisplayNameRuntime(
  vaultRoot: string,
): Promise<string | null> {
  const snapshot = await readProfileDocumentRuntime(vaultRoot);
  return snapshot.frontmatter.displayName;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}
