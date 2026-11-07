import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/hosted-onboarding/runtime", () => ({ requireHostedOnboardingLinqConfig: () => ({ apiBaseUrl: "https://linq-provider.example.test/v3", apiToken: "synthetic-provider-token" }) }));
import { readHostedLinqAttachment } from "../src/lib/hosted-onboarding/linq-client";
describe("received Linq attachment metadata boundary", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("retrieves the accepted ID with the existing bounded provider client", async () => {
    const metadata = { id: "synthetic-id", download_url: "https://cdn.linqapp.com/fresh", content_type: "image/jpeg", size_bytes: 3 };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(metadata));
    vi.stubGlobal("fetch", fetch);
    expect(await readHostedLinqAttachment(metadata.id)).toEqual(metadata);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://linq-provider.example.test/v3/attachments/synthetic-id");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  });
  it("does not retry provider failure or accept an oversized metadata response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(readHostedLinqAttachment("synthetic-id")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(Response.json({ padding: "x".repeat(17 * 1024) }));
    await expect(readHostedLinqAttachment("synthetic-id")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
