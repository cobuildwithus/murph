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
    const mediaResult = await materializeHostedWorkspaceMediaReferences({
      mediaStore: input.mediaStore ?? null,
      relativePaths,
      signal: null,
      vaultRoot: input.vaultRoot,
      options,
    });
    const materializedArtifactPaths = new Set(mediaResult.materializedArtifactPaths);
    const missingArtifactPaths = new Set(mediaResult.missingArtifactPaths);
    for (const relativePath of relativePaths) {
      const key = toHostedArtifactPathKey({ path: relativePath });
      // Media expiry, integrity, and size decisions retain authority over local bytes.
      if (missingArtifactPaths.has(key) || materializedArtifactPaths.has(key)) {
        continue;
      }
      if (await hostedLocalArtifactIsAvailable({
        key,
        maxFileBytes: options?.maxFileBytes,
        operatorHomeRoot: input.operatorHomeRoot,
        vaultRoot: input.vaultRoot,
      })) {
        materializedArtifactPaths.add(key);
      } else {
        missingArtifactPaths.add(key);
      }
    }
    return { materializedArtifactPaths, missingArtifactPaths };
  };
}

async function hostedLocalArtifactIsAvailable(input: {
  key: string;
  maxFileBytes?: number;
  operatorHomeRoot: string;
  vaultRoot: string;
}): Promise<boolean> {
  const delimiterIndex = input.key.indexOf(":");
  const root = input.key.slice(0, delimiterIndex);
  const relativePath = input.key.slice(delimiterIndex + 1);
  const rootPath = root === "vault"
    ? input.vaultRoot
    : root === "operator-home"
      ? input.operatorHomeRoot
      : null;
  if (!rootPath) return false;
  try {
    const resolved = await resolveVaultPathOnDisk(rootPath, relativePath);
    const file = await lstat(resolved.absolutePath);
    return file.isFile()
      && (input.maxFileBytes === undefined || file.size <= input.maxFileBytes);
  } catch {
    return false;
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
