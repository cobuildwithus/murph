import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadGameChatPhoto, gamePhotoAttachment } from "../src/lib/game/chat-photo-media";
import { GAME_MEDIA_MAX_BYTES } from "../src/lib/game/media";
import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution/contracts";
function wake(url: string): HostedExecutionConversationMessageWake { return { kind: "conversation.message", eventId: "synthetic", userId: "room", occurredAt: "2030-03-04T12:00:00Z", message: { channel: "linq", phoneLookupKey: "synthetic-phone-key", linqMessage: { chatId: "chat", from: "+15555550101", isFromMe: false, messageId: "photo", parts: [{ type: "text", value: "photo" }, { type: "media", url, mimeType: "image/jpeg" }] } } }; }
describe("game photo import boundary", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("selects an accepted attachment ordinal, never arbitrary origins or credentials", () => {
    expect(gamePhotoAttachment(wake("https://cdn.linqapp.com/image.jpg"), 1)?.contentType).toBe("image/jpeg");
    expect(gamePhotoAttachment(wake("https://cdn.linqapp.com/image.jpg"), 2)).toBeNull();
    for (const url of ["http://cdn.linqapp.com/a", "https://cdn.linqapp.com.evil.test/a", "https://127.0.0.1/a", "https://secret@cdn.linqapp.com/a"]) expect(gamePhotoAttachment(wake(url), 1)).toBeNull();
  });
  it("bounds streamed bytes and disables redirects", async () => {
    const fake = vi.fn(async () => new Response(new Uint8Array(GAME_MEDIA_MAX_BYTES + 1)));
    vi.stubGlobal("fetch", fake);
    await expect(downloadGameChatPhoto({ url: "https://cdn.linqapp.com/a", contentType: "image/jpeg" })).rejects.toThrow("too large");
    expect(fake).toHaveBeenCalledWith("https://cdn.linqapp.com/a", expect.objectContaining({ redirect: "error", cache: "no-store" }));
  });
  it("rejects mislabeled content and returns validated image bytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("not an image")).mockResolvedValueOnce(new Response(new Uint8Array([255,216,255,0]))));
    const source = { url: "https://cdn.linqapp.com/a", contentType: "image/jpeg" as const };
    await expect(downloadGameChatPhoto(source)).rejects.toThrow("format");
    expect((await downloadGameChatPhoto(source)).bytes).toEqual(new Uint8Array([255,216,255,0]));
  });
});
