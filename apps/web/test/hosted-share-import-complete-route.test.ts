import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonPostRequest } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  deleteHostedSharePackFromHostedExecution: vi.fn(),
  finalizeHostedShareAcceptance: vi.fn(),
  findHostedShareLinkById: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedWebInternalSignedRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  deleteHostedSharePackFromHostedExecution: mocks.deleteHostedSharePackFromHostedExecution,
}));

vi.mock("@/src/lib/hosted-execution/internal", () => ({
  requireHostedWebInternalSignedRequest: mocks.requireHostedWebInternalSignedRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-share/shared", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-share/shared")>("@/src/lib/hosted-share/shared");

  return {
    ...actual,
    finalizeHostedShareAcceptance: mocks.finalizeHostedShareAcceptance,
    findHostedShareLinkById: mocks.findHostedShareLinkById,
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
    mocks.deleteHostedSharePackFromHostedExecution.mockResolvedValue(undefined);
    mocks.finalizeHostedShareAcceptance.mockResolvedValue(undefined);
    mocks.findHostedShareLinkById.mockResolvedValue({
      id: "share_123",
      senderMemberId: "member_sender",
    });
    mocks.getPrisma.mockReturnValue({ prisma: true });
    mocks.requireHostedWebInternalSignedRequest.mockImplementation(async (request: Request) => {
      await expect(request.clone().text()).resolves.toContain("\"shareId\":\"share_123\"");
      return "member_recipient";
    });
  });

  it("finalizes the hosted share and deletes the sender pack through the signed callback lane", async () => {
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
    expect(mocks.requireHostedWebInternalSignedRequest).toHaveBeenCalledTimes(1);
    expect(mocks.findHostedShareLinkById).toHaveBeenCalledWith("share_123", { prisma: true });
    expect(mocks.finalizeHostedShareAcceptance).toHaveBeenCalledWith({
      eventId: "evt_share",
      memberId: "member_recipient",
      prisma: { prisma: true },
      shareId: "share_123",
    });
    expect(mocks.deleteHostedSharePackFromHostedExecution).toHaveBeenCalledWith({
      ownerUserId: "member_sender",
      shareId: "share_123",
    });
    await expect(response.json()).resolves.toEqual({
      eventId: "evt_share",
      finalized: true,
      shareId: "share_123",
    });
  });

  it("keeps the finalize success response even when pack cleanup fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.deleteHostedSharePackFromHostedExecution.mockRejectedValue(new Error("delete failed"));

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
    expect(consoleError).toHaveBeenCalledWith(
      "Hosted share share_123 finalized but its Cloudflare pack could not be deleted.",
      "delete failed",
    );
    consoleError.mockRestore();
  });
});
