import type { HostedRuntimeMediaCommand } from "@murphai/hosted-execution/runtime-media";
import { hostedMediaObjectKey } from "./storage-paths.ts";
import type { R2BucketLike } from "./bundle-store.ts";
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

/** Keep uncertain writes held. Only a settled successful R2 operation can
 * discharge this receipt; revocation never erases the cleanup obligation. */
export async function writeRunnerMediaWithAdmission(input: {
  source: { BUNDLES: R2BucketLike } & Readonly<Record<string, unknown>>;
  userId: string;
  command: Extract<HostedRuntimeMediaCommand, { operation: "admit_put" }>;
  write: () => Promise<unknown>;
}): Promise<boolean> {
  if (!(await commandHostedRuntimeMedia(input)).applied) return false;
  await input.write();
  await commandHostedRuntimeMedia({ ...input, command: {
    operation: "release_put", writeId: input.command.writeId, mediaId: input.command.descriptor.mediaId,
  } });
  return true;
}
