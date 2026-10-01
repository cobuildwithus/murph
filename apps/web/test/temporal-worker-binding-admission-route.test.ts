import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSystemCallback: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareSystemCallbackRequest: mocks.requireSystemCallback,
}));

describe("Temporal worker binding admission route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSystemCallback.mockResolvedValue("v1");
  });

  it("returns the exact Web-owned production binding contract without caching it", async () => {
    const request = new Request(
      "https://join.example.test/api/internal/hosted-orchestration/temporal-worker/binding-admission",
    );
    const { GET } = await import(
      "@/app/api/internal/hosted-orchestration/temporal-worker/binding-admission/route"
    );

    const response = await GET(request);

    expect(mocks.requireSystemCallback).toHaveBeenCalledWith(request, {
      maxBodyBytes: 0,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      bindingContractRevision: "bindings-v1",
      environment: "production",
      kind: "hosted_temporal_worker_binding_admission",
      owner: "web",
      signingKeyId: "v1",
    });
  });
});
