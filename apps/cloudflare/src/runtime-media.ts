import { writeRecoverableRuntimeObject } from "./runtime-object-upload.ts";
import { createHash } from "node:crypto";
import type { HostedRuntimeMediaCommand, HostedRuntimeMediaDescriptor } from "@murphai/hosted-execution/runtime-media";
import { hostedMediaObjectKey, hostedPrivateMediaObjectKey } from "./storage-paths.ts";
import type { R2BucketLike } from "./bundle-store.ts";
import type { R2PutOptionsLike, R2PutValueLike } from "./crypto.ts";
import { commandHostedRuntimeMedia } from "./runtime-resource-client.ts";

export async function executeRunnerMediaCommand(input: {
  source: { BUNDLES: R2BucketLike } & Readonly<Record<string, unknown>>;
  userId: string; command: HostedRuntimeMediaCommand;
}) {
  const result = await commandHostedRuntimeMedia(input);
  if (result.purge) {
    const purge = result.purge;
    if (purge.objectKey !== await hostedMediaObjectKey({ userId: input.userId, mediaId: purge.mediaId })) throw new TypeError("Runtime media purge identity mismatch.");
    if (!input.source.BUNDLES.delete) throw new Error("Runtime media deletion is unavailable.");
    await input.source.BUNDLES.delete(purge.objectKey);
    await commandHostedRuntimeMedia({ ...input, command: { operation: "acknowledge_purge", purge } });
  }
  return result;
}

type MediaUploadInput = {
  source: { BUNDLES: R2BucketLike } & Readonly<Record<string, unknown>>;
  userId: string; attemptId: string; generation: string;
  media: { descriptor: HostedRuntimeMediaDescriptor } | { privateMediaSha256: string };
};

/** Wrap only the encrypted store's write seam. An empty multipart allocation
 * carries no health bytes; its identity commits in Postgres before uploadPart.
 * The existing retention sweep can abort an uncertain upload by exact ID. */
export function createRuntimeMediaWriteBucket(input: MediaUploadInput): R2BucketLike {
  const bucket = input.source.BUNDLES;
  return { get: key => bucket.get(key), put: (key, value, options) => writeMediaObject(input, key, value, options),
    ...(bucket.head ? { head: (key: string) => bucket.head!(key) } : {}),
    ...(bucket.delete ? { delete: (key: string | string[]) => bucket.delete!(key) } : {}),
  };
}
async function writeMediaObject(input: MediaUploadInput, objectKey: string, value: R2PutValueLike, options?: R2PutOptionsLike): Promise<void> {
  const bucket = input.source.BUNDLES;
  const privateMedia = "privateMediaSha256" in input.media;
  const mediaId = "privateMediaSha256" in input.media ? input.media.privateMediaSha256 : input.media.descriptor.mediaId;
  const expectedKey = privateMedia ? await hostedPrivateMediaObjectKey({ userId: input.userId, sha256: mediaId })
    : await hostedMediaObjectKey({ userId: input.userId, mediaId });
  if (objectKey !== expectedKey) throw new TypeError("Runtime media upload namespace mismatch.");
  const writeId = crypto.randomUUID();
  const identity = { attemptId: input.attemptId, generation: input.generation, writeId };
  await writeRecoverableRuntimeObject({ bucket, objectKey, value, options,
    release: () => commandHostedRuntimeMedia({ source: input.source, userId: input.userId,
      command: { operation: "release_put", writeId, mediaId, ...(privateMedia ? { scope: "private_media" as const } : {}) } }),
    admit: async uploadId => {
      const command: HostedRuntimeMediaCommand = "descriptor" in input.media
        ? { operation: "admit_put", ...identity, uploadId, descriptor: input.media.descriptor }
        : { operation: "admit_private_put", ...identity, uploadId, sha256: input.media.privateMediaSha256 };
      return (await commandHostedRuntimeMedia({ source: input.source, userId: input.userId, command })).applied;
    },
  });
}

export function privateRuntimeMediaDigest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
