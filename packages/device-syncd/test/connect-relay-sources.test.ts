import { describe, expect, it } from "vitest";

import { DEVICE_CONNECT_SOURCES } from "../src/config/connect-routes.ts";

const IOS_RELAY_SOURCE_IDS = [
  "wyze-scale",
  "eufy-life",
  "vesync-etekcity",
  "ad-heart-track",
  "microlife-connected-health",
] as const;

describe("health data relay connect routes", () => {
  it("keeps vendor relays out of hosted provider authorization", () => {
    for (const sourceId of IOS_RELAY_SOURCE_IDS) {
      const source = DEVICE_CONNECT_SOURCES.find(
        (candidate) => candidate.connectSourceId === sourceId,
      );
      expect(source?.routes).toHaveLength(1);
      const route = source?.routes[0];
      expect(route?.kind).toBe("unavailable");
      if (!route || route.kind !== "unavailable") {
        throw new Error(`${sourceId} should remain a setup-only relay`);
      }
      expect(route.reason).toContain("Apple Health");
    }

    const healthConnect = DEVICE_CONNECT_SOURCES.find(
      (candidate) => candidate.connectSourceId === "health-connect",
    );
    expect(healthConnect?.routes).toHaveLength(1);
    expect(healthConnect?.routes[0]).toMatchObject({
      kind: "unavailable",
    });

    const samsung = DEVICE_CONNECT_SOURCES.find(
      (candidate) => candidate.connectSourceId === "samsung-health",
    );
    expect(samsung?.routes).toEqual([
      {
        kind: "junction_sdk",
        sourceProviderSlug: "samsung_health",
      },
    ]);
  });
});
