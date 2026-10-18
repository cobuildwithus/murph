import { parseHostedSecureBoxEnvelope } from "@murphai/runtime-state";

import type { R2BucketLike } from "./bundle-store.ts";
import {
  hostedGameMediaObjectKey,
  requireHostedGameMediaId,
} from "./storage-paths.ts";

/**
 * Weekly game photos. Web seals each photo under its owner's key before it
 * leaves Web (players need no hosted workspace, so the Worker has no key for
 * them); this store only keeps the sealed envelope under the owner's prefix
 * and refuses anything that isn't one, so plaintext can't land in R2.
 */

/** A sealed photo of up to 4 MiB, base64 inside its JSON envelope. */
export const HOSTED_GAME_MEDIA_MAX_ENVELOPE_BYTES = 6 * 1024 * 1024;

const GAME_MEDIA_LANE = "hosted-member-private-field";
const GAME_MEDIA_SCOPE = "weekly-game";

export interface HostedGameMediaStore {
  delete(mediaId: string): Promise<void>;
  /** The stored envelope text, or null when there's none. */
  read(mediaId: string): Promise<string | null>;
  stat(mediaId: string): Promise<{ byteLength: number } | null>;
  write(mediaId: string, envelope: string): Promise<{ byteLength: number }>;
}

export function createHostedGameMediaStore(input: {
  bucket: R2BucketLike;
  userId: string;
}): HostedGameMediaStore {
  const objectKey = (mediaId: string) =>
    hostedGameMediaObjectKey({ mediaId: requireHostedGameMediaId(mediaId), userId: input.userId });

  return {
    async delete(mediaId) {
      if (!input.bucket.delete) throw new Error("Hosted game media deletion is unavailable.");
      await input.bucket.delete(await objectKey(mediaId));
    },
    async read(mediaId) {
      const object = await input.bucket.get(await objectKey(mediaId));
      return object ? new TextDecoder().decode(await object.arrayBuffer()) : null;
    },
    async stat(mediaId) {
      const key = await objectKey(mediaId);
      if (input.bucket.head) {
        const head = await input.bucket.head(key);
        return head ? { byteLength: head.size ?? 0 } : null;
      }
      const object = await input.bucket.get(key);
      return object ? { byteLength: (await object.arrayBuffer()).byteLength } : null;
    },
    async write(mediaId, envelope) {
      const text = requireHostedGameMediaEnvelope(envelope);
      await input.bucket.put(await objectKey(mediaId), text, {
        httpMetadata: { contentType: "application/json" },
      });
      return { byteLength: new TextEncoder().encode(text).byteLength };
    },
  };
}

/** A weekly game secure-box envelope, normalized; anything else throws TypeError. */
export function requireHostedGameMediaEnvelope(value: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("Hosted game media must be a sealed envelope.");
  }
  const envelope = parseHostedSecureBoxEnvelope(parsed, "Hosted game media envelope");
  if (envelope.lane !== GAME_MEDIA_LANE || envelope.scope !== GAME_MEDIA_SCOPE) {
    throw new TypeError("Hosted game media must be sealed for the weekly game.");
  }
  return JSON.stringify(envelope);
}
