import {
  GAME_MEDIA_MAX_BYTES,
  gameMediaDelivery,
  isGameMediaKey,
  isGameMediaStorageAvailable,
  matchesGameMediaContentType,
  parseGameMediaContentType,
  putGameMedia,
  readGameMedia,
} from "../media";
import { authorizeMediaRead, mediaKeyPrefixFor } from "../service";
import { readRawBodyBuffer } from "../../http";
import { gameHttpError, invalidGameRequest } from "./errors";

/**
 * Stores a photo under the member's prefix, keyed by its bytes: a retry
 * returns the same key. Entry photos and invite label photos share it.
 */
export async function uploadGameMedia(input: { memberId: string; request: Request }): Promise<string> {
  const { request } = input;
  const contentType = parseGameMediaContentType(request.headers.get("content-type"));
  if (!contentType) throw invalidGameRequest("Content-Type must be image/jpeg or image/heic.");
  requireStorage();
  const bytes = await readRawBodyBuffer(request, { limitBytes: GAME_MEDIA_MAX_BYTES });
  if (bytes.byteLength === 0 || !matchesGameMediaContentType(bytes, contentType)) {
    throw invalidGameRequest("The upload doesn't match its Content-Type.");
  }
  return putGameMedia({ bytes, contentType, prefix: mediaKeyPrefixFor(input.memberId) });
}

/**
 * Bytes only after the service says this viewer may see them (their own
 * upload, or another player's entry once the game view would show it).
 * Locked and missing media look the same.
 */
export async function serveGameMedia(input: { key: string; memberId: string; delivery?: boolean; variant?: "avatar" | "photo" }): Promise<Response> {
  if (!isGameMediaKey(input.key) || !(await authorizeMediaRead(input.memberId, input.key))) throw mediaNotFound();
  requireStorage();
  if (input.delivery) {
    const delivery = await gameMediaDelivery(input.key, input.variant ?? "photo");
    if (delivery) return new Response(JSON.stringify(delivery), { headers: {
      "Cache-Control": "private, no-store", "Content-Type": "application/json", "Referrer-Policy": "no-referrer",
    } });
  }
  const media = await readGameMedia(input.key);
  if (!media) throw mediaNotFound();
  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(media.bytes.byteLength),
      "Content-Type": media.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function requireStorage(): void {
  if (!isGameMediaStorageAvailable()) {
    throw gameHttpError("GAME_MEDIA_UNAVAILABLE", 503, "Game media isn't available here yet.");
  }
}

function mediaNotFound() {
  return gameHttpError("MEDIA_MISSING", 404, "That media isn't available.");
}
