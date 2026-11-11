import type { R2BucketLike } from "./bundle-store.ts";
import { requireHostedGameMediaEnvelope } from "./game-media-store.ts";
import { hostedRecapMediaObjectKey, hostedRecapMediaUserPrefix } from "./storage-paths.ts";

type Stored = { version: 1; hash: string; envelope: string } | { version: 1; retired: true };
const decoder = new TextDecoder();
const tombstone = JSON.stringify({ version: 1, retired: true });

/** Conditional creation and retirement use the same strongly consistent key.
 * A late worker can neither replace accepted bytes nor resurrect a deleted face.
 * Retirement keeps only an opaque key and a permanent, content-free tombstone.
 */
export function createRecapMediaStore(input: { bucket: R2BucketLike; userId: string }) {
  const key = (mediaId: string) => hostedRecapMediaObjectKey({ ...input, mediaId });
  const read = async (objectKey: string): Promise<Stored | null> => {
    const object = await input.bucket.get(objectKey);
    return object ? parseStored(decoder.decode(await object.arrayBuffer())) : null;
  };
  return {
    async read(mediaId: string) {
      const stored = await read(key(mediaId));
      return stored && !("retired" in stored) ? { envelope: stored.envelope, hash: stored.hash } : null;
    },
    async write(mediaId: string, envelope: string, hash: string) {
      if (!/^[a-f0-9]{64}$/u.test(hash)) throw new TypeError("Recap content hash is invalid.");
      const sealed = requireHostedGameMediaEnvelope(envelope);
      if (new TextEncoder().encode(sealed).length > 3 * 1024 * 1024) throw new RangeError("Recap envelope is too large.");
      const objectKey = key(mediaId);
      const created = await input.bucket.put(objectKey, JSON.stringify({ version: 1, hash, envelope: sealed }), {
        onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" },
      });
      const current = await read(objectKey);
      if (!current || "retired" in current) throw new Error("Recap asset is retired.");
      if (current.hash !== hash) throw new Error("Recap asset already contains different bytes.");
      return { stored: true as const, created: created !== null };
    },
    async retire(mediaId: string) { await retireRecapMediaObject({ ...input, objectKey: key(mediaId) }); },
  };
}

export async function retireRecapMediaObject(input: { bucket: R2BucketLike; userId: string; objectKey: string }): Promise<void> {
  const prefix = hostedRecapMediaUserPrefix(input);
  const suffix = input.objectKey.slice(prefix.length);
  if (!input.objectKey.startsWith(prefix) || !/^recap\/[a-f0-9]{32}\/(?:scene-[0-6]\.jpg|song\.mp3)\.json\.enc$/u.test(suffix)) {
    throw new TypeError("Recap retirement is outside its owner namespace.");
  }
  await input.bucket.put(input.objectKey, tombstone, { httpMetadata: { contentType: "application/json" } });
}

function parseStored(text: string): Stored {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1) throw new TypeError("Invalid recap storage record.");
  if ("retired" in value && value.retired === true) return { version: 1, retired: true };
  if (!("hash" in value) || typeof value.hash !== "string" || !/^[a-f0-9]{64}$/u.test(value.hash)
    || !("envelope" in value) || typeof value.envelope !== "string") throw new TypeError("Invalid recap storage record.");
  return { version: 1, hash: value.hash, envelope: requireHostedGameMediaEnvelope(value.envelope) };
}
