import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn(), options: [] as Array<{ connect: { lookup: (host: string, options: { all?: boolean }, callback: (error: Error | null, address: string | { address: string; family: number }[], family?: number) => void) => void } }>, destroy: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", () => ({ fetch: mocks.fetch, Agent: class {
  constructor(options: { connect: { lookup: (host: string, options: { all?: boolean }, callback: (error: Error | null, address: string | { address: string; family: number }[], family?: number) => void) => void } }) { mocks.options.push(options); }
  destroy = mocks.destroy;
} }));
import { connectionUrl, guardedConnectionFetch, isPublicConnectionAddress } from "../src/lib/custom-connections/guarded-fetch";
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); mocks.options.length = 0; });
describe("guarded connection fetch", () => {
  it.each(["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "192.0.0.1", "192.0.2.1", "192.88.99.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:8.8.8.8", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "2002::1", "3fff::1"])("refuses reserved address %s", (address) => {
    expect(isPublicConnectionAddress(address)).toBe(false);
  });
  it.each(["8.8.8.8", "2606:4700:4700::1111"])("admits globally routable %s", (address) => expect(isPublicConnectionAddress(address)).toBe(true));
  it.each(["http://notes.example.com", "https://strava.com", "https://api.strava.com", "https://api.strava.com./", "https://user:secret@notes.example.com", "https://127.1", "https://[::ffff:127.0.0.1]"])("refuses URL %s", (url) => expect(() => connectionUrl(url)).toThrow());
  it("pins socket resolution and never resolves DNS again, retaining the original TLS URL", async () => {
    mocks.lookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    mocks.fetch.mockResolvedValue(new Response("ok"));
    await (await guardedConnectionFetch("https://notes.example.com/mcp")).text();
    const callback = vi.fn();
    mocks.options[0]!.connect.lookup("notes.example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0]?.[0].href).toBe("https://notes.example.com/mcp");
    expect(mocks.fetch.mock.calls[0]?.[1].redirect).toBe("manual");
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
  it("refuses mixed public/private DNS answers before opening a socket", async () => {
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await expect(guardedConnectionFetch("https://notes.example.com")).rejects.toMatchObject({ code: "unsafe_destination" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects redirects without following them", async () => {
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    mocks.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://127.0.0.1" } }));
    await expect(guardedConnectionFetch("https://notes.example.com")).rejects.toMatchObject({ code: "unsafe_destination" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds cumulative SSE bytes and destroys the dispatcher", async () => {
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    mocks.fetch.mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(600_000)); controller.enqueue(new Uint8Array(600_000)); controller.close();
    } }), { headers: { "content-type": "text/event-stream" } }));
    await expect((await guardedConnectionFetch("https://notes.example.com")).text()).rejects.toMatchObject({ code: "limit" });
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
  it("bounds stalled DNS and keeps raw errors out of caller-visible messages", async () => {
    vi.useFakeTimers();
    mocks.lookup.mockImplementation(() => new Promise(() => {}));
    const pending = expect(guardedConnectionFetch("https://notes.example.com")).rejects.toMatchObject({ code: "unreachable" });
    await vi.advanceTimersByTimeAsync(15000); await pending;
    mocks.lookup.mockRejectedValue(new Error("secret-shaped-provider-value"));
    await expect(guardedConnectionFetch("https://notes.example.com")).rejects.not.toThrow("secret-shaped");
  });
  it("enforces the same deadline after SSE headers arrive", async () => {
    vi.useFakeTimers();
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    mocks.fetch.mockImplementation(async (_url: URL, init: RequestInit) => new Response(new ReadableStream({ start(controller) {
      init.signal!.addEventListener("abort", () => controller.error(new Error("synthetic-private-error")), { once: true });
    } }), { headers: { "content-type": "text/event-stream" } }));
    const response = await guardedConnectionFetch("https://notes.example.com");
    const reading = expect(response.text()).rejects.toMatchObject({ code: "unreachable" });
    await vi.advanceTimersByTimeAsync(15_000);
    await reading;
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

});
