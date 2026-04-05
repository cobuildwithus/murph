import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedShareLink: vi.fn(),
  requireHostedWebInternalSignedRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/internal", () => ({
  requireHostedWebInternalSignedRequest: mocks.requireHostedWebInternalSignedRequest,
}));

vi.mock("@/src/lib/hosted-share/service", () => ({
  createHostedShareLink: mocks.createHostedShareLink,
}));

type HostedShareInternalCreateRouteModule = typeof import("../app/api/hosted-share/internal/create/route");

let hostedShareInternalCreateRoute: HostedShareInternalCreateRouteModule;

describe("hosted share internal create route", () => {
  beforeAll(async () => {
    hostedShareInternalCreateRoute = await import("../app/api/hosted-share/internal/create/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedShareLink.mockResolvedValue({
      shareCode: "share_123",
      url: "https://join.example.test/share/share_123",
    });
    mocks.requireHostedWebInternalSignedRequest.mockImplementation(async (request: Request) => {
      await expect(request.clone().text()).resolves.toContain("\"senderMemberId\":\"member_sender\"");
      return "member_sender";
    });
  });

  it("verifies the signed request before consuming the JSON body", async () => {
    const response = await hostedShareInternalCreateRoute.POST(
      new Request("https://join.example.test/api/hosted-share/internal/create", {
        body: JSON.stringify({
          pack: {
            createdAt: "2026-04-05T00:00:00.000Z",
            entities: [
              {
                kind: "protocol",
                payload: {
                  title: "Shared protocol",
                },
                ref: "protocol:shared",
              },
            ],
            schemaVersion: "murph.share-pack.v1",
            title: "Shared pack",
          },
          senderMemberId: "member_sender",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireHostedWebInternalSignedRequest).toHaveBeenCalledTimes(1);
    expect(mocks.createHostedShareLink).toHaveBeenCalledWith({
      expiresInHours: undefined,
      inviteCode: null,
      pack: {
        createdAt: "2026-04-05T00:00:00.000Z",
        entities: [
          {
            kind: "protocol",
            payload: {
              kind: "supplement",
              status: "active",
              title: "Shared protocol",
            },
            ref: "protocol:shared",
          },
        ],
        schemaVersion: "murph.share-pack.v1",
        title: "Shared pack",
      },
      recipientPhoneNumber: null,
      senderMemberId: "member_sender",
    });
    await expect(response.json()).resolves.toEqual({
      shareCode: "share_123",
      url: "https://join.example.test/share/share_123",
    });
  });
});
