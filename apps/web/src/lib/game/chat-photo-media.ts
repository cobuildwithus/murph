import "server-only";
import { readHostedLinqAttachment } from "../hosted-onboarding/linq-client";
import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution/contracts";
import { GAME_MEDIA_MAX_BYTES, matchesGameMediaContentType, parseGameMediaContentType, type GameMediaContentType } from "./media";

/**
 * A chat photo is the sender's full camera file: a 24 MP iPhone photo arrives
 * from Linq as a 5 to 10 MB JPEG, while the app uploads about 1 MiB. Accept the
 * runner's Linq download bound, then fit the photo to game media.
 */
export const GAME_CHAT_PHOTO_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const MAX_EDGE_PX = 2048;
const MAX_INPUT_PIXELS = 64 * 1_000_000;
const JPEG_QUALITY = 82;

export type GameChatPhotoImportFailure = "provider_lookup" | "provider_metadata" | "unavailable" | "too_large" | "format" | "decode";
/** Carries only a fixed reason, so a failed import is diagnosable without logging locators or bytes. */
export class GameChatPhotoImportError extends Error {
  constructor(readonly reason: GameChatPhotoImportFailure) { super(`Game photo import failed: ${reason}.`); }
}
function fail(reason: GameChatPhotoImportFailure): never { throw new GameChatPhotoImportError(reason); }

/** Only an immutable, accepted Linq attachment selects the remote bytes. */
export function gamePhotoAttachment(wake: HostedExecutionConversationMessageWake, ordinal: number) {
  if (wake.message.channel !== "linq") return null;
  const part = wake.message.linqMessage.parts.filter((item) => item.type === "media" || item.type === "voice_memo")[ordinal - 1];
  if (!part || part.type !== "media" || !part.attachmentId?.trim()) return null;
  const contentType = parseGameMediaContentType(part.mimeType ?? null);
  return contentType ? { attachmentId: part.attachmentId, contentType } : null;
}

/** Resolve only after consent, outside transactions. Locators stay request-local. */
export async function downloadGameChatPhoto(source: { attachmentId: string; contentType: GameMediaContentType }) {
  const attachment = await readHostedLinqAttachment(source.attachmentId).catch(() => fail("provider_lookup"));
  if (attachment.id !== source.attachmentId || parseGameMediaContentType(attachment.content_type) !== source.contentType || !attachment.download_url) fail("provider_metadata");
  if (!Number.isFinite(attachment.size_bytes) || attachment.size_bytes < 0 || attachment.size_bytes > GAME_CHAT_PHOTO_MAX_DOWNLOAD_BYTES) fail("too_large");
  const url = new URL(attachment.download_url);
  if (url.origin !== "https://cdn.linqapp.com" || url.username || url.password) fail("provider_metadata");
  // No redirects, credential forwarding, arbitrary hosts or unbounded bodies.
  const response = await fetch(url.toString(), { redirect: "error", signal: AbortSignal.timeout(8_000), cache: "no-store" }).catch(() => fail("unavailable"));
  const body = response.ok ? response.body : null;
  if (!body) fail("unavailable");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > GAME_CHAT_PHOTO_MAX_DOWNLOAD_BYTES) { await body.cancel(); fail("too_large"); }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read().catch(() => fail("unavailable"));
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > GAME_CHAT_PHOTO_MAX_DOWNLOAD_BYTES) fail("too_large");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!matchesGameMediaContentType(bytes, source.contentType)) fail("format");
  return await fitGameChatPhoto(bytes, source.contentType);
}

/**
 * JPEG is re-encoded like an app upload: upright, at most 2048 px on its long
 * edge, without camera metadata such as location. Prebuilt sharp has no HEIC
 * decoder, so HEIC passes through only when it already fits.
 */
async function fitGameChatPhoto(bytes: Uint8Array, contentType: GameMediaContentType): Promise<{ bytes: Uint8Array; contentType: GameMediaContentType }> {
  if (contentType === "image/heic") return bytes.byteLength <= GAME_MEDIA_MAX_BYTES ? { bytes, contentType } : fail("too_large");
  const sharp = (await import("sharp")).default;
  const output = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()
    .catch(() => fail("decode"));
  if (output.byteLength > GAME_MEDIA_MAX_BYTES) fail("too_large");
  return { bytes: new Uint8Array(output), contentType: "image/jpeg" };
}
