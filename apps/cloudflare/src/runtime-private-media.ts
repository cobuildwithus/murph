import { commandHostedRuntimeOwner } from "./runtime-owner-client.ts";
import { createRuntimeMediaWriteBucket, privateRuntimeMediaDigest } from "./runtime-media.ts";
import { readHostedPrivateMediaCapabilitySecret, readHostedPrivateMediaDeliveryOrigin, stageHostedPrivateMedia,
  type HostedPrivateMediaPublishInput, type HostedPrivateMediaPublishResult } from "./private-media.ts";
import type { R2BucketLike } from "./bundle-store.ts";

export async function publishPostgresRuntimePrivateMedia(input: HostedPrivateMediaPublishInput & {
  source: { BUNDLES: R2BucketLike } & Readonly<Record<string, unknown>>;
}): Promise<HostedPrivateMediaPublishResult> {
  const authorization = await commandHostedRuntimeOwner({ source: input.source, userId: input.userId,
    command: { operation: "authorize_effect", attemptId: input.attemptId, generation: input.generation, runnerContainerName: null, managedAi: false } });
  if (authorization.status !== "authorized") return { ok: false, reason: "write-fence-rejected" };
  const capabilitySecret = readHostedPrivateMediaCapabilitySecret(input.source);
  if (!capabilitySecret) return { ok: false, reason: "not-configured" };
  try {
    const result = await stageHostedPrivateMedia({ ...input, capabilitySecret, deliveryOrigin: readHostedPrivateMediaDeliveryOrigin(input.source),
      bucket: createRuntimeMediaWriteBucket({ ...input, media: { privateMediaSha256: privateRuntimeMediaDigest(input.bytes) } }) });
    return { ok: true, expiresAt: result.expiresAt, url: result.url };
  } catch { return { ok: false, reason: "stage-failed" }; }
}
