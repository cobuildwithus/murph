import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberCoreState } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  buildHostedDeviceSyncSettingsResponse: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/device-sync/settings-service", () => ({
  buildHostedDeviceSyncSettingsResponse: mocks.buildHostedDeviceSyncSettingsResponse,
}));

const MEMBER: HostedMemberCoreState = {
  billingStatus: "active",
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
  id: "member_123",
  suspendedAt: null,
  updatedAt: new Date("2026-05-01T00:00:00.000Z"),
};

describe("shouldShowHomeDeviceSyncStep", () => {
  beforeEach(() => {
    mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValue({
      generatedAt: "2026-05-01T00:00:00.000Z",
      ok: true,
      sources: [],
    });
  });

  it("shows the device step for anonymous visitors", async () => {
    const { shouldShowHomeDeviceSyncStep } = await import(
      "@/src/lib/device-sync/home-onboarding"
    );

    await expect(shouldShowHomeDeviceSyncStep({ member: null })).resolves.toBe(true);
    expect(mocks.buildHostedDeviceSyncSettingsResponse).not.toHaveBeenCalled();
  });

  it("hides the device step when the member already has an active source", async () => {
    mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
      generatedAt: "2026-05-01T00:00:00.000Z",
      ok: true,
      sources: [
        {
          connectionId: "dspc_oura",
          state: "active",
        },
      ],
    });

    const { shouldShowHomeDeviceSyncStep } = await import(
      "@/src/lib/device-sync/home-onboarding"
    );

    await expect(shouldShowHomeDeviceSyncStep({ member: MEMBER })).resolves.toBe(false);
    expect(mocks.buildHostedDeviceSyncSettingsResponse).toHaveBeenCalledWith({
      member: MEMBER,
    });
  });

  it("keeps the device step visible when the only connection never finished setup", async () => {
    mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
      generatedAt: "2026-05-01T00:00:00.000Z",
      ok: true,
      sources: [
        {
          connectionId: "dspc_junction",
          setupIncomplete: true,
          state: "active",
        },
      ],
    });

    const { shouldShowHomeDeviceSyncStep } = await import(
      "@/src/lib/device-sync/home-onboarding"
    );

    await expect(shouldShowHomeDeviceSyncStep({ member: MEMBER })).resolves.toBe(true);
  });

  it("keeps the device step visible without positive active-source evidence", async () => {
    mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
      generatedAt: "2026-05-01T00:00:00.000Z",
      ok: true,
      sources: [
        {
          connectionId: null,
          state: "available",
        },
        {
          connectionId: "dspc_whoop",
          state: "disconnected",
        },
      ],
    });

    const { shouldShowHomeDeviceSyncStep } = await import(
      "@/src/lib/device-sync/home-onboarding"
    );

    await expect(shouldShowHomeDeviceSyncStep({ member: MEMBER })).resolves.toBe(true);
  });

  it("keeps the device step visible when device-sync state cannot be read", async () => {
    mocks.buildHostedDeviceSyncSettingsResponse.mockRejectedValueOnce(new Error("unavailable"));

    const { shouldShowHomeDeviceSyncStep } = await import(
      "@/src/lib/device-sync/home-onboarding"
    );

    await expect(shouldShowHomeDeviceSyncStep({ member: MEMBER })).resolves.toBe(true);
  });
});
