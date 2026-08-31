import { beforeEach, expect, test, vi } from "vitest";

import { showSavedHealthView } from "../src/preferences.js";

const mocks = vi.hoisted(() => ({
  readSavedHealthViewSnapshot: vi.fn(),
}));

vi.mock("../src/runtime-import.js", () => ({
  loadRuntimeModule: vi.fn(async () => ({
    readSavedHealthViewSnapshot: mocks.readSavedHealthViewSnapshot,
  })),
}));

beforeEach(() => {
  mocks.readSavedHealthViewSnapshot.mockReset();
});

test("show saved health view uses one canonical preferences snapshot", async () => {
  const view = {
    savedViewId: "hview_00000000000123456789ABCDEF",
    name: "Daily",
    metricKeys: ["steps", "hrv-rmssd"],
  } as const;
  mocks.readSavedHealthViewSnapshot.mockResolvedValue({
    document: {
      sourcePath: "bank/preferences.json",
      updatedAt: "2026-08-30T12:00:00.000Z",
      savedHealthViews: [view],
      wearablePreferences: { desiredProviders: [] },
    },
    view,
  });

  await expect(
    showSavedHealthView({ vault: "test-vault", lookup: "daily" }),
  ).resolves.toEqual({
    vault: "test-vault",
    preferencesPath: "bank/preferences.json",
    recordedAt: "2026-08-30T12:00:00.000Z",
    view,
  });
  expect(mocks.readSavedHealthViewSnapshot).toHaveBeenCalledTimes(1);
  expect(mocks.readSavedHealthViewSnapshot).toHaveBeenCalledWith({
    vaultRoot: "test-vault",
    lookup: "daily",
  });
});
