import type {
  HostedBundleArtifactRef,
  HostedWorkspaceArtifactPersistInput,
} from "@murphai/runtime-state/node";

import type {
  HostedRuntimeArtifactStore,
} from "./platform.ts";

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
