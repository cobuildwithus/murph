import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { downloadGameChatPhoto, GAME_CHAT_PHOTO_MAX_DOWNLOAD_BYTES, gamePhotoAttachment } from "../src/lib/game/chat-photo-media";
import { GAME_MEDIA_MAX_BYTES } from "../src/lib/game/media";
import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution/contracts";
const metadata = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/hosted-onboarding/linq-client", () => ({ readHostedLinqAttachment: metadata }));
function wake(attachmentId?: string): HostedExecutionConversationMessageWake { return { kind: "conversation.message", eventId: "synthetic", userId: "room", occurredAt: "2030-03-04T12:00:00Z", message: { channel: "linq", phoneLookupKey: "synthetic-phone-key", linqMessage: { chatId: "chat", from: "+15555550101", isFromMe: false, messageId: "photo", parts: [{ type: "text", value: "photo" }, { type: "media", attachmentId, mimeType: "image/jpeg" }] } } }; }
const source = { attachmentId: "synthetic-attachment", contentType: "image/jpeg" as const };
const attachment = { id: source.attachmentId, content_type: source.contentType, download_url: "https://cdn.linqapp.com/a", size_bytes: 4 };
describe("game photo import boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); metadata.mockResolvedValue(attachment); });
  afterEach(() => vi.unstubAllGlobals());
  it("selects an accepted attachment ID and MIME without a URL or provider lookup", () => {
    expect(gamePhotoAttachment(wake(source.attachmentId), 1)).toEqual(source);
    expect(gamePhotoAttachment(wake(source.attachmentId), 2)).toBeNull();
    expect(gamePhotoAttachment(wake(), 1)).toBeNull();
    expect(metadata).not.toHaveBeenCalled();
  });
  it.each(["http://cdn.linqapp.com/a", "https://cdn.linqapp.com.evil.test/a", "https://127.0.0.1/a", "https://secret@cdn.linqapp.com/a", undefined])("rejects an unsafe or absent refreshed locator before download: %s", async (download_url) => {
    metadata.mockResolvedValue({ ...attachment, download_url });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(downloadGameChatPhoto(source)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ id: "another-attachment" }, { content_type: "image/png" }, { size_bytes: GAME_CHAT_PHOTO_MAX_DOWNLOAD_BYTES + 1 }])("rejects mismatched or excessive provider metadata: %j", async (change) => {
    metadata.mockResolvedValue({ ...attachment, ...change });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(downloadGameChatPhoto(source)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds streamed bytes and disables redirects without forwarding provider credentials", async () => {
    const fake = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(GAME_CHAT_PHOTO_MAX_DOWNLOAD_BYTES + 1)));
    vi.stubGlobal("fetch", fake);
    await expect(downloadGameChatPhoto(source)).rejects.toThrow("too_large");
    expect(metadata).toHaveBeenCalledWith(source.attachmentId);
    expect(fake).toHaveBeenCalledWith(attachment.download_url, expect.objectContaining({ redirect: "error", cache: "no-store" }));
    expect(fake.mock.calls[0]?.[1]).not.toHaveProperty("headers");
  });
  it("rejects mislabeled or undecodable content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("not an image")).mockResolvedValueOnce(new Response(new Uint8Array([255,216,255,0]))));
    await expect(downloadGameChatPhoto(source)).rejects.toThrow("format");
    await expect(downloadGameChatPhoto(source)).rejects.toThrow("decode");
  });
  it("fits a full-size camera JPEG to an upright app-sized photo without camera metadata", async () => {
    // A detailed 24 MP sideways camera file, larger than game media accepts.
    const camera = await sharp({ create: { width: 5712, height: 4284, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 40 } } })
      .jpeg({ quality: 70 }).withMetadata({ orientation: 6 }).toBuffer();
    expect(camera.byteLength).toBeGreaterThan(GAME_MEDIA_MAX_BYTES);
    expect(camera.byteLength).toBeLessThan(GAME_CHAT_PHOTO_MAX_DOWNLOAD_BYTES);
    metadata.mockResolvedValue({ ...attachment, size_bytes: camera.byteLength });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(camera))));
    const photo = await downloadGameChatPhoto(source);
    expect(photo.contentType).toBe("image/jpeg");
    expect(photo.bytes.byteLength).toBeLessThanOrEqual(GAME_MEDIA_MAX_BYTES);
    const stored = await sharp(photo.bytes).metadata();
    expect({ format: stored.format, width: stored.width, height: stored.height, exif: stored.exif, orientation: stored.orientation })
      .toEqual({ format: "jpeg", width: 1536, height: 2048, exif: undefined, orientation: undefined });
  });
  it("passes a HEIC photo through only when it already fits", async () => {
    const heic = (size: number) => { const bytes = new Uint8Array(size); bytes.set(new TextEncoder().encode("\0\0\0\x18ftypheic"), 0); return bytes; };
    const heicSource = { ...source, contentType: "image/heic" as const };
    metadata.mockResolvedValue({ ...attachment, content_type: "image/heic" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(heic(64))).mockResolvedValueOnce(new Response(heic(GAME_MEDIA_MAX_BYTES + 1))));
    expect(await downloadGameChatPhoto(heicSource)).toEqual({ bytes: heic(64), contentType: "image/heic" });
    await expect(downloadGameChatPhoto(heicSource)).rejects.toThrow("too_large");
  });
});
