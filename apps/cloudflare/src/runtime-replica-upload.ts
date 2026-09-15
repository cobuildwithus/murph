import type { R2BucketLike } from "./bundle-store.ts";
import { commandHostedRuntimeReplicaPut } from "./runtime-resource-client.ts";
import { writeRecoverableRuntimeObject } from "./runtime-object-upload.ts";
import { listHostedBrowserVaultReplicaSiblingObjectKeys } from "./storage-paths.ts";

/** Each shard has its own physical receipt; the canonical root owns cleanup of
 * the complete shard family. A failed sibling never releases another upload. */
export function createRuntimeReplicaWriteBucket(input: {
  source: { BUNDLES: R2BucketLike } & Readonly<Record<string, unknown>>;
  userId: string; attemptId: string; generation: string;
  readRootObjectKey: () => string | null;
}): R2BucketLike {
  const bucket = input.source.BUNDLES;
  return { get: key => bucket.get(key),
    async put(objectKey, value, options) {
      const root = input.readRootObjectKey();
      if (!root || ![root, ...listHostedBrowserVaultReplicaSiblingObjectKeys(root)].includes(objectKey)) throw new Error("Replica upload requires its admitted root.");
      const writeId = crypto.randomUUID();
      await writeRecoverableRuntimeObject({ bucket, objectKey, value, options,
        admit: uploadId => commandHostedRuntimeReplicaPut({ source: input.source, userId: input.userId,
          command: { operation: "admit", attemptId: input.attemptId, generation: input.generation, writeId,
            objectKey: root, multipart: { objectKey, uploadId } } }),
        release: () => commandHostedRuntimeReplicaPut({ source: input.source, userId: input.userId, command: { operation: "release", writeId } }),
      });
    },
    ...(bucket.delete ? { delete: (key: string | string[]) => bucket.delete!(key) } : {}),
  };
}
