import { parseInput, RequestInputError, RequestBodyTooLargeError } from "@murphai/hosted-execution/request-input";
import { ContractValidationError } from "@murphai/contracts/validation-error";
import type { R2BucketLike } from "./bundle-store.ts";
import { parseHostedSecureBoxEnvelope } from "@murphai/runtime-state";
import { hostedRecapMediaObjectKey, hostedRecapMediaUserPrefix, requireHostedRecapMediaId, hostedProgressPicObjectKey, hostedProgressPicUserPrefix, requireHostedProgressPicId } from "./storage-paths.ts";

type SealedMedia = { hash: string; envelope: string };
type Stored = ({ version: 1 } & SealedMedia) | { version: 1; retired: true };
const decoder = new TextDecoder();
const tombstone = JSON.stringify({ version: 1, retired: true });

/** Conditional creation and retirement use the same strongly consistent key.
 * A late worker can neither replace accepted bytes nor resurrect a deleted face.
 * Retirement keeps only an opaque key and a permanent, content-free tombstone.
 */
export function createRecapMediaStore(input: { bucket: R2BucketLike; userId: string }) {
  return createRetirableMediaStore(input.bucket, mediaId => hostedRecapMediaObjectKey({ ...input, mediaId }),
    mediaId => retireRecapMediaObject({ ...input, objectKey: hostedRecapMediaObjectKey({ ...input, mediaId }) }));
}

export function createProgressPicStore(input: { bucket: R2BucketLike; userId: string }) {
  return createRetirableMediaStore(input.bucket, mediaId => hostedProgressPicObjectKey({ ...input, mediaId }),
    mediaId => retireProgressPicObject({ ...input, objectKey: hostedProgressPicObjectKey({ ...input, mediaId }) }));
}

function createRetirableMediaStore(bucket: R2BucketLike, key: (mediaId: string) => string, retire: (mediaId: string) => Promise<void>) {
  const read = async (objectKey: string): Promise<Stored | null> => {
    const object = await bucket.get(objectKey);
    return object ? JSON.parse(decoder.decode(await object.arrayBuffer())) as Stored : null;
  };
  return {
    async read(mediaId: string) {
      const stored = await read(key(mediaId));
      return stored && !("retired" in stored) ? { envelope: stored.envelope, hash: stored.hash } : null;
    },
    async write(mediaId: string, { envelope, hash }: SealedMedia) {
      const objectKey = key(mediaId);
      const created = await bucket.put(objectKey, JSON.stringify({ version: 1, hash, envelope }), {
        onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" },
      });
      const current = await read(objectKey);
      if (!current || "retired" in current) throw new Error("Recap asset is retired.");
      if (current.hash !== hash) throw new Error("Recap asset already contains different bytes.");
      return { stored: true as const, created: created !== null };
    },
    retire,
  };
}

export async function retireRecapMediaObject(input: { bucket: R2BucketLike; userId: string; objectKey: string }): Promise<void> {
  const prefix = hostedRecapMediaUserPrefix(input);
  const suffix = ".json.enc";
  if (!input.objectKey.startsWith(prefix) || !input.objectKey.endsWith(suffix)) {
    throw new RequestInputError("Recap retirement is outside its owner namespace.");
  }
  parseInput(input.objectKey, () => requireHostedRecapMediaId(input.objectKey.slice(prefix.length, -suffix.length)));
  await input.bucket.put(input.objectKey, tombstone, { httpMetadata: { contentType: "application/json" } });
}

/** Parse once at the authenticated Worker route; storage receives typed sealed input. */
export function requireSealedGameMediaUpload(envelope: string, hash: string, scope: "weekly-game" | "game-progress"): SealedMedia {
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new ContractValidationError("Sealed media hash is invalid.");
  if (new TextEncoder().encode(envelope).length > 3 * 1024 * 1024) throw new RequestBodyTooLargeError(3 * 1024 * 1024, "Sealed media is too large.");
  const parsed = parseHostedSecureBoxEnvelope(JSON.parse(envelope));
  if (parsed.lane !== "hosted-member-private-field" || parsed.scope !== scope) throw new ContractValidationError("Sealed media scope is invalid.");
  return { envelope: JSON.stringify(parsed), hash };
}

export async function retireProgressPicObject(input: { bucket: R2BucketLike; userId: string; objectKey: string }): Promise<void> {
  const prefix = hostedProgressPicUserPrefix(input);
  const suffix = ".json.enc";
  if (!input.objectKey.startsWith(prefix) || !input.objectKey.endsWith(suffix)) {
    throw new RequestInputError("Progress retirement is outside its owner namespace.");
  }
  parseInput(input.objectKey, () => requireHostedProgressPicId(input.objectKey.slice(prefix.length, -suffix.length)));
  await input.bucket.put(input.objectKey, tombstone, { httpMetadata: { contentType: "application/json" } });
}
