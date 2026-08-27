import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHostedWebControlPlaneJson: vi.fn(),
}));

vi.mock("../src/runtime-platform/web-control-transport.ts", () => ({
  fetchHostedWebControlPlaneJson: mocks.fetchHostedWebControlPlaneJson,
}));

import { createHostedWebVaultSharePort } from "../src/runtime-platform/vault-share-port.ts";

const DELIVER_REQUEST = {
  expectedGenerationToken: "a".repeat(43),
  projectionKind: "sleep-times.v0" as const,
  projectionScope: {
    projectionKind: "sleep-times.v0" as const,
  },
  records: [],
  sourceWorkspaceVersion: "7",
};

function createPort() {
  return createHostedWebVaultSharePort({
    boundUserId: "member_grantor",
    fetchImpl: vi.fn() as unknown as typeof fetch,
    timeoutMs: 1_000,
    transport: { mode: "proxy" },
  });
}

describe("createHostedWebVaultSharePort delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delivers one complete legal cohort through the shared control-plane boundary", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      status: "delivered",
    });

    await expect(createPort().deliver(DELIVER_REQUEST)).resolves.toEqual({
      status: "delivered",
    });

    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledTimes(1);
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith(
      expect.objectContaining({
        body: DELIVER_REQUEST,
      }),
    );
  });

  it("drains every destination page under one effect deadline", async () => {
    mocks.fetchHostedWebControlPlaneJson
      .mockResolvedValueOnce({
        continuation: "member_destination_025",
        status: "no-active-share",
      })
      .mockResolvedValueOnce({
        continuation: "member_destination_050",
        status: "delivered",
      })
      .mockResolvedValueOnce({ status: "no-active-share" });

    await expect(createPort().deliver(DELIVER_REQUEST)).resolves.toEqual({
      status: "delivered",
    });

    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledTimes(3);
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ body: DELIVER_REQUEST }),
    );
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: {
          ...DELIVER_REQUEST,
          continuation: "member_destination_025",
        },
      }),
    );
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        body: {
          ...DELIVER_REQUEST,
          continuation: "member_destination_050",
        },
      }),
    );
    const firstHeaders = mocks.fetchHostedWebControlPlaneJson.mock.calls[0]?.[0]
      .headers as Headers;
    const secondHeaders = mocks.fetchHostedWebControlPlaneJson.mock.calls[1]?.[0]
      .headers as Headers;
    const thirdHeaders = mocks.fetchHostedWebControlPlaneJson.mock.calls[2]?.[0]
      .headers as Headers;
    expect(secondHeaders.get("x-murph-vault-share-effect-deadline"))
      .toBe(firstHeaders.get("x-murph-vault-share-effect-deadline"));
    expect(thirdHeaders.get("x-murph-vault-share-effect-deadline"))
      .toBe(firstHeaders.get("x-murph-vault-share-effect-deadline"));
  });

  it("rejects malformed and repeated delivery continuations", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValueOnce({
      continuation: "invalid/cursor",
      status: "delivered",
    });
    await expect(createPort().deliver(DELIVER_REQUEST)).rejects.toThrow(
      "Hosted vault-share delivery continuation is invalid.",
    );

    mocks.fetchHostedWebControlPlaneJson
      .mockResolvedValueOnce({
        continuation: "member_destination_025",
        status: "delivered",
      })
      .mockResolvedValueOnce({
        continuation: "member_destination_025",
        status: "no-active-share",
      });
    await expect(createPort().deliver(DELIVER_REQUEST)).rejects.toThrow(
      "Hosted vault-share delivery continuation repeated.",
    );
  });

  it("fails closed on a malformed Web delivery result", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      status: "partial",
    });

    await expect(createPort().deliver(DELIVER_REQUEST)).rejects.toThrow();
  });
});
