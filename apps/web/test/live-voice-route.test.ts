import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_VOICES } from "../src/lib/live-voice/voices";
import { POST } from "../app/api/live-voice/session/route";

const provider = vi.fn();
function request(body: { sdp: string; voice?: unknown } = { sdp: "v=0\r\n" }, origin = "http://localhost:3107") {
  return new Request("http://localhost:3107/api/live-voice/session", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  vi.stubGlobal("fetch", provider);
  provider.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("local GPT-Live admission", () => {
  it("rejects production, foreign origins, and missing keys before provider work", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await POST(request())).status).toBe(404);
    vi.stubEnv("NODE_ENV", "development");
    expect((await POST(request(undefined, "https://example.com"))).status).toBe(403);
    vi.stubEnv("OPENAI_API_KEY", "");
    expect((await POST(request())).status).toBe(503);
    expect(provider).not.toHaveBeenCalled();
  });
  it("rejects malformed and oversized offers", async () => {
    expect((await POST(request({ sdp: "invalid" }))).status).toBe(400);
    expect((await POST(request({ sdp: "v=0" + "a".repeat(70_000) }))).status).toBe(413);
    expect(provider).not.toHaveBeenCalled();
  });
  it("uses GPT-Live and returns only the answer, never credentials", async () => {
    provider.mockResolvedValue(Response.json({ session: { id: "live_synthetic" }, transport: { sdp: "answer" } }));
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ sdp: "answer" });
    expect(provider.mock.calls[0][0]).toBe("https://api.openai.com/v1/live/sessions");
    const body = JSON.parse(provider.mock.calls[0][1].body);
    expect(body.session.model).toBe("gpt-live-1");
    expect(body.session.store).toBe(false);
    expect(body.session.audio.output.voice).toBe("gleam");
    expect(body.transport).toEqual({ type: "webrtc", sdp: "v=0\r\n" });
  });
  it.each(LIVE_VOICES)("passes the selected $name voice to the provider", async ({ id }) => {
    provider.mockResolvedValue(Response.json({ transport: { sdp: "answer" } }));
    expect((await POST(request({ sdp: "v=0\r\n", voice: id }))).status).toBe(201);
    expect(JSON.parse(provider.mock.calls[0][1].body).session.audio.output.voice).toBe(id);
  });
  it.each(["unsupported", "nova", "alloy", "meridian", "vesper", "ripple", "stone", "beacon", "cinder", null, { id: "gleam" }])("rejects invalid voice %j before provider work", async (voice) => {
    expect((await POST(request({ sdp: "v=0\r\n", voice }))).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
  it("does not forward provider errors or secrets to the browser", async () => {
    provider.mockResolvedValue(Response.json({ error: { message: "private provider detail" } }, { status: 403 }));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private provider detail");
  });
});
