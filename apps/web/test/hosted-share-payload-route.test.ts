import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteHostedSharePayload: vi.fn(),
  getPrisma: vi.fn(),
  projectHostedSharePayloadState: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-share/shared", () => ({
  deleteHostedSharePayload: mocks.deleteHostedSharePayload,
  HOSTED_SHARE_PAYLOAD_SCHEMA: "murph.hosted-share-payload.v1",
  projectHostedSharePayloadState: mocks.projectHostedSharePayloadState,
}));

type HostedSharePayloadRouteModule = typeof import("../app/api/internal/hosted-execution/share/[shareId]/payload/route");

let hostedSharePayloadRoute: HostedSharePayloadRouteModule;

describe("hosted share payload route", () => {
  beforeAll(async () => {
    hostedSharePayloadRoute = await import("../app/api/internal/hosted-execution/share/[shareId]/payload/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_recipient");
    mocks.projectHostedSharePayloadState.mockReturnValue({
      pack: {
        schemaVersion: "murph.share-pack.v1",
        title: "Shared pack",
      },
      payloadSchema: "murph.hosted-share-payload.v1",
      shareId: "share_123",
    });
  });

  it("returns a payload only while the share is accepted, pending, owned by the requested sender, and bound to the runner", async () => {
    const prisma = {
      hostedSharePayload: {
        findUnique: vi.fn(async () => ({
          payloadEncrypted: "ciphertext",
          payloadSchema: "murph.hosted-share-payload.v1",
          share: {
            acceptedAt: new Date("2026-04-20T00:00:00.000Z"),
            acceptedByMemberId: "member_recipient",
            consumedAt: null,
            expiresAt: new Date("2099-04-21T00:00:00.000Z"),
            senderMemberId: "member_sender",
          },
          shareId: "share_123",
        })),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await hostedSharePayloadRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/share/share_123/payload?ownerUserId=member_sender"),
      {
        params: Promise.resolve({
          shareId: "share_123",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      fetchedAt: expect.any(String),
      payload: {
        ownerUserId: "member_sender",
        pack: {
          schemaVersion: "murph.share-pack.v1",
          title: "Shared pack",
        },
        payloadSchema: "murph.hosted-share-payload.v1",
        shareId: "share_123",
      },
      unavailable: null,
    });
    expect(mocks.deleteHostedSharePayload).not.toHaveBeenCalled();
  });

  it("fails closed when the owner query is missing", async () => {
    const response = await hostedSharePayloadRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/share/share_123/payload"),
      {
        params: Promise.resolve({
          shareId: "share_123",
        }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_SHARE_PAYLOAD_NOT_FOUND",
        message: "That shared bundle is no longer available.",
        retryable: false,
      },
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("fails closed when the share has not been accepted yet", async () => {
    const prisma = {
      hostedSharePayload: {
        findUnique: vi.fn(async () => ({
          payloadEncrypted: "ciphertext",
          payloadSchema: "murph.hosted-share-payload.v1",
          share: {
            acceptedAt: null,
            acceptedByMemberId: null,
            consumedAt: null,
            expiresAt: new Date("2099-04-21T00:00:00.000Z"),
            senderMemberId: "member_sender",
          },
          shareId: "share_123",
        })),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await hostedSharePayloadRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/share/share_123/payload?ownerUserId=member_sender"),
      {
        params: Promise.resolve({
          shareId: "share_123",
        }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_SHARE_PAYLOAD_NOT_FOUND",
        message: "That shared bundle is no longer available.",
        retryable: false,
      },
    });
    expect(mocks.deleteHostedSharePayload).not.toHaveBeenCalled();
  });

  it("prunes expired payload rows before failing closed", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-20T12:00:00.000Z"));
      const prisma = {
        hostedSharePayload: {
          findUnique: vi.fn(async () => ({
            payloadEncrypted: "ciphertext",
            payloadSchema: "murph.hosted-share-payload.v1",
            share: {
              acceptedAt: new Date("2026-04-19T00:00:00.000Z"),
              acceptedByMemberId: "member_recipient",
              consumedAt: null,
              expiresAt: new Date("2026-04-19T23:59:59.000Z"),
              senderMemberId: "member_sender",
            },
            shareId: "share_123",
          })),
        },
      };
      mocks.getPrisma.mockReturnValue(prisma);

      const response = await hostedSharePayloadRoute.GET(
        new Request("https://join.example.test/api/internal/hosted-execution/share/share_123/payload?ownerUserId=member_sender"),
        {
          params: Promise.resolve({
            shareId: "share_123",
          }),
        },
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "HOSTED_SHARE_PAYLOAD_NOT_FOUND",
          message: "That shared bundle is no longer available.",
          retryable: false,
        },
      });
      expect(mocks.deleteHostedSharePayload).toHaveBeenCalledWith({
        prisma,
        shareId: "share_123",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
