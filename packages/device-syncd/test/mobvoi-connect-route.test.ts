import { describe, expect, it } from "vitest";

import { DEVICE_CONNECT_SOURCES } from "../src/config/connect-routes.ts";

describe("Mobvoi connect routing", () => {
  it("keeps Mobvoi setup-only without changing Samsung Health routing", () => {
    const mobvoi = DEVICE_CONNECT_SOURCES.find(
      (source) => source.connectSourceId === "mobvoi-health",
    );
    expect(mobvoi?.routes).toEqual([
      {
        kind: "unavailable",
        reason:
          "Supported Mobvoi and TicWatch data can share directly with Health Connect when the installed Mobvoi Health version offers it, with Google Fit as a fallback before connecting the Murph Android app.",
      },
    ]);

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
