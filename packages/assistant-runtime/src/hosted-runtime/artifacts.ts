import { AssistantWorkspaceArtifactMaterializationError } from "@murphai/assistant-engine";
import type {
  HostedWorkspaceArtifactPersistInput,
} from "@murphai/runtime-state/node";
import { resolveVaultPathOnDisk } from "@murphai/core";
import { lstat } from "node:fs/promises";

import type {
  HostedRuntimeArtifactStore,
  HostedRuntimeMediaStore,
} from "./platform.ts";
import type {
  HostedWorkspaceArtifactMaterializer,
} from "./models.ts";
import { toHostedArtifactPathKey } from "./artifact-paths.ts";
import {
  materializeHostedWorkspaceMediaReferences,
} from "./media-references.ts";

export function createHostedArtifactUploadSink(input: {
  artifactStore: HostedRuntimeArtifactStore;
  knownArtifactHashes: ReadonlySet<string>;
}) {
  const uploadedHashes = new Set<string>();

  return async (artifact: HostedWorkspaceArtifactPersistInput) => {
    if (input.knownArtifactHashes.has(artifact.ref.sha256) || uploadedHashes.has(artifact.ref.sha256)) {
      return;
    }

    await uploadHostedArtifact(input, artifact);
    uploadedHashes.add(artifact.ref.sha256);
  };
}

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
}): Promise<"missing" | "size" | null> {
  const delimiterIndex = input.key.indexOf(":");
  const root = input.key.slice(0, delimiterIndex);
  const relativePath = input.key.slice(delimiterIndex + 1);
  const rootPath = root === "vault"
    ? input.vaultRoot
    : root === "operator-home"
      ? input.operatorHomeRoot
      : null;
  if (!rootPath) return "missing";
  try {
    const resolved = await resolveVaultPathOnDisk(rootPath, relativePath);
    const file = await lstat(resolved.absolutePath);
    if (!file.isFile()) return "missing";
    return input.maxFileBytes !== undefined && file.size > input.maxFileBytes ? "size" : null;
  } catch {
    return "missing";
  }
}

async function uploadHostedArtifact(
  input: {
    artifactStore: HostedRuntimeArtifactStore;
  },
  artifact: HostedWorkspaceArtifactPersistInput,
): Promise<void> {
  const uploadBytes = new Uint8Array(artifact.bytes.byteLength);
  uploadBytes.set(artifact.bytes);
  await input.artifactStore.put({
    bytes: uploadBytes,
    sha256: artifact.ref.sha256,
  });
}
