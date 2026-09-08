import type {
  HostedBundleArtifactRef,
  HostedWorkspaceArtifactPersistInput,
} from "@murphai/runtime-state/node";
import {
  materializeHostedBundleFiles,
} from "@murphai/runtime-state/node";
import { lstat } from "node:fs/promises";
import path from "node:path";

import type {
  HostedRuntimeArtifactStore,
  HostedRuntimeMediaStore,
} from "./platform.ts";
import type {
  HostedWorkspaceArtifactMaterializer,
} from "./models.ts";
import { toHostedArtifactPathKey } from "./artifact-paths.ts";
import {
  recordHostedMaterializedArtifactPaths,
} from "./materialized-artifact-state.ts";
import {
  materializeHostedWorkspaceMediaReferences,
} from "./media-references.ts";

export function createHostedArtifactResolver(input: {
  artifactStore: HostedRuntimeArtifactStore;
}) {
  const cache = new Map<string, Promise<Uint8Array>>();

  return async ({ ref }: { ref: HostedBundleArtifactRef }) => {
    if (!cache.has(ref.sha256)) {
      const fetchPromise = fetchHostedArtifact(input, ref).catch((error) => {
        cache.delete(ref.sha256);
        throw error;
      });
      cache.set(ref.sha256, fetchPromise);
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
  mediaStore?: HostedRuntimeMediaStore | null;
  operatorHomeRoot: string;
  vaultRoot: string;
}): HostedWorkspaceArtifactMaterializer {
  return async (relativePaths, options) => {
    const mediaResult = await materializeHostedWorkspaceMediaReferences({
      materializedArtifactPaths: input.materializedArtifactPaths,
      mediaStore: input.mediaStore ?? null,
      relativePaths,
      signal: null,
      vaultRoot: input.vaultRoot,
      options,
    });
    const pendingArtifactPathKeys = new Set<string>();
    for (const relativePath of relativePaths) {
      const key = toHostedArtifactPathKey({ path: relativePath });
      if (
        mediaResult.materializedArtifactPaths.has(key)
        || (
          input.materializedArtifactPaths.has(key)
          && await hostedMaterializedArtifactPathExists({
            key,
            operatorHomeRoot: input.operatorHomeRoot,
            vaultRoot: input.vaultRoot,
          })
        )
      ) {
        continue;
      }
      if (!mediaResult.missingArtifactPaths.has(key)) {
        pendingArtifactPathKeys.add(key);
      }
    }
    if (pendingArtifactPathKeys.size === 0) {
      await recordHostedMaterializedArtifactPaths({
        materializedArtifactPaths: mediaResult.materializedArtifactPaths,
        vaultRoot: input.vaultRoot,
      });
      return {
        materializedArtifactPaths: mediaResult.materializedArtifactPaths,
        missingArtifactPaths: mediaResult.missingArtifactPaths,
      };
    }

    const materializedArtifactPaths = new Set(mediaResult.materializedArtifactPaths);
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
      [
        ...mediaResult.missingArtifactPaths,
        ...[...pendingArtifactPathKeys].filter((key) => !materializedArtifactPaths.has(key)),
      ],
    );
    return {
      materializedArtifactPaths,
      missingArtifactPaths,
    };
  };
}

async function hostedMaterializedArtifactPathExists(input: {
  key: string;
  operatorHomeRoot: string;
  vaultRoot: string;
}): Promise<boolean> {
  const delimiterIndex = input.key.indexOf(":");
  if (delimiterIndex <= 0 || delimiterIndex >= input.key.length - 1) {
    return false;
  }
  const root = input.key.slice(0, delimiterIndex);
  const relativePath = input.key.slice(delimiterIndex + 1);
  const rootPath = root === "vault"
    ? input.vaultRoot
    : root === "operator-home"
      ? input.operatorHomeRoot
      : null;
  if (!rootPath) {
    return false;
  }
  const absolutePath = path.resolve(rootPath, relativePath);
  const relativeFromRoot = path.relative(path.resolve(rootPath), absolutePath);
  if (
    relativeFromRoot === ".."
    || relativeFromRoot.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeFromRoot)
  ) {
    return false;
  }
  try {
    return (await lstat(absolutePath)).isFile();
  } catch {
    return false;
  }
}

async function fetchHostedArtifact(
  input: {
    artifactStore: HostedRuntimeArtifactStore;
  },
  ref: HostedBundleArtifactRef,
): Promise<Uint8Array> {
  const bytes = await input.artifactStore.get(ref.sha256, {
    purpose: "workspace_artifact_materialization",
  });

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
