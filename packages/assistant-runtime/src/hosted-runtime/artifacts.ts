import type {
  HostedBundleArtifactRef,
  HostedWorkspaceArtifactPersistInput,
} from "@murphai/runtime-state/node";
import {
  materializeHostedExecutionArtifacts,
} from "@murphai/runtime-state/node";

import type {
  HostedRuntimeArtifactStore,
} from "./platform.ts";
import type {
  HostedWorkspaceArtifactMaterializer,
} from "./models.ts";

export function createHostedArtifactResolver(input: {
  artifactStore: HostedRuntimeArtifactStore;
}) {
  const cache = new Map<string, Promise<Uint8Array>>();

  return async ({ ref }: { ref: HostedBundleArtifactRef }) => {
    if (!cache.has(ref.sha256)) {
      cache.set(ref.sha256, fetchHostedArtifact(input, ref));
    }

    return await cache.get(ref.sha256)!;
  };
}

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
  artifactResolver: ReturnType<typeof createHostedArtifactResolver>;
  bundle: Uint8Array;
  materializedArtifactPaths: Set<string>;
  workspaceRoot: string;
}): HostedWorkspaceArtifactMaterializer {
  return async (relativePaths) => {
    const pendingPaths = [...new Set(relativePaths)]
      .filter((relativePath) => !input.materializedArtifactPaths.has(relativePath));
    if (pendingPaths.length === 0) {
      return;
    }

    await materializeHostedExecutionArtifacts({
      artifactResolver: input.artifactResolver,
      bundle: input.bundle,
      shouldRestoreArtifact: ({ path: artifactPath, root }) => (
        root === "vault" && pendingPaths.includes(artifactPath)
      ),
      workspaceRoot: input.workspaceRoot,
    });
    for (const relativePath of pendingPaths) {
      input.materializedArtifactPaths.add(relativePath);
    }
  };
}

async function fetchHostedArtifact(
  input: {
    artifactStore: HostedRuntimeArtifactStore;
  },
  ref: HostedBundleArtifactRef,
): Promise<Uint8Array> {
  const bytes = await input.artifactStore.get(ref.sha256);

  if (!bytes) {
    throw new Error(`Hosted runner artifact fetch failed for ${ref.sha256}.`);
  }

  return bytes;
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
