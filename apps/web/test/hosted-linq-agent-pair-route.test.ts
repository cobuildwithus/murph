import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedLinqControlPlane: vi.fn(),
}));

vi.mock("@/src/lib/linq/control-plane", () => ({
  createHostedLinqControlPlane: mocks.createHostedLinqControlPlane,
}));

type HostedLinqAgentPairRouteModule = typeof import("../app/api/linq/agents/pair/route");

let hostedLinqAgentPairRoute: HostedLinqAgentPairRouteModule;

describe("hosted Linq agent pair route", () => {
  beforeAll(async () => {
    hostedLinqAgentPairRoute = await import("../app/api/linq/agents/pair/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects GET requests with a POST-only JSON response", async () => {
    const response = await hostedLinqAgentPairRoute.GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Hosted Linq agent pair routes only allow POST.",
      },
    });
    expect(mocks.createHostedLinqControlPlane).not.toHaveBeenCalled();
  });
});
