import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murph/hosted-execution";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readHostedSharePackByReference: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-share/service", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-share/service")>(
    "@/src/lib/hosted-share/service",
  );

  return {
    ...actual,
    readHostedSharePackByReference: mocks.readHostedSharePackByReference,
  };
});

type RouteModule = typeof import("../app/api/hosted-share/internal/[shareId]/payload/route");

let route: RouteModule;

const originalShareToken = process.env.HOSTED_SHARE_INTERNAL_TOKEN;

describe("hosted share internal payload route", () => {
  beforeAll(async () => {
    route = await import("../app/api/hosted-share/internal/[shareId]/payload/route");
  });

  afterAll(() => {
    if (typeof originalShareToken === "string") {
      process.env.HOSTED_SHARE_INTERNAL_TOKEN = originalShareToken;
    } else {
      delete process.env.HOSTED_SHARE_INTERNAL_TOKEN;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_SHARE_INTERNAL_TOKEN = "share-token";
    mocks.getPrisma.mockReturnValue({
      prisma: true,
    });
    mocks.readHostedSharePackByReference.mockResolvedValue({
      pack: {
        createdAt: "2026-03-29T10:00:00.000Z",
        entities: [],
        schemaVersion: "murph.share-pack.v1",
        title: "Share pack",
      },
      shareId: "share_123",
    });
  });

  it("requires the trusted hosted execution user binding header", async () => {
    const response = await route.GET(
      new Request("https://web.example.test/api/hosted-share/internal/share_123/payload?shareCode=code_123", {
        headers: {
          authorization: "Bearer share-token",
        },
      }),
      {
        params: Promise.resolve({
          shareId: "share_123",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_EXECUTION_USER_REQUIRED",
        message: "Hosted execution user binding is required.",
      },
    });
    expect(mocks.readHostedSharePackByReference).not.toHaveBeenCalled();
  });

  it("passes the trusted hosted execution user binding through to the share lookup", async () => {
    const prisma = {
      prisma: true,
    };
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await route.GET(
      new Request("https://web.example.test/api/hosted-share/internal/share_123/payload?shareCode=code_123", {
        headers: {
          authorization: "Bearer share-token",
          [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
        },
      }),
      {
        params: Promise.resolve({
          shareId: "share_123",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.readHostedSharePackByReference).toHaveBeenCalledWith({
      boundMemberId: "member_123",
      prisma,
      shareCode: "code_123",
      shareId: "share_123",
    });
  });
});
