import {
  GAME_MEDIA_MAX_BYTES,
  gameMediaKey,
  isGameMediaKey,
  isGameMediaStorageAvailable,
  matchesGameMediaContentType,
  parseGameMediaContentType,
  putGameMedia,
  readGameMedia,
} from "../media";
import { authorizeMediaRead, isGamePlayer, mediaKeyPrefixFor } from "../service";
import { readRawBodyBuffer } from "../../http";
import { gameHttpError, gameNotFound, invalidGameRequest } from "./errors";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const MEDIA_ROLE_PATTERN = /^[a-z][a-z0-9_]{0,31}$/u;

export async function uploadGameMedia(input: { gameId: string; memberId: string; request: Request }): Promise<string> {
  const { request } = input;
  const contentType = parseGameMediaContentType(request.headers.get("content-type"));
  if (!contentType) throw invalidGameRequest("Content-Type must be image/jpeg, image/heic, audio/m4a, or video/mp4.");
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) throw invalidGameRequest("Idempotency-Key is required.");
  const role = request.headers.get("x-murph-media-role")?.trim() ?? "";
  if (!MEDIA_ROLE_PATTERN.test(role)) throw invalidGameRequest("X-Murph-Media-Role is required.");
  requireStorage();
  if (!(await isGamePlayer(input.gameId, input.memberId))) throw gameNotFound();

  const bytes = await readRawBodyBuffer(request, { limitBytes: GAME_MEDIA_MAX_BYTES });
  if (bytes.byteLength === 0 || !matchesGameMediaContentType(bytes, contentType)) {
    throw invalidGameRequest("The upload doesn't match its Content-Type.");
  }
  const key = gameMediaKey({ contentType, idempotencyKey, prefix: mediaKeyPrefixFor(input.memberId), role });
  if (await putGameMedia({ bytes, contentType, key }) === "conflict") {
    throw gameHttpError("IDEMPOTENCY_CONFLICT", 409, "This Idempotency-Key was already used for different media.");
  }
  return key;
}

/**
 * Bytes only after the service says this viewer may see them (owner, a
 * co-player who has posted that day, or anyone in the game after settle).
 * Locked and missing media look the same.
 */
export async function serveGameMedia(input: { key: string; memberId: string }): Promise<Response> {
  if (!isGameMediaKey(input.key) || !(await authorizeMediaRead(input.memberId, input.key))) throw mediaNotFound();
  requireStorage();
  const media = await readGameMedia(input.key);
  if (!media) throw mediaNotFound();
  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(media.object.byteLength),
      "Content-Type": media.object.contentType,
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
