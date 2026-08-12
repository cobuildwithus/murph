import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHostedWebControlPlaneJson: vi.fn(),
}));

vi.mock("../src/runtime-platform/web-control-transport.ts", () => ({
  fetchHostedWebControlPlaneJson: mocks.fetchHostedWebControlPlaneJson,
}));

import { createHostedWebVaultSharePort } from "../src/runtime-platform/vault-share-port.ts";

const DELIVER_REQUEST = {
  projectionKind: "sleep-times.v0" as const,
  projectionScope: {
    projectionKind: "sleep-times.v0" as const,
  },
  records: [],
};

function createPort() {
  return createHostedWebVaultSharePort({
    boundUserId: "member_grantor",
    fetchImpl: vi.fn() as unknown as typeof fetch,
    timeoutMs: 1_000,
    transport: { mode: "proxy" },
  });
}

describe("createHostedWebVaultSharePort delivery continuation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drains later pages without replaying a completed page", async () => {
    mocks.fetchHostedWebControlPlaneJson
      .mockResolvedValueOnce({
        continuation: "share_032",
        status: "delivered",
      })
      .mockResolvedValueOnce({ status: "no-active-share" });

    await expect(createPort().deliver(DELIVER_REQUEST)).resolves.toEqual({
      status: "delivered",
    });

    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledTimes(2);
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        body: DELIVER_REQUEST,
        replayOnceOnRetryableFailure: true,
      }),
    );
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: {
          ...DELIVER_REQUEST,
          continuation: "share_032",
        },
        replayOnceOnRetryableFailure: true,
      }),
    );
  });

  it("fails closed on a malformed Web continuation", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      continuation: "share/032",
      status: "delivered",
    });

    await expect(createPort().deliver(DELIVER_REQUEST)).rejects.toThrow(
      "Hosted vault-share delivery continuation is invalid.",
    );
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Web repeats a continuation", async () => {
    mocks.fetchHostedWebControlPlaneJson
      .mockResolvedValueOnce({
        continuation: "share_032",
        status: "delivered",
      })
      .mockResolvedValueOnce({
        continuation: "share_032",
        status: "delivered",
      });

    await expect(createPort().deliver(DELIVER_REQUEST)).rejects.toThrow(
      "Hosted vault-share delivery continuation repeated.",
    );
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledTimes(2);
  });

  it("does not start a later page after the original delivery deadline", async () => {
    const now = vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000)
      .mockReturnValue(2_000);
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValueOnce({
      continuation: "share_032",
      status: "delivered",
    });

    try {
      await expect(createPort().deliver(DELIVER_REQUEST)).rejects.toMatchObject({
        message: "Hosted vault-share delivery deadline exceeded.",
        name: "TimeoutError",
      });
      expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledTimes(1);
      expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 1_000 }),
      );
    } finally {
      now.mockRestore();
    }
  });
});
