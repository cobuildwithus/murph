import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    deviceConnectIntent: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  return {
    getPrisma: vi.fn(() => ({
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    })),
    tx,
  };
});

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

describe("hosted device connect intents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("creates app-page connect URLs so messaging links redeem through a browser-origin flow", async () => {
    const { createHostedDeviceConnectIntent } = await import("@/src/lib/device-sync/connect-intents");

    const result = await createHostedDeviceConnectIntent({
      connectSourceId: "whoop",
      connectTarget: "whoop",
      memberId: "member_123",
      now: new Date("2026-05-10T12:00:00.000Z"),
      provider: "whoop",
      request: new Request("https://join.example.test/api/internal/device-sync/connect-targets/whoop/connect-link"),
      sourceProviderSlug: null,
    });

    const url = new URL(result.connectUrl);
    expect(url.origin).toBe("https://join.example.test");
    expect(url.pathname).toBe("/connect");
    expect(url.search).toBe("");
    const fragment = new URLSearchParams(url.hash.slice(1));
    expect(fragment.get("deviceConnectIntent")).toBe(result.claim);
    expect(fragment.get("connectSource")).toBe("whoop");
    expect(fragment.get("deviceConnectIntent")).toMatch(/^dc_[A-Za-z0-9_-]{32}$/u);
    expect(result.deviceConnectUrl).toBe(`https://join.example.test/device/connect/${result.claim}`);
    expect(result.expiresAt).toBe("2026-05-10T12:15:00.000Z");
    expect(mocks.tx.deviceConnectIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        connectSourceId: "whoop",
        connectTarget: "whoop",
        memberId: "member_123",
        provider: "whoop",
        sourceProviderSlug: null,
      }),
    });
  });
});
