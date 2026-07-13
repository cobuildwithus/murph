import type {
  HostedBundleArtifactRef,
  HostedWorkspaceArtifactPersistInput,
} from "@murphai/runtime-state/node";
import {
  materializeHostedBundleFiles,
} from "@murphai/runtime-state/node";

import type {
  HostedRuntimeArtifactStore,
} from "./platform.ts";
import type {
  HostedWorkspaceArtifactMaterializer,
} from "./models.ts";
import { toHostedArtifactPathKey } from "./artifact-paths.ts";
import {
  recordHostedMaterializedArtifactPaths,
} from "./materialized-artifact-state.ts";

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
  bundles: readonly (() => Promise<Uint8Array | ArrayBuffer | null>)[];
  materializedArtifactPaths: Set<string>;
  operatorHomeRoot: string;
  vaultRoot: string;
}): HostedWorkspaceArtifactMaterializer {
  return async (relativePaths, options) => {
    const pendingArtifactPathKeys = new Set<string>();
    for (const relativePath of relativePaths) {
      const key = toHostedArtifactPathKey({ path: relativePath });
      if (!input.materializedArtifactPaths.has(key)) {
        pendingArtifactPathKeys.add(key);
      }
    }
    if (pendingArtifactPathKeys.size === 0) {
      return {
        materializedArtifactPaths: new Set(),
        missingArtifactPaths: new Set(),
      };
    }

    const materializedArtifactPaths = new Set<string>();
    for (const readBundle of input.bundles) {
      const bundle = await readBundle();
      if (!bundle) {
        continue;
      }
      const result = await materializeHostedBundleFiles({
        artifactResolver: input.artifactResolver,
        bytes: bundle,
        expectedKind: "vault",
        roots: {
          "operator-home": input.operatorHomeRoot,
          vault: input.vaultRoot,
        },
        shouldRestoreArtifact: ({ path: artifactPath, ref, root }) => (
          pendingArtifactPathKeys.has(toHostedArtifactPathKey({
            path: artifactPath,
            root,
          }))
          && (options?.maxFileBytes === undefined || ref.byteSize <= options.maxFileBytes)
        ),
        shouldRestoreInlineFile: ({ path: inlinePath, root, size }) => (
          pendingArtifactPathKeys.has(toHostedArtifactPathKey({
            path: inlinePath,
            root,
          }))
          && (options?.maxFileBytes === undefined || size <= options.maxFileBytes)
        ),
      });
      for (const materializedPath of result.materializedArtifactPaths) {
        const key = toHostedArtifactPathKey({ path: materializedPath });
        if (pendingArtifactPathKeys.has(key)) {
          materializedArtifactPaths.add(key);
        }
      }
    }

    for (const key of materializedArtifactPaths) {
      input.materializedArtifactPaths.add(key);
    }
    await recordHostedMaterializedArtifactPaths({
      materializedArtifactPaths,
      vaultRoot: input.vaultRoot,
    });

    const missingArtifactPaths = new Set(
      [...pendingArtifactPathKeys].filter((key) => !materializedArtifactPaths.has(key)),
    );
    return {
      materializedArtifactPaths,
      missingArtifactPaths,
    };
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
    const error = new Error("Hosted artifact fetch failed with HTTP 404.") as Error & {
      status: number;
      statusCode: number;
    };
    error.status = 404;
    error.statusCode = 404;
    throw error;
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
