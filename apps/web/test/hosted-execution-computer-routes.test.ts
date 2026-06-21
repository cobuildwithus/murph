import {
  HOSTED_COMPUTER_CAPABILITIES_PATH,
  parseHostedComputerCapabilitiesResponse,
} from "@murphai/hosted-execution/computer-use";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

type ComputerCapabilitiesRoute =
  typeof import("../app/api/internal/computer/capabilities/route");

let computerCapabilitiesRoute: ComputerCapabilitiesRoute;

describe("hosted computer-use internal routes", () => {
  beforeAll(async () => {
    computerCapabilitiesRoute = await import("../app/api/internal/computer/capabilities/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_routes_1");
  });

  it("returns the member-scoped start-run capability through a signed callback", async () => {
    const response = await computerCapabilitiesRoute.GET(
      new Request(`https://join.example.test${HOSTED_COMPUTER_CAPABILITIES_PATH}`),
    );

    expect(response.status).toBe(200);
    expect(parseHostedComputerCapabilitiesResponse(await response.json())).toEqual({
      memberScopedProfileRequired: true,
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      expect.any(Request),
      {
        maxBodyBytes: 0,
      },
    );
  });
});
