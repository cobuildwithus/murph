import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commitHostedExecutionCursorTx: vi.fn(),
  getPrisma: vi.fn(),
  listHostedWakesAfterSeq: vi.fn(),
  readOptionalJsonObject: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/http")>(
    "@/src/lib/http",
  );

  return {
    ...actual,
    readOptionalJsonObject: mocks.readOptionalJsonObject,
  };
});

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-wake/store", () => ({
  commitHostedExecutionCursorTx: mocks.commitHostedExecutionCursorTx,
  listHostedWakesAfterSeq: mocks.listHostedWakesAfterSeq,
}));

describe("hosted wake internal routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.getPrisma.mockReturnValue({
      $transaction: vi.fn(async (callback: (tx: { label: string }) => Promise<unknown>) =>
        callback({ label: "wake-route-tx" })),
    });
    mocks.listHostedWakesAfterSeq.mockResolvedValue({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "3",
      },
      wakes: [],
    });
    mocks.commitHostedExecutionCursorTx.mockResolvedValue({
      committed: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: { checkpoint: "wake_24" },
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "4",
      },
    });
  });

  it("parses and forwards unseen wake fetch requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      afterSeq: "12",
      limit: 128,
    });

    const { POST } = await import("../app/api/internal/hosted-wake/unseen/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "3",
      },
      wakes: [],
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledOnce();
    expect(mocks.listHostedWakesAfterSeq).toHaveBeenCalledWith({
      afterSeq: 12n,
      limit: 128,
      prisma: expect.anything(),
      userId: "member_123",
    });
  });

  it("parses and forwards wake cursor commit requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      committedSeq: "24",
      expectedVersion: "3",
      snapshotRef: {
        checkpoint: "wake_24",
      },
    });

    const { POST } = await import("../app/api/internal/hosted-wake/commit/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      committed: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: {
          checkpoint: "wake_24",
        },
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
        version: "4",
      },
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledOnce();
    expect(mocks.getPrisma).toHaveBeenCalledOnce();
    expect(mocks.commitHostedExecutionCursorTx).toHaveBeenCalledWith({
      committedSeq: 24n,
      expectedVersion: 3n,
      snapshotRef: {
        checkpoint: "wake_24",
      },
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
      userId: "member_123",
    });
  });
});
