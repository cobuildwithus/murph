import {
  createEmptyProfileDocument,
  parseProfileDocument,
  profileDocumentRelativePath,
  renderProfileDocument,
  setProfileDisplayName as setProfileDocumentDisplayName,
  type ProfileDocumentSnapshot,
} from "@murphai/contracts";

import {
  pathExists,
  readUtf8File,
} from "./fs.ts";
import {
  resolveSingletonMarkdownDocumentTarget,
  writeCanonicalMarkdownDocument,
} from "./markdown-documents.ts";
import {
  canonicalPathResourceForVault,
  withCanonicalResourceLocks,
} from "./operations/index.ts";
import { resolveVaultPath } from "./path-safety.ts";

export type { ProfileDocumentSnapshot } from "@murphai/contracts";

export interface SetProfileDisplayNameInput {
  displayName: string;
  now?: Date;
}

export async function readProfileDocument(
  vaultRoot: string,
): Promise<ProfileDocumentSnapshot> {
  const resolved = resolveVaultPath(vaultRoot, profileDocumentRelativePath);
  if (!(await pathExists(resolved.absolutePath))) {
    const document = createEmptyProfileDocument();
    return {
      ...document,
      exists: false,
      markdown: renderProfileDocument(document),
      sourcePath: resolved.relativePath,
    };
  }

  const markdown = await readUtf8File(vaultRoot, profileDocumentRelativePath);
  return {
    ...parseProfileDocument({ text: markdown }),
    exists: true,
    markdown,
    sourcePath: resolved.relativePath,
  };
}

export async function setProfileDisplayName(
  vaultRoot: string,
  input: SetProfileDisplayNameInput,
): Promise<ProfileDocumentSnapshot> {
  return await withCanonicalResourceLocks({
    vaultRoot,
    resources: [
      await canonicalPathResourceForVault(vaultRoot, profileDocumentRelativePath),
    ],
    run: async () => {
      const snapshot = await readProfileDocument(vaultRoot);
      const next = setProfileDocumentDisplayName(snapshot, {
        displayName: input.displayName,
        now: input.now,
      });
      await writeCanonicalMarkdownDocument({
        vaultRoot,
        operationType: "profile_update",
        summary: "Set profile display name",
        occurredAt: input.now,
        target: resolveSingletonMarkdownDocumentTarget({
          relativePath: profileDocumentRelativePath,
          created: !snapshot.exists,
        }),
        markdown: renderProfileDocument(next),
        audit: {
          action: "profile_update",
          commandName: "core.setProfileDisplayName",
          summary: "Set the profile display name.",
        },
      });
      return await readProfileDocument(vaultRoot);
    },
  });
}
