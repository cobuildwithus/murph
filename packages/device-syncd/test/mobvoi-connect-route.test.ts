import { describe, expect, it } from "vitest";

import { DEVICE_CONNECT_SOURCES } from "../src/config/connect-routes.ts";

describe("Mobvoi connect routing", () => {
  it("keeps Mobvoi out of connection identity without changing Samsung Health routing", () => {
    const connectSourceIds = new Set<string>(
      DEVICE_CONNECT_SOURCES.map((source) => source.connectSourceId),
    );
    expect(connectSourceIds.has("mobvoi-health")).toBe(false);

    const samsung = DEVICE_CONNECT_SOURCES.find(
      (source) => source.connectSourceId === "samsung-health",
    );
    expect(samsung?.routes).toEqual([
      {
        kind: "junction_sdk",
        sourceProviderSlug: "samsung_health",
      },
    ]);
  });
});
