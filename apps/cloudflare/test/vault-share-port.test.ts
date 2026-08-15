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

  it("fails closed on a malformed Web delivery result", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      status: "partial",
    });

    await expect(createPort().deliver(DELIVER_REQUEST)).rejects.toThrow();
  });
});
