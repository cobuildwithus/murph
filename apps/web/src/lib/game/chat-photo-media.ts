import "server-only";
import { readHostedLinqAttachment } from "../hosted-onboarding/linq-client";
import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution/contracts";
import { GAME_MEDIA_MAX_BYTES, matchesGameMediaContentType, parseGameMediaContentType, type GameMediaContentType } from "./media";

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
  const attachment = await readHostedLinqAttachment(source.attachmentId);
  if (attachment.id !== source.attachmentId || parseGameMediaContentType(attachment.content_type) !== source.contentType || !attachment.download_url) throw new Error("Game photo is unavailable.");
  if (!Number.isFinite(attachment.size_bytes) || attachment.size_bytes < 0 || attachment.size_bytes > GAME_MEDIA_MAX_BYTES) throw new Error("Game photo is too large.");
  const url = new URL(attachment.download_url);
  if (url.origin !== "https://cdn.linqapp.com" || url.username || url.password) throw new Error("Game photo is unavailable.");
  // No redirects, credential forwarding, arbitrary hosts or unbounded bodies.
  const response = await fetch(url.toString(), { redirect: "error", signal: AbortSignal.timeout(8_000), cache: "no-store" });
  if (!response.ok || !response.body) throw new Error("Game photo is unavailable.");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > GAME_MEDIA_MAX_BYTES) { await response.body.cancel(); throw new Error("Game photo is too large."); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > GAME_MEDIA_MAX_BYTES) throw new Error("Game photo is too large.");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!matchesGameMediaContentType(bytes, source.contentType)) throw new Error("Game photo format is unavailable.");
  return { bytes, contentType: source.contentType };
}
