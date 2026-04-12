import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonPostRequest } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  deleteHostedSharePackObject: vi.fn(),
  finalizeHostedShareAcceptance: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-share/pack-store", () => ({
  deleteHostedSharePackObject: mocks.deleteHostedSharePackObject,
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
    finalizeHostedShareAcceptance: mocks.finalizeHostedShareAcceptance,
  };
});

type HostedShareImportCompleteRouteModule =
  typeof import("../app/api/internal/hosted-execution/share-import/complete/route");

let hostedShareImportCompleteRoute: HostedShareImportCompleteRouteModule;

describe("hosted share-import complete route", () => {
  beforeAll(async () => {
    hostedShareImportCompleteRoute = await import("../app/api/internal/hosted-execution/share-import/complete/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteHostedSharePackObject.mockResolvedValue(undefined);
    mocks.finalizeHostedShareAcceptance.mockResolvedValue({
      finalized: false,
      shareFound: true,
      sharePackOwnerMemberId: "member_sender",
    });
    mocks.getPrisma.mockReturnValue({ prisma: true });
    mocks.requireHostedCloudflareCallbackRequest.mockImplementation(async (request: Request) => {
      await expect(request.clone().text()).resolves.toContain("\"shareId\":\"share_123\"");
      return "member_recipient";
    });
  });

  it("retries Cloudflare pack cleanup for an already-consumed matching callback", async () => {
    const response = await hostedShareImportCompleteRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/internal/hosted-execution/share-import/complete",
        {
          eventId: "evt_share",
          shareId: "share_123",
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledTimes(1);
    expect(mocks.finalizeHostedShareAcceptance).toHaveBeenCalledWith({
      eventId: "evt_share",
      memberId: "member_recipient",
      prisma: { prisma: true },
      shareId: "share_123",
    });
    expect(mocks.deleteHostedSharePackObject).toHaveBeenCalledWith({
      ownerUserId: "member_sender",
      shareId: "share_123",
    });
    await expect(response.json()).resolves.toEqual({
      eventId: "evt_share",
      finalized: false,
      shareId: "share_123",
    });
  });

  it("surfaces pack cleanup failures so the callback can be retried", async () => {
    mocks.finalizeHostedShareAcceptance.mockResolvedValue({
      finalized: true,
      shareFound: true,
      sharePackOwnerMemberId: "member_sender",
    });
    mocks.deleteHostedSharePackObject.mockRejectedValue(new Error("delete failed"));

    const response = await hostedShareImportCompleteRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/internal/hosted-execution/share-import/complete",
        {
          eventId: "evt_share",
          shareId: "share_123",
        },
      ),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.objectContaining({
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      }),
    });
  });

  it("returns 404 when the accepted share link no longer exists", async () => {
    mocks.finalizeHostedShareAcceptance.mockResolvedValue({
      finalized: false,
      shareFound: false,
      sharePackOwnerMemberId: null,
    });

    const response = await hostedShareImportCompleteRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/internal/hosted-execution/share-import/complete",
        {
          eventId: "evt_share",
          shareId: "share_123",
        },
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.objectContaining({
        message: "Hosted share share_123 was not found.",
      }),
    });
    expect(mocks.deleteHostedSharePackObject).not.toHaveBeenCalled();
  });
});
