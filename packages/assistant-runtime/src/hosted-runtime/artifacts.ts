import { AssistantWorkspaceArtifactMaterializationError } from "@murphai/assistant-engine";
import { canonicalRawArtifactIsPrivacyTombstone, isVaultError, resolveVaultPathOnDisk } from "@murphai/core";
import { lstat } from "node:fs/promises";

import type {
  HostedRuntimeMediaStore,
} from "./platform.ts";
import type {
  HostedWorkspaceArtifactMaterializer,
} from "./models.ts";
import { toHostedArtifactPathKey } from "./artifact-paths.ts";
import {
  materializeHostedWorkspaceMediaReferences,
} from "./media-references.ts";

export function createHostedArtifactMaterializer(input: {
  mediaStore?: HostedRuntimeMediaStore | null;
  operatorHomeRoot: string;
  vaultRoot: string;
}): HostedWorkspaceArtifactMaterializer {
  return async (relativePaths, options) => {
    try {
      options?.signal?.throwIfAborted();
      const mediaResult = await materializeHostedWorkspaceMediaReferences({
        mediaStore: input.mediaStore ?? null,
        relativePaths,
        signal: options?.signal,
        vaultRoot: input.vaultRoot,
        options,
      });
      const materializedArtifactPaths = new Set(mediaResult.materializedArtifactPaths);
      const missingArtifactPaths = new Map(mediaResult.missingArtifactPaths);
      for (const relativePath of relativePaths) {
        options?.signal?.throwIfAborted();
        const key = toHostedArtifactPathKey({ path: relativePath });
        // Media expiry, integrity, and size decisions retain authority over local bytes.
        if (missingArtifactPaths.has(key) || materializedArtifactPaths.has(key)) {
          continue;
        }
        const unavailable = await hostedLocalArtifactUnavailableReason({
          key,
          maxFileBytes: options?.maxFileBytes,
          operatorHomeRoot: input.operatorHomeRoot,
          vaultRoot: input.vaultRoot,
        });
        options?.signal?.throwIfAborted();
        if (unavailable === null) {
          materializedArtifactPaths.add(key);
        } else {
          missingArtifactPaths.set(key, unavailable);
        }
      }
      return { materializedArtifactPaths, missingArtifactPaths };
    } catch (error) {
      throw new AssistantWorkspaceArtifactMaterializationError(error);
    }
  };
}

async function hostedLocalArtifactUnavailableReason(input: {
  key: string;
  maxFileBytes?: number;
  operatorHomeRoot: string;
  vaultRoot: string;
}): Promise<"missing" | "size" | "obsolete" | "integrity" | "transport" | null> {
  const delimiterIndex = input.key.indexOf(":");
  const root = input.key.slice(0, delimiterIndex);
  const relativePath = input.key.slice(delimiterIndex + 1);
  const rootPath = root === "vault"
    ? input.vaultRoot
    : root === "operator-home"
      ? input.operatorHomeRoot
      : null;
  if (!rootPath) return "missing";
  if (root === "vault" && (relativePath.startsWith("raw/meals/") || relativePath.startsWith("raw/measurements/"))) {
    try {
      if (await canonicalRawArtifactIsPrivacyTombstone({ vaultRoot: rootPath, relativePath })) return "obsolete";
    } catch (error) {
      return isVaultError(error) && error.code === "CANONICAL_WRITE_LOCKED" ? "transport" : "integrity";
    }
  }
  try {
    const resolved = await resolveVaultPathOnDisk(rootPath, relativePath);
    const file = await lstat(resolved.absolutePath);
    if (!file.isFile()) return "missing";
    return input.maxFileBytes !== undefined && file.size > input.maxFileBytes ? "size" : null;
  } catch {
    return "missing";
  }
}
