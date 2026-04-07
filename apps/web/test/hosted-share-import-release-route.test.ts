import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonPostRequest } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  releaseHostedShareAcceptance: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-share/shared", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-share/shared")>("@/src/lib/hosted-share/shared");

  return {
    ...actual,
    releaseHostedShareAcceptance: mocks.releaseHostedShareAcceptance,
  };
});

type HostedShareImportReleaseRouteModule =
  typeof import("../app/api/internal/hosted-execution/share-import/release/route");

let hostedShareImportReleaseRoute: HostedShareImportReleaseRouteModule;

describe("hosted share-import release route", () => {
  beforeAll(async () => {
    hostedShareImportReleaseRoute = await import("../app/api/internal/hosted-execution/share-import/release/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({ prisma: true });
    mocks.releaseHostedShareAcceptance.mockResolvedValue(true);
    mocks.requireHostedCloudflareCallbackRequest.mockImplementation(async (request: Request) => {
      await expect(request.clone().text()).resolves.toContain("\"shareId\":\"share_123\"");
      return "member_recipient";
    });
  });

  it("releases the hosted share claim through the signed callback lane", async () => {
    const response = await hostedShareImportReleaseRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/internal/hosted-execution/share-import/release",
        {
          eventId: "evt_share",
          reason: "share pack missing",
          shareId: "share_123",
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledTimes(1);
    expect(mocks.releaseHostedShareAcceptance).toHaveBeenCalledWith({
      eventId: "evt_share",
      memberId: "member_recipient",
      prisma: { prisma: true },
      shareId: "share_123",
    });
    await expect(response.json()).resolves.toEqual({
      eventId: "evt_share",
      reason: "share pack missing",
      released: true,
      shareId: "share_123",
    });
  });

  it("returns released false when the callback is stale for the current claim", async () => {
    mocks.releaseHostedShareAcceptance.mockResolvedValue(false);

    const response = await hostedShareImportReleaseRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/internal/hosted-execution/share-import/release",
        {
          eventId: "evt_share",
          reason: "share pack missing",
          shareId: "share_123",
        },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      eventId: "evt_share",
      reason: "share pack missing",
      released: false,
      shareId: "share_123",
    });
  });
});
