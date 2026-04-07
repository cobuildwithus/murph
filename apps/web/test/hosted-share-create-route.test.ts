import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonPostRequest } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  createHostedShareLink: vi.fn(),
  requireHostedPrivyActiveRequestAuthContext: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireHostedPrivyActiveRequestAuthContext: mocks.requireHostedPrivyActiveRequestAuthContext,
}));

vi.mock("@/src/lib/hosted-share/service", () => ({
  createHostedShareLink: mocks.createHostedShareLink,
}));

type HostedShareCreateRouteModule = typeof import("../app/api/hosted-share/create/route");

let hostedShareCreateRoute: HostedShareCreateRouteModule;

describe("hosted share create route", () => {
  beforeAll(async () => {
    hostedShareCreateRoute = await import("../app/api/hosted-share/create/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedShareLink.mockResolvedValue({
      shareCode: "share_123",
      url: "https://join.example.test/share/share_123",
    });
    mocks.requireHostedPrivyActiveRequestAuthContext.mockResolvedValue({
      member: {
        id: "member_sender",
      },
    });
  });

  it("uses the authenticated hosted member instead of trusting caller-supplied sender ids", async () => {
    const response = await hostedShareCreateRoute.POST(
      createJsonPostRequest("https://join.example.test/api/hosted-share/create", {
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
        senderMemberId: "member_attacker",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledTimes(1);
    expect(mocks.requireHostedPrivyActiveRequestAuthContext).toHaveBeenCalledTimes(1);
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
