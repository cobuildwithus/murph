import type { R2BucketLike, RuntimeMultipartUpload } from "./bundle-store.ts";
import { commandHostedRuntimeReplicaPut } from "./runtime-resource-client.ts";
import { abortRuntimeMultipartUpload } from "./runtime-object-upload.ts";
import { listHostedBrowserVaultReplicaSiblingObjectKeys } from "./storage-paths.ts";

interface ReplicaUpload {
  objectKey: string;
  writeId: string;
  upload: RuntimeMultipartUpload;
  started: boolean;
  completed: boolean;
}

/** One bounded callback admits the physical receipts before any encrypted
 * bytes. Settlement names only completed or confirmed-aborted uploads. */
export function createRuntimeReplicaWriteBucket(input: {
  source: { BUNDLES: R2BucketLike } & Readonly<Record<string, unknown>>;
  userId: string; attemptId: string; generation: string;
}) {
  const bucket = input.source.BUNDLES;
  const uploads = new Map<string, ReplicaUpload>();
  let admitted = false;
  return {
    async admit(root: string): Promise<void> {
      if (!bucket.createMultipartUpload || !bucket.resumeMultipartUpload) throw new Error("Recoverable runtime uploads are not configured.");
      const objectKeys = [root, ...listHostedBrowserVaultReplicaSiblingObjectKeys(root)];
      await drainReplicaOperations(objectKeys, async objectKey => {
        const upload = await bucket.createMultipartUpload!(objectKey);
        uploads.set(objectKey, { objectKey, writeId: crypto.randomUUID(), upload, started: false, completed: false });
      });
      admitted = await commandHostedRuntimeReplicaPut({ source: input.source, userId: input.userId,
        command: { operation: "admit_batch", attemptId: input.attemptId, generation: input.generation, objectKey: root,
          uploads: [...uploads.values()].map(({ objectKey, writeId, upload }) => ({ objectKey, writeId, uploadId: upload.uploadId })) } });
      if (!admitted) throw new Error("Runtime upload admission was rejected.");
    },
    bucket: {
      get: (key: string) => bucket.get(key),
      async put(objectKey, value) {
        const write = uploads.get(objectKey);
        if (!admitted || !write || write.started) throw new Error("Replica upload requires its admitted unused receipt.");
        write.started = true;
        const part = await write.upload.uploadPart(1, value);
        await write.upload.complete([part]);
        write.completed = true;
      },
    } satisfies R2BucketLike,
    async settle(): Promise<void> {
      await drainReplicaOperations([...uploads.values()].filter(write => !write.completed), async write => {
        try {
          await abortRuntimeMultipartUpload(write.upload);
          write.completed = true;
        } catch { /* Unknown outcomes stay pending for durable recovery. */ }
      });
      const writeIds = [...uploads.values()].filter(write => write.completed).map(write => write.writeId);
      if (writeIds.length > 0) await commandHostedRuntimeReplicaPut({ source: input.source, userId: input.userId,
        command: { operation: "release_batch", writeIds } });
    },
  };
}

async function drainReplicaOperations<T>(items: T[], operation: (item: T) => Promise<void>): Promise<void> {
  let firstFailure: { cause: unknown } | undefined;
  const work = async () => {
    while (items.length > 0) {
      const item = items.shift()!;
      try { await operation(item); }
      catch (cause) { firstFailure ??= { cause }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, work));
  if (firstFailure) throw firstFailure.cause;
}
