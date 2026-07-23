import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    hostedMember: {
      findUnique: mocks.findUnique,
    },
  }),
}));

import {
  resolveDeviceSyncVoiceMemoSources,
  resolveWhoopSyncVoiceMemoSrc,
} from "@/src/lib/device-sync/device-sync-voice-memos";

describe("device sync voice memo sources", () => {
  beforeEach(() => {
    mocks.findUnique.mockReset();
  });

  it("uses the default voice when there is no authenticated member", async () => {
    await expect(resolveDeviceSyncVoiceMemoSources(null)).resolves.toEqual({
      garminHistoricalData: "/audio/garmin-historical-data-memos/upbeat.mp3",
      whoopSync: "/audio/whoop-sync-memos/upbeat.mp3",
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("uses the member's selected voice for every device-sync memo", async () => {
    mocks.findUnique.mockResolvedValue({ assistantVoice: "grandpa" });

    await expect(resolveDeviceSyncVoiceMemoSources("member-1")).resolves.toEqual({
      garminHistoricalData: "/audio/garmin-historical-data-memos/grandpa.mp3",
      whoopSync: "/audio/whoop-sync-memos/grandpa.mp3",
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      select: { assistantVoice: true },
      where: { id: "member-1" },
    });
  });

  it("keeps the existing WHOOP resolver on the shared selected-voice lookup", async () => {
    mocks.findUnique.mockResolvedValue({ assistantVoice: "warm" });

    await expect(resolveWhoopSyncVoiceMemoSrc("member-2")).resolves.toBe(
      "/audio/whoop-sync-memos/warm.mp3",
    );
  });

  it("falls back safely when the saved voice cannot be read", async () => {
    mocks.findUnique.mockRejectedValue(new Error("database unavailable"));

    await expect(resolveDeviceSyncVoiceMemoSources("member-3")).resolves.toEqual({
      garminHistoricalData: "/audio/garmin-historical-data-memos/upbeat.mp3",
      whoopSync: "/audio/whoop-sync-memos/upbeat.mp3",
    });
  });
});
