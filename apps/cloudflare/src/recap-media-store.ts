import { parseInput, RequestInputError, RequestBodyTooLargeError } from "@murphai/hosted-execution/request-input";
import { ContractValidationError } from "@murphai/contracts/validation-error";
import type { R2BucketLike } from "./bundle-store.ts";
import { parseHostedSecureBoxEnvelope } from "@murphai/runtime-state";
import { requireHostedGameMediaEnvelope } from "./game-media-store.ts";
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
    mediaId => retireRecapMediaObject({ ...input, objectKey: hostedRecapMediaObjectKey({ ...input, mediaId }) }), parseStored);
}

export function createProgressPicStore(input: { bucket: R2BucketLike; userId: string }) {
  return createRetirableMediaStore(input.bucket, mediaId => hostedProgressPicObjectKey({ ...input, mediaId }),
    mediaId => retireProgressPicObject({ ...input, objectKey: hostedProgressPicObjectKey({ ...input, mediaId }) }), text => JSON.parse(text) as Stored);
}

function createRetirableMediaStore(bucket: R2BucketLike, key: (mediaId: string) => string, retire: (mediaId: string) => Promise<void>, decodeStored: (text: string) => Stored) {
  const read = async (objectKey: string): Promise<Stored | null> => {
    const object = await bucket.get(objectKey);
    return object ? decodeStored(decoder.decode(await object.arrayBuffer())) : null;
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

// Retain the existing recap storage contract; Progress decodes its own typed records directly.
function parseStored(text: string): Stored {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1) throw new TypeError("Invalid recap storage record.");
  if ("retired" in value && value.retired === true) return { version: 1, retired: true };
  if (!("hash" in value) || typeof value.hash !== "string" || !/^[a-f0-9]{64}$/u.test(value.hash)
    || !("envelope" in value) || typeof value.envelope !== "string") throw new TypeError("Invalid recap storage record.");
  return { version: 1, hash: value.hash, envelope: requireHostedGameMediaEnvelope(value.envelope) };
}

export function requireRecapMediaEnvelope(envelope: string, hash: string): string {
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new ContractValidationError("Recap content hash is invalid.");
  const sealed = requireHostedGameMediaEnvelope(envelope);
  if (new TextEncoder().encode(sealed).length > 3 * 1024 * 1024) throw new RequestBodyTooLargeError(3 * 1024 * 1024, "Recap envelope is too large.");
  return sealed;
}

/** Parse once at the authenticated Progress route; storage receives typed sealed input. */
export function requireProgressPicUpload(envelope: string, hash: string): SealedMedia {
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new ContractValidationError("Sealed media hash is invalid.");
  if (new TextEncoder().encode(envelope).length > 3 * 1024 * 1024) throw new RequestBodyTooLargeError(3 * 1024 * 1024, "Sealed media is too large.");
  const parsed = parseHostedSecureBoxEnvelope(JSON.parse(envelope));
  if (parsed.lane !== "hosted-member-private-field" || (parsed.scope !== "game-progress" && parsed.scope !== "health-post")) throw new ContractValidationError("Sealed media scope is invalid.");
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
