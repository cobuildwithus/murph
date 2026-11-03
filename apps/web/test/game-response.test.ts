import { describe, expect, it } from "vitest";
import { gameJsonOk } from "@/src/lib/game/http/response";

describe("game JSON response", () => {
  it("streams an oversized capable response without altering JSON bytes or Unicode", async () => {
    const request = new Request("https://example.test", { headers: { "X-Murph-Game-Multiplayer": "1" } });
    const payload = { text: "Family 🏆 ".repeat(500_000) };
    const response = gameJsonOk(request, payload);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-length")).toBeNull();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "", chunks = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      expect(value.byteLength).toBeLessThanOrEqual(64 * 1024);
      text += decoder.decode(value, { stream: true }); chunks++;
    }
    text += decoder.decode();
    expect(chunks).toBeGreaterThan(1);
    expect(text).toBe(JSON.stringify(payload));
  });

  it("keeps the legacy JSON helper's bytes and headers", async () => {
    const request = new Request("https://example.test");
    const response = gameJsonOk(request, { ok: true, game: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe('{"ok":true,"game":null}');
  });
});
